import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { bumpTenant } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string; feature_key: string }> };

const PutBody = z
  .object({
    enabled: z.boolean().optional(),
    limit_value: z.number().min(0).nullable().optional(),
    limit_unlimited: z.boolean().optional(),
    enum_value: z.string().nullable().optional(),
    reason: z.string().min(1, "reason is required"),
    expires_at: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((b) => !(b.limit_unlimited && b.limit_value != null), {
    message: "Cannot set both limit_unlimited and a numeric limit_value",
  });

// PUT /tenants/{id}/entitlement-overrides/{feature_key} — upsert an override (§5.5)
export const PUT = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "entitlement.override");
  const { id, feature_key } = await params;

  const parsed = PutBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    throw errUnprocessable("Invalid override payload", { issues: parsed.error.issues });
  const body = parsed.data;

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const feature = await queryOne<{ id: string }>("SELECT id FROM feature WHERE `key` = ?", [feature_key]);
  if (!feature) throw errNotFound("Feature");

  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

  const row = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      `INSERT INTO tenant_entitlement_override
         (tenant_id, feature_id, enabled_override, limit_value_override, limit_unlimited_override,
          enum_value_override, reason, expires_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         enabled_override = VALUES(enabled_override),
         limit_value_override = VALUES(limit_value_override),
         limit_unlimited_override = VALUES(limit_unlimited_override),
         enum_value_override = VALUES(enum_value_override),
         reason = VALUES(reason),
         expires_at = VALUES(expires_at)`,
      [
        id,
        feature.id,
        body.enabled ?? null,
        body.limit_value ?? null,
        body.limit_unlimited ?? false,
        body.enum_value ?? null,
        body.reason,
        expiresAt,
        ctx.user.id,
      ]
    );
    await bumpTenant(conn, id);
    audit({
      action: "entitlement.override",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Set entitlement override ${feature_key} for ${tenant.name}`,
      metadata: { feature_key, reason: body.reason },
    });
    return queryOne(
      "SELECT * FROM tenant_entitlement_override WHERE tenant_id = ? AND feature_id = ?",
      [id, feature.id]
    );
  });
  return ok(row);
});

// DELETE /tenants/{id}/entitlement-overrides/{feature_key} — revert to edition (§5.5)
export const DELETE = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "entitlement.override");
  const { id, feature_key } = await params;

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const feature = await queryOne<{ id: string }>("SELECT id FROM feature WHERE `key` = ?", [feature_key]);
  if (!feature) throw errNotFound("Feature");

  await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "DELETE FROM tenant_entitlement_override WHERE tenant_id = ? AND feature_id = ?",
      [id, feature.id]
    );
    await bumpTenant(conn, id);
    audit({
      action: "entitlement.override.remove",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Removed entitlement override ${feature_key} for ${tenant.name}`,
      metadata: { feature_key },
    });
  });
  return ok({ ok: true });
});

import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { storage } from "@/lib/integrations";

type Params = { params: Promise<{ id: string }> };

const MAX_SIZE = 512 * 1024; // 512 KB (§3.5)
const ALLOWED_TYPES = ["image/png", "image/svg+xml", "image/jpeg"] as const;

const Body = z.object({
  content_type: z.enum(ALLOWED_TYPES),
  size: z.number().int().positive().max(MAX_SIZE),
});

// POST /tenants/{id}/theme/logo — record a validated tenant-scoped logo object (§3.5, §3.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.theme.write");
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success)
    throw errUnprocessable("Invalid logo upload (type must be image/png|image/svg+xml|image/jpeg, size <= 512KB)", {
      issues: parsed.error.issues,
    });

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const objectKey = storage.keyFor(id, "logo");
  await useCase(ctx, async (conn, audit) => {
    await conn.query(
      `INSERT INTO tenant_theme (tenant_id, logo_object_key, theme_tokens, updated_by)
       VALUES (?,?, JSON_OBJECT(), ?)
       ON DUPLICATE KEY UPDATE logo_object_key = VALUES(logo_object_key), updated_by = VALUES(updated_by)`,
      [id, objectKey, ctx.user.id]
    );
    audit({
      action: "tenant.theme.logo.set",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Set logo for ${tenant.name}`,
      metadata: { object_key: objectKey, content_type: parsed.data.content_type, size: parsed.data.size },
    });
  });
  return ok({ object_key: objectKey });
});

// DELETE /tenants/{id}/theme/logo — remove logo (§3.5, §3.6)
export const DELETE = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.theme.write");
  const { id } = await params;

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  await useCase(ctx, async (conn, audit) => {
    await conn.query("UPDATE tenant_theme SET logo_object_key = NULL, updated_by = ? WHERE tenant_id = ?", [
      ctx.user.id,
      id,
    ]);
    audit({
      action: "tenant.theme.logo.remove",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Removed logo for ${tenant.name}`,
    });
  });
  return ok({ object_key: null });
});

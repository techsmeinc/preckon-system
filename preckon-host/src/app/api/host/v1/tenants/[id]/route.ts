import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { storage } from "@/lib/integrations";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id} — full detail (§3.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");
  const { id } = await params;

  const tenant = await queryOne<any>(
    `SELECT t.*, e.\`key\` AS edition_key, e.name AS edition_name
       FROM tenant t JOIN edition e ON e.id = t.current_edition_id WHERE t.id = ?`,
    [id]
  );
  if (!tenant) throw errNotFound("Tenant");

  const theme = await queryOne<any>("SELECT * FROM tenant_theme WHERE tenant_id = ?", [id]);
  const subscription = await queryOne<any>(
    "SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'canceled' LIMIT 1",
    [id]
  );
  const recentAudit = await query(
    `SELECT id, occurred_at, action, summary, actor_type
       FROM audit_event WHERE target_tenant_id = ? ORDER BY seq DESC LIMIT 10`,
    [id]
  );
  const seats = await queryOne<{ seat_cap: number | null }>(
    `SELECT COALESCE(ter.limit_value_override, ef.limit_value) AS seat_cap
       FROM feature f
       LEFT JOIN edition_feature ef ON ef.edition_id = ? AND ef.feature_id = f.id
       LEFT JOIN tenant_entitlement_override ter ON ter.tenant_id = ? AND ter.feature_id = f.id
      WHERE f.\`key\` = 'limit.seats'`,
    [tenant.current_edition_id, id]
  );

  return ok({
    ...tenant,
    edition: { id: tenant.current_edition_id, key: tenant.edition_key, name: tenant.edition_name },
    theme: theme ? { ...theme, logo_url: storage.urlFor(theme.logo_object_key) } : null,
    subscription,
    seats_in_use: 0, // tenant-plane rollup (read via internal endpoint in prod)
    seat_cap: seats?.seat_cap ?? null,
    recent_audit: recentAudit,
  });
});

const Patch = z.object({
  name: z.string().min(1).optional(),
  legal_name: z.string().nullable().optional(),
  primary_contact_email: z.string().email().optional(),
  region: z.string().min(1).optional(),
});

// PATCH /tenants/{id} — edit metadata (§3.6)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.update");
  const { id } = await params;
  const body = Patch.parse(await req.json());

  const tenant = await queryOne<any>("SELECT id, name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return ok(tenant);

  await useCase(ctx, async (conn, audit) => {
    const set = fields.map(([k]) => `\`${k}\` = ?`).join(", ");
    await conn.query(`UPDATE tenant SET ${set} WHERE id = ?`, [...fields.map(([, v]) => v), id]);
    audit({
      action: "tenant.update",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Updated tenant ${tenant.name}`,
      metadata: { changed: fields.map(([k]) => k) },
    });
  });
  return ok(await queryOne("SELECT * FROM tenant WHERE id = ?", [id]));
});

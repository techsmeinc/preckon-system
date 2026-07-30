import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id}/entitlement-overrides — list overrides joined to feature (§5.5)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");
  const { id } = await params;

  const rows = await query(
    `SELECT o.tenant_id, o.feature_id, f.\`key\` AS feature_key, f.name AS feature_name,
            f.type AS feature_type, f.value_type,
            o.enabled_override, o.limit_value_override, o.limit_unlimited_override, o.enum_value_override,
            o.reason, o.expires_at, o.created_by, o.created_at, o.updated_at
       FROM tenant_entitlement_override o
       JOIN feature f ON f.id = o.feature_id
      WHERE o.tenant_id = ?
      ORDER BY f.sort_order, f.\`key\``,
    [id]
  );
  return ok({ data: rows });
});

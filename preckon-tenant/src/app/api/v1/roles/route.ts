import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { actorFromCtx } from "@/lib/usecase";
import { createRole } from "@/lib/iam";

// §1.7 GET /roles — the tenant's roles + how many permissions each grants (and the
// concrete keys, so the editor can prefill).
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "admin.users");
  const rows = await query(
    `SELECT r.id, r.\`key\`, r.name, r.tier, r.is_system,
            COUNT(rp.permission_key) AS permissions,
            GROUP_CONCAT(rp.permission_key) AS permission_keys
       FROM tenant_role r
       LEFT JOIN tenant_role_permission rp ON rp.role_id = r.id
      WHERE r.tenant_id = ?
      GROUP BY r.id, r.\`key\`, r.name, r.tier, r.is_system
      ORDER BY FIELD(r.tier, 'owner_admin','delivery','review','view'), r.name`,
    [ctx.tenantId]
  );
  return ok(rows);
});

const NewRole = z.object({
  name: z.string().min(1),
  tier: z.enum(["owner_admin", "delivery", "review", "view"]),
  permissions: z.array(z.string()).default([]),
});

// POST /roles — create a custom role from selected permissions.
export const POST = route(async (req, ctx) => {
  requirePermission(ctx, "admin.users");
  const b = NewRole.parse(await req.json());
  const res = await createRole(actorFromCtx(ctx), ctx.tenantId, b);
  return ok(res, 201);
});

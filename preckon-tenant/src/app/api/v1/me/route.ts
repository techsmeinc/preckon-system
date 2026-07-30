import { route, ok } from "@/lib/http";
import { query, queryOne } from "@/lib/db";

// GET /me — the signed-in tenant user, their tenant, domain, permissions, roles.
// Powers the console shell (nav gating, avatar, role + domain badge).
export const GET = route(async (_req, ctx) => {
  const roles = await query<{ key: string; name: string }>(
    `SELECT r.\`key\`, r.name FROM user_role ur JOIN tenant_role r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND ur.tenant_id = ?`,
    [ctx.user.id, ctx.tenantId]
  );
  const boot = await queryOne<{ domain_key: string }>(
    "SELECT domain_key FROM tenant_bootstrap WHERE tenant_id = ?",
    [ctx.tenantId]
  );
  return ok({
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    tenantId: ctx.tenantId,
    domain: boot?.domain_key ?? "construction",
    permissions: [...ctx.permissions],
    roles,
  });
});

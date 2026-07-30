import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, parsePage, paginate, q } from "@/lib/http";

// GET /audit-events — reverse-chronological list. Filters ?actor_host_user_id ?action
// ?target_type ?target_id ?target_tenant_id ?from ?to. Cursor keyed on id. (§2.4)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "audit.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const actor = q(req, "actor_host_user_id");
  const action = q(req, "action");
  const targetType = q(req, "target_type");
  const targetId = q(req, "target_id");
  const targetTenantId = q(req, "target_tenant_id");
  const from = q(req, "from");
  const to = q(req, "to");
  if (actor) (where.push("ae.actor_host_user_id = ?"), params.push(actor));
  if (action) (where.push("ae.action = ?"), params.push(action));
  if (targetType) (where.push("ae.target_type = ?"), params.push(targetType));
  if (targetId) (where.push("ae.target_id = ?"), params.push(targetId));
  if (targetTenantId) (where.push("ae.target_tenant_id = ?"), params.push(targetTenantId));
  if (from) (where.push("ae.occurred_at >= ?"), params.push(from));
  if (to) (where.push("ae.occurred_at <= ?"), params.push(to));
  if (cursor) (where.push("ae.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `SELECT ae.id, ae.seq, ae.occurred_at, ae.actor_host_user_id, ae.actor_type,
            ae.action, ae.target_type, ae.target_id, ae.target_tenant_id,
            ae.summary, ae.metadata, ae.correlation_id, ae.ip, ae.user_agent,
            hu.display_name AS actor_display_name
       FROM audit_event ae
       LEFT JOIN host_user hu ON hu.id = ae.actor_host_user_id
       ${whereSql}
      ORDER BY ae.seq DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, parsePage, paginate } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id}/impersonation-sessions — session history (who/when/why/duration) (§3.3, §3.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");
  const { id } = await params;
  const { limit, cursor } = parsePage(req);

  const params2: any[] = [id];
  let cursorSql = "";
  if (cursor) {
    cursorSql = "AND s.id < ?";
    params2.push(cursor);
  }

  const rows = await query(
    `SELECT s.id, s.tenant_id, s.host_user_id, hu.display_name AS host_user_name,
            hu.email AS host_user_email, s.reason, s.status,
            s.started_at, s.expires_at, s.ended_at,
            TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.ended_at, NOW(3))) AS duration_seconds
       FROM impersonation_session s
       LEFT JOIN host_user hu ON hu.id = s.host_user_id
      WHERE s.tenant_id = ? ${cursorSql}
      ORDER BY s.id DESC
      LIMIT ${limit + 1}`,
    params2
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

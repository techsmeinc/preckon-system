import { getAuthContext } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, parsePage, paginate, q } from "@/lib/http";

// GET /host-notifications — my inbox: targeted (me) or broadcast (NULL) (§8.3)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  const { limit, cursor } = parsePage(req);
  const unreadOnly = q(req, "unread") === "true";

  const where: string[] = ["(hn.target_host_user_id = ? OR hn.target_host_user_id IS NULL)"];
  const params: any[] = [ctx.user.id, ctx.user.id];
  if (unreadOnly) where.push("r.host_notification_id IS NULL");
  if (cursor) (where.push("hn.id < ?"), params.push(cursor));

  const rows = await query(
    `SELECT hn.id, hn.kind, hn.severity, hn.title, hn.body, hn.link,
            hn.target_host_user_id, hn.correlation_id, hn.created_at,
            (r.host_notification_id IS NOT NULL) AS is_read, r.read_at
       FROM host_notification hn
       LEFT JOIN host_notification_read r
         ON r.host_notification_id = hn.id AND r.host_user_id = ?
      WHERE ${where.join(" AND ")}
      ORDER BY hn.id DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

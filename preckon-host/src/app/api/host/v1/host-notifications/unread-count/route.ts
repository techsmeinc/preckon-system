import { getAuthContext } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /host-notifications/unread-count — my targeted/broadcast unread count (§8.3)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);

  const row = await queryOne<{ unread: number }>(
    `SELECT COUNT(*) AS unread
       FROM host_notification hn
       LEFT JOIN host_notification_read r
         ON r.host_notification_id = hn.id AND r.host_user_id = ?
      WHERE (hn.target_host_user_id = ? OR hn.target_host_user_id IS NULL)
        AND r.host_notification_id IS NULL`,
    [ctx.user.id, ctx.user.id]
  );

  return ok({ unread: Number(row?.unread ?? 0) });
});

import { getAuthContext } from "@/lib/context";
import { pool } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// POST /host-notifications/read-all — mark all my unread inbox items read (§8.3, no audit)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);

  const [res]: any = await pool.query(
    `INSERT IGNORE INTO host_notification_read (host_notification_id, host_user_id, read_at)
     SELECT hn.id, ?, NOW()
       FROM host_notification hn
       LEFT JOIN host_notification_read r
         ON r.host_notification_id = hn.id AND r.host_user_id = ?
      WHERE (hn.target_host_user_id = ? OR hn.target_host_user_id IS NULL)
        AND r.host_notification_id IS NULL`,
    [ctx.user.id, ctx.user.id, ctx.user.id]
  );

  return ok({ marked_read: res?.affectedRows ?? 0 });
});

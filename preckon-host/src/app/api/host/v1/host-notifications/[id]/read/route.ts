import { getAuthContext } from "@/lib/context";
import { pool, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// POST /host-notifications/{id}/read — mark one inbox item read (§8.3, no audit)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  const { id } = await params;

  const notif = await queryOne<{ id: string }>(
    `SELECT id FROM host_notification
      WHERE id = ? AND (target_host_user_id = ? OR target_host_user_id IS NULL)`,
    [id, ctx.user.id]
  );
  if (!notif) throw errNotFound("Notification");

  await pool.query(
    "INSERT IGNORE INTO host_notification_read (host_notification_id, host_user_id, read_at) VALUES (?,?,NOW())",
    [id, ctx.user.id]
  );

  return ok({ id, read: true });
});

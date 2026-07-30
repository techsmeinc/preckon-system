import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET /notifications/{id} — detail + delivery stats (§8.3)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "notification.read");
  const { id } = await params;

  const notification = await queryOne<any>(
    `SELECT n.*,
            (SELECT COUNT(*) FROM notification_delivery d WHERE d.notification_id = n.id) AS recipient_count,
            (SELECT COUNT(*) FROM notification_delivery d
               WHERE d.notification_id = n.id AND d.read_at IS NOT NULL) AS read_count
       FROM notification n WHERE n.id = ?`,
    [id]
  );
  if (!notification) throw errNotFound("Notification");

  return ok(notification);
});

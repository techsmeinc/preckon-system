import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { resolveAudience, fanOut, type AudienceType, type AudienceFilter } from "../../_audience";

type Params = { params: Promise<{ id: string }> };

// POST /notifications/{id}/send — send a saved draft now (§8.3)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "notification.send");
  const { id } = await params;

  const draft = await queryOne<{
    id: string;
    title: string;
    status: string;
    audience_type: AudienceType;
    audience_filter: AudienceFilter | string;
  }>("SELECT id, title, status, audience_type, audience_filter FROM notification WHERE id = ?", [id]);
  if (!draft) throw errNotFound("Notification");
  if (draft.status === "sent")
    throw errUnprocessable("Notification has already been sent");

  const filter =
    typeof draft.audience_filter === "string"
      ? (JSON.parse(draft.audience_filter) as AudienceFilter)
      : draft.audience_filter;
  const tenantIds = await resolveAudience(draft.audience_type, filter);

  const result = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "UPDATE notification SET status='sent', sent_at=NOW() WHERE id=?",
      [id]
    );
    await fanOut(conn, id, tenantIds);
    audit({
      action: "notification.send",
      targetType: "notification",
      targetId: id,
      summary: `Sent broadcast "${draft.title}" to ${tenantIds.length} tenant(s)`,
      metadata: { audience_type: draft.audience_type, recipient_count: tenantIds.length },
    });
    return queryOne("SELECT * FROM notification WHERE id = ?", [id]);
  });

  return ok({ ...(result as object), recipient_count: tenantIds.length });
});

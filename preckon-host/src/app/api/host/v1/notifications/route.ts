import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, ok, parsePage, paginate, q } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";
import { resolveAudience, fanOut } from "./_audience";

// GET /notifications — sent/draft list with per-broadcast delivery + read stats (§8.3)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "notification.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const status = q(req, "status");
  if (status) (where.push("n.status = ?"), params.push(status));
  if (cursor) (where.push("n.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `SELECT n.id, n.title, n.body, n.audience_type, n.audience_filter,
            n.deliver_in_app, n.deliver_email, n.status, n.scheduled_at, n.sent_at,
            n.author_host_user_id, n.created_at, n.updated_at,
            (SELECT COUNT(*) FROM notification_delivery d WHERE d.notification_id = n.id) AS recipient_count,
            (SELECT COUNT(*) FROM notification_delivery d
               WHERE d.notification_id = n.id AND d.read_at IS NOT NULL) AS read_count
       FROM notification n
       ${whereSql}
      ORDER BY n.id DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

const Compose = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audience_type: z.enum(["all_tenants", "by_edition", "by_status", "specific"]),
  audience_filter: z.record(z.any()).default({}),
  deliver_in_app: z.boolean().default(true),
  deliver_email: z.boolean().default(false),
  status: z.enum(["draft", "sent"]).default("draft"),
  scheduled_at: z.string().datetime().optional(),
});

// POST /notifications — compose; draft saves, sent resolves audience + fans out (§8.3)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "notification.send");
  const body = Compose.parse(await req.json());

  // Resolve the audience up front (reads) so we can fan out inside the tx.
  const tenantIds =
    body.status === "sent"
      ? await resolveAudience(body.audience_type, body.audience_filter)
      : [];

  const result = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    const sent = body.status === "sent";
    await conn.query(
      `INSERT INTO notification
         (id, author_host_user_id, title, body, audience_type, audience_filter,
          deliver_in_app, deliver_email, status, scheduled_at, sent_at)
       VALUES (?,?,?,?,?, ?, ?,?,?,?, ${sent ? "NOW()" : "NULL"})`,
      [
        id,
        ctx.user.id,
        body.title,
        body.body,
        body.audience_type,
        JSON.stringify(body.audience_filter),
        body.deliver_in_app,
        body.deliver_email,
        body.status,
        body.scheduled_at ?? null,
      ]
    );

    if (sent) await fanOut(conn, id, tenantIds);

    audit({
      action: sent ? "notification.send" : "notification.draft",
      targetType: "notification",
      targetId: id,
      summary: sent
        ? `Sent broadcast "${body.title}" to ${tenantIds.length} tenant(s)`
        : `Drafted broadcast "${body.title}"`,
      metadata: {
        audience_type: body.audience_type,
        recipient_count: tenantIds.length,
        deliver_in_app: body.deliver_in_app,
        deliver_email: body.deliver_email,
      },
    });

    return { id, ...body, recipient_count: tenantIds.length };
  });

  return ok(result, 201);
});

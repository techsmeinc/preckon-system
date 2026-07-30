import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errConflict, errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };
const Body = z.object({ reason: z.string().min(1, "reason is required") });

// POST /tenants/{id}/impersonate — open a time-boxed impersonation session (§3.3, §3.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.impersonate");
  const { id } = await params;
  const { reason } = Body.parse(await req.json());

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const active = await queryOne<{ id: string }>(
    "SELECT id FROM impersonation_session WHERE host_user_id = ? AND status = 'active'",
    [ctx.user.id]
  );
  if (active) throw errConflict("You already have an active impersonation session");

  // §3.3 hard time-box; default 30 minutes from platform settings.
  const setting = await queryOne<{ value: number }>(
    "SELECT value FROM platform_setting WHERE `key` = 'impersonation.max_minutes'",
    []
  );
  const maxMinutes = Number(setting?.value ?? 30) || 30;

  const sessionId = newId();
  const session = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      `INSERT INTO impersonation_session (id, tenant_id, host_user_id, reason, status, expires_at, ip, user_agent)
       VALUES (?,?,?,?, 'active', DATE_ADD(NOW(3), INTERVAL ? MINUTE), ?, ?)`,
      [sessionId, id, ctx.user.id, reason, maxMinutes, ctx.ip, ctx.userAgent]
    );
    audit({
      action: "tenant.impersonate",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Started impersonating ${tenant.name}`,
      metadata: { reason, session_id: sessionId },
    });
    return queryOne<{ expires_at: string }>(
      "SELECT expires_at FROM impersonation_session WHERE id = ?",
      [sessionId]
    );
  });

  return ok({
    session_id: sessionId,
    tenant_id: id,
    url: `/impersonate/${id}?session=${sessionId}`,
    expires_at: session?.expires_at ?? null,
  });
});

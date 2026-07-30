import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string; session_id: string }> };

// POST /tenants/{id}/impersonate/{session_id}/end — end an active session (§3.3, §3.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.impersonate");
  const { id, session_id } = await params;

  const session = await queryOne<{ status: string }>(
    "SELECT status FROM impersonation_session WHERE id = ? AND tenant_id = ?",
    [session_id, id]
  );
  if (!session) throw errNotFound("Impersonation session");

  const updated = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "UPDATE impersonation_session SET status='ended', ended_at=NOW(3) WHERE id=? AND status='active'",
      [session_id]
    );
    audit({
      action: "tenant.impersonate.end",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Ended impersonation session`,
      metadata: { session_id },
    });
    return queryOne("SELECT * FROM impersonation_session WHERE id = ?", [session_id]);
  });
  return ok(updated);
});

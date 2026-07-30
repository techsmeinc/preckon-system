import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";

// GET /audit-events/{id} — single event incl. metadata, hash, prev_hash. (§2.4)
export const GET = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "audit.read");
  const { id } = await params;

  const event = await queryOne(
    `SELECT ae.id, ae.seq, ae.occurred_at, ae.actor_host_user_id, ae.actor_type,
            ae.action, ae.target_type, ae.target_id, ae.target_tenant_id,
            ae.summary, ae.metadata, ae.correlation_id, ae.ip, ae.user_agent,
            ae.prev_hash, ae.hash,
            hu.display_name AS actor_display_name
       FROM audit_event ae
       LEFT JOIN host_user hu ON hu.id = ae.actor_host_user_id
      WHERE ae.id = ?`,
    [id]
  );
  if (!event) throw errNotFound("Audit event");
  return ok(event);
});

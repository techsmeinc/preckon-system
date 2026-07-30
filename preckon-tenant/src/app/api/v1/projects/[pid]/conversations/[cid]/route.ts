import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";

// §6.3 GET /projects/{pid}/conversations/{cid} — messages in a thread.
export const GET = route<{ pid: string; cid: string }>(async (_req, ctx, { pid, cid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const messages = await query(
    "SELECT id, role, content, referenced_artifact_ids, job_id, author_user_id, created_at FROM orchestrator_message WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at ASC",
    [ctx.tenantId, cid]
  );
  return ok({ id: cid, messages });
});

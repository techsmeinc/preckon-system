import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";

// §6.3 GET /projects/{pid}/runs/{rid}/deviations — proposed/decided deviations.
export const GET = route<{ pid: string; rid: string }>(async (_req, ctx, { pid, rid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const rows = await query(
    "SELECT id, proposed_by, kind, target_step_id, rationale, payload, status, created_at FROM run_deviation WHERE tenant_id = ? AND run_id = ? ORDER BY created_at DESC",
    [ctx.tenantId, rid]
  );
  return ok(rows);
});

import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";

// §4.6 GET /projects/{pid}/runs/{rid} — run + steps status.
export const GET = route<{ pid: string; rid: string }>(async (_req, ctx, { pid, rid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const run = await queryOne(
    "SELECT id, workflow_key, workflow_version, status, started_at, ended_at FROM workflow_run WHERE id = ? AND tenant_id = ? AND project_id = ?",
    [rid, ctx.tenantId, pid]
  );
  if (!run) throw errNotFound("Run");
  const steps = await query(
    `SELECT id, node_id, kind, agent_key, parent_step_id, map_index, status, attempt,
            output_artifact_ids, gate_types, job_id, started_at, ended_at
       FROM workflow_run_step WHERE run_id = ? AND tenant_id = ? ORDER BY created_at ASC`,
    [rid, ctx.tenantId]
  );
  return ok({ ...run, steps });
});

import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { queryOne } from "@/lib/db";

// GET /projects/{pid}/boq/roster — how the bill was built.
//
// The specialists the Agent Designer invented for this project, the checks it
// decided the bill must pass, and how each check came out. A reviewer facing 200
// priced lines needs to know who wrote them and what was audited; a bill with no
// visible provenance is one you have to re-check by hand.

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{ roster: any; ended_at: string | null; model: string | null }>(
    `SELECT roster, ended_at, model
       FROM ai_job
      WHERE tenant_id = ? AND project_id = ? AND job_type = 'boq.derive_lines'
        AND roster IS NOT NULL
      ORDER BY queued_at DESC LIMIT 1`,
    [ctx.tenantId, pid]
  );
  if (!row) return ok({ roster: null });

  const roster = typeof row.roster === "string" ? JSON.parse(row.roster) : row.roster;
  return ok({ roster, ran_at: row.ended_at, model: row.model });
});

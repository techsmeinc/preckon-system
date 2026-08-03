import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { enqueueJob, type JobInputArtifact } from "@/lib/jobs";
import { newId } from "@/lib/ids";

// POST /projects/{pid}/narrative/{section} — write ONE section of the submission.
//
// The whole narrative also runs as a workflow, but a section is the unit a
// reviewer actually works in: they reject HSE, or the programme shifts and only
// the programme section is now wrong. Re-running all seven to fix one is slow,
// expensive, and — worse — rewrites six sections somebody had already accepted.
//
// Enqueued as a standalone job with a synthetic step, the same way a supervisor
// turn is (see persona.ts). It is not a workflow node: there is no gate to
// advance and nothing downstream waiting on it.

const SECTIONS = new Set([
  "executive_summary",
  "company_profile",
  "technical_approach",
  "programme",
  "quality",
  "hse",
  "risk_management",
]);

/** What a narrative section is written from — the same grounding the workflow gives it. */
const CONSUMES = ["tender_summary", "spec_clause", "boq_line", "cost_line", "schedule_activity", "procurement_package"];

export const POST = route<{ pid: string; section: string }>(async (_req, ctx, { pid, section }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);

  if (!SECTIONS.has(section)) {
    return ok({ error: `unknown section '${section}'` }, 400);
  }

  const inputs: JobInputArtifact[] = [];
  for (const type of CONSUMES) {
    const rows = await query<{ id: string; type_key: string; payload: any }>(
      `SELECT id, type_key, payload FROM artifact
        WHERE tenant_id = ? AND project_id = ? AND type_key LIKE ? AND status = 'confirmed'`,
      [ctx.tenantId, pid, `%${type}`]
    );
    for (const r of rows) inputs.push({ id: r.id, type: r.type_key, payload: r.payload });
  }

  const jobId = await enqueueJob({
    ctx: {
      tenantId: ctx.tenantId,
      projectId: pid,
      runId: "",
      stepId: newId(), // synthetic — this is not a workflow step
      agentKey: "agent.narrative",
    },
    agentKind: "worker",
    jobType: "narrative.compose",
    tier: "deep",
    promptRef: "narrative.compose@v1",
    inputArtifacts: inputs,
    params: { section },
    // Without this every regeneration of the same section collides on the
    // default idempotency key and the second one is silently dropped.
    idempotencyKey: `${pid}:narrative:${section}:${Date.now()}`,
  });

  return ok({ job_id: jobId, section, grounded_on: inputs.length });
});

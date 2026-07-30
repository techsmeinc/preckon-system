import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { getArtifact } from "@/lib/store";
import { errNotFound } from "@/lib/errors";

// §9.3 GET /projects/{pid}/artifacts/{id}/trace — the defensibility view:
// provenance graph + producing job (model/confidence/trace) + audit events.
export const GET = route<{ pid: string; id: string }>(async (_req, ctx, { pid, id }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const a = await getArtifact(ctx.tenantId, id);
  if (!a || a.project_id !== pid) throw errNotFound("Artifact");

  const provenance = await query(
    `SELECT ap.source_artifact_id, src.type_key
       FROM artifact_provenance ap JOIN artifact src ON src.id = ap.source_artifact_id
      WHERE ap.artifact_id = ? AND ap.tenant_id = ?`,
    [id, ctx.tenantId]
  );
  const job = a.source_run_id
    ? await queryOne(
        "SELECT id, job_type, tier, model, prompt_ref, trace_id, input_tokens, output_tokens, cost_minor FROM ai_job WHERE step_id = ? AND tenant_id = ? LIMIT 1",
        [a.source_step_id, ctx.tenantId]
      )
    : null;
  const audit = await query(
    "SELECT seq, action, actor_kind, actor_id, created_at FROM audit_event WHERE tenant_id = ? AND target_id = ? ORDER BY seq ASC",
    [ctx.tenantId, id]
  );

  return ok({
    artifact: { id: a.id, type: a.type_key, status: a.status, confidence: a.confidence, version: a.version },
    provenance,
    producingJob: job,
    auditEvents: audit,
  });
});

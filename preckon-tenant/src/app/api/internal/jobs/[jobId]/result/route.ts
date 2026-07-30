import { serviceRoute, ok } from "@/lib/http";
import { queryOne } from "@/lib/db";
import { onJobResult } from "@/lib/runtime";
import { handleSupervisorResult } from "@/lib/persona";
import type { JobResult } from "@/lib/jobs";
import type { AuditActor } from "@/lib/audit";

// §5.9 POST /internal/jobs/{jobId}/result — the worker's result callback (service
// auth, idempotent by job id). Records result/usage/trace, materializes outputs
// via emitArtifact, and advances the step — or, for a supervisor job, appends the
// chat turn + deviations. This is the seam that fires onJobResult (§5.4).
export const POST = serviceRoute<{ jobId: string }>(async (req, { jobId }) => {
  const body = (await req.json()) as JobResult;
  body.job_id = jobId;

  const job = await queryOne<{ tenant_id: string; agent_key: string }>(
    "SELECT tenant_id, agent_key FROM ai_job WHERE id = ?",
    [jobId]
  );
  const actor: AuditActor = {
    tenantId: job?.tenant_id ?? "",
    actorId: job?.agent_key ?? "worker",
    actorKind: "agent",
  };

  // Supervisor/conversation jobs route to the persona handler; worker steps to the runtime.
  const handled = await handleSupervisorResult(actor, body);
  if (!handled) await onJobResult(actor, body);

  return ok({ ok: true });
});

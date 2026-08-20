import type { AgentContext } from "./abi";
import { query } from "./db";
import { newId } from "./ids";
import { TIER_ORDER, type Tier } from "./constants";
import { claimForDispatch, clearLease, releaseForRetry } from "./job-queue";
import { currentRequestId, logWarn } from "./log";
import { decideDispatch, type DispatchDecision } from "./ai/govern";
import { loadRegistry, loadTenantPolicy, recordUsage, spendFor } from "./ai/store";
import { TIER_ALIAS } from "./ai/registry";
import type { Sensitivity } from "./ai/policy";

// ── §5 The job seam. Core owns dispatch + tracking; the stateless worker runs
// the (stub) agent logic and returns proposals. The worker has NO store access
// (trust boundary §5.1) — Core inlines inputs into the envelope and materializes
// outputs on the result callback.

export interface JobInputArtifact {
  id: string;
  type: string;
  payload: any;
}

export interface JobEnvelope {
  job_id: string;
  job_type: string;
  agent_key: string;
  agent_kind: "worker" | "service" | "supervisor";
  tenant_id: string;
  project_id: string;
  run_id: string;
  step_id: string;
  tier: Tier;
  prompt_ref: string;
  inputs: { artifacts: JobInputArtifact[]; params: Record<string, unknown> };
  idempotency_key: string;
}

export interface JobOutput {
  type: string;
  payload: any;
  provenance: string[];
  confidence?: number;
}

export interface JobResult {
  job_id: string;
  status: "succeeded" | "failed";
  outputs?: JobOutput[];
  // supervisor jobs return a chat message + deviation proposals instead of outputs
  message?: { role: "assistant"; content: string; referenced_artifact_ids?: string[] };
  /** For the multi-agent bill: the specialist roster the designer invented and
   *  the verifier's verdicts. Provenance of the run, not a proposal. */
  roster?: Record<string, unknown> | null;
  deviations?: Array<{
    kind: "rerun_step" | "insert_review_gate" | "skip_step" | "request_review" | "flag";
    target_step_id?: string | null;
    rationale: string;
    payload?: Record<string, unknown>;
  }>;
  usage?: { model: string; input_tokens: number; output_tokens: number; cost_minor: number };
  trace_id?: string;
  error?: { message: string } | null;
}

// Tiers → concrete model ids resolved in CONFIG, not schema (§5.5), so a model
// swap is a config change. Stub agents ignore the model; it is recorded for
// tracing/metering fidelity.
const TIER_MODEL: Record<Tier, string> = {
  routing: process.env.MODEL_ROUTING ?? "claude-haiku-4-5",
  standard: process.env.MODEL_STANDARD ?? "claude-sonnet-5",
  deep: process.env.MODEL_DEEP ?? "claude-opus-4-8",
};

/** Clamp a requested tier down to an edition's max_tier (§5.5). */
export function clampTier(requested: Tier, maxTier: Tier): Tier {
  return TIER_ORDER.indexOf(requested) <= TIER_ORDER.indexOf(maxTier) ? requested : maxTier;
}

// ── Dispatcher: how an envelope reaches the worker. Default = HTTP POST to the
// worker (production/docker). Overridable so tests can run the worker's compute
// in-process and drive the callback deterministically without a network hop.
export type Dispatcher = (env: JobEnvelope) => Promise<void>;

let dispatcher: Dispatcher = async (env) => {
  const url = `${process.env.WORKER_URL ?? "http://localhost:4000"}/run`;
  const rq = currentRequestId();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN ?? ""}`,
      // Carries the trace across the process boundary. The worker echoes it on
      // the result callback, so its half of the work lands on the same request
      // id as the click that started it.
      ...(rq ? { "x-request-id": rq } : {}),
    },
    body: JSON.stringify(env),
  });
  if (!res.ok && res.status !== 202)
    throw new Error(`worker dispatch failed (${res.status})`);
};

export function setDispatcher(fn: Dispatcher): void {
  dispatcher = fn;
}

/**
 * Send an envelope using whatever dispatcher is currently configured.
 *
 * The reconciler needs this rather than the module-private binding: tests swap
 * the dispatcher for an in-process one, and recovery has to follow the swap or
 * it would quietly go to the network in a test that never expected it to.
 */
export const dispatchEnvelope: Dispatcher = (env) => dispatcher(env);

export interface EnqueueInput {
  ctx: AgentContext;
  agentKind: "worker" | "service" | "supervisor";
  jobType: string;
  tier: Tier;
  promptRef: string;
  inputArtifacts: JobInputArtifact[];
  params?: Record<string, unknown>;
  /** Override the idempotency key (§5.7). A re-run is genuinely new work, so it
   *  carries the step attempt to stay distinct from the prior job. */
  idempotencyKey?: string;
}

/** §5.4 — write ai_job (queued) + push the JobEnvelope to the worker. Returns jobId. */
export async function enqueueJob(input: EnqueueInput): Promise<string> {
  const jobId = newId();
  const idempotencyKey =
    input.idempotencyKey ?? `${input.ctx.stepId}:${input.jobType}:${input.ctx.tenantId}`;
  const envelope: JobEnvelope = {
    job_id: jobId,
    job_type: input.jobType,
    agent_key: input.ctx.agentKey,
    agent_kind: input.agentKind,
    tenant_id: input.ctx.tenantId,
    project_id: input.ctx.projectId,
    run_id: input.ctx.runId,
    step_id: input.ctx.stepId,
    tier: input.tier,
    prompt_ref: input.promptRef,
    inputs: { artifacts: input.inputArtifacts, params: input.params ?? {} },
    idempotency_key: idempotencyKey,
  };

  await query(
    `INSERT INTO ai_job
       (id, tenant_id, project_id, run_id, step_id, agent_key, job_type, status,
        tier, model, envelope, prompt_ref, idempotency_key)
     VALUES (?,?,?,?,?,?,?, 'queued', ?,?,?,?,?)`,
    [
      jobId,
      input.ctx.tenantId,
      input.ctx.projectId,
      input.ctx.runId,
      input.ctx.stepId,
      input.ctx.agentKey,
      input.jobType,
      input.tier,
      TIER_MODEL[input.tier],
      JSON.stringify(envelope),
      input.promptRef,
      idempotencyKey,
    ]
  );

  // Bind the job to its run step BEFORE dispatch. A synchronous (in-process)
  // dispatcher can drive onJobResult immediately, which looks the step up by
  // job_id — so this write must precede the dispatch. No-op for supervisor jobs
  // whose stepId isn't a real workflow_run_step.
  await query("UPDATE workflow_run_step SET job_id = ? WHERE id = ? AND tenant_id = ?", [
    jobId,
    input.ctx.stepId,
    input.ctx.tenantId,
  ]);

  /* Dispatch is best-effort; the ROW is the commitment.

     This used to be a bare `await dispatcher(envelope)`, so a worker that was
     restarting took the whole enqueue down with it — with the ai_job row already
     written, the step already bound, and nothing anywhere that would ever look
     at that row again. One worker restart could strand every job in flight.

     Now the job is claimed before it is sent and released for retry if the send
     fails, so a failure here costs a few seconds of latency instead of the work.
     The reconciler picks up anything this misses, including the case where Core
     dies between the INSERT and the POST. */
  const claimed = await claimForDispatch(jobId);
  if (!claimed) return jobId; // a reconciler already has it

  try {
    await dispatcher(envelope);
  } catch (e: any) {
    const outcome = await releaseForRetry(jobId, e?.message ?? "dispatch failed");
    logWarn("job dispatch failed", { jobId, jobType: input.jobType, outcome, err: e?.message });
  }
  return jobId;
}

/** Record the raw result/usage/trace on the ai_job row (idempotent by status). */
export async function recordJobResult(result: JobResult): Promise<{
  job: any;
  alreadyDone: boolean;
}> {
  const rows = await query<any>("SELECT * FROM ai_job WHERE id = ?", [result.job_id]);
  const job = rows[0];
  if (!job) throw new Error(`ai_job ${result.job_id} not found`);
  if (job.status === "succeeded" || job.status === "failed")
    return { job, alreadyDone: true }; // idempotent — duplicate callback is a no-op

  const status = result.status === "succeeded" ? "succeeded" : "failed";
  // The queue stops watching a job the moment a real result lands, so the
  // reconciler cannot reclaim one that has already reported.
  await clearLease(result.job_id);
  await query(
    `UPDATE ai_job SET status = ?, result = ?, roster = COALESCE(?, roster), error = ?, trace_id = ?,
        input_tokens = ?, output_tokens = ?, cost_minor = ?, model = COALESCE(?, model),
        started_at = COALESCE(started_at, NOW(3)), ended_at = NOW(3)
      WHERE id = ?`,
    [
      status,
      JSON.stringify(result.outputs ?? result.message ?? null),
      result.roster ? JSON.stringify(result.roster) : null,
      result.error ? JSON.stringify(result.error) : null,
      result.trace_id ?? null,
      result.usage?.input_tokens ?? null,
      result.usage?.output_tokens ?? null,
      result.usage?.cost_minor ?? null,
      result.usage?.model ?? null,
      result.job_id,
    ]
  );
  return { job: { ...job, status }, alreadyDone: false };
}

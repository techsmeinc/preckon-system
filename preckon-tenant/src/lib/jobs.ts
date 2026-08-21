import type { AgentContext } from "./abi";
import { query } from "./db";
import { newId } from "./ids";
import { TIER_ORDER, type Tier } from "./constants";
import { claimForDispatch, clearLease, releaseForRetry } from "./job-queue";
import { currentRequestId, logInfo, logWarn } from "./log";
import { decideDispatch, type DispatchDecision } from "./ai/govern";
import { loadRegistry, loadTenantPolicy, recordUsage, spendFor } from "./ai/store";
import { TIER_ALIAS } from "./ai/registry";
import { parseRef, resolvePrompt } from "./ai/prompt-store";
import type { CacheDimensions } from "./ai/cache";
import * as responseCache from "./ai/cache-store";
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
  /** Dimensions this dispatch would be cached under. Carried on the envelope so
   *  the completion path can write the answer back without recomputing them —
   *  the policy version and prompt version in force at DISPATCH are what the
   *  answer was produced under, and re-deriving them at completion would silently
   *  file the result under a version it never ran. */
  cache?: CacheDimensions;
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
  /** Set only by tryCachedJob. Never sent by a worker, which is the point: a
   *  stub-mode result also reports zero tokens, and inferring "cached" from a
   *  zero cost would file it as reuse that never happened. */
  from_cache?: boolean;
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

/** Raised when the tenant's AI policy or budget forbids a job outright. */
export class DispatchNotPermitted extends Error {
  constructor(public decision: DispatchDecision) {
    super(decision.why);
    this.name = "DispatchNotPermitted";
  }
}

/**
 * Ask the governance layer before spending anyone's money or sending anyone's
 * data anywhere.
 *
 * Runs on the enqueue path, which is the last point where refusing is cheap:
 * after this the envelope is at the worker and the tokens are gone. Failures
 * here resolve to "permitted" on purpose — see store.ts. Governance that can
 * take the product down when its own tables hiccup would not survive contact
 * with a release.
 */
async function governDispatch(input: EnqueueInput): Promise<DispatchDecision> {
  const alias = TIER_ALIAS[input.tier] ?? input.tier;
  const [{ policy, version }, registry] = await Promise.all([
    loadTenantPolicy(input.ctx.tenantId),
    loadRegistry(),
  ]);
  const spend = await spendFor(input.ctx.tenantId, input.ctx.projectId);

  // A rough token estimate from the inlined artifacts — four characters to the
  // token. Precise enough to catch a request that is an order of magnitude too
  // large, which is what a pre-flight budget check is for.
  const inlined = JSON.stringify(input.inputArtifacts ?? []).length;
  return decideDispatch({
    alias,
    registry,
    policy,
    policyVersion: version,
    sensitivity: input.sensitivity,
    module: input.ctx.agentKey,
    estimatedInputTokens: Math.ceil(inlined / 4),
    spend,
    fallbackModel: TIER_MODEL[input.tier],
    enforce: process.env.AI_POLICY_ENFORCE === "1",
  });
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
  /** How sensitive the inlined inputs are. Omitted means `confidential`, which
   *  is policy.ts's deliberate default: unclassified data is treated as the
   *  thing you would least like to send to a third party. */
  sensitivity?: Sensitivity;
}

/* ── Response cache ──────────────────────────────────────────────────────────
   Two switches, deliberately separate.

   Warming is on by default: every completed job stores its answer, and the hit
   counters then show what reuse WOULD have saved. That is the number worth
   having before turning reuse on, and collecting it costs one insert.

   Reuse is off by default, behind AI_CACHE_REUSE. Serving a stored answer
   instead of calling the model is a real behaviour change on a live system, and
   it should be somebody's decision rather than a side effect of a deploy — the
   same reasoning that left policy enforcement report-only behind a flag. */
const CACHE_WARM = process.env.AI_CACHE_WARM !== "off";
const CACHE_REUSE = process.env.AI_CACHE_REUSE === "on";
/** Reuse ceiling. Correctness comes from the key; this only bounds staleness for
 *  things the key cannot see, so it is a backstop rather than the mechanism. */
const CACHE_MAX_AGE_MS = Number(process.env.AI_CACHE_MAX_AGE_MS ?? 30 * 24 * 3600_000);

/**
 * The dimensions this dispatch is cached under.
 *
 * `input` is the whole request — artifacts and params — rather than a prompt
 * string, because that is what actually determines the answer: two jobs with the
 * same params over different artifacts are different questions. It is hashed
 * into the key and never stored, so its size here does not matter.
 *
 * The artifact ids double as revision keys, which is what makes scoped
 * invalidation work: re-issuing a document produces a new artifact id, so every
 * answer computed from the old one can be found and dropped.
 */
export function cacheDimensionsFor(
  input: EnqueueInput, decision: DispatchDecision, promptRef: string,
): CacheDimensions {
  return {
    tenantId: input.ctx.tenantId,
    projectId: input.ctx.projectId ?? null,
    taskType: input.jobType,
    input: JSON.stringify({
      artifacts: input.inputArtifacts.map((a) => ({ id: a.id, type: a.type })),
      params: input.params ?? {},
    }),
    revisionKeys: input.inputArtifacts.map((a) => a.id),
    sensitivity: decision.sensitivity,
    policyVersion: decision.policyVersion,
    promptVersion: promptRef,
    modelAlias: decision.alias,
  };
}

/** MySQL hands back JSON columns already parsed on some drivers and as a string
 *  on others. Tolerating both here beats a crash in the completion path. */
function parseEnvelope(raw: unknown): JobEnvelope | null {
  try {
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as JobEnvelope;
  } catch {
    return null;
  }
}

/** What a cache hit yields: a job row that already has its answer. */
export interface CachedJob {
  jobId: string;
  result: JobResult;
  savedMinor: number;
}

/**
 * Serve a job from the cache, if reuse is permitted and an answer is stored.
 *
 * Returns a real ai_job row and a JobResult, NOT a shortcut. The caller passes
 * the result through the same completion path a worker's callback takes, so a
 * cached answer produces the same artifacts, the same audit events and the same
 * workflow advance as a computed one. A cache that bypassed materialisation
 * would produce runs whose outputs exist only when the cache missed.
 *
 * Null means "call the model" — for a miss, for reuse being switched off, and
 * for any failure. There is no path here that can stop work happening.
 */
export async function tryCachedJob(input: EnqueueInput): Promise<CachedJob | null> {
  if (!CACHE_REUSE) return null;
  try {
    const decision = await governDispatch(input);
    if (!decision.permitted && decision.blocked) return null; // let enqueueJob refuse it properly

    const prompt = await resolvePrompt(input.jobType, input.promptRef);
    const dims = cacheDimensionsFor(input, decision, prompt.ref);
    const hit = await responseCache.lookup(input.ctx.tenantId, dims, CACHE_MAX_AGE_MS);
    if (!hit) return null;

    const jobId = newId();
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
      prompt_ref: prompt.ref,
      inputs: { artifacts: input.inputArtifacts, params: input.params ?? {} },
      idempotency_key:
        input.idempotencyKey ?? `${input.ctx.stepId}:${input.jobType}:${input.ctx.tenantId}`,
      cache: dims,
    };

    // Written as 'queued' like any other job. recordJobResult moves it to
    // succeeded, so the row passes through the same states and the job list
    // does not grow a second kind of history to understand.
    await query(
      `INSERT INTO ai_job
         (id, tenant_id, project_id, run_id, step_id, agent_key, job_type, status,
          tier, model, envelope, prompt_ref, idempotency_key)
       VALUES (?,?,?,?,?,?,?, 'queued', ?,?,?,?,?)`,
      [
        jobId, input.ctx.tenantId, input.ctx.projectId, input.ctx.runId, input.ctx.stepId,
        input.ctx.agentKey, input.jobType, input.tier, decision.model,
        JSON.stringify(envelope), prompt.ref, envelope.idempotency_key,
      ],
    );
    await query("UPDATE workflow_run_step SET job_id = ? WHERE id = ? AND tenant_id = ?", [
      jobId, input.ctx.stepId, input.ctx.tenantId,
    ]);

    const cached = hit.response as { outputs?: any[]; message?: any } | null;
    logInfo("ai.cache.hit", {
      jobId, jobType: input.jobType, key: hit.key, hits: hit.hits, savedMinor: hit.costMinor,
    });

    return {
      jobId,
      savedMinor: hit.costMinor,
      result: {
        job_id: jobId,
        status: "succeeded",
        outputs: cached?.outputs ?? [],
        message: cached?.message,
        from_cache: true,
        // Zero cost and zero tokens, because none were spent. The ledger row
        // this becomes is marked cache_hit, so "what did we spend" and "what
        // did we serve" stay separable.
        usage: { model: decision.model, input_tokens: 0, output_tokens: 0, cost_minor: 0 },
      },
    };
  } catch (e) {
    logWarn("ai.cache.serve_failed", { jobType: input.jobType, error: String(e) });
    return null;
  }
}

/** §5.4 — write ai_job (queued) + push the JobEnvelope to the worker. Returns jobId. */
export async function enqueueJob(input: EnqueueInput): Promise<string> {
  const jobId = newId();
  const idempotencyKey =
    input.idempotencyKey ?? `${input.ctx.stepId}:${input.jobType}:${input.ctx.tenantId}`;

  /* Policy, registry and budget, before anything is written or sent.
     A refusal is recorded in the ledger rather than only thrown: "what did the
     policy stop, and what would it have stopped" is the question an operator
     actually asks, and it cannot be answered from an exception that vanished
     into a log line. */
  const decision = await governDispatch(input);

  /* Resolve the prompt through the registry.
     input.promptRef is the caller's default — a `${type}@v1` string built from
     the job_type row. When a prompt is registered and approved for this task,
     the registry's version wins and the ref recorded against the job is the one
     that actually ran. When nothing is registered the caller's ref survives
     untouched, so an unregistered task behaves exactly as it did before. */
  const prompt = await resolvePrompt(input.jobType, input.promptRef);
  const promptRef = prompt.ref;
  const dims = cacheDimensionsFor(input, decision, promptRef);

  if (!decision.permitted) {
    await recordUsage({
      tenantId: input.ctx.tenantId,
      projectId: input.ctx.projectId,
      jobId,
      requestId: currentRequestId(),
      module: input.ctx.agentKey,
      taskType: input.jobType,
      executionClass: decision.executionClass,
      modelAlias: decision.alias,
      provider: decision.provider,
      providerModel: decision.model,
      sensitivity: decision.sensitivity,
      policyVersion: decision.policyVersion,
      promptKey: prompt.registered ? prompt.key : null,
      promptVersion: prompt.registered ? prompt.version : null,
      outcome: "rejected",
      errorCode: decision.reasons[0] ?? "not_permitted",
    });
    if (decision.blocked) throw new DispatchNotPermitted(decision);
    logWarn("ai policy would have blocked this job", {
      jobId, jobType: input.jobType, why: decision.why, reasons: decision.reasons,
    });
  }
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
    prompt_ref: promptRef,
    inputs: { artifacts: input.inputArtifacts, params: input.params ?? {} },
    idempotency_key: idempotencyKey,
    cache: dims,
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
      // Resolved through the registry alias when one is registered, so swapping
      // a provider model is a row in ai_model_registry rather than a deploy.
      decision.model,
      JSON.stringify(envelope),
      // The ref that actually ran, not the one the caller asked for. These
      // differ exactly when the registry has a newer approved version, and the
      // job row is where somebody looks to find out which.
      promptRef,
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

  /* One ledger row per ATTEMPT.
     ai_job carries the latest usage only, so a job that failed twice and then
     succeeded reports a third of what it cost — and every budget measured
     against it permits more than the customer agreed to. This row is the
     append-only record that does not overwrite its own history. Written after
     the status UPDATE and guarded by the idempotency check above, so a
     duplicate callback cannot double-count. */
  const envelope = parseEnvelope(job.envelope);
  const promptRef = parseRef(job.prompt_ref ?? "");
  // Declared by the caller, not inferred from a zero cost. Keeping "what we
  // served" and "what we paid for" separable is the whole point of the
  // cache_hit column, and a stub-mode result would fail a cost-based guess.
  const servedFromCache = result.from_cache === true;

  await recordUsage({
    tenantId: job.tenant_id,
    projectId: job.project_id,
    jobId: result.job_id,
    requestId: result.trace_id ?? currentRequestId(),
    attempt: Number(job.attempts ?? 1) || 1,
    module: job.agent_key,
    taskType: job.job_type,
    executionClass: servedFromCache ? "cache" : "external",
    modelAlias: TIER_ALIAS[job.tier] ?? job.tier ?? null,
    providerModel: result.usage?.model ?? job.model ?? null,
    // Which prompt produced this output. Read off the job row rather than
    // resolved again: the registry may have approved a new version since this
    // job was dispatched, and the answer belongs to the one that ran.
    promptKey: promptRef.version != null ? promptRef.key : null,
    promptVersion: promptRef.version,
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
    costMinor: result.usage?.cost_minor ?? 0,
    cacheHit: servedFromCache,
    outcome: status,
    errorCode: result.error ? "worker_error" : null,
  });

  /* Write-through.

     Three conditions, each for its own reason.

     Successes only. A cached failure is a job that can never succeed again
     until something invalidates it.

     Not a cache hit. Storing one back over itself would reset its own hit
     counter and destroy the evidence that reuse is working.

     Tokens actually consumed. A real model call always reports some; a stub
     result reports none. Without this, running with DEMO_STUB_MODE would fill
     the cache with placeholder answers that later get served to real runs —
     a fabricated BOQ presented with the same confidence as a computed one. */
  const didRealWork = (result.usage?.input_tokens ?? 0) > 0 || (result.usage?.output_tokens ?? 0) > 0;
  if (CACHE_WARM && status === "succeeded" && !servedFromCache && didRealWork && envelope?.cache) {
    await responseCache.store({
      dims: envelope.cache,
      response: { outputs: result.outputs ?? [], message: result.message ?? null },
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      costMinor: result.usage?.cost_minor ?? 0,
    });
  }

  return { job: { ...job, status }, alreadyDone: false };
}

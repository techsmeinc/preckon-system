import type { AuditSpec } from "./audit";
import { query } from "./db";
import {
  emitArtifact as storeEmit,
  readArtifacts as storeRead,
  type Artifact,
  type EmitResult,
} from "./store";

/**
 * §3.2 — The Agent Contract (ABI). The entire surface an agent's work touches.
 * Per §5.1 the stateless worker only *proposes* outputs; Core materializes them
 * through this ABI inside the trusted process — so provenance, scoping, schema
 * validation, audit and auto-accept always happen here, never in the worker.
 * The context is set by the runtime from the run and is unforgeable by the agent.
 */
export interface AgentContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly agentKey: string;
}

export interface EmitInput {
  type: string; // must be in the agent's `produces`
  payload: object;
  provenance: string[];
  confidence?: number;
}

/** Enforce that a type is declared in the agent's manifest column (`produces`/`consumes`). */
async function assertDeclared(
  agentKey: string,
  column: "produces" | "consumes",
  type: string
): Promise<void> {
  const rows = await query<{ produces?: string[]; consumes?: string[] }>(
    `SELECT ${column} FROM agent WHERE \`key\` = ?`,
    [agentKey]
  );
  const list = (rows[0] as any)?.[column] as string[] | undefined;
  if (!list) return;
  // '*' (supervisors) reads everything.
  if (list.includes("*")) return;
  // Compare on the short key too (namespacing is illustrative in the design).
  const short = type.split(".").pop();
  const ok = list.some((t) => t === type || t.split(".").pop() === short);
  if (!ok)
    throw new Error(
      `ABI violation: agent ${agentKey} may not ${column === "produces" ? "emit" : "read"} '${type}'`
    );
}

/** syscall: emitArtifact — Core validates & materializes an agent proposal (§3.2). */
export async function emitArtifact(
  ctx: AgentContext,
  input: EmitInput,
  audit?: (spec: AuditSpec) => void
): Promise<EmitResult> {
  await assertDeclared(ctx.agentKey, "produces", input.type);
  return storeEmit(
    {
      tenantId: ctx.tenantId,
      projectId: ctx.projectId,
      typeKey: input.type,
      payload: input.payload,
      source: "agent",
      sourceAgentKey: ctx.agentKey,
      sourceRunId: ctx.runId,
      sourceStepId: ctx.stepId,
      provenance: input.provenance,
      confidence: input.confidence ?? null,
    },
    audit
  );
}

/** syscall: readArtifacts — current confirmed artifacts in the run's project only (§3.2). */
export async function readArtifacts(
  ctx: AgentContext,
  q: { type: string; status?: "confirmed"; filter?: Record<string, unknown> }
): Promise<Artifact[]> {
  await assertDeclared(ctx.agentKey, "consumes", q.type);
  return storeRead({
    tenantId: ctx.tenantId,
    projectId: ctx.projectId,
    typeKey: q.type,
    status: q.status ?? "confirmed",
    filter: q.filter,
  });
}

/**
 * syscall: requestReview — mark listed proposals surfaced / auto-accept any
 * already ≥ threshold. Idempotent. In this implementation auto-accept happens
 * at emit time (§5.6), so this is the explicit surface-to-queue affirmation:
 * a pending proposal is already in the review_queue view, so this is a no-op
 * beyond an audit breadcrumb.
 */
export async function requestReview(
  ctx: AgentContext,
  artifactIds: string[],
  audit?: (spec: AuditSpec) => void
): Promise<void> {
  if (artifactIds.length === 0) return;
  audit?.({
    action: "artifact.request_review",
    actorKind: "agent",
    actorId: ctx.agentKey,
    targetKind: "artifact",
    projectId: ctx.projectId,
    summary: { artifactIds },
  });
}

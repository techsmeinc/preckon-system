import type { AuditSpec } from "./audit";
import { query, queryOne } from "./db";
import { errNotFound, errSchema, errStale } from "./errors";
import { newId } from "./ids";
import { validatePayload } from "./validate";
import { captureCorrections } from "./learning";

// ── The artifact store (§2). One shared, versioned graph per project. All DB
// access goes through query()/queryOne(), which join the ambient transaction
// (lib/db.ts) when called inside a useCase — so an emit + its provenance + its
// audit event commit atomically. Every function is tenant/project scoped
// explicitly (MySQL has no RLS; this is the app-layer enforcement point).

export type ArtifactStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "stale"
  | "superseded";

export interface Artifact {
  id: string;
  tenant_id: string;
  project_id: string;
  type_key: string;
  payload: any;
  source: "human" | "agent";
  source_agent_key: string | null;
  source_run_id: string | null;
  source_step_id: string | null;
  status: ArtifactStatus;
  confidence: number | null;
  version: number;
  supersedes_id: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactType {
  key: string;
  payload_schema: any;
  is_reviewable: number | boolean;
}

async function getType(typeKey: string): Promise<ArtifactType> {
  const t = await queryOne<ArtifactType>(
    "SELECT `key`, payload_schema, is_reviewable FROM artifact_type WHERE `key` = ?",
    [typeKey]
  );
  if (!t) throw errNotFound(`Artifact type '${typeKey}'`);
  return t;
}

/** Is the project running the whole pursuit automatically (auto-accept everything)? */
async function isAutopilot(tenantId: string, projectId: string): Promise<boolean> {
  const p = await queryOne<{ autopilot: number }>(
    "SELECT autopilot FROM project WHERE tenant_id = ? AND id = ?",
    [tenantId, projectId]
  );
  return !!p && Number(p.autopilot) === 1;
}

/** Resolve the per-type or global auto-accept threshold for a tenant (§5.6). */
async function resolveThreshold(tenantId: string, typeKey: string): Promise<number> {
  const s = await queryOne<{ auto_accept_threshold: string; type_thresholds: any }>(
    "SELECT auto_accept_threshold, type_thresholds FROM tenant_setting WHERE tenant_id = ?",
    [tenantId]
  );
  if (!s) return 0.9;
  const per = s.type_thresholds?.[typeKey];
  return per != null ? Number(per) : Number(s.auto_accept_threshold);
}

export interface EmitInput {
  tenantId: string;
  projectId: string;
  typeKey: string;
  payload: any;
  source: "human" | "agent";
  sourceAgentKey?: string | null;
  sourceRunId?: string | null;
  sourceStepId?: string | null;
  provenance?: string[];
  confidence?: number | null;
  createdBy?: string | null;
  /** Human edits set this so the new row supersedes the old (§2.2). */
  supersedesId?: string | null;
  version?: number;
}

export interface EmitResult {
  id: string;
  status: ArtifactStatus;
}

/**
 * §2.2 / §5.1 — materialize an artifact. Validates payload against the type
 * schema, decides pending vs confirmed (non-reviewable → confirmed; else
 * confidence ≥ threshold → auto-accept), writes provenance edges, and (unless
 * `noAudit`) journals an audit event via the callback. Scope comes from args,
 * never from a caller-supplied tenant on the payload.
 */
export async function emitArtifact(
  input: EmitInput,
  audit?: (spec: AuditSpec) => void
): Promise<EmitResult> {
  const type = await getType(input.typeKey);

  const res = validatePayload(type.payload_schema, input.payload);
  if (!res.valid)
    throw errSchema(`Payload invalid for ${input.typeKey}`, { errors: res.errors });

  const reviewable = !!type.is_reviewable;
  let status: ArtifactStatus;
  let confirmedBy: string | null = null;
  let confirmedAt = false;

  if (!reviewable) {
    status = "confirmed"; // canonical on emit; confirmed_by = null (system)
    confirmedAt = true;
  } else if (input.source === "human") {
    status = "confirmed"; // a human authoring a fact is canonical
    confirmedBy = input.createdBy ?? null;
    confirmedAt = true;
  } else {
    const threshold = await resolveThreshold(input.tenantId, input.typeKey);
    const meetsThreshold = input.confidence != null && input.confidence >= threshold;
    // Autopilot: the human explicitly delegated review for this project, so every
    // agent proposal is auto-accepted (confirmed_by = null → a system decision,
    // still fully audited). Otherwise the §5.6 confidence gate applies.
    if (meetsThreshold || (await isAutopilot(input.tenantId, input.projectId))) {
      status = "confirmed";
      confirmedAt = true;
    } else {
      status = "pending";
    }
  }

  const id = newId();
  await query(
    `INSERT INTO artifact
       (id, tenant_id, project_id, type_key, payload, source, source_agent_key,
        source_run_id, source_step_id, status, confidence, version, supersedes_id,
        created_by, confirmed_by, confirmed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ${confirmedAt ? "NOW(3)" : "NULL"})`,
    [
      id,
      input.tenantId,
      input.projectId,
      input.typeKey,
      JSON.stringify(input.payload),
      input.source,
      input.sourceAgentKey ?? null,
      input.sourceRunId ?? null,
      input.sourceStepId ?? null,
      status,
      input.confidence ?? null,
      input.version ?? 1,
      input.supersedesId ?? null,
      input.createdBy ?? null,
      confirmedBy,
    ]
  );

  for (const src of input.provenance ?? []) {
    await query(
      `INSERT IGNORE INTO artifact_provenance (id, tenant_id, artifact_id, source_artifact_id)
       VALUES (?,?,?,?)`,
      [newId(), input.tenantId, id, src]
    );
  }

  // §M.2 — record an auto-accepted decision for calibration.
  if (input.source === "agent" && reviewable && status === "confirmed") {
    await query(
      `INSERT INTO decision_outcome
         (id, tenant_id, project_id, artifact_id, agent_key, type_key, confidence, outcome)
       VALUES (?,?,?,?,?,?,?,'auto_accepted')`,
      [
        newId(),
        input.tenantId,
        input.projectId,
        id,
        input.sourceAgentKey ?? null,
        input.typeKey,
        input.confidence ?? null,
      ]
    );
  }

  audit?.({
    action: "artifact.emit",
    actorKind: input.source === "agent" ? "agent" : "user",
    actorId: input.sourceAgentKey ?? input.createdBy ?? null,
    targetKind: "artifact",
    targetId: id,
    projectId: input.projectId,
    summary: { type: input.typeKey, status, confidence: input.confidence ?? null },
  });

  return { id, status };
}

/** §3.2 readArtifacts — current (non-superseded), by default confirmed, this project. */
export async function readArtifacts(args: {
  tenantId: string;
  projectId: string;
  typeKey: string;
  status?: ArtifactStatus;
  filter?: Record<string, unknown>;
}): Promise<Artifact[]> {
  const status = args.status ?? "confirmed";
  const rows = await query<Artifact>(
    `SELECT * FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key = ? AND status = ?
      ORDER BY created_at ASC`,
    [args.tenantId, args.projectId, args.typeKey, status]
  );
  if (!args.filter) return rows;
  return rows.filter((r) =>
    Object.entries(args.filter!).every(([k, v]) => r.payload?.[k] === v)
  );
}

export async function getArtifact(
  tenantId: string,
  id: string
): Promise<Artifact | null> {
  return queryOne<Artifact>("SELECT * FROM artifact WHERE tenant_id = ? AND id = ?", [
    tenantId,
    id,
  ]);
}

export async function listArtifacts(args: {
  tenantId: string;
  projectId: string;
  typeKey?: string;
  status?: ArtifactStatus;
}): Promise<Artifact[]> {
  const where: string[] = ["tenant_id = ?", "project_id = ?"];
  const params: any[] = [args.tenantId, args.projectId];
  if (args.typeKey) {
    where.push("type_key = ?");
    params.push(args.typeKey);
  }
  if (args.status) {
    where.push("status = ?");
    params.push(args.status);
  }
  return query<Artifact>(
    `SELECT * FROM artifact WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
    params
  );
}

export async function reviewQueue(tenantId: string, projectId: string): Promise<any[]> {
  return query(
    `SELECT id, type_key, source_agent_key, confidence, source_run_id, created_at
       FROM review_queue WHERE tenant_id = ? AND project_id = ? ORDER BY created_at ASC`,
    [tenantId, projectId]
  );
}

/**
 * §2.4 — mark every artifact reachable downstream through provenance edges
 * `stale` (transitive, cycle-safe via UNION). Returns the affected ids.
 */
export async function markDownstreamStale(
  tenantId: string,
  artifactId: string
): Promise<string[]> {
  const rows = await query<{ artifact_id: string }>(
    `WITH RECURSIVE downstream (artifact_id) AS (
       SELECT p.artifact_id FROM artifact_provenance p
        WHERE p.source_artifact_id = ? AND p.tenant_id = ?
       UNION
       SELECT p.artifact_id FROM artifact_provenance p
        JOIN downstream d ON p.source_artifact_id = d.artifact_id
        WHERE p.tenant_id = ?
     )
     SELECT artifact_id FROM downstream`,
    [artifactId, tenantId, tenantId]
  );
  const ids = rows.map((r) => r.artifact_id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  await query(
    `UPDATE artifact SET status = 'stale', updated_at = NOW(3)
      WHERE tenant_id = ? AND id IN (${placeholders}) AND status <> 'superseded'`,
    [tenantId, ...ids]
  );
  return ids;
}

/** §2.6 confirm — pending → confirmed; may resume a paused run (caller does). */
export async function confirmArtifact(
  tenantId: string,
  id: string,
  userId: string,
  audit?: (spec: AuditSpec) => void
): Promise<Artifact> {
  const a = await getArtifact(tenantId, id);
  if (!a) throw errNotFound("Artifact");
  if (a.status === "superseded" || a.status === "rejected") throw errStale();
  if (a.status === "confirmed") return a;
  await query(
    "UPDATE artifact SET status = 'confirmed', confirmed_by = ?, confirmed_at = NOW(3), updated_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [userId, tenantId, id]
  );
  await query(
    `INSERT INTO decision_outcome (id, tenant_id, project_id, artifact_id, agent_key, type_key, confidence, outcome, decided_by)
     VALUES (?,?,?,?,?,?,?,'confirmed',?)`,
    [newId(), tenantId, a.project_id, id, a.source_agent_key, a.type_key, a.confidence, userId]
  );
  audit?.({
    action: "artifact.confirm",
    targetKind: "artifact",
    targetId: id,
    projectId: a.project_id,
    summary: { type: a.type_key },
  });
  return { ...a, status: "confirmed", confirmed_by: userId };
}

/** §2.6 reject — pending → rejected (terminal). */
export async function rejectArtifact(
  tenantId: string,
  id: string,
  userId: string,
  audit?: (spec: AuditSpec) => void
): Promise<void> {
  const a = await getArtifact(tenantId, id);
  if (!a) throw errNotFound("Artifact");
  if (a.status !== "pending") throw errStale("Only pending proposals can be rejected");
  await query(
    "UPDATE artifact SET status = 'rejected', updated_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [tenantId, id]
  );
  await query(
    `INSERT INTO decision_outcome (id, tenant_id, project_id, artifact_id, agent_key, type_key, confidence, outcome, decided_by)
     VALUES (?,?,?,?,?,?,?,'rejected',?)`,
    [newId(), tenantId, a.project_id, id, a.source_agent_key, a.type_key, a.confidence, userId]
  );
  audit?.({
    action: "artifact.reject",
    targetKind: "artifact",
    targetId: id,
    projectId: a.project_id,
    summary: { type: a.type_key },
  });
}

/**
 * §2.6 edit — a human edits an artifact: supersede the current row with a new
 * version (confirmed, human source) and mark everything downstream stale (§2.4).
 * Returns the new artifact id + the ids marked stale.
 */
export async function editArtifact(
  tenantId: string,
  id: string,
  newPayload: any,
  userId: string,
  audit?: (spec: AuditSpec) => void
): Promise<{ newId: string; staleIds: string[] }> {
  const a = await getArtifact(tenantId, id);
  if (!a) throw errNotFound("Artifact");
  if (a.status === "superseded") throw errStale();

  const emitted = await emitArtifact(
    {
      tenantId,
      projectId: a.project_id,
      typeKey: a.type_key,
      payload: newPayload,
      source: "human",
      createdBy: userId,
      supersedesId: a.id,
      version: a.version + 1,
      // carry forward the same provenance edges so re-plan still reaches downstream
      provenance: (
        await query<{ source_artifact_id: string }>(
          "SELECT source_artifact_id FROM artifact_provenance WHERE artifact_id = ? AND tenant_id = ?",
          [a.id, tenantId]
        )
      ).map((r) => r.source_artifact_id),
    },
    audit
  );

  /* The workspace takes a note of what was changed.
     This is the only place that holds both the agent's proposal and the human's
     correction, so it is the only place the difference between them can be
     learned. Not awaited for correctness — an edit that succeeded must never be
     reported as failed because a lesson could not be written. */
  void captureCorrections(tenantId, a.project_id, a.type_key, a.payload, newPayload, userId);

  await query(
    "UPDATE artifact SET status = 'superseded', updated_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [tenantId, a.id]
  );
  // Re-point downstream provenance edges at the new version so the stale walk
  // and future re-derivation see the current artifact.
  await query(
    "UPDATE artifact_provenance SET source_artifact_id = ? WHERE source_artifact_id = ? AND tenant_id = ?",
    [emitted.id, a.id, tenantId]
  );
  const staleIds = await markDownstreamStale(tenantId, emitted.id);

  audit?.({
    action: "artifact.edit",
    targetKind: "artifact",
    targetId: emitted.id,
    projectId: a.project_id,
    summary: { supersedes: a.id, type: a.type_key, staleCount: staleIds.length },
  });
  return { newId: emitted.id, staleIds };
}

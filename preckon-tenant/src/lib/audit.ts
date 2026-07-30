import type { PoolConnection } from "mysql2/promise";
import { newId } from "./ids";

// §9 — an audit event is written only as a side effect of a use case, through
// the stored procedure that maintains the per-tenant tamper-evident hash chain.
// Never INSERT into audit_event directly (a trigger forbids UPDATE/DELETE).
export interface AuditSpec {
  action: string; // 'artifact.confirm', 'run.start', ...
  actorKind?: "user" | "service" | "agent" | "system";
  actorId?: string | null; // app_user id / service name / agent key
  targetKind?: string | null; // 'artifact' | 'run' | 'user' | ...
  targetId?: string | null;
  projectId?: string | null;
  summary?: Record<string, unknown>;
}

export interface AuditActor {
  tenantId: string;
  actorId: string | null;
  actorKind: "user" | "service" | "agent" | "system";
}

export async function appendAudit(
  conn: PoolConnection,
  actor: AuditActor,
  spec: AuditSpec
): Promise<void> {
  await conn.query("CALL append_audit_event(?,?,?,?,?,?,?,?,?)", [
    newId(),
    actor.tenantId,
    spec.actorKind ?? actor.actorKind,
    spec.actorId ?? actor.actorId,
    spec.action,
    spec.targetKind ?? null,
    spec.targetId ?? null,
    spec.projectId ?? null,
    JSON.stringify(spec.summary ?? {}),
  ]);
}

/** Walk a tenant's chain from seq=1, recompute each hash, confirm linkage (§9.3). */
export async function verifyChain(
  conn: PoolConnection,
  tenantId: string
): Promise<{ ok: boolean; brokenSeq: number | null }> {
  // Read MySQL's OWN serialization of the JSON summary and the timestamp (CAST AS
  // CHAR) so the recomputed canonical string byte-matches what the stored
  // procedure hashed — JS JSON.stringify would differ (spacing) and break the chain.
  const [rows] = await conn.query(
    "SELECT seq, actor_kind, actor_id, action, target_kind, target_id, project_id, CAST(summary AS CHAR) AS summary_str, CAST(UNIX_TIMESTAMP(created_at) AS CHAR) AS ts_str, prev_hash, hash FROM audit_event WHERE tenant_id = ? ORDER BY seq ASC",
    [tenantId]
  );
  const { createHash } = await import("node:crypto");
  let prev: string | null = null;
  for (const r of rows as any[]) {
    const canon = [
      tenantId,
      String(r.seq),
      String(r.ts_str),
      r.actor_kind,
      r.actor_id ?? "",
      r.action,
      r.target_kind ?? "",
      r.target_id ?? "",
      r.project_id ?? "",
      r.summary_str,
      prev ?? "",
    ].join("|");
    const h = createHash("sha256").update(canon).digest("hex");
    if (h !== r.hash || (r.prev_hash ?? null) !== prev) {
      return { ok: false, brokenSeq: Number(r.seq) };
    }
    prev = r.hash;
  }
  return { ok: true, brokenSeq: null };
}

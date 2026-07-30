import type { PoolConnection } from "mysql2/promise";
import { appendAudit, type AuditActor, type AuditSpec } from "./audit";
import type { AuthContext } from "./context";
import { tx } from "./db";

/** Derive the audit actor from a user AuthContext. */
export function actorFromCtx(ctx: AuthContext): AuditActor {
  return { tenantId: ctx.tenantId, actorId: ctx.user.id, actorKind: "user" };
}

/**
 * The canonical use-case skeleton (§X): validate → authorize (done by the
 * caller) → the mutation and its audit event(s) commit in ONE transaction.
 * The handler writes on `conn` and calls `audit(spec)` to enqueue events; they
 * are appended just before commit, on the per-tenant hash chain.
 */
export async function useCase<T>(
  actor: AuditActor,
  fn: (conn: PoolConnection, audit: (spec: AuditSpec) => void) => Promise<T>
): Promise<T> {
  return tx(async (conn) => {
    const specs: AuditSpec[] = [];
    const result = await fn(conn, (s) => specs.push(s));
    for (const spec of specs) await appendAudit(conn, actor, spec);
    return result;
  });
}

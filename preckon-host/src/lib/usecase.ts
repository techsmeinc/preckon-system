import type { PoolConnection } from "mysql2/promise";
import { appendAudit, type AuditSpec } from "./audit";
import type { AuthContext } from "./context";
import { tx } from "./db";

/**
 * The canonical host use-case skeleton (§0.4): the mutation and its audit
 * event(s) commit in ONE transaction. The handler does its writes on `conn`,
 * and calls `audit(spec)` (possibly after computing values) to enqueue events;
 * they're appended just before commit.
 *
 *   const t = await useCase(ctx, async (conn, audit) => {
 *     const [res] = await conn.query('UPDATE ...', [...]);
 *     audit({ action: 'tenant.suspend', targetType: 'tenant', targetId: id,
 *             targetTenantId: id, summary: `Suspended ${name}` });
 *     return updated;
 *   });
 */
export async function useCase<T>(
  ctx: AuthContext | null,
  fn: (conn: PoolConnection, audit: (spec: AuditSpec) => void) => Promise<T>
): Promise<T> {
  return tx(async (conn) => {
    const specs: AuditSpec[] = [];
    const result = await fn(conn, (s) => specs.push(s));
    for (const spec of specs) await appendAudit(conn, ctx, spec);
    return result;
  });
}

import type { PoolConnection } from "mysql2/promise";
import type { AuthContext } from "./context";
import { newId } from "./ids";

// §2 — an audit event is written only as a side effect of a use case, through
// the DB procedure that maintains the tamper-evident hash chain. Never INSERT
// into audit_event directly.
export interface AuditSpec {
  action: string; // 'tenant.suspend', 'edition.update', ...
  summary: string; // human one-liner
  targetType?: string | null; // 'tenant','edition','host_user',...
  targetId?: string | null;
  targetTenantId?: string | null; // set for tenant-directed actions (§0.2)
  metadata?: Record<string, unknown>;
  actorType?: "host_user" | "system" | "impersonated";
}

export async function appendAudit(
  conn: PoolConnection,
  ctx: Pick<AuthContext, "user" | "ip" | "userAgent" | "correlationId"> | null,
  spec: AuditSpec
): Promise<void> {
  await conn.query("CALL append_audit_event(?,?,?,?,?,?,?,?,?,?,?,?)", [
    newId(),
    ctx?.user?.id ?? null,
    spec.actorType ?? (ctx ? "host_user" : "system"),
    spec.action,
    spec.targetType ?? null,
    spec.targetId ?? null,
    spec.targetTenantId ?? null,
    spec.summary,
    JSON.stringify(spec.metadata ?? {}),
    ctx?.correlationId ?? null,
    ctx?.ip ?? null,
    ctx?.userAgent ?? null,
  ]);
}

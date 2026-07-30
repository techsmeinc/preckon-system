import type { PoolConnection } from "mysql2/promise";
import { query, queryOne } from "./db";

// §5 — entitlements are COMPUTED from the resolution view, not stored.
export interface ResolvedEntitlement {
  key: string;
  type: "flag" | "limit" | "metric";
  included: boolean;
  value?: number | string | null; // limit cap / enum tier (null = unlimited)
  included_quota?: number; // metric free allowance
  source?: "edition" | "override";
}

/** The machine contract of §5.3 — consumed by the console and the tenant plane. */
export async function resolveEntitlements(tenantId: string) {
  const t = await queryOne<{ edition_key: string; entitlement_version: number }>(
    `SELECT e.\`key\` AS edition_key, t.entitlement_version
       FROM tenant t JOIN edition e ON e.id = t.current_edition_id
      WHERE t.id = ?`,
    [tenantId]
  );
  if (!t) return null;

  const rows = await query<{
    key: string;
    type: "flag" | "limit" | "metric";
    value_type: string;
    included: number;
    limit_value: string | null;
    enum_value: string | null;
    source: "edition" | "override";
  }>(
    `SELECT \`key\`, type, value_type, included, limit_value, enum_value, source
       FROM tenant_entitlement_resolved WHERE tenant_id = ?`,
    [tenantId]
  );

  const entitlements: Record<string, ResolvedEntitlement> = {};
  for (const r of rows) {
    const included = !!r.included;
    const e: ResolvedEntitlement = { key: r.key, type: r.type, included, source: r.source };
    if (r.type === "limit") {
      e.value = r.value_type === "enum" ? r.enum_value : r.limit_value === null ? null : Number(r.limit_value);
    } else if (r.type === "metric") {
      e.included_quota = r.limit_value === null ? Infinity : Number(r.limit_value);
    }
    entitlements[r.key] = e;
  }

  return {
    tenant_id: tenantId,
    edition: t.edition_key,
    version: Number(t.entitlement_version),
    resolved_at: new Date().toISOString(),
    entitlements,
  };
}

/**
 * §5.4 — bump entitlement_version and publish an invalidation whenever the
 * effective set could change. `scope` picks the SQL. Publishing is a stub here
 * (log); wire Redis pub/sub in production so tenant caches drop immediately.
 */
export async function bumpTenant(conn: PoolConnection, tenantId: string): Promise<void> {
  await conn.query(
    "UPDATE tenant SET entitlement_version = entitlement_version + 1 WHERE id = ?",
    [tenantId]
  );
  invalidate({ tenantId });
}

export async function bumpEdition(conn: PoolConnection, editionId: string): Promise<void> {
  await conn.query(
    "UPDATE tenant SET entitlement_version = entitlement_version + 1 WHERE current_edition_id = ?",
    [editionId]
  );
  invalidate({ editionId });
}

function invalidate(scope: { tenantId?: string; editionId?: string }): void {
  // TODO(prod): publish `entitlements.invalidated` on Redis pub/sub.
  if (process.env.NODE_ENV !== "test")
    console.info("[entitlements.invalidated]", JSON.stringify(scope));
}

import type { PoolConnection } from "mysql2/promise";
import { query } from "@/lib/db";
import { errUnprocessable } from "@/lib/errors";

export type AudienceType = "all_tenants" | "by_edition" | "by_status" | "specific";

export interface AudienceFilter {
  edition_id?: string;
  status?: string;
  tenant_ids?: string[];
}

/**
 * Resolve a broadcast audience to a concrete set of tenant ids (§8.3).
 * Offboarded tenants are always excluded — they no longer receive broadcasts.
 */
export async function resolveAudience(
  audienceType: AudienceType,
  filter: AudienceFilter
): Promise<string[]> {
  switch (audienceType) {
    case "all_tenants": {
      const rows = await query<{ id: string }>(
        "SELECT id FROM tenant WHERE status <> 'offboarded'"
      );
      return rows.map((r) => r.id);
    }
    case "by_edition": {
      if (!filter.edition_id)
        throw errUnprocessable("audience_filter.edition_id is required for by_edition");
      const rows = await query<{ id: string }>(
        "SELECT id FROM tenant WHERE status <> 'offboarded' AND current_edition_id = ?",
        [filter.edition_id]
      );
      return rows.map((r) => r.id);
    }
    case "by_status": {
      if (!filter.status)
        throw errUnprocessable("audience_filter.status is required for by_status");
      const rows = await query<{ id: string }>(
        "SELECT id FROM tenant WHERE status = ?",
        [filter.status]
      );
      return rows.map((r) => r.id);
    }
    case "specific": {
      const ids = filter.tenant_ids ?? [];
      if (ids.length === 0)
        throw errUnprocessable("audience_filter.tenant_ids[] is required for specific");
      const placeholders = ids.map(() => "?").join(",");
      const rows = await query<{ id: string }>(
        `SELECT id FROM tenant WHERE id IN (${placeholders})`,
        ids
      );
      return rows.map((r) => r.id);
    }
    default:
      throw errUnprocessable(`Unknown audience_type '${audienceType}'`);
  }
}

/** Fan a resolved audience out to notification_delivery rows on `conn`. */
export async function fanOut(
  conn: PoolConnection,
  notificationId: string,
  tenantIds: string[]
): Promise<void> {
  if (tenantIds.length === 0) return;
  const values = tenantIds.map(() => "(?,?)").join(",");
  const params: string[] = [];
  for (const tid of tenantIds) params.push(notificationId, tid);
  await conn.query(
    `INSERT IGNORE INTO notification_delivery (notification_id, tenant_id) VALUES ${values}`,
    params
  );
}

/** A small named sample of tenants in the audience, for preview. */
export async function audienceSample(tenantIds: string[]): Promise<{ id: string; name: string }[]> {
  if (tenantIds.length === 0) return [];
  const sample = tenantIds.slice(0, 5);
  const placeholders = sample.map(() => "?").join(",");
  return query<{ id: string; name: string }>(
    `SELECT id, name FROM tenant WHERE id IN (${placeholders}) ORDER BY name LIMIT 5`,
    sample
  );
}

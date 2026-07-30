import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id}/usage — current-period usage per metric: consumed vs included quota (§7.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.read");
  const { id } = await params;

  const tenant = await queryOne<{ id: string }>("SELECT id FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  // Billing period: the live subscription's window, else the current calendar month (UTC).
  const sub = await queryOne<{ current_period_start: Date | null; current_period_end: Date | null }>(
    "SELECT current_period_start, current_period_end FROM subscription WHERE tenant_id = ? AND status <> 'canceled' LIMIT 1",
    [id]
  );
  const now = new Date();
  const periodStart = sub?.current_period_start
    ? new Date(sub.current_period_start)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const startSql = periodStart.toISOString().slice(0, 19).replace("T", " ");
  const endSql = periodEnd.toISOString().slice(0, 19).replace("T", " ");

  // Consumed this period, per metric feature.
  const consumedRows = await query<{ feature_key: string; name: string; consumed: string }>(
    `SELECT f.\`key\` AS feature_key, f.name,
            COALESCE(SUM(ur.quantity), 0) AS consumed
       FROM feature f
       LEFT JOIN usage_record ur
         ON ur.feature_id = f.id AND ur.tenant_id = ?
        AND ur.occurred_at >= ? AND ur.occurred_at < ?
      WHERE f.type = 'metric' AND f.status = 'active'
      GROUP BY f.id, f.\`key\`, f.name
      ORDER BY f.sort_order, f.\`key\``,
    [id, startSql, endSql]
  );

  // Included quota from the resolution view (override ⊕ edition), null = unlimited.
  const quotaRows = await query<{ key: string; type: string; limit_value: string | null }>(
    "SELECT `key`, type, limit_value FROM tenant_entitlement_resolved WHERE tenant_id = ? AND type = 'metric'",
    [id]
  );
  const quota = new Map(quotaRows.map((r) => [r.key, r.limit_value === null ? null : Number(r.limit_value)]));

  const out = consumedRows.map((r) => ({
    feature_key: r.feature_key,
    name: r.name,
    consumed: Number(r.consumed),
    included_quota: quota.has(r.feature_key) ? quota.get(r.feature_key)! : null,
  }));

  return ok(out);
});

import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, parsePage, paginate, q } from "@/lib/http";

// GET /subscriptions — roster with filters ?status ?edition_id (§7.6)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const status = q(req, "status");
  const editionId = q(req, "edition_id");
  if (status) (where.push("s.status = ?"), params.push(status));
  if (editionId) (where.push("s.edition_id = ?"), params.push(editionId));
  if (cursor) (where.push("s.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `SELECT s.id, s.tenant_id, s.edition_id, s.currency_code, s.\`interval\`,
            s.status, s.seats, s.custom_amount_minor, s.trial_end,
            s.current_period_start, s.current_period_end,
            s.cancel_at_period_end, s.canceled_at,
            s.stripe_subscription_id, s.created_at,
            t.name AS tenant_name, t.slug AS tenant_slug,
            e.\`key\` AS edition_key, e.name AS edition_name
       FROM subscription s
       JOIN tenant t  ON t.id = s.tenant_id
       JOIN edition e ON e.id = s.edition_id
       ${whereSql}
      ORDER BY s.id DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

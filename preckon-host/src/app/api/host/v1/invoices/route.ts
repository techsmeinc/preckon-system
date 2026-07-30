import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, parsePage, paginate, q } from "@/lib/http";

// GET /invoices — list with filters ?tenant_id ?status ?from ?to (§7.6)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const tenantId = q(req, "tenant_id");
  const status = q(req, "status");
  const from = q(req, "from");
  const to = q(req, "to");
  if (tenantId) (where.push("i.tenant_id = ?"), params.push(tenantId));
  if (status) (where.push("i.status = ?"), params.push(status));
  if (from) (where.push("i.created_at >= ?"), params.push(from));
  if (to) (where.push("i.created_at <= ?"), params.push(to));
  if (cursor) (where.push("i.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `SELECT i.id, i.tenant_id, i.subscription_id, i.currency_code, i.number, i.status,
            i.subtotal_minor, i.discount_minor, i.tax_minor, i.total_minor,
            i.amount_paid_minor, i.amount_due_minor, i.period_start, i.period_end,
            i.due_date, i.issued_at, i.paid_at, i.attempt_count,
            i.hosted_invoice_url, i.created_at,
            t.name AS tenant_name, t.slug AS tenant_slug
       FROM invoice i JOIN tenant t ON t.id = i.tenant_id
       ${whereSql}
      ORDER BY i.id DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

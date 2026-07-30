import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /billing/summary — MRR per currency, status counts, billing health (§7.5, §7.6)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.read");

  // MRR per currency: active subscriptions normalized to monthly.
  //   annual → amount / 12 ; monthly → as-is.
  //   amount = edition_price(edition, currency, interval) ?? custom_amount_minor.
  const mrrRows = await query<{ currency_code: string; amount_minor: string }>(
    `SELECT s.currency_code,
            ROUND(SUM(
              CASE WHEN s.\`interval\` = 'annual'
                   THEN COALESCE(ep.amount_minor, s.custom_amount_minor, 0) / 12
                   ELSE COALESCE(ep.amount_minor, s.custom_amount_minor, 0)
              END
            )) AS amount_minor
       FROM subscription s
       LEFT JOIN edition_price ep
         ON ep.edition_id = s.edition_id
        AND ep.currency_code = s.currency_code
        AND ep.\`interval\` = s.\`interval\`
      WHERE s.status = 'active'
      GROUP BY s.currency_code
      ORDER BY s.currency_code`,
    []
  );

  // Status counts across live subscriptions.
  const statusRows = await query<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM subscription GROUP BY status",
    []
  );
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const status_counts = {
    trialing: byStatus.get("trialing") ?? 0,
    active: byStatus.get("active") ?? 0,
    past_due: byStatus.get("past_due") ?? 0,
    unpaid: byStatus.get("unpaid") ?? 0,
  };

  // Failed-payment attempts: open invoices that have been attempted at least once.
  const failed = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM invoice WHERE attempt_count > 0 AND status = 'open'",
    []
  );

  // Upcoming renewals: live subscriptions whose period ends within 30 days.
  const renewals = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM subscription
      WHERE status <> 'canceled'
        AND current_period_end IS NOT NULL
        AND current_period_end BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)`,
    []
  );

  return ok({
    mrr_by_currency: mrrRows.map((r) => ({ currency_code: r.currency_code, amount_minor: Number(r.amount_minor) })),
    status_counts,
    health: {
      failed_payments: Number(failed[0]?.n ?? 0),
      upcoming_renewals: Number(renewals[0]?.n ?? 0),
    },
  });
});

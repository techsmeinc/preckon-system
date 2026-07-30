"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, usePagedList, unwrap, errMessage, useToast, useCan, fmtMoneyShort, fmtMoney, fmtDate, StatusChip, Skeleton, ErrorBox, EmptyState } from "../_ui";

interface BillingSummary {
  mrr_by_currency?: { currency_code: string; amount_minor: number }[];
  status_counts?: { trialing?: number; active?: number; past_due?: number; unpaid?: number };
  health?: { failed_payments?: number; upcoming_renewals?: number };
}

interface Invoice {
  id: string;
  number?: string;
  tenant_name?: string;
  total_minor?: number;
  currency_code?: string;
  status?: string;
  attempt_count?: number;
  issued_at?: string;
  hosted_invoice_url?: string | null;
}

export default function SubscriptionsPage() {
  const toast = useToast();
  const canRetry = useCan("invoice.retry");
  const canRemind = useCan("invoice.remind");
  const canRefund = useCan("billing.refund");

  const billing = useApi<BillingSummary>("/billing/summary");
  const invoices = useApi<any>("/invoices?limit=25");
  const subs = usePagedList<any>("/subscriptions?limit=50");

  const s = (billing.data as BillingSummary) ?? {};
  const mrr = s.mrr_by_currency ?? [];
  const mrrMain = mrr.length ? fmtMoneyShort(mrr[0].amount_minor, mrr[0].currency_code) : "—";
  const mrrRest = mrr
    .slice(1)
    .map((m) => fmtMoneyShort(m.amount_minor, m.currency_code))
    .join(" · ");
  const statusCounts = s.status_counts ?? {};
  const health = s.health ?? {};

  const invRows: Invoice[] = unwrap(invoices.data) ?? [];
  const [invState, setInvState] = useState<Record<string, string>>({});
  const subRows: any[] = subs.items;

  async function retry(inv: Invoice) {
    try {
      await api.post(`/invoices/${inv.id}/retry`, {});
      setInvState((m) => ({ ...m, [inv.id]: "retrying" }));
      toast("Retrying payment");
    } catch (e) {
      toast(errMessage(e));
    }
  }
  async function remind(inv: Invoice) {
    try {
      await api.post(`/invoices/${inv.id}/remind`, {});
      setInvState((m) => ({ ...m, [inv.id]: "reminded" }));
      toast("Reminder sent");
    } catch (e) {
      toast(errMessage(e));
    }
  }
  async function refund(inv: Invoice) {
    if (!window.confirm(`Refund the full amount of invoice ${inv.number ?? inv.id.slice(0, 8)}? This cannot be undone.`)) return;
    try {
      await api.post(`/invoices/${inv.id}/refund`, {});
      setInvState((m) => ({ ...m, [inv.id]: "refunded" }));
      toast("Refund issued");
    } catch (e) {
      toast(errMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Subscriptions &amp; billing</h2>
          <p>Plans, invoices and revenue across every tenant.</p>
        </div>
      </div>

      <div className="kpis k4">
        <div className="kpi">
          <div className="k">MRR</div>
          <div className="v">{billing.loading ? "—" : mrrMain}</div>
          <div className="d up">recurring</div>
          <div className="sub">{mrrRest || "monthly"}</div>
        </div>
        <div className="kpi">
          <div className="k">Active</div>
          <div className="v">{billing.loading ? "—" : statusCounts.active ?? 0}</div>
          <div className="d up">subscriptions</div>
          <div className="sub">billing normally</div>
        </div>
        <div className="kpi">
          <div className="k">Trialing</div>
          <div className="v">{billing.loading ? "—" : statusCounts.trialing ?? 0}</div>
          <div className="d flat">in trial</div>
          <div className="sub">not yet paying</div>
        </div>
        <div className="kpi">
          <div className="k">Past due</div>
          <div className="v">{billing.loading ? "—" : statusCounts.past_due ?? 0}</div>
          <div className="d down">at risk</div>
          <div className="sub">{statusCounts.unpaid ?? 0} unpaid</div>
        </div>
      </div>

      <div className="row two2">
        <div className="card">
          <div className="chead">
            <div>
              <h3>Recent invoices</h3>
              <div className="csub">Latest billing run</div>
            </div>
          </div>
          {invoices.loading ? (
            <Skeleton rows={5} />
          ) : invoices.error ? (
            <ErrorBox message={invoices.error} onRetry={invoices.reload} />
          ) : invRows.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Tenant</th>
                  <th className="r">Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invRows.map((v) => {
                  const st = (v.status ?? "").toLowerCase();
                  const acted = invState[v.id];
                  const failedAttempts = (v.attempt_count ?? 0) > 0;
                  return (
                    <tr key={v.id}>
                      <td className="num">{v.number ?? v.id.slice(0, 8)}</td>
                      <td>{v.tenant_name ?? "—"}</td>
                      <td className="num r">{fmtMoney(v.total_minor, v.currency_code ?? "USD")}</td>
                      <td>
                        <StatusChip status={v.status ?? "open"} />
                      </td>
                      <td className="r">
                        {acted ? (
                          <span style={{ color: "var(--slate-400)", fontSize: 12 }}>
                            {acted === "retrying" ? "Retrying…" : acted === "reminded" ? "Reminded" : "Refunded"}
                          </span>
                        ) : (
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            {st === "open" && failedAttempts && canRetry && (
                              <button className="rowbtn" onClick={() => retry(v)}>
                                Retry
                              </button>
                            )}
                            {st === "open" && canRemind && (
                              <button className="rowbtn" onClick={() => remind(v)}>
                                Remind
                              </button>
                            )}
                            {st === "paid" && canRefund && (
                              <button className="rowbtn" onClick={() => refund(v)}>
                                Refund
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Billing health</h3>
          <div className="csub">Across all tenants</div>
          <div className="trow-lbl" style={{ borderTop: 0 }}>
            Failed payments <b>{billing.loading ? "—" : health.failed_payments ?? 0}</b>
          </div>
          <div className="trow-lbl">
            Upcoming renewals <b>{billing.loading ? "—" : health.upcoming_renewals ?? 0}</b>
          </div>
          <div className="trow-lbl">
            Active subscriptions <b>{billing.loading ? "—" : statusCounts.active ?? 0}</b>
          </div>
          <div className="trow-lbl">
            Trialing <b>{billing.loading ? "—" : statusCounts.trialing ?? 0}</b>
          </div>
          <div className="trow-lbl">
            Past due <b>{billing.loading ? "—" : statusCounts.past_due ?? 0}</b>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <div>
            <h3>Subscriptions</h3>
            <div className="csub">Edition, seats and billing per tenant</div>
          </div>
        </div>
        {subs.loading ? (
          <Skeleton rows={6} />
        ) : subs.error ? (
          <ErrorBox message={subs.error} onRetry={subs.reload} />
        ) : subRows.length === 0 ? (
          <EmptyState title="No subscriptions yet" />
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Edition</th>
                <th>Interval</th>
                <th className="r">Seats</th>
                <th>Status</th>
                <th className="r">Renews</th>
              </tr>
            </thead>
            <tbody>
              {subRows.map((sub) => (
                <tr key={sub.id}>
                  <td>
                    <div className="t-name">{sub.tenant_name ?? "—"}</div>
                    <div className="t-sub">{sub.tenant_slug ?? ""}</div>
                  </td>
                  <td className="num">{sub.edition_name ?? sub.edition_key ?? "—"}</td>
                  <td style={{ color: "var(--slate-500)", fontSize: 12 }}>
                    {sub.interval ?? "—"}
                    {sub.currency_code ? ` · ${sub.currency_code}` : ""}
                  </td>
                  <td className="num r">{sub.seats ?? "—"}</td>
                  <td>
                    <StatusChip status={sub.status ?? "active"} />
                  </td>
                  <td className="r" style={{ color: "var(--slate-500)", fontSize: 12 }}>
                    {fmtDate(sub.current_period_end)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {subs.hasMore && (
          <div style={{ textAlign: "center", paddingTop: 14 }}>
            <button className="mini" onClick={subs.loadMore} disabled={subs.loadingMore}>
              {subs.loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

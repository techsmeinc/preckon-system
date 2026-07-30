"use client";

import Link from "next/link";
import { useApi, unwrap, fmtMoneyShort, StatusChip, Skeleton } from "../_ui";

interface BillingSummary {
  mrr_by_currency?: { currency_code: string; amount_minor: number }[];
  status_counts?: { trialing?: number; active?: number; past_due?: number; unpaid?: number };
  health?: { failed_payments?: number; upcoming_renewals?: number };
}

const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "var(--teal)" },
  { key: "trial", label: "Trial", color: "var(--blue)" },
  { key: "pastdue", label: "Past due", color: "var(--amber)" },
  { key: "suspended", label: "Suspended", color: "var(--red)" },
];

// Normalise assorted status spellings the API might use into the four buckets.
function bucket(s: string): string {
  const k = (s || "").toLowerCase();
  if (k.startsWith("trial")) return "trial";
  if (k === "past_due" || k === "pastdue" || k === "unpaid") return "pastdue";
  if (k === "suspended" || k === "canceled") return "suspended";
  return "active";
}

// seat_cap arrives as a decimal string ("25.0000"); null means no cap.
function fmtSeatCap(v: string | null | undefined): string {
  if (v === null || v === undefined) return "Unlimited";
  const n = Number(v);
  return Number.isNaN(n) ? "—" : String(n);
}

// ISO datetime → short relative label for the audit feed.
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function OverviewPage() {
  const billing = useApi<BillingSummary>("/billing/summary");
  // KPI counts come from a server-side aggregate (correct at any scale).
  const tenantStats = useApi<{ total: number; by_status: { status: string; n: number }[] }>(
    "/tenants/stats"
  );
  // A bounded recent sample only powers the "needs attention" widget below.
  const tenants = useApi<any>("/tenants?limit=50");
  const audit = useApi<any>("/audit-events?limit=8");
  const queues = useApi<any>("/observability/queues");

  const tList: any[] = unwrap(tenants.data) ?? [];
  const summary = (billing.data as BillingSummary) ?? {};
  const statusCounts = summary.status_counts ?? {};

  // Bucket the aggregated status counts (not the sampled rows) for the KPIs.
  const counts: Record<string, number> = { active: 0, trial: 0, pastdue: 0, suspended: 0 };
  for (const r of tenantStats.data?.by_status ?? []) counts[bucket(r.status)] += Number(r.n) || 0;
  const total = tenantStats.data?.total ?? 0;

  // MRR is reported per currency (integer minor units each).
  const mrr = summary.mrr_by_currency ?? [];
  const mrrMain = mrr.length ? fmtMoneyShort(mrr[0].amount_minor, mrr[0].currency_code) : "—";
  const mrrRest = mrr
    .slice(1)
    .map((m) => fmtMoneyShort(m.amount_minor, m.currency_code))
    .join(" · ");

  const attention = tList
    .filter((t) => ["pastdue", "trial", "suspended"].includes(bucket(t.status)))
    .slice(0, 6);

  const auditRows: any[] = unwrap(audit.data) ?? [];

  // queues / workers are arrays — derive counts. A 'stale' worker = degraded.
  const q = queues.data ?? {};
  const workersArr: any[] = Array.isArray(q.workers) ? q.workers : [];
  const queuesArr: any[] = Array.isArray(q.queues) ? q.queues : [];
  const workersUp = workersArr.filter((w) => w.status !== "stale").length;
  const stalled = workersArr.filter((w) => w.status === "stale").length;
  const depth = queuesArr.reduce((s, x) => s + (Number(x.depth) || 0), 0);
  const inFlight = queuesArr.reduce((s, x) => s + (Number(x.in_flight) || 0), 0);
  const pending = queuesArr.reduce((s, x) => s + (Number(x.pending) || 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Platform overview</h2>
          <p>How Preckon is doing across every tenant.</p>
        </div>
        {/* Time-range filter intentionally omitted until the summary endpoints
            accept a ?range param — a non-functional selector misleads operators. */}
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi">
          <div className="k">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M3 21h18M5 21V7l7-4 7 4v14" />
            </svg>
            Tenants
          </div>
          <div className="v">{tenantStats.loading || tenantStats.error ? "—" : total}</div>
          <div className="d flat">{tenantStats.error ? "unavailable" : `${counts.active} active`}</div>
          <div className="sub">
            {tenantStats.error ? "Couldn't load tenant stats" : `${counts.active} active · ${counts.trial} trial`}
          </div>
        </div>
        <div className="kpi">
          <div className="k">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            MRR
          </div>
          <div className="v">{billing.loading ? "—" : mrrMain}</div>
          <div className="d up">recurring</div>
          <div className="sub">{mrrRest || "plan subscriptions"}</div>
        </div>
        <div className="kpi">
          <div className="k">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M3 3v18h18" />
              <path d="m7 14 4-4 3 3 5-6" />
            </svg>
            Active subs
          </div>
          <div className="v">{billing.loading ? "—" : statusCounts.active ?? 0}</div>
          <div className="d up">paying</div>
          <div className="sub">{statusCounts.trialing ?? 0} on trial</div>
        </div>
        <div className="kpi">
          <div className="k">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4 4h16v14H4z" />
              <path d="M8 8h8M8 12h5" />
            </svg>
            Suspended
          </div>
          <div className="v">{tenantStats.loading || tenantStats.error ? "—" : counts.suspended}</div>
          <div className="d flat">access cut</div>
          <div className="sub">needs review</div>
        </div>
        <div className="kpi">
          <div className="k">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l3 2" />
            </svg>
            Past due
          </div>
          <div className="v">{billing.loading ? "—" : statusCounts.past_due ?? 0}</div>
          <div className={"d " + ((statusCounts.past_due ?? 0) > 0 ? "down" : "flat")}>{summary.health?.failed_payments ?? 0} failed</div>
          <div className="sub">need follow-up</div>
        </div>
      </div>

      {/* Recurring revenue + tenant status */}
      <div className="row two">
        <div className="card">
          <div className="chead">
            <div>
              <h3>Recurring revenue</h3>
              <div className="csub">Monthly, by currency</div>
            </div>
          </div>
          {billing.loading ? (
            <Skeleton rows={3} />
          ) : mrr.length === 0 ? (
            <div className="csub" style={{ padding: "26px 0" }}>
              {billing.error ? billing.error : "No recurring revenue yet."}
            </div>
          ) : (
            <div className="slegend" style={{ marginTop: 8 }}>
              {mrr.map((m) => (
                <div className="r" key={m.currency_code}>
                  <i style={{ background: "var(--teal)" }} />
                  <span className="nm">{m.currency_code}</span>
                  <span className="ct">{fmtMoneyShort(m.amount_minor, m.currency_code)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Tenant status</h3>
          <div className="csub">{total} tenants</div>
          <div className="statusbar">
            {STATUS_META.map((s) => {
              const pct = total ? (counts[s.key] / total) * 100 : 0;
              return pct > 0 ? <span key={s.key} style={{ width: pct + "%", background: s.color }} /> : null;
            })}
          </div>
          <div className="slegend">
            {STATUS_META.map((s) => (
              <div className="r" key={s.key}>
                <i style={{ background: s.color }} />
                <span className="nm">{s.label}</span>
                <span className="ct">{counts[s.key]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Needs attention + recent activity */}
      <div className="row two2">
        <div className="card">
          <div className="chead">
            <div>
              <h3>Needs attention</h3>
              <div className="csub">Trials ending and payment issues</div>
            </div>
            <Link href="/tenants">All tenants →</Link>
          </div>
          {tenants.loading ? (
            <Skeleton rows={4} />
          ) : attention.length === 0 ? (
            <div className="csub" style={{ padding: "18px 0" }}>Nothing needs attention right now.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Edition</th>
                  <th>Status</th>
                  <th className="r">Seats</th>
                </tr>
              </thead>
              <tbody>
                {attention.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="t-name">{t.name}</div>
                      <div className="t-sub">{t.slug}</div>
                    </td>
                    <td className="num">{t.edition_name ?? t.edition_key ?? "—"}</td>
                    <td>
                      <StatusChip status={t.status} />
                    </td>
                    <td className="r num">{fmtSeatCap(t.seat_cap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Recent activity</h3>
          <div className="csub">Host actions, audited</div>
          {audit.loading ? (
            <Skeleton rows={4} />
          ) : auditRows.length === 0 ? (
            <div className="csub" style={{ padding: "14px 0" }}>
              {audit.error ? audit.error : "No recent activity."}
            </div>
          ) : (
            <ul className="feed">
              {auditRows.map((e) => (
                <li key={e.id}>
                  <div className="dot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4l3 2" />
                    </svg>
                  </div>
                  <div>
                    <div className="tx">{e.summary ?? e.action}</div>
                    <div className="tm">{timeAgo(e.occurred_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* System status */}
      <div className="sys">
        <div className="s">
          <div className="k">
            <span className={"led " + (stalled ? "warn" : "ok")} />
            Job queue
          </div>
          <div className="v">{queues.loading ? "—" : stalled ? "Degraded" : "Healthy"}</div>
          <div className="vs">
            {workersUp} workers · {stalled} stalled
          </div>
        </div>
        <div className="s">
          <div className="k">
            <span className={"led " + (depth > 100 ? "warn" : "ok")} />
            Queue depth
          </div>
          <div className="v">{queues.loading ? "—" : depth}</div>
          <div className="vs">pending across queues</div>
        </div>
        <div className="s">
          <div className="k">
            <span className="led ok" />
            In flight
          </div>
          <div className="v">{queues.loading ? "—" : inFlight}</div>
          <div className="vs">processing now</div>
        </div>
        <div className="s">
          <div className="k">
            <span className="led ok" />
            Pending
          </div>
          <div className="v">{queues.loading ? "—" : pending}</div>
          <div className="vs">queued jobs</div>
        </div>
      </div>
    </>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePagedList, unwrap, errMessage, useToast, useCan, Field, Skeleton, ErrorBox, EmptyState } from "../_ui";

interface AuditEvent {
  id: string;
  seq?: number;
  occurred_at?: string;
  actor_type?: string;
  actor_display_name?: string | null;
  action?: string;
  summary?: string;
  target_type?: string;
  target_id?: string;
  target_tenant_id?: string;
  metadata?: Record<string, unknown> | null;
  // Selected and returned by /host/v1/audit-events; the detail row shows it to
  // tie an entry to the request that caused it.
  correlation_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
}

// Compact device label from a user-agent string (for the audit detail).
function deviceOf(ua?: string | null): string {
  if (!ua) return "—";
  if (/curl|wget|node|python|okhttp/i.test(ua)) return ua.split("/")[0];
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || "Browser";
}

// ISO string → readable local timestamp.
function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CAT_CLASS: Record<string, string> = {
  impersonation: "ac-imp",
  billing: "ac-bill",
  invoice: "ac-bill",
  product: "ac-prod",
  edition: "ac-prod",
  feature: "ac-prod",
  pricing: "ac-prod",
  tenant: "ac-ten",
  tenants: "ac-ten",
  user: "ac-user",
  users: "ac-user",
  host_user: "ac-user",
  role: "ac-user",
};

// Derive a category label from the action prefix.
function categoryOf(e: AuditEvent): string {
  const a = e.action ?? "";
  if (a.includes("impersonate")) return "impersonation";
  return a.split(".")[0] || "tenant";
}

function initials(n?: string) {
  if (!n) return "SYS";
  return n.split(" ").map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

export default function AuditPage() {
  const toast = useToast();
  const canExport = useCan("audit.export");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; first_broken_seq?: number } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Action AND date range are filtered server-side (the log spans all history,
  // not just the latest page) with cursor pagination. Free-text search refines
  // the loaded rows client-side.
  const fromISO = from ? new Date(from).toISOString() : "";
  const toISO = to ? new Date(new Date(to).getTime() + 86_400_000).toISOString() : "";
  const path =
    "/audit-events?limit=50" +
    (action ? `&action=${encodeURIComponent(action)}` : "") +
    (fromISO ? `&from=${encodeURIComponent(fromISO)}` : "") +
    (toISO ? `&to=${encodeURIComponent(toISO)}` : "");
  const { items, loading, loadingMore, error, hasMore, loadMore, reload } =
    usePagedList<AuditEvent>(path, [path]);
  const rows: AuditEvent[] = items;

  // Accumulate the set of actions ever seen so the dropdown stays populated
  // even while a single action is selected (which narrows the response).
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const e of rows) if (e.action) seen.current.add(e.action);
  }, [rows]);
  const actionOptions = useMemo(() => Array.from(seen.current).sort(), [rows]);

  const filtered = rows.filter((e) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const hay = ((e.actor_display_name ?? "System") + " " + (e.action ?? "") + " " + (e.summary ?? "") + " " + (e.ip ?? "")).toLowerCase();
    return hay.includes(q);
  });

  async function runExport() {
    setExporting(true);
    try {
      const body: Record<string, unknown> = {};
      if (action) body.action = action;
      if (from) body.occurred_after = new Date(from).toISOString();
      if (to) body.occurred_before = new Date(new Date(to).getTime() + 86_400_000).toISOString();
      await api.post("/audit-events/export", body);
      toast("Audit export queued");
    } catch (e) {
      toast(errMessage(e));
    } finally {
      setExporting(false);
    }
  }

  async function runVerify() {
    setVerifying(true);
    try {
      const res = await api.get<any>("/audit-events/verify");
      const v = unwrap(res) ?? res;
      setVerify({ ok: !!v.ok, first_broken_seq: v.first_broken_seq });
      toast(v.ok ? "Chain verified — intact" : `Chain broken at seq ${v.first_broken_seq}`);
    } catch (e) {
      toast(errMessage(e));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Audit log</h2>
          <p>Every host action, append-only and tamper-evident.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="mini" onClick={runVerify} disabled={verifying}>
            {verifying ? "Verifying…" : "Verify chain"}
          </button>
          {canExport && (
            <button className="mini pri" onClick={runExport} disabled={exporting}>
              {exporting ? "Exporting…" : "Export"}
            </button>
          )}
        </div>
      </div>

      {verify && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 9,
            borderColor: verify.ok ? "var(--teal)" : "var(--red)",
          }}
        >
          <span className={"led " + (verify.ok ? "ok" : "warn")} style={{ width: 9, height: 9, borderRadius: "50%", background: verify.ok ? "var(--teal)" : "var(--red)" }} />
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {verify.ok ? "Hash chain intact — no tampering detected." : `Hash chain broken at seq ${verify.first_broken_seq}.`}
          </span>
        </div>
      )}

      <div className="fbar">
        <Field label="Action">
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="fsearch" style={{ marginLeft: "auto" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input placeholder="Search the log…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <Skeleton rows={10} />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No audit entries" sub="Nothing matches this filter." />
      ) : (
        <div className="card" style={{ padding: "14px 18px" }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Event</th>
                <th>Target</th>
                <th>IP address</th>
                <th className="r">Entry</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const c = categoryOf(e);
                const cls = CAT_CLASS[c] ?? "ac-ten";
                const actor = e.actor_display_name ?? "System";
                const isOpen = expanded === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : e.id)}>
                      <td className="num" style={{ whiteSpace: "nowrap", color: "var(--slate-500)", fontSize: 12 }}>
                        {fmtTime(e.occurred_at)}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div className="avatar" style={{ width: 26, height: 26, fontSize: 9 }}>
                            {initials(actor === "System" ? undefined : actor)}
                          </div>
                          <div>
                            <div className="t-name" style={{ fontSize: 12.5 }}>{actor}</div>
                            <div className="t-sub">{e.actor_type ?? ""}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={"audit-cat " + cls}>{c}</span>{" "}
                        <span style={{ marginLeft: 7, color: "var(--ink)" }}>{e.action}</span>
                      </td>
                      <td style={{ color: "var(--slate-600)", fontSize: 12.5 }}>{e.summary ?? e.target_id ?? "—"}</td>
                      <td className="mono" style={{ fontSize: 12, color: e.ip ? "var(--ink)" : "var(--slate-400)", whiteSpace: "nowrap" }}>{e.ip ?? "—"}</td>
                      <td className="r">
                        <span className="entry-id">{(e.id ?? "").slice(0, 6)}…</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--panel-2)" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", fontSize: 12, marginBottom: 10 }}>
                            <span><span style={{ color: "var(--slate-500)" }}>IP address:</span> <span className="mono" style={{ color: "var(--ink)" }}>{e.ip ?? "—"}</span></span>
                            <span><span style={{ color: "var(--slate-500)" }}>Device:</span> {deviceOf(e.user_agent)}</span>
                            {e.correlation_id && <span><span style={{ color: "var(--slate-500)" }}>Correlation:</span> <span className="mono">{e.correlation_id.slice(0, 8)}</span></span>}
                            {e.seq != null && <span><span style={{ color: "var(--slate-500)" }}>Seq:</span> <span className="mono">{e.seq}</span></span>}
                          </div>
                          {e.user_agent && <div className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)", marginBottom: 10, wordBreak: "break-all" }}>{e.user_agent}</div>}
                          <pre
                            className="mono"
                            style={{ margin: 0, fontSize: 11, color: "var(--slate-600)", whiteSpace: "pre-wrap", overflowX: "auto" }}
                          >
                            {JSON.stringify(e.metadata ?? { action: e.action, target_type: e.target_type, target_id: e.target_id }, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {hasMore && !search && (
            <div style={{ textAlign: "center", paddingTop: 12 }}>
              <button className="mini" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14, fontSize: 11.5, color: "var(--slate-500)" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--teal-press)" }}>
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Entries are append-only — they can&apos;t be edited or deleted, only exported.
          </div>
        </div>
      )}
    </>
  );
}

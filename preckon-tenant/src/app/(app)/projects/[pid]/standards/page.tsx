"use client";
import { use, useState } from "react";
import { useApi, useCan, useToast, Skeleton, EmptyState } from "@/lib/ui";
import { api } from "@/lib/apiclient";

const TIER_ORDER = ["statutory", "industry", "client", "company", "project"];
const TIER_LABEL: Record<string, string> = {
  statutory: "Statutory", industry: "Industry", client: "Client", company: "Company", project: "Project",
};

// Compact, readable key/value for a small rule payload (never raw JSON).
function kv(o: any): string {
  if (o == null || typeof o !== "object") return o == null ? "—" : String(o);
  const parts = Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  return parts.length ? parts.join(", ") : "—";
}

export default function StandardsPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const toast = useToast();
  const canRun = useCan("workflow.run");
  const [subject, setSubject] = useState("concrete wall");
  const rules = useApi<{ rules: any[]; resolution: any }>(`/standards/rules?subject=${encodeURIComponent(subject)}`, [subject]);
  const violations = useApi<any[]>(`/projects/${pid}/standards/violations`, [], { refreshMs: 4000 });
  const [busy, setBusy] = useState(false);

  async function validate() {
    setBusy(true);
    try {
      const r = await api.post<{ emitted: number; checked: number }>(`/projects/${pid}/standards/validate`);
      toast(r.emitted ? `${r.emitted} violation(s) found across ${r.checked} artifacts` : `No violations — ${r.checked} artifacts clean`);
      violations.reload();
    } catch (e: any) { toast(e?.message ?? "Validation failed"); }
    finally { setBusy(false); }
  }

  const byTier = new Map<string, any[]>();
  for (const r of rules.data?.rules ?? []) { const g = byTier.get(r.tier) ?? []; g.push(r); byTier.set(r.tier, g); }
  const resolution = rules.data?.resolution;
  const vios = violations.data ?? [];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <p className="csub" style={{ margin: 0 }}>Standards resolve by precedence (statutory → project); mandatory rules validate your outputs. The rules come from your Library.</p>
        {canRun && <button className="mini pri" disabled={busy} onClick={validate}>{busy ? "Validating…" : "Validate project"}</button>}
      </div>

      {/* Tier precedence resolver */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead"><h2>Tier precedence</h2>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="csub">resolve for</span>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}>
              <option value="concrete wall">concrete wall</option>
              <option value="reinforcement">reinforcement</option>
              <option value="unit rate">unit rate</option>
            </select>
          </span>
        </div>
        {rules.loading ? <Skeleton rows={3} /> : !resolution || resolution.ranked.length === 0 ? (
          <p className="csub" style={{ margin: 0 }}>No rules for “{subject}”.</p>
        ) : (
          <table>
            <thead><tr><th>#</th><th>Standard</th><th>Tier</th><th>Binding</th><th>Result</th><th>Resolution</th></tr></thead>
            <tbody>
              {resolution.ranked.map((r: any) => (
                <tr key={r.rule.rule_id} style={r.rank === 1 ? { background: "var(--teal-tint)" } : undefined}>
                  <td className="num">{r.rank}</td>
                  <td className="t-name">{r.rule.standard}<div className="t-sub">{r.rule.rule_id}</div></td>
                  <td><span className="chip plain" style={{ color: "var(--slate-600)", background: "var(--panel-2)" }}>{TIER_LABEL[r.rule.tier]}</span></td>
                  <td><span className={"chip plain " + (r.rule.binding === "mandatory" ? "critical" : "draft")}>{r.rule.binding}</span></td>
                  <td style={{ fontSize: 12 }}>{kv(r.rule.result)}</td>
                  <td>{r.rank === 1 ? <span className="chip active">wins</span> : <span className="csub" style={{ fontSize: 11.5 }}>{r.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Rules by tier */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead"><h2>Rule library</h2><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{(rules.data?.rules ?? []).length} rules</span></div>
        {rules.loading ? <Skeleton rows={3} /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {TIER_ORDER.filter((t) => byTier.has(t)).map((t) => (
              <div key={t}>
                <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 6 }}>{TIER_LABEL[t]}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {byTier.get(t)!.map((r) => (
                    <div key={r.rule_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 8 }}>
                      <span style={{ fontSize: 12.5 }}><b>{r.standard}</b> <span className="mono" style={{ color: "var(--slate-400)", fontSize: 11 }}>{r.subject}</span></span>
                      <span className={"chip plain " + (r.binding === "mandatory" ? "critical" : "draft")}>{r.binding}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Violations */}
      <div className="card">
        <div className="chead"><h2>Validation findings</h2><span className={"chip plain " + (vios.length ? "warn" : "active")}>{vios.length} open</span></div>
        {violations.loading ? <Skeleton rows={2} /> : vios.length === 0 ? (
          <EmptyState title="No violations" sub="Run “Validate project” after confirming some artifacts to check them against the mandatory rules." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {vios.map((v) => (
              <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 9 }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                    <span className={"chip " + (v.payload.severity || "medium")}>{v.payload.severity}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--slate-500)" }}>{v.payload.rule_id}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--slate-700)" }}>
                    {v.payload.recommendation} <span className="mono" style={{ color: "var(--slate-400)" }}>({v.payload.reference})</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--slate-500)", marginTop: 3 }}>
                    Observed {kv(v.payload.observed)} · Expected {kv(v.payload.expected)}
                  </div>
                </div>
                <span className={"chip " + v.status}>{v.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

"use client";
import { use, useEffect, useState } from "react";
import { useApi, useToast, Skeleton, StatusChip, fmtDateTime } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { typeLabel, summarize } from "@/lib/catalog";

export default function TracePage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const toast = useToast();
  const artifacts = useApi<any[]>(`/projects/${pid}/artifacts`, [], { refreshMs: 5000 });
  const [sel, setSel] = useState<string | null>(null);

  // Deep-link support (?artifact=…) without useSearchParams (avoids suspense boundary).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("artifact");
    if (p) setSel(p);
  }, []);

  const rows = (artifacts.data ?? []).filter((a) => a.status !== "superseded");
  const grouped = new Map<string, any[]>();
  for (const a of rows) { const g = grouped.get(a.type_key) ?? []; g.push(a); grouped.set(a.type_key, g); }

  async function verify() {
    try { const r = await api.get<{ ok: boolean; brokenSeq: number | null }>("/audit/verify"); toast(r.ok ? "Audit chain verified ✓" : `Chain broken at seq ${r.brokenSeq}`); }
    catch (e: any) { toast(e?.message ?? "Verify failed"); }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <p className="csub" style={{ margin: 0 }}>Full provenance — pick any output to see what it was derived from, the AI that produced it, and who confirmed it.</p>
        <button className="mini sm" onClick={verify}>Verify audit chain</button>
      </div>
      <div className="row two">
        <div className="card">
          <div className="chead"><h2>Artifact graph</h2><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{rows.length}</span></div>
          {artifacts.loading ? <Skeleton rows={5} /> : rows.length === 0 ? <p className="csub" style={{ margin: 0 }}>No artifacts yet — run a workflow first.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[...grouped.entries()].map(([type, list]) => (
                <div key={type}>
                  <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 6 }}>{typeLabel(type)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {list.map((a) => (
                      <button key={a.id} onClick={() => setSel(a.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "1px solid " + (sel === a.id ? "var(--teal)" : "var(--hairline)"), background: sel === a.id ? "var(--teal-tint)" : "var(--panel-2)", cursor: "pointer", textAlign: "left" }}>
                        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 12.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summarize(a.payload) || typeLabel(a.type_key)}</span>
                          <span className="mono" style={{ fontSize: 9.5, color: "var(--slate-400)" }}>{a.id.slice(0, 8)}</span>
                        </span>
                        <StatusChip status={a.status} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="chead"><h2>Lineage</h2></div>
          {!sel ? <p className="csub" style={{ margin: 0 }}>Select an artifact to trace it.</p> : <TraceDetail pid={pid} id={sel} />}
        </div>
      </div>
    </>
  );
}

function TraceDetail({ pid, id }: { pid: string; id: string }) {
  const t = useApi<any>(`/projects/${pid}/artifacts/${id}/trace`, [id]);
  if (t.loading) return <Skeleton rows={4} />;
  if (t.error || !t.data) return <p className="csub">Couldn’t load trace.</p>;
  const { artifact, provenance, producingJob, auditEvents } = t.data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="chip plain" style={{ color: "var(--teal-press)" }}>{artifact.type}</span><StatusChip status={artifact.status} /><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>v{artifact.version} · conf {artifact.confidence ?? "—"}</span></div>
      </div>
      <div>
        <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 8 }}>Provenance</div>
        {(provenance ?? []).length === 0 ? <span className="csub">Derived from a source document (root).</span> : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {(provenance ?? []).map((p: any, i: number) => (<span key={i} className="mono" style={{ fontSize: 11.5, color: "var(--slate-600)", background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 6, padding: "3px 7px" }}>{p.type_key}</span>))}
            <span className="ar">→</span><span className="chip plain" style={{ color: "var(--teal-press)" }}>{artifact.type}</span>
          </div>
        )}
      </div>
      {producingJob && (
        <div>
          <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 8 }}>Producing job</div>
          <table><tbody>
            <tr><td>Model</td><td className="r mono">{producingJob.model}</td></tr>
            <tr><td>Tier</td><td className="r mono">{producingJob.tier}</td></tr>
            <tr><td>Job type</td><td className="r mono">{producingJob.job_type}</td></tr>
            <tr><td>Trace</td><td className="r mono">{producingJob.trace_id ?? "—"}</td></tr>
          </tbody></table>
        </div>
      )}
      <div>
        <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 8 }}>Audit trail</div>
        {(auditEvents ?? []).length === 0 ? <span className="csub">No decisions recorded yet.</span> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(auditEvents ?? []).map((e: any) => (
              <div key={e.seq} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                <span className="mono" style={{ color: "var(--ink)" }}>#{e.seq} {e.action}</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{e.actor_kind} · {fmtDateTime(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
import { use } from "react";
import Link from "next/link";
import { useApi, useCan, useToast, Skeleton, ErrorBox } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { humanize } from "@/lib/catalog";

export default function RunDetailPage({ params }: { params: Promise<{ pid: string; rid: string }> }) {
  const { pid, rid } = use(params);
  const toast = useToast();
  const canRun = useCan("workflow.run");
  const run = useApi<any>(`/projects/${pid}/runs/${rid}`, [], { refreshMs: 1800 });
  const devs = useApi<any[]>(`/projects/${pid}/runs/${rid}/deviations`, [], { refreshMs: 2500 });

  async function sweep() { try { await api.post(`/projects/${pid}/runs/${rid}/review`); toast("Copilot sweep requested"); } catch (e: any) { toast(e?.message ?? "Failed"); } }
  async function rerun() { try { const r = await api.post<{ rerun: number }>(`/projects/${pid}/runs/${rid}/rerun-stale`); toast(r.rerun ? `Re-running ${r.rerun} step(s)` : "No stale steps"); run.reload(); } catch (e: any) { toast(e?.message ?? "Failed"); } }
  async function approve(id: string) { try { await api.post(`/projects/${pid}/deviations/${id}/approve`); toast("Deviation approved"); devs.reload(); run.reload(); } catch (e: any) { toast(e?.message ?? "Failed"); } }
  async function reject(id: string) { try { await api.post(`/projects/${pid}/deviations/${id}/reject`); toast("Deviation rejected"); devs.reload(); } catch (e: any) { toast(e?.message ?? "Failed"); } }

  if (run.loading) return <Skeleton rows={6} />;
  if (run.error || !run.data) return <ErrorBox message={run.error ?? "Run not found"} onRetry={run.reload} />;

  const parents = (run.data.steps ?? []).filter((s: any) => !s.parent_step_id);
  const childrenOf = (id: string) => (run.data.steps ?? []).filter((s: any) => s.parent_step_id === id);
  const deviations = devs.data ?? [];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link className="rowbtn" href={`/projects/${pid}/runs`}>← Runs</Link>
          <span style={{ color: "var(--ink)", fontWeight: 600, fontFamily: "var(--font-display)" }}>{humanize(run.data.workflow_key.replace(/^workflow\./, "").replace(/\.skeleton$/, ""))}</span>
          <span className={"chip " + run.data.status}>{run.data.status.replace(/_/g, " ")}</span>
        </div>
        {canRun && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="mini sm" onClick={sweep}>Copilot sweep</button>
            <button className="mini sm" onClick={rerun}>Re-run stale</button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead"><h3>Step timeline</h3><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>ordered · fully traceable</span></div>
        <div className="tl">
          {parents.map((s: any) => (
            <div key={s.id}>
              <div className="step">
                <div><span className="lbl" style={{ textTransform: "capitalize" }}>{humanize(s.node_id)}</span><span className="sub">{s.kind}{s.agent_key ? ` · ${humanize(s.agent_key)}` : ""}</span></div>
                <span className={"chip " + s.status}>{s.status.replace(/_/g, " ")}</span>
              </div>
              {childrenOf(s.id).map((c: any) => (
                <div key={c.id} className="step child">
                  <div><span className="lbl">↳ map #{c.map_index}</span><span className="sub">{c.agent_key}</span></div>
                  <span className={"chip " + c.status}>{c.status.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {run.data.status === "awaiting_review" && (
          <p className="csub" style={{ marginTop: 14, marginBottom: 0 }}>Paused at a gate. Confirm the pending proposals on the <Link className="rowbtn" href={`/projects/${pid}`}>chain stage</Link> that produced them to resume.</p>
        )}
      </div>

      <div className="card">
        <div className="chead"><h3>Colleague proposals</h3><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{deviations.length}</span></div>
        {deviations.length === 0 ? <p className="csub" style={{ margin: 0 }}>No deviations. Run a Copilot sweep to have a colleague cross-check this run.</p> : (
          <div className="tl">
            {deviations.map((d: any) => (
              <div key={d.id} className="step" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}><span className="chip flag">{humanize(d.kind)}</span><span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{humanize(d.proposed_by)}</span></div>
                  <div style={{ fontSize: 12.5, color: "var(--slate-600)" }}>{d.rationale}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className={"chip " + d.status}>{d.status.replace(/_/g, " ")}</span>
                  {d.status === "proposed" && canRun && <><button className="mini sm pri" onClick={() => approve(d.id)}>Approve</button><button className="mini sm" onClick={() => reject(d.id)}>Reject</button></>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

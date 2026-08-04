"use client";
// Project Overview — the chain, made legible. A clickable stepper from tender to
// procurement, what the bid is waiting on, the pursuit lifecycle, and the
// autopilot that can run the whole thing end to end.

import { use } from "react";
import { ProjectCover } from "@/lib/project-cover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, useCan, useToast, Skeleton } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { useProject } from "@/lib/project";
import { typeLabel, humanize } from "@/lib/catalog";
import { Icon } from "@/lib/icons";
import { STAGE_ICON, chainProgress, moneyShort, moduleForType } from "@/lib/chain";
import { useI18n, type Key } from "@/lib/i18n";

export default function ProjectOverviewPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const canRun = useCan("workflow.run");
  const { project, lifecycle, artifacts, runs, stages, loading, reload } = useProject();
  const files = useApi<any[]>(`/projects/${pid}/files`);
  const pursuit = useApi<any>(`/projects/${pid}/pursuit`, [], { refreshMs: 4000 });

  async function startAuto() {
    try { await api.post(`/projects/${pid}/pursuit/start`, {}); toast(t("project.autoStarted")); pursuit.reload(); }
    catch (e: any) { toast(e?.message ?? t("project.autoStartFail")); }
  }
  async function stopAuto() {
    try { await api.post(`/projects/${pid}/pursuit/stop`, {}); toast(t("project.autoStopped")); pursuit.reload(); }
    catch (e: any) { toast(e?.message ?? t("project.autoStopFail")); }
  }

  const pv = pursuit.data;
  const auto = !!pv?.autopilot;
  const plan: any[] = pv?.plan ?? [];
  const attention = stages.filter((s) => s.status === "review");
  const states = lifecycle?.states ?? [];
  const curIdx = states.indexOf(lifecycle?.state ?? project.lifecycle_state);
  const costs = artifacts.filter((a) => (a.type_key.split(".").pop() ?? "") === "cost_line" && a.status === "confirmed");
  const value = costs.length
    ? moneyShort(costs.reduce((n, a) => n + Number(a.payload?.amount_minor ?? 0), 0), costs[0].payload?.currency ?? "")
    : "—";

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead">
          <div>
            <h3>{t("project.chainProgress")}</h3>
            <div className="csub">{t("project.chainProgressSub")}</div>
          </div>
          <span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{t("project.percentComplete", { n: chainProgress(stages) })}</span>
        </div>
        {loading && stages.length === 0 ? <Skeleton rows={2} /> : stages.length === 0 ? (
          <p className="csub" style={{ margin: 0 }}>{t("project.noModules")}</p>
        ) : (
          <div className="chain" style={{ marginTop: 20 }}>
            {stages.map((s, i) => {
              const I = (Icon as any)[STAGE_ICON[s.key] ?? "review"];
              return (
                <button key={s.key} className={"step " + s.status} onClick={() => router.push(`/projects/${pid}/modules/${s.key}`)}>
                  <span className="node">
                    {s.status === "done"
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12l4 4 10-10" /></svg>
                      : I ? <I /> : i + 1}
                  </span>
                  <span className="sl">{t(("stage." + s.key) as Key)}</span>
                  <span className="ss">{t(("chain." + s.status) as Key)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="row two">
        <div className="card">
          <h3>{t("project.attention")}</h3>
          <div className="csub">{t("project.attentionSub")}</div>
          {attention.length === 0 ? (
            <p className="csub" style={{ margin: 0 }}>{t("project.nothingWaiting")}</p>
          ) : (
            <ul className="rq" style={{ marginTop: 6 }}>
              {attention.map((s) => {
                const I = (Icon as any)[STAGE_ICON[s.key] ?? "review"] ?? Icon.review;
                return (
                  <li key={s.key}>
                    <div className="ic hot"><I /></div>
                    <div className="tx">
                      <div className="tt">{t("project.stageNeedsReview", { stage: t(("stage." + s.key) as Key) })}</div>
                      <div className="mt">{s.full} · {t("project.proposalCount", { n: s.pending })}</div>
                    </div>
                    <Link className="mini pri sm" href={`/projects/${pid}/modules/${s.key}`}>{t("common.open")}</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <h3>{t("project.details")}</h3>
          <div className="csub">{t("project.detailsSub")}</div>
          <div className="trow-lbl" style={{ borderTop: 0 }}>{t("project.client")} <b>{project.client_name ?? "—"}</b></div>
          <div className="trow-lbl">{t("project.code")} <b className="mono">{project.code ?? "—"}</b></div>
          <div className="trow-lbl">{t("project.pricedValue")} <b className="mono">{value}</b></div>
          <div className="trow-lbl">{t("project.documents")} <b>{files.data?.length ?? "—"}</b></div>
          <div className="trow-lbl">{t("project.records")} <b>{artifacts.length}</b></div>

          {/* The chain is the product; these are the machine room behind it —
              reachable, but off the tab bar so it stays the chain and nothing else. */}
          <div className="mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate-400)", margin: "16px 0 8px" }}>
            {t("project.behindChain")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Link className="mini sm" href={`/projects/${pid}/runs`}>{t("project.runs", { n: runs.length })}</Link>
            <Link className="mini sm" href={`/projects/${pid}/trace`}>{t("project.trace")}</Link>
            <Link className="mini sm" href={`/projects/${pid}/standards`}>{t("project.standards")}</Link>
            <Link className="mini sm" href={`/projects/${pid}/colleagues`}>{t("project.colleagues")}</Link>
          </div>
        </div>
      </div>

      <ProjectCover pid={pid} />

      <div className="card" style={{ marginBottom: 16, borderColor: auto ? "var(--brand)" : undefined }}>
        <div className="chead">
          <div>
            <h3>{t("project.autopilot")} {auto && <span className="chip running" style={{ marginInlineStart: 8 }}>{t("project.autopilotRunning")}</span>}</h3>
            <div className="csub">{t("project.autopilotSub")}</div>
          </div>
          <span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{pv ? t("project.autopilotProgress", { done: pv.completed, total: pv.total }) : ""}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {auto
            ? <button className="mini sm" disabled={!canRun} onClick={stopAuto}>■ {t("project.autopilotStop")}</button>
            : <button className="mini sm pri" disabled={!canRun} onClick={startAuto}>▶ {t("project.autopilotStart")}</button>}
          {plan.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {plan.map((p) => (
                <span
                  key={p.key}
                  className={"chip " + (p.status === "completed" ? "confirmed" : p.status === "running" || p.status === "awaiting_review" ? "running" : "plain")}
                  title={`${p.module} · ${p.status}`}
                  style={{ fontSize: 11 }}
                >
                  {p.status === "completed" ? "✓ " : p.status === "running" || p.status === "awaiting_review" ? "▸ " : ""}{p.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {project.lifecycle_key && (
        <div className="card">
          <div className="chead">
            <div><h3>{t("project.pursuit")}</h3><div className="csub">{t("project.pursuitSub")}</div></div>
            <span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{project.lifecycle_key}</span>
          </div>
          <div className="stepper">
            {states.map((s, i) => {
              const state = curIdx === -1 ? "" : i < curIdx ? "done" : i === curIdx ? "cur" : "";
              return (
                <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span className={"nd " + state}><span className="n">{state === "done" ? "✓" : i + 1}</span>{humanize(s)}</span>
                  {i < states.length - 1 && <span className="ar">›</span>}
                </span>
              );
            })}
          </div>
          {lifecycle && lifecycle.transitions.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 10 }}>{t("project.nextStep")}</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {lifecycle.transitions.map((tr) => (
                  <div key={`${tr.to}:${tr.triggerType}`} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ fontSize: 13 }}>
                      {t("project.confirmToAdvance", { type: typeLabel(tr.triggerType, t), state: humanize(tr.to) })}
                    </span>
                    <Link className="mini sm pri" href={`/projects/${pid}/modules/${moduleForType(tr.triggerType) ?? stages[0]?.key ?? ""}`} onClick={reload}>{t("project.goToReview")}</Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

"use client";
// PlanLogix — the construction programme.
//
// The planner states the logic — what follows what, with what overlap — and
// `computeCpm` decides the dates, the float and which chain is critical. That
// split matters: a critical path an agent nominated is a label nobody can
// check, while one computed from stated links is something a planner can argue
// with, and correct by editing a duration.
//
// Two things are surfaced that a bar chart alone hides: the BASIS of every
// duration (a quoted contract period, or the quantity ÷ output rate it was
// sized from), and priced scope that no activity delivers — work that will get
// built whether or not the programme left time for it.

import { useMemo, useState } from "react";
import { qty } from "@/lib/chain";
import { ofType } from "@/lib/project";
import { useI18n } from "@/lib/i18n";
import { computeCpm, uncoveredBoq, type CpmNode } from "@/lib/cpm";
import {
  ReviewDrawer, StageEmpty, StageHeader, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";

export default function ScheduleSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  const { nodes, total, criticalPath, warnings } = useMemo(() => computeCpm(rows), [rows]);
  const boqLines = useMemo(() => ofType(artifacts ?? [], "boq_line"), [artifacts]);
  const uncovered = useMemo(() => uncoveredBoq(rows, boqLines), [rows, boqLines]);

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("sched.emptyTitle")} sub={t("sched.emptySub")} />
      </>
    );
  }

  const weeks = Math.ceil(total / 7);
  const marks: number[] = [];
  const step = total > 168 ? 56 : total > 84 ? 28 : total > 28 ? 14 : 7;
  for (let d = 0; d <= total; d += step) marks.push(d);
  const pct = (d: number) => (d / Math.max(total, 1)) * 100;

  // Group into phases in the order they start, so the Gantt reads top to bottom
  // as the job is actually built.
  const phases: Array<{ name: string; items: CpmNode[] }> = [];
  for (const n of nodes) {
    const name = n.phase || t("sched.unphased");
    const last = phases[phases.length - 1];
    if (last && last.name === name) last.items.push(n);
    else if (phases.find((p) => p.name === name)) phases.find((p) => p.name === name)!.items.push(n);
    else phases.push({ name, items: [n] });
  }
  const selNode = nodes.find((n) => n.a.id === sel) ?? null;

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <div className="kpis">
        <div className="kpi"><div className="k">{t("sched.programme")}</div><div className="v">{t("sched.weeks", { n: weeks })}</div><div className="sub">{t("sched.workingDays", { n: total })}</div></div>
        <div className="kpi"><div className="k">{t("sched.activities")}</div><div className="v">{nodes.length}</div><div className="sub">{t("sched.fromBoq")}</div></div>
        <div className="kpi"><div className="k">{t("sched.criticalPath")}</div><div className="v">{criticalPath.length}</div><div className="sub">{t("sched.drivesEnd")}</div></div>
        <div className="kpi"><div className="k">{t("sched.needsReview")}</div><div className="v" style={{ color: pending.length ? "var(--amber)" : undefined }}>{pending.length}</div><div className="sub">{t("sched.durationsToConfirm")}</div></div>
      </div>

      {/* A programme with broken links or uncovered scope is not wrong so much
          as incomplete, and saying so is more useful than drawing it silently. */}
      {(warnings.length > 0 || uncovered.length > 0) && (
        <div className="synth" style={{ marginBottom: 12 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flex: "none" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg>
          <span>
            {warnings.join(" ")}
            {uncovered.length > 0 && ` ${t("sched.uncovered", { n: uncovered.length })}`}
          </span>
        </div>
      )}

      <div className="card" style={{ padding: "16px 18px" }}>
        <div className="chead">
          <div>
            <h3>{t("sched.title")}</h3>
            <div className="csub">{t("sched.titleSub")}</div>
          </div>
        </div>

        <div className="gantt">
          <div className="gantt-head">
            <div className="glbl">{t("sched.colActivity")}</div>
            <div className="gaxis">
              {marks.map((d) => (
                <span key={d} className="wk" style={{ insetInlineStart: `${pct(d)}%` }}>W{Math.round(d / 7)}</span>
              ))}
            </div>
          </div>

          {phases.map((ph) => (
            <div key={ph.name}>
              {phases.length > 1 && (
                <div className="gphase"><span>{ph.name}</span></div>
              )}
              {ph.items.map((n) => (
                <div className="grow" key={n.a.id}>
                  <button className="glbl" onClick={() => { setSel(n.a.id); setReview(n.a); }} title={n.name}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                    {n.flagged && <span className="sd review" />}
                  </button>
                  <div className="gtrack">
                    {marks.map((d) => (
                      <div key={d} className="gwk-grid" style={{ insetInlineStart: `${pct(d)}%` }} />
                    ))}
                    {n.milestone ? (
                      // A milestone has no duration, so a bar would misrepresent
                      // it as a period of work. It gets a diamond on its date.
                      <button
                        className={"gmile" + (n.critical ? " crit" : "") + (sel === n.a.id ? " sel" : "")}
                        style={{ insetInlineStart: `${pct(n.es)}%` }}
                        onClick={() => { setSel(n.a.id); setReview(n.a); }}
                        title={t("sched.milestoneAt", { name: n.name, day: n.es })}
                      />
                    ) : (
                      <>
                        {/* Float drawn behind the bar: how far it can slip. */}
                        {n.float > 0 && (
                          <div
                            className="gfloat"
                            style={{ insetInlineStart: `${pct(n.ef)}%`, width: `${Math.max(0.4, pct(n.float))}%` }}
                            title={t("sched.floatDays", { n: n.float })}
                          />
                        )}
                        <button
                          className={"gbar " + (n.flagged ? "flag" : n.critical ? "crit" : "norm") + (sel === n.a.id ? " sel" : "")}
                          style={{ insetInlineStart: `${pct(n.es)}%`, width: `${Math.max(1.5, pct(n.dur))}%` }}
                          onClick={() => { setSel(n.a.id); setReview(n.a); }}
                          title={t("sched.barTitle", { name: n.name, from: n.es, to: n.ef })}
                        >
                          <span className="gd">{n.dur}d</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="leg">
          <span><i style={{ background: "var(--brand)" }} />{t("sched.legendCritical")}</span>
          <span><i style={{ background: "var(--slate-400)" }} />{t("sched.legendFloat")}</span>
          <span><i style={{ background: "var(--amber)" }} />{t("sched.legendReview")}</span>
        </div>

        {/* The working behind the selected bar. This is what makes a programme
            defensible rather than decorative. */}
        {selNode && (
          <div className="dwg-det" style={{ marginTop: 14 }}>
            <div className="dt">{selNode.name}</div>
            <div className="dk">
              {selNode.phase || t("sched.unphased")}
              {selNode.a.payload?.trade ? ` · ${selNode.a.payload.trade}` : ""}
              {selNode.a.payload?.sow_ref ? ` · SOW ${selNode.a.payload.sow_ref}` : ""}
            </div>
            <div className="trow-lbl" style={{ marginTop: 12 }}>
              {t("sched.dates")} <b className="mono">{t("sched.dayRange", { from: selNode.es, to: selNode.ef })}</b>
            </div>
            <div className="trow-lbl">
              {t("sched.float")}{" "}
              <b className="mono">{selNode.critical ? t("sched.onCriticalPath") : t("sched.floatDays", { n: selNode.float })}</b>
            </div>
            {selNode.links.length > 0 && (
              <div className="trow-lbl">
                {t("sched.follows")}{" "}
                <b>{selNode.links.map((l) => `${l.activity} (${l.type}${l.lag_days ? `${l.lag_days > 0 ? "+" : ""}${l.lag_days}d` : ""})`).join(", ")}</b>
              </div>
            )}
            {selNode.danglingRefs.length > 0 && (
              <div className="trow-lbl">
                {t("sched.unknownLinks")} <b className="conf warn">{selNode.danglingRefs.join(", ")}</b>
              </div>
            )}
            {selNode.a.payload?.basis && (
              <div className="trow-lbl">{t("sched.basis")} <b>{selNode.a.payload.basis}</b></div>
            )}
            {(selNode.a.payload?.boq_refs ?? []).length > 0 && (
              <div className="trow-lbl">
                {t("sched.delivers")} <b className="mono">{(selNode.a.payload.boq_refs as string[]).join(", ")}</b>
              </div>
            )}
          </div>
        )}
      </div>

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review?.payload?.activity ?? t("sched.activity")}
        proposal={
          <>
            <div className="val">{qty(review?.payload?.duration_days)} <small>{t("sched.days")}</small></div>
            <div style={{ fontSize: 12.5, color: "var(--slate-500)", marginTop: 8 }}>
              {(review?.payload?.depends_on ?? review?.payload?.predecessors ?? []).length
                ? t("sched.startsAfter", {
                    predecessors: (review.payload.depends_on ?? review.payload.predecessors)
                      .map((p: any) => (typeof p === "string" ? p : p.activity))
                      .join(", "),
                  })
                : t("sched.noPredecessors")}
              {review?.payload?.wbs ? ` · WBS ${review.payload.wbs}` : ""}
              {review?.payload?.trade ? ` · ${review.payload.trade}` : ""}
            </div>
            {review?.payload?.basis && (
              <div style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 6 }}>{review.payload.basis}</div>
            )}
          </>
        }
        fields={[{ key: "duration_days", label: "sched.fieldDuration", kind: "number" }]}
        onSaved={reload}
      />
    </>
  );
}

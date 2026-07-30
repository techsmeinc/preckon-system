"use client";
// PlanLogix — the construction programme. Activities are sequenced from their
// declared predecessors (forward pass), the critical path falls out of the
// backward pass, and adjusting a duration re-sequences the whole programme.

import { useMemo, useState } from "react";
import { qty } from "@/lib/chain";
import { useI18n } from "@/lib/i18n";
import {
  ReviewDrawer, StageEmpty, StageHeader, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";

interface Node {
  a: any;
  key: string;
  name: string;
  dur: number;
  preds: string[];
  es: number; ef: number;   // early start / finish
  ls: number; lf: number;   // late start / finish
  critical: boolean;
  flagged: boolean;
}

export default function ScheduleSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  const { nodes, total } = useMemo(() => schedule(rows), [rows]);

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("sched.emptyTitle")} sub={t("sched.emptySub")} />
      </>
    );
  }

  const weeks = Math.ceil(total / 7);
  const criticalCount = nodes.filter((n) => n.critical).length;
  const marks: number[] = [];
  const step = total > 84 ? 28 : total > 28 ? 14 : 7;
  for (let d = 0; d <= total; d += step) marks.push(d);

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <div className="kpis">
        <div className="kpi"><div className="k">{t("sched.programme")}</div><div className="v">{t("sched.weeks", { n: weeks })}</div><div className="sub">{t("sched.workingDays", { n: total })}</div></div>
        <div className="kpi"><div className="k">{t("sched.activities")}</div><div className="v">{nodes.length}</div><div className="sub">{t("sched.fromBoq")}</div></div>
        <div className="kpi"><div className="k">{t("sched.criticalPath")}</div><div className="v">{criticalCount}</div><div className="sub">{t("sched.drivesEnd")}</div></div>
        <div className="kpi"><div className="k">{t("sched.needsReview")}</div><div className="v" style={{ color: pending.length ? "var(--amber)" : undefined }}>{pending.length}</div><div className="sub">{t("sched.durationsToConfirm")}</div></div>
      </div>

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
                <span key={d} className="wk" style={{ insetInlineStart: `${(d / Math.max(total, 1)) * 100}%` }}>W{Math.round(d / 7)}</span>
              ))}
            </div>
          </div>
          {nodes.map((n) => (
            <div className="grow" key={n.a.id}>
              <button className="glbl" onClick={() => { setSel(n.a.id); setReview(n.a); }} title={n.name}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                {n.flagged && <span className="sd review" />}
              </button>
              <div className="gtrack">
                {marks.map((d) => (
                  <div key={d} className="gwk-grid" style={{ insetInlineStart: `${(d / Math.max(total, 1)) * 100}%` }} />
                ))}
                <button
                  className={"gbar " + (n.flagged ? "flag" : n.critical ? "crit" : "norm") + (sel === n.a.id ? " sel" : "")}
                  style={{ insetInlineStart: `${(n.es / Math.max(total, 1)) * 100}%`, width: `${Math.max(1.5, (n.dur / Math.max(total, 1)) * 100)}%` }}
                  onClick={() => { setSel(n.a.id); setReview(n.a); }}
                  title={t("sched.barTitle", { name: n.name, from: n.es, to: n.ef })}
                >
                  <span className="gd">{n.dur}d</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="leg">
          <span><i style={{ background: "var(--brand)" }} />{t("sched.legendCritical")}</span>
          <span><i style={{ background: "var(--slate-400)" }} />{t("sched.legendFloat")}</span>
          <span><i style={{ background: "var(--amber)" }} />{t("sched.legendReview")}</span>
        </div>
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
              {(review?.payload?.predecessors ?? []).length
                ? t("sched.startsAfter", { predecessors: (review!.payload.predecessors as string[]).join(", ") })
                : t("sched.noPredecessors")}
              {review?.payload?.wbs ? ` · WBS ${review.payload.wbs}` : ""}
              {review?.payload?.trade ? ` · ${review.payload.trade}` : ""}
            </div>
          </>
        }
        fields={[{ key: "duration_days", label: "sched.fieldDuration", kind: "number" }]}
        onSaved={reload}
      />
    </>
  );
}

/**
 * Forward pass for early dates, backward pass for late dates; zero float means
 * the activity is on the critical path. Unknown predecessor names are ignored
 * rather than throwing — an agent can reference an activity it hasn't emitted.
 */
function schedule(rows: any[]): { nodes: Node[]; total: number } {
  const nodes: Node[] = rows.map((a) => ({
    a,
    key: String(a.payload?.activity ?? a.id),
    name: String(a.payload?.activity ?? "Activity"),
    dur: Math.max(0, Number(a.payload?.duration_days ?? 0)),
    preds: (a.payload?.predecessors ?? []).map(String),
    es: Number(a.payload?.start_offset_days ?? 0) || 0,
    ef: 0, ls: 0, lf: 0,
    critical: false,
    flagged: a.status === "pending" || a.status === "stale",
  }));
  if (nodes.length === 0) return { nodes, total: 0 };

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const byWbs = new Map(nodes.filter((n) => n.a.payload?.wbs).map((n) => [String(n.a.payload.wbs), n]));
  const resolve = (ref: string) => byKey.get(ref) ?? byWbs.get(ref) ?? null;

  // Forward pass. Iterate to a fixed point; the bound also breaks cycles.
  for (let pass = 0; pass < nodes.length + 1; pass++) {
    let changed = false;
    for (const n of nodes) {
      let start = Number(n.a.payload?.start_offset_days ?? 0) || 0;
      for (const p of n.preds) {
        const pred = resolve(p);
        if (pred) start = Math.max(start, pred.es + pred.dur);
      }
      if (start !== n.es) { n.es = start; changed = true; }
      n.ef = n.es + n.dur;
    }
    if (!changed) break;
  }

  const total = Math.max(1, ...nodes.map((n) => n.ef));

  // Backward pass.
  for (const n of nodes) { n.lf = total; n.ls = total - n.dur; }
  for (let pass = 0; pass < nodes.length + 1; pass++) {
    let changed = false;
    for (const n of nodes) {
      const succs = nodes.filter((s) => s.preds.some((p) => resolve(p) === n));
      const lf = succs.length ? Math.min(...succs.map((s) => s.ls)) : total;
      if (lf !== n.lf) { n.lf = lf; n.ls = lf - n.dur; changed = true; }
    }
    if (!changed) break;
  }
  for (const n of nodes) n.critical = n.ls - n.es <= 0.001;

  nodes.sort((a, b) => a.es - b.es || a.name.localeCompare(b.name));
  return { nodes, total };
}

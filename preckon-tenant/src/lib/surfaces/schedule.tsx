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
import { ProgrammeGantt } from "@/lib/programme/gantt";
import { api } from "@/lib/apiclient";
import { useApi } from "@/lib/ui";
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
  const prog = useApi<{ commencement_date: string | null; members: any[] }>(`/projects/${pid}/programme`);
  const boqLines = useMemo(() => ofType(artifacts ?? [], "boq_line"), [artifacts]);
  // A bar's cost is the sum of the priced lines it delivers. Derived rather than
  // stored: a cost typed onto an activity drifts from the bill the moment a rate
  // changes, and then two numbers in the same bid disagree.
  const costByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of ofType(artifacts ?? [], "cost_line")) {
      const code = String(c.payload?.boq_code ?? "").trim();
      if (code) m.set(code, (m.get(code) ?? 0) + Number(c.payload?.amount_minor ?? 0));
    }
    return m;
  }, [artifacts]);
  const currency = String(ofType(artifacts ?? [], "cost_line")[0]?.payload?.currency ?? "USD");
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

      <ProgrammeGantt
        pid={pid}
        rows={rows}
        costByCode={costByCode}
        currency={currency}
        commencement={prog.data?.commencement_date ?? null}
        members={prog.data?.members ?? []}
        reload={() => { reload(); prog.reload(); }}
        onSettings={async (iso) => {
          await api.put(`/projects/${pid}/programme`, { commencement_date: iso });
          prog.reload();
        }}
      />

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

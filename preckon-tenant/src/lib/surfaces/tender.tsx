"use client";
// TenderLogix — the requirement register. What governs the bid, each item traced
// to the clause it came from, plus the commercial decisions the stage produces
// (go/no-go, the assembled proposal, the approval pack).

import { useState } from "react";
import { ofType } from "@/lib/project";
import { money, qty } from "@/lib/chain";
import { fmtDateLocal } from "@/lib/i18n";
import { humanize } from "@/lib/catalog";
import {
  ReviewDrawer, StageEmpty, StageHeader, StatusCell, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";
import { useI18n } from "@/lib/i18n";

export default function TenderSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const { confirmMany, busy } = useArtifactActions(pid, reload);

  const summaries = ofType(rows, "tender_summary");
  const decisions = ofType(rows, "bid_decision");
  const proposals = ofType(rows, "proposal_doc");
  const approvals = ofType(rows, "bid_approval");
  const { pending, highConf } = pendingOf(rows);

  // The register is the union of every summary's mandatory requirements, so a
  // re-read of the tender adds rows rather than replacing the register.
  const requirements = summaries.flatMap((s) =>
    (s.payload?.mandatory_requirements ?? []).map((r: any, i: number) => ({ ...r, artifact: s, idx: i }))
  );
  const latest = summaries[0];
  const deadline = latest?.payload?.submission_deadline;
  const days = deadline ? Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000) : null;

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("tender.emptyTitle")} sub={t("tender.emptySub")} />
      </>
    );
  }

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <div className="kpis">
        <div className="kpi"><div className="k">{t("tender.requirements")}</div><div className="v">{requirements.length}</div><div className="sub">{t("tender.requirementsSub")}</div></div>
        <div className="kpi"><div className="k">{t("tender.awaitingDecision")}</div><div className="v" style={{ color: pending.length ? "var(--amber)" : undefined }}>{pending.length}</div><div className="sub">{t("tender.recordsToConfirm")}</div></div>
        <div className="kpi"><div className="k">{t("tender.submissionFormat")}</div><div className="v" style={{ fontSize: 15 }}>{latest?.payload?.submission_format ?? "—"}</div><div className="sub">{t("tender.asRequired")}</div></div>
        <div className="kpi">
          <div className="k">{t("tender.daysToBid")}</div>
          <div className="v" style={{ color: days != null && days <= 7 ? "var(--amber)" : undefined }}>{days ?? "—"}</div>
          <div className="sub">{deadline ? t("tender.dueOn", { date: fmtDateLocal(deadline, { dateStyle: "medium" }) }) : t("tender.noDeadline")}</div>
        </div>
      </div>

      <div className="row two">
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="chead">
            <div><h3>{t("tender.register")}</h3><div className="csub">{t("tender.registerSub")}</div></div>
          </div>
          {requirements.length === 0 ? (
            <p className="csub" style={{ margin: 0 }}>{t("tender.noRequirements")}</p>
          ) : (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>{t("tender.colRequirement")}</th><th>{t("tender.colSource")}</th><th className="r">{t("common.status")}</th></tr></thead>
              <tbody>
                {requirements.map((r: any) => (
                  <tr key={`${r.artifact.id}-${r.idx}`} className={r.artifact.status === "pending" ? "flagged" : ""}>
                    <td style={{ fontWeight: 500, color: "var(--ink)" }}>{r.text}</td>
                    <td><span className="mono" style={{ fontSize: 11, color: "var(--slate-500)" }}>{r.ref}</span></td>
                    <td className="r"><StatusCell a={r.artifact} onReview={setReview} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>{t("tender.keyFacts")}</h3>
          <div className="csub">{t("tender.keyFactsSub")}</div>
          <div className="trow-lbl" style={{ borderTop: 0 }}>{t("tender.project")} <b>{latest?.payload?.project_name ?? "—"}</b></div>
          <div className="trow-lbl">{t("tender.clientName")} <b>{latest?.payload?.client ?? "—"}</b></div>
          <div className="trow-lbl">{t("tender.deadline")} <b className="mono">{deadline ? fmtDateLocal(deadline, { dateStyle: "medium" }) : "—"}</b></div>
          <div className="trow-lbl">{t("tender.format")} <b>{latest?.payload?.submission_format ?? "—"}</b></div>
          {latest?.payload?.scope_summary && (
            <p className="csub" style={{ marginTop: 14, marginBottom: 0 }}>{latest.payload.scope_summary}</p>
          )}
        </div>
      </div>

      {(decisions.length > 0 || proposals.length > 0 || approvals.length > 0) && (
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="chead"><div><h3>{t("tender.decisions")}</h3><div className="csub">{t("tender.decisionsSub")}</div></div></div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>{t("tender.colRecord")}</th><th>{t("tender.colDetail")}</th><th className="r">{t("projects.colValue")}</th><th className="r">{t("common.status")}</th></tr></thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} className={d.status === "pending" ? "flagged" : ""}>
                  <td className="t-name">{t("tender.goNoGo")}</td>
                  <td>{humanize(d.payload?.decision ?? "—")} — {d.payload?.rationale ?? ""}</td>
                  <td className="r num">—</td>
                  <td className="r"><StatusCell a={d} onReview={setReview} /></td>
                </tr>
              ))}
              {proposals.map((p) => (
                <tr key={p.id} className={p.status === "pending" ? "flagged" : ""}>
                  <td className="t-name">{t("tender.proposal")}</td>
                  <td>{p.payload?.title ?? "—"} · {t("tender.sections", { n: (p.payload?.sections ?? []).length })}</td>
                  <td className="r num">{money(p.payload?.total_amount_minor, p.payload?.currency)}</td>
                  <td className="r"><StatusCell a={p} onReview={setReview} /></td>
                </tr>
              ))}
              {approvals.map((a) => (
                <tr key={a.id} className={a.status === "pending" ? "flagged" : ""}>
                  <td className="t-name">{t("tender.approvalPack")}</td>
                  <td>{a.payload?.recommendation ?? "—"} · {t("tender.margin", { n: qty(a.payload?.margin_pct) })}</td>
                  <td className="r num">{money(a.payload?.total_amount_minor, a.payload?.currency)}</td>
                  <td className="r"><StatusCell a={a} onReview={setReview} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? humanize(review.type_key) : ""}
        proposal={
          <div className="val" style={{ fontSize: 17 }}>
            {review?.payload?.project_name ?? review?.payload?.title ?? review?.payload?.decision ?? review?.payload?.recommendation ?? "Record"}
          </div>
        }
        fields={
          review?.type_key?.endsWith("tender_summary")
            ? [{ key: "submission_format", label: "tender.fieldFormat" as const }, { key: "scope_summary", label: "tender.fieldScope" as const }]
            : [{ key: "rationale", label: "tender.fieldRationale" as const }]
        }
        onSaved={reload}
      />
    </>
  );
}

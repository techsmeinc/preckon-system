"use client";
// DocLogix — the spec browser. Every clause the agent parsed, grouped by
// section, with the normative ones flagged: those are the clauses that must
// carry through to a BOQ item, or something gets priced generically.

import { Fragment, useMemo, useState } from "react";
import {
  ReviewDrawer, StageEmpty, StageHeader, StatusCell, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";
import { useI18n } from "@/lib/i18n";

export default function SpecsSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  const clauses = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (!needle) return true;
      const p = c.payload ?? {};
      return `${p.clause_ref ?? ""} ${p.title ?? ""} ${p.text ?? ""} ${p.section ?? ""}`.toLowerCase().includes(needle);
    });
  }, [rows, q]);

  const sections = useMemo(() => {
    const by = new Map<string, any[]>();
    for (const c of clauses) {
      const s = c.payload?.section ?? t("specs.unsectioned");
      if (!by.has(s)) by.set(s, []);
      by.get(s)!.push(c);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clauses]);

  const normative = rows.filter((c) => c.payload?.is_normative).length;
  const standards = new Set(rows.flatMap((c) => c.payload?.standards ?? [])).size;

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("specs.emptyTitle")} sub={t("specs.emptySub")} />
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
        <div className="kpi"><div className="k">{t("specs.clauses")}</div><div className="v">{rows.length}</div><div className="sub">{t("specs.clausesSub")}</div></div>
        <div className="kpi"><div className="k">{t("specs.normative")}</div><div className="v">{normative}</div><div className="sub">{t("specs.normativeSub")}</div></div>
        <div className="kpi"><div className="k">{t("specs.awaitingReview")}</div><div className="v" style={{ color: pending.length ? "var(--amber)" : undefined }}>{pending.length}</div><div className="sub">{t("specs.needDecision")}</div></div>
        <div className="kpi"><div className="k">{t("specs.standardsCited")}</div><div className="v">{standards}</div><div className="sub">{t("specs.acrossClauses")}</div></div>
      </div>

      <div className="fbar">
        <div className="fsearch">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("specs.search")} aria-label={t("specs.search")} />
        </div>
      </div>

      <div className="card" style={{ padding: "14px 18px" }}>
        <div className="chead">
          <div><h3>{t("specs.title")}</h3><div className="csub">{t("specs.titleSub")}</div></div>
        </div>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>{t("specs.colClause")}</th><th>{t("specs.colTitle")}</th><th>{t("specs.colStandards")}</th><th className="r">{t("common.status")}</th></tr></thead>
          <tbody>
            {sections.map(([section, list]) => (
              <Fragment key={section}>
                <tr className="grp-row"><td colSpan={4}>{section}</td></tr>
                {list.map((c) => (
                  <tr key={c.id} className={c.status === "pending" || c.status === "stale" ? "flagged" : ""}>
                    <td className="num" style={{ color: "var(--slate-500)" }}>{c.payload?.clause_ref ?? "—"}</td>
                    <td>
                      <div className="t-name" style={{ fontWeight: 500 }}>{c.payload?.title ?? (c.payload?.text ?? "").slice(0, 60)}</div>
                      {c.payload?.is_normative && <span className="chip flag plain" style={{ marginTop: 4 }}>{t("specs.normativeChip")}</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--slate-500)" }}>{(c.payload?.standards ?? []).join(", ") || "—"}</td>
                    <td className="r"><StatusCell a={c} onReview={setReview} /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {clauses.length === 0 && <p className="csub" style={{ marginTop: 12 }}>{t("specs.noMatch")}</p>}
      </div>

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? `${review.payload?.clause_ref ?? "Clause"} · ${review.payload?.title ?? ""}` : ""}
        proposal={
          <>
            <div className="val" style={{ fontSize: 17 }}>{review?.payload?.clause_ref ?? "—"}</div>
            <div style={{ fontSize: 13, color: "var(--slate-600)", marginTop: 10, lineHeight: 1.55 }}>{review?.payload?.text}</div>
          </>
        }
        fields={[{ key: "title", label: "specs.fieldTitle" }, { key: "text", label: "specs.fieldText" }]}
        onSaved={reload}
      />
    </>
  );
}

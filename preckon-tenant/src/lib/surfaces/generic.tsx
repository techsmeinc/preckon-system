"use client";
// Fallback surface for any module without a purpose-built screen — a second
// vertical's pack, or a domain a tenant configured themselves. Core is
// domain-neutral, so the UI has to be too: one table per output type, driven by
// the pack's declared artifact types, with the same review pattern.

import { useState } from "react";
import { typeLabel } from "@/lib/catalog";
import { useI18n, type Key } from "@/lib/i18n";
import { StageEmpty, StageHeader, StatusCell, ReviewDrawer, pendingOf, useArtifactActions, summaryOf, type SurfaceProps } from "./common";

export default function GenericSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("generic.emptyTitle", { stage: stage.full })} sub={t("generic.emptySub")} />
      </>
    );
  }

  const byType = new Map<string, any[]>();
  for (const a of rows) {
    const type = a.type_key;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(a);
  }

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <div className="kpis">
        <div className="kpi"><div className="k">{t("generic.records")}</div><div className="v">{rows.length}</div><div className="sub">{t("generic.producedBy", { stage: stage.full })}</div></div>
        <div className="kpi"><div className="k">{t("generic.awaitingReview")}</div><div className="v" style={{ color: pending.length ? "var(--amber)" : undefined }}>{pending.length}</div><div className="sub">{t("generic.needDecision")}</div></div>
        <div className="kpi"><div className="k">{t("generic.confirmed")}</div><div className="v">{rows.filter((a) => a.status === "confirmed").length}</div><div className="sub">{t("generic.onGraph")}</div></div>
        <div className="kpi"><div className="k">{t("generic.outputTypes")}</div><div className="v">{byType.size}</div><div className="sub">{t("generic.fromPack")}</div></div>
      </div>

      {[...byType.entries()].map(([type, list]) => (
        <div className="card" key={type} style={{ padding: "14px 18px", marginBottom: 16 }}>
          <div className="chead"><div><h3>{typeLabel(type, t)}</h3><div className="csub">{t("generic.recordCount", { n: list.length })}</div></div></div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>{t("generic.colRecord")}</th><th className="r">{t("common.status")}</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={a.status === "pending" || a.status === "stale" ? "flagged" : ""}>
                  <td className="t-name">{summaryOf(a.payload) || typeLabel(a.type_key, t)}</td>
                  <td className="r"><StatusCell a={a} onReview={setReview} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? typeLabel(review.type_key, t) : ""}
        proposal={<div className="val" style={{ fontSize: 17 }}>{review ? summaryOf(review.payload) || typeLabel(review.type_key, t) : ""}</div>}
        fields={review ? editableFields(review.payload) : []}
        onSaved={reload}
      />
    </>
  );
}

/** Offer the scalar fields for correction — objects and arrays stay as they are.
 *  A tenant-configured pack has no dictionary entry, so the humanized field name
 *  is the label; `t` echoes an unknown key back, which the drawer renders as-is. */
function editableFields(payload: any): { key: string; label: Key; kind?: "number" | "text" }[] {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .slice(0, 6)
    .map(([k, v]) => ({
      key: k,
      label: (k.replace(/_/g, " ").replace(/\b\w/, (m) => m.toUpperCase())) as Key,
      kind: typeof v === "number" ? ("number" as const) : ("text" as const),
    }));
}

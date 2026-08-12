"use client";
// DrawLogix — the modelling and takeoff surface.
//
// There is ONE drawing canvas here: BIM Studio, which renders the real modelled
// geometry. What follows it is the takeoff *register*.
//
// HONEST LIMIT: `drawing_measurement` carries what was measured (sheet, item,
// quantity, unit, location, method) but no vector geometry — an agent reading a
// PDF gets numbers, not lines. Those measurements are therefore listed and
// reviewed as records, which is what they are. They are not scattered onto a
// representative plan pretending to be a drawing.

import { useEffect, useMemo, useState } from "react";
import { ofType } from "@/lib/project";
import { qty, confPct } from "@/lib/chain";
import { useCan } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { BimStudioPanel } from "@/lib/bim/panel";
import { ParsedSheets } from "@/lib/bim/sheets";
import { Boundary } from "@/lib/boundary";
import { PcmPanel } from "@/lib/pcm/panel";
import {
  ReviewDrawer, StageEmpty, StageHeader, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";

export default function DrawingsSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const sheets = ofType(rows, "drawing_index");
  const measurements = ofType(rows, "drawing_measurement");
  const canConfirm = useCan("artifact.confirm");
  const { confirm, confirmMany, busy } = useArtifactActions(pid, reload);
  const { highConf } = pendingOf(measurements);

  const sheetNos = useMemo(() => {
    const set = new Set<string>();
    for (const s of sheets) if (s.payload?.sheet_no) set.add(s.payload.sheet_no);
    for (const m of measurements) if (m.payload?.sheet_no) set.add(m.payload.sheet_no);
    return [...set].sort();
  }, [sheets, measurements]);

  const [sheet, setSheet] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [review, setReview] = useState<any | null>(null);

  const onSheet = useMemo(
    () => measurements.filter((m) => !sheet || m.payload?.sheet_no === sheet),
    [measurements, sheet]
  );

  const sel = onSheet.find((m) => m.id === selId) ?? null;
  const sheetMeta = sheets.find((s) => s.payload?.sheet_no === sheet);
  const flaggedCount = onSheet.filter(
    (m) => ((confPct(m.confidence) ?? 100) < 90 || m.status === "stale") && m.status !== "confirmed"
  ).length;

  useEffect(() => { setSelId(null); }, [sheet]);

  const flagged = (m: any) => ((confPct(m.confidence) ?? 100) < 90 || m.status === "stale") && m.status !== "confirmed";

  // BIM Studio is the modelling surface and stands on its own — it must be here
  // before any drawing has been indexed, because modelling is often how the
  // first quantities get created in the first place.
  if (measurements.length === 0 && sheets.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <Boundary name="Issued drawings"><ParsedSheets pid={pid} /></Boundary>
        <Boundary name="BIM Studio"><BimStudioPanel pid={pid} onMeasured={reload} /></Boundary>
        <Boundary name="Construction model"><PcmPanel pid={pid} /></Boundary>
        <StageEmpty title={t("draw.emptyTitle")} sub={t("draw.emptySub")} />
      </>
    );
  }

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <Boundary name="Issued drawings"><ParsedSheets pid={pid} /></Boundary>

      <Boundary name="BIM Studio"><BimStudioPanel pid={pid} onMeasured={reload} /></Boundary>

      <Boundary name="Construction model"><PcmPanel pid={pid} /></Boundary>

      <div className="card">
        <div className="chead">
          <div>
            <h2>{t("draw.registerTitle")}</h2>
            <div className="csub">{t("draw.registerSub")}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {sheetNos.length > 1 && (
              <select
                className="mini"
                value={sheet ?? ""}
                onChange={(e) => setSheet(e.target.value || null)}
                aria-label={t("draw.sheet")}
              >
                <option value="">{t("draw.allSheets")}</option>
                {sheetNos.map((s) => {
                  const meta = sheets.find((x) => x.payload?.sheet_no === s);
                  return <option key={s} value={s}>{s}{meta?.payload?.title ? ` · ${meta.payload.title}` : ""}</option>;
                })}
              </select>
            )}
          </div>
        </div>

        <div className="dwg-stat" style={{ marginBottom: 12 }}>
          <div className="st"><div className="k">{t("draw.measured")}</div><div className="v">{onSheet.length}</div></div>
          <div className="st"><div className="k">{t("draw.needReview")}</div><div className={"v" + (flaggedCount ? " warn" : "")}>{flaggedCount}</div></div>
        </div>

        <div className="tw">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("draw.element")}</th>
                <th>{t("draw.location")}</th>
                <th className="num">{t("draw.measurement")}</th>
                <th className="num">{t("draw.confidence")}</th>
                <th>{t("common.status")}</th>
                <th><span className="vh">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {onSheet.map((m) => {
                const pct = confPct(m.confidence);
                return (
                  <tr
                    key={m.id}
                    className={(selId === m.id ? "on " : "") + (flagged(m) ? "warn" : "")}
                    onClick={() => setSelId(selId === m.id ? null : m.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <b>{m.payload?.item ?? t("draw.element")}</b>
                      {m.payload?.sheet_no && <div className="csub mono">{m.payload.sheet_no}</div>}
                    </td>
                    <td>{m.payload?.location ?? "—"}</td>
                    <td className="num mono">{qty(m.payload?.quantity)} {unitLabel(m.payload?.unit)}</td>
                    <td className="num">
                      {pct != null ? <span className={"conf" + (pct < 90 ? " warn" : "")}>{pct}%</span> : "—"}
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{m.status}</td>
                    <td className="num">
                      {m.status === "confirmed" ? (
                        // Accepted is not final. A measurement is the number a
                        // bill is built on, and the moment somebody finds it
                        // wrong is usually after it was accepted — so the way
                        // back in has to be on the row, not nowhere.
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <span className="acc">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12l4 4 10-10" /></svg>
                            {t("draw.measurementAccepted")}
                          </span>
                          <button className="mini sm" onClick={(e) => { e.stopPropagation(); setReview(m); }}>{t("review.correctThis")}</button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          {canConfirm && <button className="mini pri sm" disabled={busy} onClick={() => confirm(m.id)}>{t("draw.accept")}</button>}
                          <button className="mini sm" onClick={() => setReview(m)}>{t("draw.correct")}</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* How it was measured is the part an estimator actually audits, so it
            gets room of its own rather than a truncated cell. */}
        {sel && (
          <div className="dwg-det" style={{ marginTop: 12 }}>
            <div className="dt">{sel.payload?.item ?? t("draw.element")}</div>
            <div className="dk">{sel.payload?.sheet_no ?? "—"} · {t("draw.measuredElement")}</div>
            <div className="trow-lbl" style={{ marginTop: 12 }}>{t("draw.measurement")} <b className="mono">{qty(sel.payload?.quantity)} {unitLabel(sel.payload?.unit)}</b></div>
            {sel.payload?.location && <div className="trow-lbl">{t("draw.location")} <b>{sel.payload.location}</b></div>}
            {sel.payload?.method && <div className="trow-lbl">{t("draw.method")} <b>{sel.payload.method}</b></div>}
            <div style={{ fontSize: 11, color: "var(--slate-500)", marginTop: 12 }}>
              {sel.status === "confirmed" ? t("draw.acceptedNote") : t("draw.reviewNote")}
            </div>
          </div>
        )}

        {sheetMeta && (
          <p className="csub" style={{ marginTop: 12 }}>
            {sheetMeta.payload?.sheet_no} · {sheetMeta.payload?.title ?? "—"} · {sheetMeta.payload?.discipline ?? "—"}
            {sheetMeta.payload?.scale ? ` · scale ${sheetMeta.payload.scale}` : ""}
            {sheetMeta.payload?.revision ? ` · rev ${sheetMeta.payload.revision}` : ""}
          </p>
        )}
      </div>

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? `${review.payload?.sheet_no ?? ""} · ${review.payload?.item ?? "Measurement"}` : ""}
        proposal={<div className="val">{qty(review?.payload?.quantity)} <small>{unitLabel(review?.payload?.unit)}</small></div>}
        fields={[
          { key: "quantity", label: "draw.fieldQuantity", kind: "number" },
          { key: "unit", label: "draw.fieldUnit" },
          { key: "location", label: "draw.fieldLocation" },
          { key: "method", label: "draw.fieldMethod", kind: "textarea" },
        ]}
        onSaved={reload}
      />
    </>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const UNITS: Record<string, string> = { m: "m", m2: "m²", m3: "m³", nr: "nr", kg: "kg", t: "t", lm: "lm" };
export function unitLabel(u?: string | null): string {
  return u ? UNITS[u] ?? u : "";
}

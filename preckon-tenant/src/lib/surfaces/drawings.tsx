"use client";
// DrawLogix — the takeoff review surface.
//
// HONEST LIMIT: `drawing_measurement` carries what was measured (sheet, item,
// quantity, unit, location, method) but no vector geometry, and the ingestion
// path stores page text rather than a renderable drawing. So the canvas is a
// SCHEMATIC: a representative plan with one element per real measurement, laid
// out deterministically so positions are stable between visits. Everything you
// act on — the quantity, the confidence, the status, the trace — is real. The
// banner says so on screen; it is not dressed up as a rendered sheet.

import { useEffect, useMemo, useRef, useState } from "react";
import { ofType } from "@/lib/project";
import { qty, confPct } from "@/lib/chain";
import { useCan } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { BimStudioPanel } from "@/lib/bim/panel";
import {
  ReviewDrawer, StageEmpty, StageHeader, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";

interface Placed {
  a: any;            // the measurement artifact
  x: number; y: number; w: number; h: number;
  flagged: boolean;
}

const COLS = 5;
const ROWS = 3;

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
  const [showRec, setShowRec] = useState(true);
  const [review, setReview] = useState<any | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const vpRef = useRef<SVGGElement>(null);
  const view = useRef({ tx: 0, ty: 0, s: 1 });

  useEffect(() => {
    if (!sheet && sheetNos.length) setSheet(sheetNos[0]);
  }, [sheetNos, sheet]);

  const onSheet = useMemo(
    () => measurements.filter((m) => !sheet || m.payload?.sheet_no === sheet),
    [measurements, sheet]
  );

  // Deterministic layout: elements spread evenly over the plan rather than
  // filling row by row, so four measurements don't all bunch along the top.
  // Each box is sized by how big its quantity is relative to the largest here.
  const placed: Placed[] = useMemo(() => {
    const shown = onSheet.slice(0, COLS * ROWS);
    const max = Math.max(1, ...shown.map((m) => Number(m.payload?.quantity ?? 0)));
    const cols = Math.min(COLS, Math.max(1, Math.ceil(Math.sqrt(shown.length))));
    const rows = Math.max(1, Math.ceil(shown.length / cols));
    // Inside the slab (70,60 → 740,530), inset so labels stay on the sheet.
    const x0 = 150, x1 = 660, y0 = 140, y1 = 460;
    return shown.map((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const share = Math.sqrt(Number(m.payload?.quantity ?? 0) / max) || 0.35;
      const w = 34 + share * 62;
      const h = 26 + share * 46;
      const cx = cols === 1 ? (x0 + x1) / 2 : x0 + (col * (x1 - x0)) / (cols - 1);
      const cy = rows === 1 ? (y0 + y1) / 2 : y0 + (row * (y1 - y0)) / (rows - 1);
      return {
        a: m,
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
        flagged: (confPct(m.confidence) ?? 100) < 90 || m.status === "stale",
      };
    });
  }, [onSheet]);

  const overflow = Math.max(0, onSheet.length - COLS * ROWS);
  const sel = placed.find((p) => p.a.id === selId)?.a ?? null;
  const sheetMeta = sheets.find((s) => s.payload?.sheet_no === sheet);

  /* ── pan / zoom ─────────────────────────────────────────────────────────── */
  function apply() {
    const v = view.current;
    vpRef.current?.setAttribute("transform", `translate(${v.tx},${v.ty}) scale(${v.s})`);
  }
  function zoom(f: number) {
    const v = view.current;
    const ns = Math.min(4, Math.max(0.6, v.s * f));
    v.tx = 400 - ((400 - v.tx) / v.s) * ns;
    v.ty = 300 - ((300 - v.ty) / v.s) * ns;
    v.s = ns;
    apply();
  }
  function fit() { view.current = { tx: 0, ty: 0, s: 1 }; apply(); }

  useEffect(() => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!canvas || !svg) return;
    let panning = false, moved = false, sx = 0, sy = 0, stx = 0, sty = 0;

    const down = (e: PointerEvent) => {
      panning = true; moved = false;
      sx = e.clientX; sy = e.clientY; stx = view.current.tx; sty = view.current.ty;
      canvas.classList.add("grabbing");
    };
    const move = (e: PointerEvent) => {
      if (!panning) return;
      const r = svg.getBoundingClientRect();
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
      view.current.tx = stx + ((e.clientX - sx) / r.width) * 800;
      view.current.ty = sty + ((e.clientY - sy) / r.height) * 600;
      apply();
    };
    const up = () => { panning = false; canvas.classList.remove("grabbing"); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 800;
      const my = ((e.clientY - r.top) / r.height) * 600;
      const v = view.current;
      const ns = Math.min(4, Math.max(0.6, v.s * (e.deltaY < 0 ? 1.1 : 0.9)));
      v.tx = mx - ((mx - v.tx) / v.s) * ns;
      v.ty = my - ((my - v.ty) / v.s) * ns;
      v.s = ns;
      apply();
    };
    const click = (e: MouseEvent) => {
      if (moved) return;
      const el = (e.target as Element).closest(".rec");
      if (el) setSelId(el.getAttribute("data-id"));
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    svg.addEventListener("click", click);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("wheel", wheel);
      svg.removeEventListener("click", click);
    };
  }, []);

  useEffect(() => { fit(); setSelId(null); }, [sheet]);

  // BIM Studio is the modelling surface and stands on its own — it must be here
  // before any drawing has been indexed, because modelling is often how the
  // first quantities get created in the first place.
  if (measurements.length === 0 && sheets.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <BimStudioPanel pid={pid} onMeasured={reload} />
        <StageEmpty title={t("draw.emptyTitle")} sub={t("draw.emptySub")} />
      </>
    );
  }

  const flaggedCount = placed.filter((p) => p.flagged && p.a.status !== "confirmed").length;
  const byUnit = groupBy(onSheet, (m) => m.payload?.unit ?? "—");

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <BimStudioPanel pid={pid} onMeasured={reload} />

      <div className="synth">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flex: "none" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg>
        <span><b>{t("draw.schematicLead")}</b> {t("draw.schematicBody")}</span>
      </div>

      <div className="dwg-wrap">
        <div className="dwg-main">
          <div className="dwg-toolbar">
            <select value={sheet ?? ""} onChange={(e) => setSheet(e.target.value)} aria-label={t("draw.sheet")}>
              {sheetNos.map((s) => {
                const meta = sheets.find((x) => x.payload?.sheet_no === s);
                return <option key={s} value={s}>{s}{meta?.payload?.title ? ` · ${meta.payload.title}` : ""}</option>;
              })}
            </select>
            <label className="tgl"><input type="checkbox" checked={showRec} onChange={(e) => setShowRec(e.target.checked)} /> {t("draw.recognition")}</label>
            <div className="zoomctl">
              <button onClick={() => zoom(0.83)} title={t("draw.zoomOut")}>−</button>
              <button onClick={() => zoom(1.2)} title={t("draw.zoomIn")}>+</button>
              <button className="tbtn" onClick={fit} title={t("draw.fit")}>⤢</button>
            </div>
          </div>

          <div className="dwg-canvas" ref={canvasRef}>
            <svg viewBox="0 0 800 600" ref={svgRef}>
              <g ref={vpRef}>
                <BasePlan />
                {showRec && placed.map((p) => (
                  <g key={p.a.id}>
                    <rect
                      className={"rec" + (p.flagged && p.a.status !== "confirmed" ? " flagged" : "") + (selId === p.a.id ? " sel" : "")}
                      data-id={p.a.id}
                      x={p.x} y={p.y} width={p.w} height={p.h} rx={3}
                    />
                    <text className="reclbl" x={p.x + 1} y={p.y - 3}>{(p.a.payload?.item ?? "").slice(0, 18)}</text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </div>

        <aside className="dwg-panel">
          <div className="dwg-stat">
            <div className="st"><div className="k">{t("draw.measured")}</div><div className="v">{onSheet.length}</div></div>
            <div className="st"><div className="k">{t("draw.needReview")}</div><div className={"v" + (flaggedCount ? " warn" : "")}>{flaggedCount}</div></div>
          </div>

          <ul className="dwg-types">
            {byUnit.map(([unit, list]) => {
              const fl = list.filter((m) => (confPct(m.confidence) ?? 100) < 90 && m.status !== "confirmed").length;
              return (
                <li key={unit} onClick={() => setSelId(list[0].id)}>
                  <span>{unitLabel(unit)}</span>
                  <span className="ct">{list.length}{fl ? <> · <span className="fl">{t("draw.flagged", { n: fl })}</span></> : null}</span>
                </li>
              );
            })}
          </ul>

          <div className="dwg-det">
            {!sel ? (
              <div className="empty">{t("draw.selectPrompt")}</div>
            ) : (
              <>
                <div className="dt">{sel.payload?.item ?? t("draw.element")}</div>
                <div className="dk">{sel.payload?.sheet_no ?? "—"} · {t("draw.measuredElement")}</div>
                <div className="trow-lbl" style={{ marginTop: 12 }}>{t("draw.measurement")} <b className="mono">{qty(sel.payload?.quantity)} {unitLabel(sel.payload?.unit)}</b></div>
                {sel.payload?.location && <div className="trow-lbl">{t("draw.location")} <b>{sel.payload.location}</b></div>}
                {sel.payload?.method && <div className="trow-lbl">{t("draw.method")} <b>{sel.payload.method}</b></div>}
                <div className="trow-lbl">
                  {t("draw.confidence")} <b>{confPct(sel.confidence) != null ? <span className={"conf" + ((confPct(sel.confidence) ?? 100) < 90 ? " warn" : "")}>{confPct(sel.confidence)}%</span> : "—"}</b>
                </div>
                <div className="trow-lbl">{t("common.status")} <b style={{ textTransform: "capitalize" }}>{sel.status}</b></div>

                {sel.status === "confirmed" ? (
                  <div className="acc" style={{ marginTop: 14 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12l4 4 10-10" /></svg>
                    {t("draw.measurementAccepted")}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    {canConfirm && <button className="mini pri" style={{ flex: 1 }} disabled={busy} onClick={() => confirm(sel.id)}>{t("draw.accept")}</button>}
                    <button className="mini" style={{ flex: 1 }} onClick={() => setReview(sel)}>{t("draw.correct")}</button>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--slate-500)", marginTop: 12 }}>
                  {sel.status === "confirmed" ? t("draw.acceptedNote") : t("draw.reviewNote")}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {overflow > 0 && (
        <p className="csub" style={{ marginTop: 12 }}>
          {t("draw.overflow", { n: overflow })}
        </p>
      )}
      {sheetMeta && (
        <p className="csub" style={{ marginTop: 8 }}>
          {sheetMeta.payload?.sheet_no} · {sheetMeta.payload?.title ?? "—"} · {sheetMeta.payload?.discipline ?? "—"}
          {sheetMeta.payload?.scale ? ` · scale ${sheetMeta.payload.scale}` : ""}
          {sheetMeta.payload?.revision ? ` · rev ${sheetMeta.payload.revision}` : ""}
        </p>
      )}

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? `${review.payload?.sheet_no ?? ""} · ${review.payload?.item ?? "Measurement"}` : ""}
        proposal={<div className="val">{qty(review?.payload?.quantity)} <small>{unitLabel(review?.payload?.unit)}</small></div>}
        fields={[{ key: "quantity", label: "draw.fieldQuantity", kind: "number" }, { key: "location", label: "draw.fieldLocation" }]}
        onSaved={reload}
      />
    </>
  );
}

/* ── the representative plan the elements sit on ─────────────────────────── */

function BasePlan() {
  const gx = [120, 260, 400, 540, 680];
  const gy = [110, 290, 470];
  return (
    <g>
      {gx.map((x) => <line key={`vx${x}`} className="g-grid" x1={x} y1={55} x2={x} y2={525} />)}
      {gy.map((y) => <line key={`hy${y}`} className="g-grid" x1={55} y1={y} x2={745} y2={y} />)}
      <rect className="g-slab" x={70} y={60} width={670} height={470} />
      <rect className="g-core" x={340} y={225} width={120} height={130} />
      {gx.map((x, i) => (
        <g key={`bx${x}`}>
          <circle className="g-bub" cx={x} cy={40} r={9} />
          <text className="g-bubt" x={x} y={40}>{i + 1}</text>
        </g>
      ))}
      {["A", "B", "C"].map((l, i) => (
        <g key={l}>
          <circle className="g-bub" cx={40} cy={gy[i]} r={9} />
          <text className="g-bubt" x={40} y={gy[i]}>{l}</text>
        </g>
      ))}
    </g>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const UNITS: Record<string, string> = { m: "m", m2: "m²", m3: "m³", nr: "nr", kg: "kg", t: "t", lm: "lm" };
export function unitLabel(u?: string | null): string {
  return u ? UNITS[u] ?? u : "";
}

function groupBy<T>(list: T[], key: (t: T) => string): [string, T[]][] {
  const by = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(item);
  }
  return [...by.entries()];
}

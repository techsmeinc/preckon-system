"use client";
// BIM Studio — the modelling surface on the Drawings stage.
//
// Ported from DrawLogix's bim-studio/bim-plan. Two rules carried over verbatim
// because they are what make it work:
//
//  1. Every mutation — toolbar, properties panel, and later the agent — emits a
//     `Command` and goes through `applyCommand`. Any manual capability is
//     therefore automatically an agent capability, and undo is a single snapshot
//     bus rather than per-widget bookkeeping.
//  2. The catalog is data. All seven disciplines and ~60 categories come from
//     CATALOG in model.ts, so adding a construction item is a catalog entry, not
//     a change here.
//
// This is the 2D plan (SVG, top-down, Y-flipped). The three.js 3D viewport is
// the next piece; the model and commands are already shared, so it drops in
// beside this without touching either.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATALOG, DISCIPLINES, byDiscipline, catalogByDiscipline, emptyDocument, levels, linLength, list,
  type BimDocument, type CatalogItem, type Discipline, type Element, type Id,
} from "./model";
import { applyCommands, initHistory, redo, run, undo, type Command, type History } from "./commands";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/**
 * The catalogue's colours are 3D *material* colours — a wall is near-white
 * because that is what a lit surface looks like in a viewport. Flat on a plan
 * the same value is invisible against the sheet, so pale items are darkened to
 * something like the poché a real drawing uses. Services keep their signal
 * colours, which are already legible.
 */
function planHex(c: number): string {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum <= 0.72) return hex(c);
  // Keep the hue, drop it to a readable weight rather than flat black.
  const k = 0.34 / lum;
  const d = (v: number) => Math.round(Math.min(255, v * k));
  return `#${((d(r) << 16) | (d(g) << 8) | d(b)).toString(16).padStart(6, "0")}`;
}

/* ── Plan geometry ────────────────────────────────────────────────────────── */

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function boundsOf(doc: BimDocument): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x?: number, y?: number) => {
    if (typeof x !== "number" || typeof y !== "number") return;
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
  };
  for (const e of list(doc)) {
    const g = e.geom;
    add(g.start?.x, g.start?.y);
    add(g.end?.x, g.end?.y);
    add(g.at?.x, g.at?.y);
    for (const p of g.outline ?? []) add(p.x, p.y);
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 20, maxY: 15 };
  const pad = Math.max(2, (b.maxX - b.minX) * 0.08);
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/** Where a hosted element (door/window) sits along its host wall. */
function hostedPoint(doc: BimDocument, e: Element): { x: number; y: number; ang: number } | null {
  const host = e.geom.host ? doc.elements[e.geom.host] : undefined;
  if (!host?.geom.start || !host.geom.end) return null;
  const len = linLength(host) || 1;
  const t = Math.min(1, Math.max(0, (e.geom.offset ?? len / 2) / len));
  return {
    x: host.geom.start.x + (host.geom.end.x - host.geom.start.x) * t,
    y: host.geom.start.y + (host.geom.end.y - host.geom.start.y) * t,
    ang: Math.atan2(host.geom.end.y - host.geom.start.y, host.geom.end.x - host.geom.start.x),
  };
}

/* ── The Studio ───────────────────────────────────────────────────────────── */

export function BimStudio({
  initialDoc, version, onSave, readOnly = false, t, full = false, onToggleFull,
}: {
  initialDoc: BimDocument;
  version: number;
  onSave: (doc: BimDocument, baseVersion: number) => Promise<number>;
  readOnly?: boolean;
  t: (k: string, vars?: Record<string, string | number>) => string;
  /** Owned by the panel, because full screen takes the whole studio — the
   *  ribbon and the catalogue as well as the canvas. */
  full?: boolean;
  onToggleFull?: () => void;
}) {
  const [hist, setHist] = useState<History>(() => initHistory(initialDoc));
  const [discipline, setDiscipline] = useState<Discipline>("architectural");
  const [selected, setSelected] = useState<Id | null>(null);
  const [hidden, setHidden] = useState<Set<Discipline>>(new Set());
  const [baseVersion, setBaseVersion] = useState(version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doc = hist.doc;
  const bounds = useMemo(() => boundsOf(doc), [doc]);

  const dispatch = useCallback((cmds: Command | Command[]) => {
    if (readOnly) return;
    setHist((h) => run(h, cmds));
    setDirty(true);
  }, [readOnly]);

  /* Place a catalog item. Linear items get a default run, area items a default
     footprint, points land at the plan centre — enough to exist and be dragged
     into place, which is how the DrawLogix toolbar behaves. */
  function place(item: CatalogItem) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const lvl = levels(doc)[0]?.id;
    const base: any = { category: item.category, level: lvl };
    if (item.kind === "linear") dispatch({ name: "add", args: { ...base, start: { x: cx - 4, y: cy }, end: { x: cx + 4, y: cy } } });
    else if (item.kind === "area") dispatch({ name: "add", args: { ...base, outline: [
      { x: cx - 4, y: cy - 3 }, { x: cx + 4, y: cy - 3 }, { x: cx + 4, y: cy + 3 }, { x: cx - 4, y: cy + 3 },
    ] } });
    else if (item.kind === "hosted") {
      const wall = list(doc).find((e) => e.geom.kind === "linear" && /wall/.test(e.category));
      if (!wall) { setErr(t("bim.needWall")); return; }
      dispatch({ name: "add", args: { ...base, host: wall.id, offset: linLength(wall) / 2 } });
    } else dispatch({ name: "add", args: { ...base, at: { x: cx, y: cy } } });
    setErr(null);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const v = await onSave(doc, baseVersion);
      setBaseVersion(v);
      setDirty(false);
    } catch (e: any) {
      setErr(e?.message ?? t("bim.saveFail"));
    } finally { setSaving(false); }
  }

  // Ctrl+Z / Ctrl+Shift+Z, the only shortcuts a modelling surface really owes you.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
      setDirty(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const visible = list(doc).filter((e) => e.category !== "level" && !hidden.has(e.discipline));
  const sel = selected ? doc.elements[selected] : null;

  // Legend: only the categories actually present, grouped by discipline.
  const legend = useMemo(() => {
    const by = new Map<Discipline, Map<string, number>>();
    for (const e of list(doc)) {
      if (e.category === "level") continue;
      if (!by.has(e.discipline)) by.set(e.discipline, new Map());
      const m = by.get(e.discipline)!;
      m.set(e.category, (m.get(e.category) ?? 0) + 1);
    }
    return by;
  }, [doc]);

  const vb = `${bounds.minX} ${-bounds.maxY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
  const span = Math.max(bounds.maxX - bounds.minX, 1);
  const stroke = span / 400;

  return (
    <>
      {/* Discipline ribbon — the seven divisions, straight from DISCIPLINES. */}
      <div className="bim-ribbon">
        {DISCIPLINES.map((d) => (
          <button key={d.id} className={discipline === d.id ? "on" : ""} onClick={() => setDiscipline(d.id)}>
            {t(`bim.disc.${d.id}`)}
            <span className="n">{byDiscipline(doc, d.id).length}</span>
          </button>
        ))}
      </div>

      {/* Catalog for the active discipline. */}
      <div className="bim-tools">
        {catalogByDiscipline(discipline).map((item) => (
          <button key={item.category} className="bim-tool" disabled={readOnly} onClick={() => place(item)} title={item.category}>
            <i style={{ background: planHex(item.color) }} />
            {item.label}
          </button>
        ))}
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="bim-wrap">
        <div className="bim-main">
          <div className="bim-bar">
            <span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>
              {t("bim.elements", { n: visible.length })} · v{baseVersion}{dirty ? " ·" : ""}
            </span>
            <div style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
              <button
                className="mini sm"
                onClick={() => onToggleFull?.()}
                aria-pressed={full}
                title={full ? t("bim.exitFull") : t("bim.full")}
              >
                {full ? "⤡" : "⤢"} {full ? t("bim.exitFull") : t("bim.full")}
              </button>
              <button className="mini sm" onClick={() => { setHist(undo); setDirty(true); }} disabled={!hist.past.length}>↶</button>
              <button className="mini sm" onClick={() => { setHist(redo); setDirty(true); }} disabled={!hist.future.length}>↷</button>
              {!readOnly && (
                <button className="mini sm pri" onClick={save} disabled={saving || !dirty}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              )}
            </div>
          </div>

          {/* 2D plan. Y is flipped so north is up, and every element is wrapped
              so one malformed entity can't blank the whole drawing. */}
          <div className="bim-canvas">
            <svg viewBox={vb} preserveAspectRatio="xMidYMid meet">
              <g>
                {visible.map((e) => {
                  try { return <PlanElement key={e.id} doc={doc} e={e} stroke={stroke} selected={e.id === selected} onSelect={setSelected} />; }
                  catch { return null; }
                })}
              </g>
            </svg>
          </div>
        </div>

        <aside className="bim-side">
          <h4>{t("bim.legend")}</h4>
          {legend.size === 0 ? (
            <p className="csub" style={{ margin: 0 }}>{t("bim.empty")}</p>
          ) : (
            [...legend.entries()].map(([d, cats]) => (
              <div key={d} className="bim-leg">
                <button className="bim-leg-h" onClick={() => setHidden((s) => {
                  const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n;
                })}>
                  <span className={hidden.has(d) ? "off" : ""}>{t(`bim.disc.${d}`)}</span>
                </button>
                {[...cats.entries()].map(([cat, n]) => (
                  <div className="bim-leg-r" key={cat}>
                    <i style={{ background: planHex(CATALOG[cat]?.color ?? 0x94a3b8) }} />
                    <span>{CATALOG[cat]?.label ?? cat}</span>
                    <b className="mono">{n}</b>
                  </div>
                ))}
              </div>
            ))
          )}

          <h4 style={{ marginTop: 18 }}>{t("bim.properties")}</h4>
          {!sel ? (
            <p className="csub" style={{ margin: 0 }}>{t("bim.selectPrompt")}</p>
          ) : (
            <>
              <div className="trow-lbl" style={{ borderTop: 0 }}>{t("bim.category")} <b>{CATALOG[sel.category]?.label ?? sel.category}</b></div>
              <div className="trow-lbl">{t("bim.discipline")} <b>{t(`bim.disc.${sel.discipline}`)}</b></div>
              {sel.geom.kind === "linear" && <div className="trow-lbl">{t("bim.length")} <b className="mono">{linLength(sel).toFixed(2)} m</b></div>}
              {sel.geom.width != null && <div className="trow-lbl">{t("bim.width")} <b className="mono">{sel.geom.width} m</b></div>}
              {sel.geom.height != null && <div className="trow-lbl">{t("bim.height")} <b className="mono">{sel.geom.height} m</b></div>}
              {!readOnly && (
                <button className="mini sm" style={{ marginTop: 12 }} onClick={() => { dispatch({ name: "delete", args: { id: sel.id } }); setSelected(null); }}>
                  {t("common.remove")}
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/* ── One element, drawn in plan ───────────────────────────────────────────── */

function PlanElement({ doc, e, stroke, selected, onSelect }: {
  doc: BimDocument; e: Element; stroke: number; selected: boolean; onSelect: (id: Id) => void;
}) {
  const raw = CATALOG[e.category]?.color ?? 0x94a3b8;
  const c = planHex(raw);
  const g = e.geom;
  const click = { onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); onSelect(e.id); }, style: { cursor: "pointer" } };
  const sw = selected ? stroke * 3 : stroke;

  if (g.kind === "linear" && g.start && g.end) {
    // Walls read as bands of their real thickness; services as single lines.
    const band = Math.max(g.width ?? 0.1, stroke * 2);
    return (
      <line {...click} x1={g.start.x} y1={-g.start.y} x2={g.end.x} y2={-g.end.y}
        stroke={c} strokeWidth={band} strokeLinecap="butt"
        opacity={selected ? 1 : 0.9} />
    );
  }
  if (g.kind === "area" && g.outline?.length) {
    // Slabs and rooms are the ground the plan sits on: keep the pale material
    // colour as fill so walls read on top of it, and outline in the plan ink.
    return (
      <polygon {...click} points={g.outline.map((p) => `${p.x},${-p.y}`).join(" ")}
        fill={hex(raw)} fillOpacity={0.28} stroke={c} strokeWidth={sw} strokeOpacity={0.55} />
    );
  }
  if (g.kind === "hosted") {
    const p = hostedPoint(doc, e);
    if (!p) return null;
    const w = g.width ?? 0.9;
    return (
      <g {...click} transform={`translate(${p.x},${-p.y}) rotate(${(-p.ang * 180) / Math.PI})`}>
        <rect x={-w / 2} y={-stroke * 2} width={w} height={stroke * 4} fill={c} />
        {/* A door gets its swing arc — the one symbol that makes a plan readable. */}
        {e.category === "door" && <path d={`M ${-w / 2} 0 A ${w} ${w} 0 0 1 ${-w / 2 + w} ${-w}`} fill="none" stroke={c} strokeWidth={stroke} />}
      </g>
    );
  }
  if (g.at) {
    const w = g.width ?? 0.4, d = g.depth ?? w;
    return (
      <rect {...click} x={g.at.x - w / 2} y={-g.at.y - d / 2} width={w} height={d}
        fill={c} fillOpacity={0.85} stroke={selected ? "var(--ink)" : c} strokeWidth={sw} />
    );
  }
  return null;
}

export { emptyDocument, applyCommands };
export type { BimDocument };

"use client";
// The model-space viewport — an AutoCAD-shaped canvas over the editable model.
//
// Ported from DrawLogix's CAD viewport, with one deliberate substitution: that
// one drives WebGL through three.js, this one draws on a 2D canvas. A general
// arrangement is flat linework; batching it into one path per layer draws a
// 60,000-segment sheet inside a frame, and it saves shipping a 600 KB 3D engine
// to every estimator who only wanted to add a dimension. Everything above the
// renderer — snapping, tools, previews — is the reference behaviour unchanged.
//
// Navigation follows CAD, not the web: wheel zooms about the cursor, middle and
// right drag pan in every tool, and left-drag only pans when Pan is active,
// because in every other tool the left button belongs to the tool.

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  hatchSegments, mirrorEntity, modelBounds, newId, robustBounds, rotateEntity,
  scaleEntityAbout, translateEntity, type DxfModel, type Entity,
} from "./model";
import type { CadMark } from "./agent";

export type Tool =
  | "select" | "pan" | "line" | "polyline" | "rect" | "circle" | "text"
  | "dimension" | "hatch" | "move" | "copy" | "rotate" | "scale" | "mirror";

const DRAW_TOOLS: Tool[] = ["line", "polyline", "rect", "circle", "text", "dimension", "hatch"];
const MODIFY_TOOLS: Tool[] = ["move", "copy", "rotate", "scale", "mirror"];
export const isDraw = (t: Tool) => DRAW_TOOLS.includes(t);
export const isModify = (t: Tool) => MODIFY_TOOLS.includes(t);

// Object snap (AutoCAD OSNAP). `nearest` is off by default — it wins too often
// and stops the sharper snaps from ever firing.
export type SnapMode = "end" | "mid" | "center" | "intersection" | "perp" | "nearest" | "node";
export const ALL_SNAP_MODES: SnapMode[] = ["end", "mid", "center", "intersection", "perp", "nearest", "node"];
export const DEFAULT_SNAPS: SnapMode[] = ["end", "mid", "center", "intersection", "perp", "node"];
const SNAP_PRI: Record<SnapMode, number> = { end: 1, intersection: 2, mid: 3, perp: 4, center: 5, node: 6, nearest: 7 };

export interface CadHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  clearMeasure: () => void;
  deleteSelection: () => void;
  clearSelection: () => void;
  selectAll: () => void;
  selectLayer: (name: string) => void;
  selectionCount: () => number;
}

// Bright-on-black ACI, the model-space screen colours.
const ACI_SCREEN: Record<number, string> = {
  1: "#ff5555", 2: "#ffff55", 3: "#55ff55", 4: "#55ffff", 5: "#6f8cff",
  6: "#ff77ff", 7: "#e8e8e8", 8: "#8a8a8a", 9: "#c0c0c0", 30: "#ff9f40",
};
const aciHex = (aci: number) => ACI_SCREEN[aci] ?? "#dfe4ea";
const MONO_HEX = "#dfe4ea";
const HILITE = "#38ff9c";
const BG = "#0d1017";
const GRID_MINOR = "#1b2130";
const GRID_MAJOR = "#2b3346";

const SNAP_PX = 12;
const PICK_PX = 8;
const CIRCLE_SEG = 48;
const MAX_TEXT = 2200;   // labels drawn per frame; the rest are off-screen anyway
const MIN_TEXT_PX = 5;   // below this a label is a smudge, so it is not drawn

interface Pt { x: number; y: number }
interface Cam { ox: number; oy: number; scale: number }

interface Props {
  model: DxfModel;
  mono?: boolean;
  units?: string;
  /** Multiply world coordinates by this for display. */
  unitFactor?: number;
  precision?: number;
  measuring?: boolean;
  /** Change this to refit the view — a new file, a new sheet. */
  fitOn?: string;
  tool?: Tool;
  activeLayer?: string;
  onChange?: (next: DxfModel) => void;
  /** Fired when a one-shot draw/modify completes, so the parent can go back to Select. */
  onOperationDone?: () => void;
  onSelectionChange?: (count: number) => void;
  osnap?: boolean;
  snapModes?: SnapMode[];
  ortho?: boolean;
  polar?: boolean;
  polarInc?: number;
  /** Rendered under the canvas — the status hint the editor shows. */
  onHint?: (hint: string) => void;
  /** What the assistant measured, drawn over the drawing. This is the whole
   *  point of the assistant: a figure you can see the origin of. */
  marks?: CadMark[];
}

/* ── geometry helpers ────────────────────────────────────────────────────── */

function niceStep(extent: number): number {
  const raw = Math.max(extent, 1e-6) / 20;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function entitySegments(e: Entity): number[] {
  if (e.kind === "line") return [e.x1, e.y1, e.x2, e.y2];
  if (e.kind === "poly") {
    const out: number[] = [];
    for (let i = 0; i < e.pts.length - 1; i++) out.push(e.pts[i].x, e.pts[i].y, e.pts[i + 1].x, e.pts[i + 1].y);
    if (e.closed && e.pts.length > 2) out.push(e.pts[e.pts.length - 1].x, e.pts[e.pts.length - 1].y, e.pts[0].x, e.pts[0].y);
    return out;
  }
  return [];
}
const closestOnSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): Pt => {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
};
function footOnSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): Pt | null {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (!l2) return null;
  const t = ((px - x1) * dx + (py - y1) * dy) / l2;
  return t < 0 || t > 1 ? null : { x: x1 + t * dx, y: y1 + t * dy };
}
function segInt(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): Pt | null {
  const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
  const den = r1x * r2y - r1y * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
  const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
  return t < 0 || t > 1 || u < 0 || u > 1 ? null : { x: ax + t * r1x, y: ay + t * r1y };
}
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const c = closestOnSeg(px, py, x1, y1, x2, y2);
  return Math.hypot(px - c.x, py - c.y);
}
function distToEntity(e: Entity, p: Pt): number {
  if (e.kind === "text") return Math.hypot(p.x - e.x, p.y - e.y);
  const s = entitySegments(e);
  let best = Infinity;
  for (let i = 0; i < s.length; i += 4) best = Math.min(best, distToSeg(p.x, p.y, s[i], s[i + 1], s[i + 2], s[i + 3]));
  return best;
}
function entityInRect(e: Entity, a: Pt, b: Pt): boolean {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (e.kind === "line") return inside(e.x1, e.y1) || inside(e.x2, e.y2);
  if (e.kind === "poly") return e.pts.some((p) => inside(p.x, p.y));
  return inside(e.x, e.y);
}
function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/* ── the viewport ────────────────────────────────────────────────────────── */

export const CadViewport = forwardRef<CadHandle, Props>(function CadViewport(
  {
    model, mono = false, units = "", unitFactor = 1, precision = 2, measuring = false,
    fitOn, tool = "select", activeLayer = "0", onChange, onOperationDone, onSelectionChange,
    osnap = true, snapModes = DEFAULT_SNAPS, ortho = false, polar = false, polarInc = 15, onHint, marks = [],
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState<Cam>({ ox: 0, oy: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const [cursor, setCursor] = useState<{ px: number; py: number } | null>(null);
  const [coords, setCoords] = useState<Pt | null>(null);
  const [hover, setHover] = useState<{ p: Pt; snapped: boolean; type: SnapMode | "ortho" | "polar" | null } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);       // measure chain
  const [draft, setDraft] = useState<Pt[]>([]);   // in-progress draw / modify
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selRect, setSelRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // Handlers read these, so they are mirrored into refs rather than closed over.
  const modelRef = useRef(model);
  const camRef = useRef(cam);
  const sizeRef = useRef(size);
  const toolRef = useRef(tool);
  const measuringRef = useRef(measuring);
  const ptsRef = useRef(pts);
  const draftRef = useRef(draft);
  const selRef = useRef(selection);
  const downRef = useRef<{ x: number; y: number; pan: boolean; cam: Cam } | null>(null);

  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { camRef.current = cam; }, [cam]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { measuringRef.current = measuring; }, [measuring]);
  useEffect(() => { ptsRef.current = pts; }, [pts]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { selRef.current = selection; onSelectionChange?.(selection.size); }, [selection, onSelectionChange]);
  // Switching tools abandons a half-finished operation rather than carrying its
  // points into the next one.
  useEffect(() => { toolRef.current = tool; setDraft([]); setSelRect(null); }, [tool]);

  /* ── projection ──────────────────────────────────────────────────────── */
  const sx = useCallback((x: number) => size.w / 2 + (x - cam.ox) * cam.scale, [size.w, cam]);
  const sy = useCallback((y: number) => size.h / 2 - (y - cam.oy) * cam.scale, [size.h, cam]);
  const toScreen = useCallback((p: Pt) => ({ x: sx(p.x), y: sy(p.y) }), [sx, sy]);
  const worldAt = useCallback((px: number, py: number): Pt => {
    const c = camRef.current, s = sizeRef.current;
    return { x: c.ox + (px - s.w / 2) / c.scale, y: c.oy - (py - s.h / 2) / c.scale };
  }, []);
  const worldPerPx = useCallback(() => 1 / camRef.current.scale, []);

  /* ── measured size ───────────────────────────────────────────────────── */
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 560 });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── batched geometry, rebuilt only when entities change ─────────────── */
  const batches = useMemo(() => {
    const segs = new Map<string, number[]>();
    const texts: Array<{ t: string; x: number; y: number; h: number; layer: string }> = [];
    for (const e of model.entities) {
      if (e.kind === "text") { texts.push({ t: e.text, x: e.x, y: e.y, h: e.h || 1, layer: e.layer }); continue; }
      let a = segs.get(e.layer);
      if (!a) segs.set(e.layer, (a = []));
      const s = entitySegments(e);
      for (let i = 0; i < s.length; i++) a.push(s[i]);
    }
    return {
      segs: [...segs.entries()].map(([layer, arr]) => ({ layer, arr: Float32Array.from(arr) })),
      texts,
    };
  }, [model.entities]);

  /* ── snap sources, from visible geometry only ────────────────────────── */
  const snapData = useMemo(() => {
    const hidden = new Set(model.layers.filter((l) => !l.visible).map((l) => l.name));
    const verts: number[] = [], segs: number[] = [], nodes: number[] = [], centers: number[] = [];
    for (const e of model.entities) {
      if (hidden.has(e.layer)) continue;
      if (e.kind === "line") {
        verts.push(e.x1, e.y1, e.x2, e.y2);
        segs.push(e.x1, e.y1, e.x2, e.y2);
      } else if (e.kind === "poly") {
        for (const p of e.pts) verts.push(p.x, p.y);
        for (let i = 0; i < e.pts.length - 1; i++) segs.push(e.pts[i].x, e.pts[i].y, e.pts[i + 1].x, e.pts[i + 1].y);
        if (e.closed && e.pts.length > 2) {
          segs.push(e.pts[e.pts.length - 1].x, e.pts[e.pts.length - 1].y, e.pts[0].x, e.pts[0].y);
          let cx = 0, cy = 0;
          for (const p of e.pts) { cx += p.x; cy += p.y; }
          centers.push(cx / e.pts.length, cy / e.pts.length);
        }
      } else {
        nodes.push(e.x, e.y);
        verts.push(e.x, e.y);
      }
    }
    return {
      verts: Float32Array.from(verts), segs: Float32Array.from(segs),
      nodes: Float32Array.from(nodes), centers: Float32Array.from(centers),
    };
  }, [model.entities, model.layers]);

  /* ── fit ─────────────────────────────────────────────────────────────── */
  const fitNow = useCallback(() => {
    const s = sizeRef.current;
    if (!s.w || !s.h) return;
    const b = robustBounds(modelRef.current);
    const bw = Math.max(b.maxX - b.minX, 1e-6);
    const bh = Math.max(b.maxY - b.minY, 1e-6);
    const scale = Math.min(s.w / (bw * 1.12), s.h / (bh * 1.12)) || 1;
    setCam({ ox: (b.minX + b.maxX) / 2, oy: (b.minY + b.maxY) / 2, scale });
  }, []);

  // Refit on a new drawing, and once the panel has a measured size.
  useEffect(() => {
    if (!size.w || !size.h) return;
    fitNow();
    setPts([]); setDraft([]); setSelection(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitOn, size.w, size.h]);

  /* ── draw ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(size.w * dpr) || cv.height !== Math.round(size.h * dpr)) {
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size.w, size.h);

    const X = (x: number) => size.w / 2 + (x - cam.ox) * cam.scale;
    const Y = (y: number) => size.h / 2 - (y - cam.oy) * cam.scale;
    const wx0 = cam.ox - size.w / 2 / cam.scale, wx1 = cam.ox + size.w / 2 / cam.scale;
    const wy0 = cam.oy - size.h / 2 / cam.scale, wy1 = cam.oy + size.h / 2 / cam.scale;

    // Grid — a step that stays about a screen-inch apart at any zoom.
    const step = niceStep(Math.max(wx1 - wx0, wy1 - wy0));
    if (step * cam.scale > 6) {
      const draw = (major: boolean) => {
        ctx.strokeStyle = major ? GRID_MAJOR : GRID_MINOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const isMajor = (v: number) => Math.abs(v / (step * 5) - Math.round(v / (step * 5))) < 1e-6;
        for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) {
          if (isMajor(x) !== major) continue;
          const px = Math.round(X(x)) + 0.5;
          ctx.moveTo(px, 0); ctx.lineTo(px, size.h);
        }
        for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) {
          if (isMajor(y) !== major) continue;
          const py = Math.round(Y(y)) + 0.5;
          ctx.moveTo(0, py); ctx.lineTo(size.w, py);
        }
        ctx.stroke();
      };
      draw(false);
      draw(true);
    }

    // Linework — one path per layer.
    const hidden = new Set(model.layers.filter((l) => !l.visible).map((l) => l.name));
    const aciOf = (layer: string) => model.layers.find((l) => l.name === layer)?.aci ?? 7;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (const { layer, arr } of batches.segs) {
      if (hidden.has(layer)) continue;
      ctx.strokeStyle = mono ? MONO_HEX : aciHex(aciOf(layer));
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) {
        const x1 = arr[i], y1 = arr[i + 1], x2 = arr[i + 2], y2 = arr[i + 3];
        // Cheap reject: a segment wholly off one edge is never drawn.
        if ((x1 < wx0 && x2 < wx0) || (x1 > wx1 && x2 > wx1) || (y1 < wy0 && y2 < wy0) || (y1 > wy1 && y2 > wy1)) continue;
        ctx.moveTo(X(x1), Y(y1));
        ctx.lineTo(X(x2), Y(y2));
      }
      ctx.stroke();
    }

    // Labels — skipped when they would be a smudge, capped so a text-heavy
    // schedule sheet does not cost a second per pan.
    ctx.textBaseline = "alphabetic";
    let drawn = 0;
    for (const t of batches.texts) {
      if (drawn >= MAX_TEXT) break;
      if (hidden.has(t.layer)) continue;
      const px = t.h * cam.scale;
      if (px < MIN_TEXT_PX) continue;
      if (t.x < wx0 || t.x > wx1 || t.y < wy0 || t.y > wy1) continue;
      ctx.fillStyle = mono ? MONO_HEX : aciHex(aciOf(t.layer));
      ctx.font = `${Math.min(px, 220).toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(t.t, X(t.x), Y(t.y));
      drawn++;
    }

    // Selection.
    if (selection.size) {
      ctx.strokeStyle = HILITE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const e of model.entities) {
        if (!e.id || !selection.has(e.id)) continue;
        if (e.kind === "text") {
          ctx.moveTo(X(e.x) - 4, Y(e.y) - 4); ctx.lineTo(X(e.x) + 4, Y(e.y) + 4);
          ctx.moveTo(X(e.x) - 4, Y(e.y) + 4); ctx.lineTo(X(e.x) + 4, Y(e.y) - 4);
          continue;
        }
        const s = entitySegments(e);
        for (let i = 0; i < s.length; i += 4) {
          ctx.moveTo(X(s[i]), Y(s[i + 1]));
          ctx.lineTo(X(s[i + 2]), Y(s[i + 3]));
        }
      }
      ctx.stroke();
    }
  }, [batches, model.layers, model.entities, selection, cam, size, mono]);

  /* ── mutation ────────────────────────────────────────────────────────── */
  const commit = useCallback((entities: Entity[]) => {
    onChange?.({ ...modelRef.current, entities });
  }, [onChange]);

  const NEW_LAYER_ACI: Record<string, number> = { DIMENSIONS: 4, HATCH: 8, NOTES: 2, MARKUP: 1 };
  const addEntities = useCallback((...added: Entity[]) => {
    const m = modelRef.current;
    const known = new Set(m.layers.map((l) => l.name));
    const fresh = [...new Set(added.map((e) => e.layer))].filter((n) => !known.has(n));
    const layers = fresh.length
      ? [...m.layers, ...fresh.map((name) => ({ name, aci: NEW_LAYER_ACI[name] ?? 7, visible: true }))]
      : m.layers;
    onChange?.({ ...m, layers, entities: [...m.entities, ...added.map((e) => ({ ...e, id: newId() }))] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const deleteSelection = useCallback(() => {
    const sel = selRef.current;
    if (!sel.size) return;
    commit(modelRef.current.entities.filter((e) => !e.id || !sel.has(e.id)));
    setSelection(new Set());
  }, [commit]);

  const transformSelected = useCallback((fn: (e: Entity) => Entity, keepOriginal = false) => {
    const sel = selRef.current;
    if (!sel.size) return;
    if (keepOriginal) {
      const copies = modelRef.current.entities.filter((e) => e.id && sel.has(e.id)).map((e) => ({ ...fn(e), id: newId() }));
      commit([...modelRef.current.entities, ...copies]);
    } else {
      commit(modelRef.current.entities.map((e) => (e.id && sel.has(e.id) ? fn(e) : e)));
    }
  }, [commit]);

  /**
   * A linear dimension built from plain lines and text on a DIMENSIONS layer.
   *
   * Not a DIMENSION entity: those carry a style, a scale and an associativity
   * that an R12 file cannot express, and a dimension that renders differently in
   * the recipient's CAD is worse than none. Exploded graphics measure the same
   * everywhere, and the value is baked in the display units on screen.
   */
  const buildDimension = useCallback((p1: Pt, p2: Pt, offPt: Pt): Entity[] => {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [];
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const off = (offPt.x - p1.x) * nx + (offPt.y - p1.y) * ny;
    const d1 = { x: p1.x + nx * off, y: p1.y + ny * off };
    const d2 = { x: p2.x + nx * off, y: p2.y + ny * off };
    const b = modelBounds(modelRef.current);
    const dscale = Math.max(b.maxX - b.minX, b.maxY - b.minY, len) || 1;
    const th = Math.max(dscale * 0.016, len * 0.05, 1e-6);
    const s = Math.sign(off) || 1;
    const over = th * 0.6;
    const L = "DIMENSIONS";
    const out: Entity[] = [
      { kind: "line", layer: L, x1: p1.x, y1: p1.y, x2: d1.x + nx * over * s, y2: d1.y + ny * over * s },
      { kind: "line", layer: L, x1: p2.x, y1: p2.y, x2: d2.x + nx * over * s, y2: d2.y + ny * over * s },
      { kind: "line", layer: L, x1: d1.x, y1: d1.y, x2: d2.x, y2: d2.y },
    ];
    const t = th * 0.5;
    for (const d of [d1, d2]) {
      out.push({ kind: "line", layer: L, x1: d.x - (ux + nx) * t, y1: d.y - (uy + ny) * t, x2: d.x + (ux + nx) * t, y2: d.y + (uy + ny) * t });
    }
    const label = `${(len * unitFactor).toFixed(precision)}${units ? ` ${units}` : ""}`;
    const w = label.length * th * 0.6;
    const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
    out.push({ kind: "text", layer: L, text: label, x: mid.x - w / 2 + nx * th * 0.4 * s, y: mid.y + ny * th * 0.4 * s, h: th });
    return out;
  }, [unitFactor, precision, units]);

  const hatchToEntities = useCallback((poly: Pt[]): Entity[] => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
    return hatchSegments(poly, Math.max(diag / 40, 1e-6), Math.PI / 4)
      .map(([a, b]) => ({ kind: "line" as const, layer: "HATCH", x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
  }, []);

  const finishPolyline = useCallback(() => {
    const d = draftRef.current;
    if (d.length >= 2) addEntities({ kind: "poly", layer: activeLayer, closed: false, pts: d.map((q) => ({ x: q.x, y: q.y })) });
    setDraft([]);
  }, [addEntities, activeLayer]);

  const finishHatch = useCallback(() => {
    const d = draftRef.current;
    if (d.length >= 3) addEntities(...hatchToEntities(d));
    setDraft([]);
  }, [addEntities, hatchToEntities]);

  /* ── snapping ────────────────────────────────────────────────────────── */
  const currentBase = useCallback((): Pt | null => {
    if (draftRef.current.length) return draftRef.current[draftRef.current.length - 1];
    if (measuringRef.current && ptsRef.current.length) return ptsRef.current[ptsRef.current.length - 1];
    return null;
  }, []);

  const resolveSnap = useCallback((w: Pt, base: Pt | null): { p: Pt; type: SnapMode } | null => {
    if (!osnap) return null;
    const tol = SNAP_PX * worldPerPx();
    const tol2 = tol * tol;
    const enabled = new Set(snapModes);
    let bestPri = Infinity, bestD2 = Infinity, bx = 0, by = 0;
    let bestType: SnapMode | null = null;
    const consider = (x: number, y: number, type: SnapMode) => {
      const dx = x - w.x, dy = y - w.y, d2 = dx * dx + dy * dy;
      if (d2 > tol2) return;
      const pri = SNAP_PRI[type];
      if (pri < bestPri || (pri === bestPri && d2 < bestD2)) {
        bestPri = pri; bestD2 = d2; bx = x; by = y; bestType = type;
      }
    };
    const { verts, segs, nodes, centers } = snapData;
    if (enabled.has("end")) for (let i = 0; i < verts.length; i += 2) consider(verts[i], verts[i + 1], "end");
    const near: number[] = [];
    if (enabled.has("mid") || enabled.has("nearest") || enabled.has("perp") || enabled.has("intersection")) {
      for (let i = 0; i < segs.length; i += 4) {
        const x1 = segs[i], y1 = segs[i + 1], x2 = segs[i + 2], y2 = segs[i + 3];
        if (w.x < Math.min(x1, x2) - tol || w.x > Math.max(x1, x2) + tol || w.y < Math.min(y1, y2) - tol || w.y > Math.max(y1, y2) + tol) continue;
        near.push(i);
        if (enabled.has("mid")) consider((x1 + x2) / 2, (y1 + y2) / 2, "mid");
        if (enabled.has("nearest")) { const c = closestOnSeg(w.x, w.y, x1, y1, x2, y2); consider(c.x, c.y, "nearest"); }
        if (enabled.has("perp") && base) { const f = footOnSeg(base.x, base.y, x1, y1, x2, y2); if (f) consider(f.x, f.y, "perp"); }
      }
      // Intersections are O(n²) on the segments already near the cursor, so the
      // list is capped rather than the tolerance widened.
      if (enabled.has("intersection") && near.length <= 120) {
        for (let a = 0; a < near.length; a++) {
          for (let b = a + 1; b < near.length; b++) {
            const i = near[a], j = near[b];
            const p = segInt(segs[i], segs[i + 1], segs[i + 2], segs[i + 3], segs[j], segs[j + 1], segs[j + 2], segs[j + 3]);
            if (p) consider(p.x, p.y, "intersection");
          }
        }
      }
    }
    if (enabled.has("center")) for (let i = 0; i < centers.length; i += 2) consider(centers[i], centers[i + 1], "center");
    if (enabled.has("node")) for (let i = 0; i < nodes.length; i += 2) consider(nodes[i], nodes[i + 1], "node");
    return bestType ? { p: { x: bx, y: by }, type: bestType } : null;
  }, [osnap, snapModes, snapData, worldPerPx]);

  const resolvePoint = useCallback((raw: Pt): { p: Pt; snapped: boolean; type: SnapMode | "ortho" | "polar" | null } => {
    const base = currentBase();
    const sn = resolveSnap(raw, base);
    if (sn) return { p: sn.p, snapped: true, type: sn.type };
    if (base && (ortho || polar)) {
      const dx = raw.x - base.x, dy = raw.y - base.y;
      if (Math.hypot(dx, dy) > 1e-9) {
        if (ortho) {
          const p = Math.abs(dx) >= Math.abs(dy) ? { x: raw.x, y: base.y } : { x: base.x, y: raw.y };
          return { p, snapped: false, type: "ortho" };
        }
        const inc = ((polarInc || 90) * Math.PI) / 180;
        const ang = Math.atan2(dy, dx);
        const snapAng = Math.round(ang / inc) * inc;
        let diff = Math.abs(ang - snapAng);
        diff = Math.min(diff, Math.abs(2 * Math.PI - diff));
        if (diff < (4 * Math.PI) / 180) {
          const ux = Math.cos(snapAng), uy = Math.sin(snapAng);
          const t = dx * ux + dy * uy;
          return { p: { x: base.x + ux * t, y: base.y + uy * t }, snapped: false, type: "polar" };
        }
      }
    }
    return { p: raw, snapped: false, type: null };
  }, [currentBase, resolveSnap, ortho, polar, polarInc]);

  const pickAt = useCallback((w: Pt): string | null => {
    const tol = PICK_PX * worldPerPx();
    let best = tol, id: string | null = null;
    for (const e of modelRef.current.entities) {
      if (!e.id) continue;
      const layer = modelRef.current.layers.find((l) => l.name === e.layer);
      if (layer && !layer.visible) continue;
      const d = distToEntity(e, w);
      if (d < best) { best = d; id = e.id; }
    }
    return id;
  }, [worldPerPx]);

  /* ── tools ───────────────────────────────────────────────────────────── */
  const handleToolClick = useCallback((p: Pt, shift: boolean) => {
    const t = toolRef.current;
    switch (t) {
      case "select": {
        const id = pickAt(p);
        setSelection((prev) => {
          const next = new Set(shift ? prev : []);
          if (id) { if (shift && next.has(id)) next.delete(id); else next.add(id); }
          return next;
        });
        break;
      }
      case "line": {
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          addEntities({ kind: "line", layer: activeLayer, x1: d[0].x, y1: d[0].y, x2: d[1].x, y2: d[1].y });
          setDraft([]);
        } else setDraft(d);
        break;
      }
      case "polyline":
        setDraft((prev) => [...prev, p]);
        break;
      case "rect": {
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          const [a, b] = d;
          addEntities({ kind: "poly", layer: activeLayer, closed: true, pts: [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }] });
          setDraft([]);
        } else setDraft(d);
        break;
      }
      case "circle": {
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          const c = d[0];
          const r = Math.hypot(d[1].x - c.x, d[1].y - c.y);
          const pp = Array.from({ length: CIRCLE_SEG }, (_, i) => ({
            x: c.x + r * Math.cos((i / CIRCLE_SEG) * Math.PI * 2),
            y: c.y + r * Math.sin((i / CIRCLE_SEG) * Math.PI * 2),
          }));
          addEntities({ kind: "poly", layer: activeLayer, closed: true, pts: pp });
          setDraft([]);
        } else setDraft(d);
        break;
      }
      case "dimension": {
        const d = [...draftRef.current, p];
        if (d.length === 3) { addEntities(...buildDimension(d[0], d[1], d[2])); setDraft([]); }
        else setDraft(d);
        break;
      }
      case "hatch": {
        const selPolys = modelRef.current.entities.filter(
          (e): e is Extract<Entity, { kind: "poly" }> => !!e.id && selRef.current.has(e.id) && e.kind === "poly" && e.closed
        );
        if (selPolys.length) {
          const add: Entity[] = [];
          for (const poly of selPolys) add.push(...hatchToEntities(poly.pts));
          if (add.length) addEntities(...add);
        } else setDraft((prev) => [...prev, p]);
        break;
      }
      case "text": {
        const s = window.prompt("Text:");
        if (s?.trim()) {
          const b = modelBounds(modelRef.current);
          const h = Math.max(0.25, (b.maxY - b.minY || 1) * 0.02);
          addEntities({ kind: "text", layer: activeLayer, text: s.trim(), x: p.x, y: p.y, h });
        }
        break;
      }
      case "move":
      case "copy": {
        if (!selRef.current.size) return;
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          const dx = d[1].x - d[0].x, dy = d[1].y - d[0].y;
          transformSelected((en) => translateEntity(en, dx, dy), t === "copy");
          setDraft([]);
          onOperationDone?.();
        } else setDraft(d);
        break;
      }
      case "rotate": {
        if (!selRef.current.size) return;
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          const ang = Math.atan2(d[1].y - d[0].y, d[1].x - d[0].x);
          transformSelected((en) => rotateEntity(en, d[0].x, d[0].y, ang));
          setDraft([]);
          onOperationDone?.();
        } else setDraft(d);
        break;
      }
      case "mirror": {
        if (!selRef.current.size) return;
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          transformSelected((en) => mirrorEntity(en, d[0].x, d[0].y, d[1].x, d[1].y));
          setDraft([]);
          onOperationDone?.();
        } else setDraft(d);
        break;
      }
      case "scale": {
        if (!selRef.current.size) return;
        const raw = window.prompt("Scale factor:", "1");
        const fct = Number(raw);
        if (Number.isFinite(fct) && fct > 0) {
          transformSelected((en) => scaleEntityAbout(en, p.x, p.y, fct));
          onOperationDone?.();
        }
        break;
      }
    }
  }, [pickAt, addEntities, activeLayer, buildDimension, hatchToEntities, transformSelected, onOperationDone]);

  /* ── pointer ─────────────────────────────────────────────────────────── */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    // Middle and right always pan, so the sheet stays navigable in every tool.
    const pan = e.button === 1 || e.button === 2 || (e.button === 0 && tool === "pan");
    if (e.button !== 0 && !pan) return;
    downRef.current = { x: px, y: py, pan, cam: camRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    setCursor({ px, py });

    const d = downRef.current;
    if (d?.pan) {
      setCam({ ox: d.cam.ox - (px - d.x) / d.cam.scale, oy: d.cam.oy + (py - d.y) / d.cam.scale, scale: d.cam.scale });
      return;
    }

    const raw = worldAt(px, py);
    if (measuring || isDraw(tool) || isModify(tool)) {
      const sn = resolvePoint(raw);
      setHover(sn);
      setCoords(sn.p);
    } else {
      setCoords(raw);
      if (hover) setHover(null);
    }
    if (d && tool === "select" && !measuring) {
      if (Math.hypot(px - d.x, py - d.y) > 4) setSelRect({ x1: d.x, y1: d.y, x2: px, y2: py });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = downRef.current;
    downRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    if (!d || d.pan) { setSelRect(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const moved = Math.hypot(px - d.x, py - d.y);

    if (tool === "select" && !measuring && moved > 5) {
      const a = worldAt(d.x, d.y), b = worldAt(px, py);
      const hits = modelRef.current.entities.filter((en) => en.id && entityInRect(en, a, b)).map((en) => en.id as string);
      setSelection(new Set(e.shiftKey ? [...selRef.current, ...hits] : hits));
      setSelRect(null);
      return;
    }
    setSelRect(null);
    if (moved > 5) return; // a drag that was not a window-select places no point

    const p = resolvePoint(worldAt(px, py)).p;
    if (measuring) { setPts((prev) => [...prev, p]); return; }
    handleToolClick(p, e.shiftKey);
  };

  // Wheel zoom about the cursor. Non-passive, or the page scrolls out from under
  // the drawing while you are trying to zoom into it.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const before = worldAt(px, py);
      const c = camRef.current, s = sizeRef.current;
      const scale = Math.max(1e-6, Math.min(1e9, c.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setCam({ scale, ox: before.x - (px - s.w / 2) / scale, oy: before.y + (py - s.h / 2) / scale });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [worldAt]);

  // Esc abandons, Enter closes a polyline or fills a hatch, Delete erases.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (e.key === "Escape") { setPts([]); setDraft([]); setSelRect(null); setSelection(new Set()); }
      else if (e.key === "Enter" && toolRef.current === "polyline") finishPolyline();
      else if (e.key === "Enter" && toolRef.current === "hatch") finishHatch();
      else if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.size) { e.preventDefault(); deleteSelection(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishPolyline, finishHatch, deleteSelection]);

  useImperativeHandle(ref, () => ({
    fit: fitNow,
    zoom: (factor: number) => setCam((c) => ({ ...c, scale: Math.max(1e-6, Math.min(1e9, c.scale * factor)) })),
    clearMeasure: () => setPts([]),
    deleteSelection,
    clearSelection: () => setSelection(new Set()),
    selectAll: () => setSelection(new Set(model.entities.map((e) => e.id).filter(Boolean) as string[])),
    selectLayer: (name: string) => setSelection(new Set(model.entities.filter((e) => e.id && e.layer === name).map((e) => e.id as string))),
    selectionCount: () => selRef.current.size,
  }), [fitNow, deleteSelection, model.entities]);

  /* ── overlay geometry ────────────────────────────────────────────────── */
  const fmt = (v: number) => (v * unitFactor).toFixed(precision);

  const mChain = measuring && hover ? [...pts, hover.p] : pts;
  const mScreen = mChain.map(toScreen);
  let mTotal = 0;
  const mSeg: Array<{ x: number; y: number; d: number }> = [];
  for (let i = 1; i < mChain.length; i++) {
    const d = Math.hypot(mChain[i].x - mChain[i - 1].x, mChain[i].y - mChain[i - 1].y);
    mTotal += d;
    mSeg.push({ x: (mScreen[i].x + mScreen[i - 1].x) / 2, y: (mScreen[i].y + mScreen[i - 1].y) / 2, d });
  }
  const mArea = pts.length >= 3 ? polygonArea(pts) : 0;

  const hp = hover?.p ?? null;
  const previewSegs: Array<[Pt, Pt]> = [];
  let ghost: Entity[] = [];
  if (hp && draft.length) {
    if (tool === "line" || tool === "polyline") {
      for (let i = 1; i < draft.length; i++) previewSegs.push([draft[i - 1], draft[i]]);
      previewSegs.push([draft[draft.length - 1], hp]);
    } else if (tool === "rect") {
      const a = draft[0];
      previewSegs.push([a, { x: hp.x, y: a.y }], [{ x: hp.x, y: a.y }, hp], [hp, { x: a.x, y: hp.y }], [{ x: a.x, y: hp.y }, a]);
    } else if (tool === "circle") {
      const c = draft[0];
      const r = Math.hypot(hp.x - c.x, hp.y - c.y);
      let prev = { x: c.x + r, y: c.y };
      for (let i = 1; i <= CIRCLE_SEG; i++) {
        const q = { x: c.x + r * Math.cos((i / CIRCLE_SEG) * Math.PI * 2), y: c.y + r * Math.sin((i / CIRCLE_SEG) * Math.PI * 2) };
        previewSegs.push([prev, q]);
        prev = q;
      }
    } else if (tool === "dimension") {
      if (draft.length === 1) previewSegs.push([draft[0], hp]);
      else for (const e of buildDimension(draft[0], draft[1], hp)) if (e.kind === "line") previewSegs.push([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
    } else if (tool === "hatch") {
      for (let i = 1; i < draft.length; i++) previewSegs.push([draft[i - 1], draft[i]]);
      previewSegs.push([draft[draft.length - 1], hp]);
      if (draft.length >= 2) previewSegs.push([hp, draft[0]]);
    } else if (isModify(tool)) {
      const sel = model.entities.filter((e) => e.id && selection.has(e.id));
      if (tool === "move" || tool === "copy") {
        const dx = hp.x - draft[0].x, dy = hp.y - draft[0].y;
        ghost = sel.map((e) => translateEntity(e, dx, dy));
      } else if (tool === "rotate") {
        const ang = Math.atan2(hp.y - draft[0].y, hp.x - draft[0].x);
        ghost = sel.map((e) => rotateEntity(e, draft[0].x, draft[0].y, ang));
      } else if (tool === "mirror") {
        previewSegs.push([draft[0], hp]);
        ghost = sel.map((e) => mirrorEntity(e, draft[0].x, draft[0].y, hp.x, hp.y));
      }
    }
  }
  const ghostSegs: Array<[Pt, Pt]> = [];
  for (const e of ghost) {
    const s = entitySegments(e);
    for (let i = 0; i < s.length && ghostSegs.length < 4000; i += 4) {
      ghostSegs.push([{ x: s[i], y: s[i + 1] }, { x: s[i + 2], y: s[i + 3] }]);
    }
  }
  const previewScreen = previewSegs.map(([a, b]) => [toScreen(a), toScreen(b)] as const);
  const ghostScreen = ghostSegs.map(([a, b]) => [toScreen(a), toScreen(b)] as const);

  const hoverScreen = hover && (hover.snapped || hover.type === "ortho" || hover.type === "polar") ? toScreen(hover.p) : null;
  const trackBase = draft.length ? draft[draft.length - 1] : measuring && pts.length ? pts[pts.length - 1] : null;
  const trackScreen = trackBase && (hover?.type === "ortho" || hover?.type === "polar") ? toScreen(trackBase) : null;

  const hint = (() => {
    if (measuring) {
      return pts.length
        ? `Total ${fmt(mTotal)} ${units}${pts.length >= 3 ? ` · Area ${(mArea * unitFactor * unitFactor).toFixed(precision)} ${units}²` : ""}`
        : "Click points to measure · Esc clears";
    }
    if (tool === "select") return selection.size ? `${selection.size} selected · Del erases · Esc clears` : "Click to select · drag a window · Shift adds";
    if (tool === "polyline") return `Click points · Enter finishes${draft.length ? ` · ${draft.length} pts` : ""}`;
    if (tool === "dimension") return draft.length < 2 ? "Click the two points to dimension" : "Click to place the dimension line";
    if (tool === "hatch") return selection.size ? "Click to hatch the selected closed shape" : draft.length ? `Trace a boundary · Enter fills · ${draft.length} pts` : "Trace a boundary · Enter fills · or select a shape first";
    if (isDraw(tool)) return `Draw ${tool} · Esc cancels`;
    if (isModify(tool)) return selection.size ? (draft.length ? "Click destination" : "Click base point") : "Select something first";
    if (tool === "pan") return "Drag to pan · wheel zooms";
    return "";
  })();
  useEffect(() => { onHint?.(hint); }, [hint, onHint]);

  return (
    <div
      ref={hostRef}
      className="cadvp"
      style={{ cursor: tool === "pan" ? "grab" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { setCursor(null); if (!measuring) setCoords(null); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {cursor && tool !== "pan" && (
        <>
          <div className="cadvp-x" style={{ left: cursor.px }} />
          <div className="cadvp-y" style={{ top: cursor.py }} />
        </>
      )}

      <svg className="cadvp-ov" aria-hidden>
        {mChain.length > 0 && (
          <>
            <polyline points={mScreen.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="5 3" />
            {mScreen.map((p, i) => (
              <rect key={`v${i}`} x={p.x - 3} y={p.y - 3} width={6} height={6} fill={BG} stroke="#fbbf24" strokeWidth={1.5} />
            ))}
            {mSeg.map((s, i) => (
              <text key={`s${i}`} x={s.x} y={s.y - 5} fill="#fde68a" fontSize={11} fontFamily="monospace" textAnchor="middle" stroke={BG} strokeWidth={3} paintOrder="stroke">
                {fmt(s.d)} {units}
              </text>
            ))}
          </>
        )}
        {ghostScreen.map(([a, b], i) => (
          <line key={`g${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={HILITE} strokeOpacity={0.6} strokeWidth={1} />
        ))}
        {previewScreen.map(([a, b], i) => (
          <line key={`p${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6f8cff" strokeWidth={1.4} strokeDasharray="6 3" />
        ))}
        {/* The assistant's working. Amber so it cannot be mistaken for the
            drawing, and labelled with a halo so a figure stays readable over
            dense linework. */}
        {marks.map((m, i) => {
          if (m.kind === "dot") {
            const p = toScreen(m);
            return (
              <g key={`m${i}`}>
                <circle cx={p.x} cy={p.y} r={6} fill="#f59e0b" fillOpacity={0.9} stroke={BG} strokeWidth={1.5} />
                {m.label && (
                  <text x={p.x + 10} y={p.y + 4} fill="#fbbf24" fontSize={12} fontFamily="monospace"
                        stroke={BG} strokeWidth={3} paintOrder="stroke">{m.label}</text>
                )}
              </g>
            );
          }
          if (m.kind === "edge") {
            const a = toScreen({ x: m.x1, y: m.y1 });
            const b = toScreen({ x: m.x2, y: m.y2 });
            return (
              <g key={`m${i}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f59e0b" strokeWidth={3} strokeOpacity={0.85} />
                <circle cx={a.x} cy={a.y} r={4} fill="#f59e0b" />
                <circle cx={b.x} cy={b.y} r={4} fill="#f59e0b" />
                {m.label && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} fill="#fbbf24" fontSize={12}
                        fontFamily="monospace" textAnchor="middle" stroke={BG} strokeWidth={3} paintOrder="stroke">
                    {m.label}
                  </text>
                )}
              </g>
            );
          }
          const pts = m.pts.map(toScreen);
          const cx = pts.reduce((s2, p) => s2 + p.x, 0) / (pts.length || 1);
          const cy = pts.reduce((s2, p) => s2 + p.y, 0) / (pts.length || 1);
          return (
            <g key={`m${i}`}>
              <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                       fill="#f59e0b" fillOpacity={0.14} stroke="#f59e0b" strokeWidth={2} />
              {m.label && (
                <text x={cx} y={cy} fill="#fde68a" fontSize={13} fontFamily="monospace" textAnchor="middle"
                      stroke={BG} strokeWidth={4} paintOrder="stroke">{m.label}</text>
              )}
            </g>
          );
        })}

        {trackScreen && hoverScreen && (
          <line x1={trackScreen.x} y1={trackScreen.y} x2={hoverScreen.x} y2={hoverScreen.y} stroke="#a3e635" strokeWidth={1} strokeDasharray="4 4" />
        )}
        {hoverScreen && hover && <SnapGlyph type={hover.type} x={hoverScreen.x} y={hoverScreen.y} />}
      </svg>

      {selRect && (
        <div
          className="cadvp-sel"
          style={{
            left: Math.min(selRect.x1, selRect.x2), top: Math.min(selRect.y1, selRect.y2),
            width: Math.abs(selRect.x2 - selRect.x1), height: Math.abs(selRect.y2 - selRect.y1),
          }}
        />
      )}

      <div className="cadvp-read">
        <span className="xy">{coords ? `X ${fmt(coords.x)}  Y ${fmt(coords.y)}${units ? ` ${units}` : ""}` : "X —  Y —"}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
    </div>
  );
});

/** The AutoCAD snap markers — a distinct glyph per snap type, so the point you
 *  are about to place is identifiable without reading the tooltip. */
function SnapGlyph({ type, x, y }: { type: SnapMode | "ortho" | "polar" | null; x: number; y: number }) {
  const c = "#a3e635";
  const r = 6;
  const common = { fill: "none", stroke: c, strokeWidth: 1.6 };
  switch (type) {
    case "end": return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
    case "mid": return <polygon points={`${x},${y - r} ${x + r},${y + r} ${x - r},${y + r}`} {...common} />;
    case "center": return <circle cx={x} cy={y} r={r} {...common} />;
    case "intersection": return (
      <>
        <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} stroke={c} strokeWidth={1.6} />
        <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} stroke={c} strokeWidth={1.6} />
      </>
    );
    case "perp": return <path d={`M ${x - r} ${y - r} L ${x - r} ${y + r} L ${x + r} ${y + r}`} {...common} />;
    case "node": return (
      <>
        <circle cx={x} cy={y} r={r} {...common} />
        <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} stroke={c} strokeWidth={1.2} />
        <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} stroke={c} strokeWidth={1.2} />
      </>
    );
    case "nearest": return <polygon points={`${x - r},${y - r} ${x + r},${y - r} ${x - r},${y + r} ${x + r},${y + r}`} {...common} />;
    default: return <polygon points={`${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`} fill={c} />;
  }
}

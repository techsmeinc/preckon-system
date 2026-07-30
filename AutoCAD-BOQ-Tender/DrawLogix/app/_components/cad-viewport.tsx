"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type DxfModel, type Entity, hatchSegments, mirrorEntity, modelBounds, newId, rotateEntity, scaleEntityAbout, translateEntity } from "@/domain/dxf-model";

/**
 * AutoCAD-style model-space viewport. Renders the in-memory DxfModel on a dark
 * canvas (WebGL, bright-on-black ACI colours, adaptive grid) and hosts the full
 * interactive toolset: pan/zoom, measure, endpoint snap, selection (pick + window),
 * drawing (line/polyline/rect/circle/text) and modify (move/copy/rotate/scale/
 * mirror/delete). Geometry mutations are handed back to the parent via onChange.
 */

export type Tool = "select" | "pan" | "line" | "polyline" | "rect" | "circle" | "text" | "dimension" | "hatch" | "move" | "copy" | "rotate" | "scale" | "mirror";
const DRAW_TOOLS: Tool[] = ["line", "polyline", "rect", "circle", "text", "dimension", "hatch"];
const MODIFY_TOOLS: Tool[] = ["move", "copy", "rotate", "scale", "mirror"];
const isDraw = (t: Tool) => DRAW_TOOLS.includes(t);
const isModify = (t: Tool) => MODIFY_TOOLS.includes(t);

// Object-snap modes (AutoCAD OSNAP). `nearest` is off by default (it over-snaps).
export type SnapMode = "end" | "mid" | "center" | "intersection" | "perp" | "nearest" | "node";
export const ALL_SNAP_MODES: SnapMode[] = ["end", "mid", "center", "intersection", "perp", "nearest", "node"];
export const SNAP_LABEL: Record<SnapMode, string> = { end: "Endpoint", mid: "Midpoint", center: "Center", intersection: "Intersection", perp: "Perpendicular", nearest: "Nearest", node: "Node" };
export const DEFAULT_SNAPS: SnapMode[] = ["end", "mid", "center", "intersection", "perp", "node"];
// Lower priority number wins when several snaps are in range.
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

// Bright-on-black AutoCAD colour indices (model-space screen colours).
const ACI_SCREEN: Record<number, number> = { 1: 0xff5555, 2: 0xffff55, 3: 0x55ff55, 4: 0x55ffff, 5: 0x6f8cff, 6: 0xff77ff, 7: 0xe8e8e8, 8: 0x8a8a8a, 9: 0xc0c0c0, 30: 0xff9f40 };
const screenAci = (aci: number) => ACI_SCREEN[aci] ?? 0xdfe4ea;
const MONO = 0xdfe4ea;
const HILITE = 0x38ff9c; // selection highlight (green)
const MAX_TEXT_SPRITES = 1500;
const SNAP_PX = 12; // endpoint-snap tolerance in screen pixels
const PICK_PX = 8; // pick tolerance in screen pixels
const CIRCLE_SEG = 48;

interface Pt {
  x: number;
  y: number;
}

interface ThreeState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  content: THREE.Group;
  grid: THREE.Group;
  highlight: THREE.Group;
  groups: Map<string, THREE.Group>;
  frustumH: number;
  center: Pt;
  // Snap sources (visible geometry only), all flat arrays:
  snap: Float32Array; // vertices/endpoints [x,y,...]
  segsFlat: Float32Array; // segments [x1,y1,x2,y2,...] (mid/near/perp/intersection)
  nodes: Float32Array; // text insertion points [x,y,...]
  centers: Float32Array; // closed-polygon centroids [x,y,...]
}

// Rebuild all snap sources from the currently-visible geometry.
function buildSnapData(st: ThreeState, model: DxfModel) {
  const hidden = new Set(model.layers.filter((l) => !l.visible).map((l) => l.name));
  const verts: number[] = [];
  const segs: number[] = [];
  const nodes: number[] = [];
  const centers: number[] = [];
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
        let cx = 0;
        let cy = 0;
        for (const p of e.pts) {
          cx += p.x;
          cy += p.y;
        }
        centers.push(cx / e.pts.length, cy / e.pts.length);
      }
    } else {
      nodes.push(e.x, e.y);
      verts.push(e.x, e.y);
    }
  }
  st.snap = new Float32Array(verts);
  st.segsFlat = new Float32Array(segs);
  st.nodes = new Float32Array(nodes);
  st.centers = new Float32Array(centers);
}

interface Props {
  model: DxfModel;
  mono: boolean;
  units?: string;
  /** Multiply world coordinates by this to get display units (native→display). */
  unitFactor?: number;
  precision?: number;
  measuring?: boolean;
  fitOn?: string;
  tool?: Tool;
  activeLayer?: string;
  onChange?: (next: DxfModel) => void;
  /** Fired after a one-shot draw/modify completes so the parent can revert to Select. */
  onOperationDone?: () => void;
  onSelectionChange?: (count: number) => void;
  osnap?: boolean;
  snapModes?: SnapMode[];
  ortho?: boolean;
  polar?: boolean;
  polarInc?: number; // polar tracking increment, degrees
}

function niceStep(extent: number): number {
  const raw = Math.max(extent, 1e-6) / 20;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return m * p;
}

function robustBounds(m: DxfModel): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of m.entities) {
    if (e.kind === "line") {
      xs.push(e.x1, e.x2);
      ys.push(e.y1, e.y2);
    } else if (e.kind === "poly") {
      for (const p of e.pts) {
        xs.push(p.x);
        ys.push(p.y);
      }
    } else {
      xs.push(e.x);
      ys.push(e.y);
    }
  }
  if (!xs.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
  return { minX: q(xs, 0.02), maxX: q(xs, 0.98), minY: q(ys, 0.02), maxY: q(ys, 0.98) };
}

// ── entity geometry helpers (world space) ─────────────────────────────────────
function entitySegments(e: Entity): number[] {
  // flat [x1,y1,x2,y2,...] segments approximating the entity (empty for text)
  if (e.kind === "line") return [e.x1, e.y1, e.x2, e.y2];
  if (e.kind === "poly") {
    const out: number[] = [];
    for (let i = 0; i < e.pts.length - 1; i++) out.push(e.pts[i].x, e.pts[i].y, e.pts[i + 1].x, e.pts[i + 1].y);
    if (e.closed && e.pts.length > 2) out.push(e.pts[e.pts.length - 1].x, e.pts[e.pts.length - 1].y, e.pts[0].x, e.pts[0].y);
    return out;
  }
  return [];
}
function closestOnSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}
// Foot of perpendicular from (px,py) onto the segment — null if it falls outside.
function footOnSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (!l2) return null;
  const t = ((px - x1) * dx + (py - y1) * dy) / l2;
  if (t < 0 || t > 1) return null;
  return { x: x1 + t * dx, y: y1 + t * dy };
}
// Proper intersection of two segments, or null.
function segInt(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): { x: number; y: number } | null {
  const r1x = bx - ax;
  const r1y = by - ay;
  const r2x = dx - cx;
  const r2y = dy - cy;
  const den = r1x * r2y - r1y * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
  const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + t * r1x, y: ay + t * r1y };
}
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function distToEntity(e: Entity, p: Pt): number {
  if (e.kind === "text") return Math.hypot(p.x - e.x, p.y - e.y);
  const s = entitySegments(e);
  let best = Infinity;
  for (let i = 0; i < s.length; i += 4) best = Math.min(best, distToSeg(p.x, p.y, s[i], s[i + 1], s[i + 2], s[i + 3]));
  return best;
}
function entityInRect(e: Entity, a: Pt, b: Pt): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (e.kind === "line") return inside(e.x1, e.y1) || inside(e.x2, e.y2);
  if (e.kind === "poly") return e.pts.some((p) => inside(p.x, p.y));
  return inside(e.x, e.y);
}

export const CadViewport = forwardRef<CadHandle, Props>(function CadViewport(
  { model, mono, units = "", unitFactor = 1, precision = 2, measuring = false, fitOn, tool = "select", activeLayer = "0", onChange, onOperationDone, onSelectionChange, osnap = true, snapModes = DEFAULT_SNAPS, ortho = false, polar = false, polarInc = 15 },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const three = useRef<ThreeState | null>(null);
  const measuringRef = useRef(measuring);
  const toolRef = useRef<Tool>(tool);
  const ptsRef = useRef<Pt[]>([]); // measure points
  const draftRef = useRef<Pt[]>([]); // in-progress draw/modify points
  const selRef = useRef<Set<string>>(new Set());
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const modelRef = useRef(model);
  const [cursor, setCursor] = useState<{ px: number; py: number } | null>(null);
  const [coords, setCoords] = useState<Pt | null>(null);
  const [hover, setHover] = useState<{ p: Pt; snapped: boolean; type: SnapMode | "ortho" | "polar" | null } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]); // measure
  const [draft, setDraft] = useState<Pt[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selRect, setSelRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [, setViewVersion] = useState(0);

  useEffect(() => {
    measuringRef.current = measuring;
  }, [measuring]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    ptsRef.current = pts;
  }, [pts]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    selRef.current = selection;
    onSelectionChange?.(selection.size);
  }, [selection, onSelectionChange]);
  // Switching tools abandons any half-finished operation.
  useEffect(() => {
    toolRef.current = tool;
    setDraft([]);
    setSelRect(null);
  }, [tool]);

  // ---- Mount ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth || 800;
    const H = mount.clientHeight || 560;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1017);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e4, 1e4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    const content = new THREE.Group();
    const grid = new THREE.Group();
    const highlight = new THREE.Group();
    scene.add(grid, content, highlight);

    const st: ThreeState = { renderer, scene, camera, controls, content, grid, highlight, groups: new Map(), frustumH: 10, center: { x: 0, y: 0 }, snap: new Float32Array(0), segsFlat: new Float32Array(0), nodes: new Float32Array(0), centers: new Float32Array(0) };
    three.current = st;

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    // Reproject transient overlays (measure / draft previews) while the camera moves.
    let pending = false;
    const onChangeCam = () => {
      if (pending || !(measuringRef.current || ptsRef.current.length || draftRef.current.length)) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        setViewVersion((v) => v + 1);
      });
    };
    controls.addEventListener("change", onChangeCam);

    const applyFrustum = () => {
      const w = mount.clientWidth || W;
      const h = mount.clientHeight || H;
      const aspect = w / h;
      camera.left = (-st.frustumH * aspect) / 2;
      camera.right = (st.frustumH * aspect) / 2;
      camera.top = st.frustumH / 2;
      camera.bottom = -st.frustumH / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      setViewVersion((v) => v + 1);
    };
    const ro = new ResizeObserver(applyFrustum);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener("change", onChangeCam);
      disposeChildren(content);
      disposeChildren(grid);
      disposeChildren(highlight);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only the Pan tool uses left-drag panning; every other tool handles left-click
  // itself. Middle and right mouse always pan, so the canvas is navigable in any tool.
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    st.controls.mouseButtons = { LEFT: tool === "pan" ? THREE.MOUSE.PAN : (null as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  }, [tool]);

  // ---- Rebuild geometry when entities or mono change ----
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild keyed on entities identity + mono
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    disposeChildren(st.content);
    disposeChildren(st.grid);
    st.groups.clear();

    const layerGroup = (layer: string): THREE.Group => {
      let g = st.groups.get(layer);
      if (!g) {
        g = new THREE.Group();
        st.groups.set(layer, g);
        st.content.add(g);
      }
      return g;
    };
    const aciOf = (layer: string) => model.layers.find((l) => l.name === layer)?.aci ?? 7;

    const segs = new Map<string, number[]>();
    const texts: { t: string; x: number; y: number; h: number; layer: string }[] = [];
    const pushSeg = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
      let a = segs.get(layer);
      if (!a) segs.set(layer, (a = []));
      a.push(x1, y1, 0, x2, y2, 0);
    };
    for (const e of model.entities) {
      if (e.kind === "line") {
        pushSeg(e.layer, e.x1, e.y1, e.x2, e.y2);
      } else if (e.kind === "poly") {
        for (let i = 0; i < e.pts.length - 1; i++) pushSeg(e.layer, e.pts[i].x, e.pts[i].y, e.pts[i + 1].x, e.pts[i + 1].y);
        if (e.closed && e.pts.length > 2) pushSeg(e.layer, e.pts[e.pts.length - 1].x, e.pts[e.pts.length - 1].y, e.pts[0].x, e.pts[0].y);
      } else {
        texts.push({ t: e.text, x: e.x, y: e.y, h: e.h || 1, layer: e.layer });
      }
    }
    buildSnapData(st, model);

    for (const [layer, flat] of segs) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
      layerGroup(layer).add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: mono ? MONO : screenAci(aciOf(layer)) })));
    }
    for (const tx of texts.slice(0, MAX_TEXT_SPRITES)) {
      const sprite = makeTextSprite(tx.t, mono ? MONO : screenAci(aciOf(tx.layer)), tx.h, tx.x, tx.y);
      if (sprite) layerGroup(tx.layer).add(sprite);
    }

    const b = modelBounds(model);
    const bw = Math.max(b.maxX - b.minX, 1);
    const bh = Math.max(b.maxY - b.minY, 1);
    const step = niceStep(Math.max(bw, bh));
    const pad = step * 2;
    const gx0 = Math.floor((b.minX - pad) / step) * step;
    const gx1 = Math.ceil((b.maxX + pad) / step) * step;
    const gy0 = Math.floor((b.minY - pad) / step) * step;
    const gy1 = Math.ceil((b.maxY + pad) / step) * step;
    const minor: number[] = [];
    const major: number[] = [];
    const isMajor = (v: number) => Math.abs(v / (step * 5) - Math.round(v / (step * 5))) < 1e-6;
    for (let x = gx0; x <= gx1 + step / 2; x += step) (isMajor(x) ? major : minor).push(x, gy0, -1, x, gy1, -1);
    for (let y = gy0; y <= gy1 + step / 2; y += step) (isMajor(y) ? major : minor).push(gx0, y, -1, gx1, y, -1);
    st.grid.add(gridLines(minor, 0x1b2130), gridLines(major, 0x2b3346));

    st.center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    syncVisibility(st, model);
  }, [model.entities, mono]);

  useEffect(() => {
    const st = three.current;
    if (st) {
      syncVisibility(st, model);
      buildSnapData(st, model); // hidden layers must drop out of snapping too
    }
  }, [model.layers]);

  // ---- Selection highlight (its own group, transform-correct) ----
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on selection + entities
  useEffect(() => {
    const st = three.current;
    if (!st) return;
    disposeChildren(st.highlight);
    if (!selection.size) return;
    const flat: number[] = [];
    const dots: number[] = [];
    for (const e of model.entities) {
      if (!e.id || !selection.has(e.id)) continue;
      if (e.kind === "text") {
        dots.push(e.x, e.y, 0);
        continue;
      }
      const s = entitySegments(e);
      for (let i = 0; i < s.length; i += 4) flat.push(s[i], s[i + 1], 1, s[i + 2], s[i + 3], 1);
    }
    if (flat.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
      st.highlight.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: HILITE })));
    }
    if (dots.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3));
      st.highlight.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: HILITE, size: 8, sizeAttenuation: false })));
    }
  }, [selection, model.entities]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only on new-file signal
  useEffect(() => {
    fitNow();
    setPts([]);
    setDraft([]);
    setSelection(new Set());
  }, [fitOn]);

  // Keyboard: Esc cancels the current op / clears; Enter finishes a polyline; Delete erases selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPts([]);
        setDraft([]);
        setSelRect(null);
        setSelection(new Set());
      } else if (e.key === "Enter" && toolRef.current === "polyline") {
        finishPolyline();
      } else if (e.key === "Enter" && toolRef.current === "hatch") {
        finishHatch();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.size) {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fitNow() {
    const st = three.current;
    const mount = mountRef.current;
    if (!st || !mount) return;
    const rb = robustBounds(model);
    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 560;
    const aspect = w / h;
    const bw = Math.max(rb.maxX - rb.minX, 1);
    const bh = Math.max(rb.maxY - rb.minY, 1);
    st.frustumH = Math.max(bh, bw / aspect) * 1.12;
    st.center = { x: (rb.minX + rb.maxX) / 2, y: (rb.minY + rb.maxY) / 2 };
    st.camera.zoom = 1;
    st.camera.position.set(st.center.x, st.center.y, 10);
    st.controls.target.set(st.center.x, st.center.y, 0);
    st.camera.left = (-st.frustumH * aspect) / 2;
    st.camera.right = (st.frustumH * aspect) / 2;
    st.camera.top = st.frustumH / 2;
    st.camera.bottom = -st.frustumH / 2;
    st.camera.updateProjectionMatrix();
    setViewVersion((v) => v + 1);
  }

  // ---- Mutation helpers (hand new models back to the parent) ----
  function commit(entities: Entity[]) {
    onChange?.({ ...modelRef.current, entities });
  }
  const NEW_LAYER_ACI: Record<string, number> = { DIMENSIONS: 4, HATCH: 8, NOTES: 2 };
  function addEntities(...added: Entity[]) {
    const m = modelRef.current;
    const known = new Set(m.layers.map((l) => l.name));
    const fresh = [...new Set(added.map((e) => e.layer))].filter((n) => !known.has(n));
    const layers = fresh.length ? [...m.layers, ...fresh.map((name) => ({ name, aci: NEW_LAYER_ACI[name] ?? 7, visible: true }))] : m.layers;
    onChange?.({ ...m, layers, entities: [...m.entities, ...added] });
  }

  // Build an aligned linear dimension (extension lines + dim line + arch ticks + text)
  // as plain LINE/TEXT entities on a DIMENSIONS layer. Value is baked in display units.
  function buildDimension(p1: Pt, p2: Pt, offPt: Pt): Entity[] {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [];
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy; // unit perpendicular
    const ny = ux;
    const off = (offPt.x - p1.x) * nx + (offPt.y - p1.y) * ny; // signed offset to the dim line
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
      // 45° architectural tick
      out.push({ kind: "line", layer: L, x1: d.x - (ux + nx) * t, y1: d.y - (uy + ny) * t, x2: d.x + (ux + nx) * t, y2: d.y + (uy + ny) * t });
    }
    const label = `${(len * unitFactor).toFixed(precision)}${units ? ` ${units}` : ""}`;
    const w = label.length * th * 0.6;
    const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
    out.push({ kind: "text", layer: L, text: label, x: mid.x - w / 2 + nx * th * 0.4 * s, y: mid.y + ny * th * 0.4 * s, h: th });
    return out;
  }

  // Fill a closed boundary polygon with a 45° line hatch on a HATCH layer.
  function hatchToEntities(pts: { x: number; y: number }[]): Entity[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
    const segs = hatchSegments(pts, Math.max(diag / 40, 1e-6), Math.PI / 4);
    return segs.map(([a, b]) => ({ kind: "line" as const, layer: "HATCH", x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
  }
  function finishHatch() {
    const d = draftRef.current;
    if (d.length >= 3) addEntities(...hatchToEntities(d));
    setDraft([]);
  }
  function deleteSelection() {
    const sel = selRef.current;
    if (!sel.size) return;
    commit(modelRef.current.entities.filter((e) => !e.id || !sel.has(e.id)));
    setSelection(new Set());
  }
  function transformSelected(fn: (e: Entity) => Entity, keepOriginal = false) {
    const sel = selRef.current;
    if (!sel.size) return;
    if (keepOriginal) {
      const copies = modelRef.current.entities.filter((e) => e.id && sel.has(e.id)).map((e) => ({ ...fn(e), id: newId() }));
      commit([...modelRef.current.entities, ...copies]);
    } else {
      commit(modelRef.current.entities.map((e) => (e.id && sel.has(e.id) ? fn(e) : e)));
    }
  }

  useImperativeHandle(ref, () => ({
    fit: fitNow,
    zoom: (factor: number) => {
      const st = three.current;
      if (!st) return;
      st.camera.zoom *= factor;
      st.camera.updateProjectionMatrix();
      setViewVersion((v) => v + 1);
    },
    clearMeasure: () => setPts([]),
    deleteSelection,
    clearSelection: () => setSelection(new Set()),
    selectAll: () => setSelection(new Set(model.entities.map((e) => e.id).filter(Boolean) as string[])),
    selectLayer: (name: string) => setSelection(new Set(model.entities.filter((e) => e.id && e.layer === name).map((e) => e.id as string))),
    selectionCount: () => selRef.current.size,
  }));

  // World coordinate under a screen point.
  function worldAt(px: number, py: number, rect: DOMRect): Pt {
    const st = three.current;
    if (!st) return { x: 0, y: 0 };
    const ndcx = (px / rect.width) * 2 - 1;
    const ndcy = -((py / rect.height) * 2 - 1);
    const v = new THREE.Vector3(ndcx, ndcy, 0).unproject(st.camera);
    return { x: v.x, y: v.y };
  }
  function worldPerPx(rect: DOMRect): number {
    const st = three.current;
    if (!st) return 1;
    return st.frustumH / st.camera.zoom / rect.height;
  }
  // The point an angle constraint (ortho/polar) is measured from — the last placed
  // vertex of the current draw/modify/measure operation.
  function currentBase(): Pt | null {
    if (draftRef.current.length) return draftRef.current[draftRef.current.length - 1];
    if (measuringRef.current && ptsRef.current.length) return ptsRef.current[ptsRef.current.length - 1];
    return null;
  }

  // Object snap: pick the best snap point within tolerance across all enabled modes.
  function resolveSnap(w: Pt, rect: DOMRect, base: Pt | null): { p: Pt; type: SnapMode } | null {
    const st = three.current;
    if (!st || !osnap) return null;
    const tol = SNAP_PX * worldPerPx(rect);
    const tol2 = tol * tol;
    const enabled = new Set(snapModes);
    let bestPri = Infinity;
    let bestD2 = Infinity;
    let bx = 0;
    let by = 0;
    let bestType: SnapMode | null = null;
    const consider = (x: number, y: number, type: SnapMode) => {
      const dx = x - w.x;
      const dy = y - w.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > tol2) return;
      const pri = SNAP_PRI[type];
      if (pri < bestPri || (pri === bestPri && d2 < bestD2)) {
        bestPri = pri;
        bestD2 = d2;
        bx = x;
        by = y;
        bestType = type;
      }
    };
    if (enabled.has("end")) for (let i = 0; i < st.snap.length; i += 2) consider(st.snap[i], st.snap[i + 1], "end");
    const seg = st.segsFlat;
    const near: number[] = [];
    if (enabled.has("mid") || enabled.has("nearest") || enabled.has("perp") || enabled.has("intersection")) {
      for (let i = 0; i < seg.length; i += 4) {
        const x1 = seg[i];
        const y1 = seg[i + 1];
        const x2 = seg[i + 2];
        const y2 = seg[i + 3];
        if (w.x < Math.min(x1, x2) - tol || w.x > Math.max(x1, x2) + tol || w.y < Math.min(y1, y2) - tol || w.y > Math.max(y1, y2) + tol) continue;
        near.push(i);
        if (enabled.has("mid")) consider((x1 + x2) / 2, (y1 + y2) / 2, "mid");
        if (enabled.has("nearest")) {
          const c = closestOnSeg(w.x, w.y, x1, y1, x2, y2);
          consider(c.x, c.y, "nearest");
        }
        if (enabled.has("perp") && base) {
          const f = footOnSeg(base.x, base.y, x1, y1, x2, y2);
          if (f) consider(f.x, f.y, "perp");
        }
      }
      if (enabled.has("intersection") && near.length <= 120) {
        for (let a = 0; a < near.length; a++) {
          for (let b = a + 1; b < near.length; b++) {
            const i = near[a];
            const j = near[b];
            const p = segInt(seg[i], seg[i + 1], seg[i + 2], seg[i + 3], seg[j], seg[j + 1], seg[j + 2], seg[j + 3]);
            if (p) consider(p.x, p.y, "intersection");
          }
        }
      }
    }
    if (enabled.has("center")) for (let i = 0; i < st.centers.length; i += 2) consider(st.centers[i], st.centers[i + 1], "center");
    if (enabled.has("node")) for (let i = 0; i < st.nodes.length; i += 2) consider(st.nodes[i], st.nodes[i + 1], "node");
    return bestType ? { p: { x: bx, y: by }, type: bestType } : null;
  }

  // Full point resolution: object snap wins; otherwise Ortho/Polar constrains the
  // angle from the base point. Returns the point plus which aid produced it.
  function resolvePoint(raw: Pt, rect: DOMRect): { p: Pt; snapped: boolean; type: SnapMode | "ortho" | "polar" | null } {
    const base = currentBase();
    const sn = resolveSnap(raw, rect, base);
    if (sn) return { p: sn.p, snapped: true, type: sn.type };
    if (base && (ortho || polar)) {
      const dx = raw.x - base.x;
      const dy = raw.y - base.y;
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
          const ux = Math.cos(snapAng);
          const uy = Math.sin(snapAng);
          const t = dx * ux + dy * uy;
          return { p: { x: base.x + ux * t, y: base.y + uy * t }, snapped: false, type: "polar" };
        }
      }
    }
    return { p: raw, snapped: false, type: null };
  }
  function pickAt(w: Pt, rect: DOMRect): string | null {
    const tol = PICK_PX * worldPerPx(rect);
    let best = tol;
    let id: string | null = null;
    for (const e of modelRef.current.entities) {
      if (!e.id) continue;
      const layer = modelRef.current.layers.find((l) => l.name === e.layer);
      if (layer && !layer.visible) continue;
      const d = distToEntity(e, w);
      if (d < best) {
        best = d;
        id = e.id;
      }
    }
    return id;
  }

  const interactive = measuring || tool !== "pan";

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    setCursor({ px, py });
    const raw = worldAt(px, py, rect);
    // Object snap + ortho/polar while measuring or using any drawing/modify tool.
    if (measuring || isDraw(tool) || isModify(tool)) {
      const sn = resolvePoint(raw, rect);
      setHover(sn);
      setCoords(sn.p);
    } else {
      setCoords(raw);
      if (hover) setHover(null);
    }
    // Rubber-band window-select rectangle.
    if (downRef.current && tool === "select" && !measuring) {
      const moved = Math.hypot(e.clientX - (rect.left + downRef.current.x), e.clientY - (rect.top + downRef.current.y));
      if (moved > 4) setSelRect({ x1: downRef.current.x, y1: downRef.current.y, x2: px, y2: py });
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    downRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !downRef.current || !interactive) {
      downRef.current = null;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const upx = e.clientX - rect.left;
    const upy = e.clientY - rect.top;
    const moved = Math.hypot(upx - downRef.current.x, upy - downRef.current.y);
    const down = downRef.current;
    downRef.current = null;

    // Window select (drag) takes priority for the Select tool.
    if (tool === "select" && !measuring && moved > 5) {
      const a = worldAt(down.x, down.y, rect);
      const b = worldAt(upx, upy, rect);
      const hits = modelRef.current.entities.filter((en) => en.id && entityInRect(en, a, b)).map((en) => en.id as string);
      setSelection(new Set(e.shiftKey ? [...selRef.current, ...hits] : hits));
      setSelRect(null);
      return;
    }
    setSelRect(null);
    if (moved > 5) return; // a drag that wasn't a window-select — ignore (avoids stray points)

    const p = resolvePoint(worldAt(upx, upy, rect), rect).p;
    if (measuring) {
      setPts((prev) => [...prev, p]);
      return;
    }
    handleToolClick(p, e.shiftKey, rect);
  }

  function finishPolyline() {
    const d = draftRef.current;
    if (d.length >= 2) addEntities({ kind: "poly", layer: activeLayer, closed: false, pts: d.map((q) => ({ x: q.x, y: q.y })) });
    setDraft([]);
  }

  function handleToolClick(p: Pt, shift: boolean, rect: DOMRect) {
    switch (tool) {
      case "select": {
        const id = pickAt(p, rect);
        setSelection((prev) => {
          const next = new Set(shift ? prev : []);
          if (id) {
            if (shift && next.has(id)) next.delete(id);
            else next.add(id);
          }
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
          const pts = Array.from({ length: CIRCLE_SEG }, (_, i) => ({ x: c.x + r * Math.cos((i / CIRCLE_SEG) * Math.PI * 2), y: c.y + r * Math.sin((i / CIRCLE_SEG) * Math.PI * 2) }));
          addEntities({ kind: "poly", layer: activeLayer, closed: true, pts });
          setDraft([]);
        } else setDraft(d);
        break;
      }
      case "dimension": {
        const d = [...draftRef.current, p];
        if (d.length === 3) {
          addEntities(...buildDimension(d[0], d[1], d[2]));
          setDraft([]);
        } else setDraft(d);
        break;
      }
      case "hatch": {
        const selPolys = modelRef.current.entities.filter((e): e is Extract<Entity, { kind: "poly" }> => !!e.id && selRef.current.has(e.id) && e.kind === "poly" && e.closed);
        if (selPolys.length) {
          const add: Entity[] = [];
          for (const poly of selPolys) add.push(...hatchToEntities(poly.pts));
          if (add.length) addEntities(...add);
        } else setDraft((prev) => [...prev, p]);
        break;
      }
      case "text": {
        const t = window.prompt("Text:");
        if (t?.trim()) {
          const b = modelBounds(modelRef.current);
          const h = Math.max(0.25, (b.maxY - b.minY || 1) * 0.02);
          addEntities({ kind: "text", layer: activeLayer, text: t.trim(), x: p.x, y: p.y, h });
        }
        break;
      }
      case "move":
      case "copy": {
        if (!selRef.current.size) return;
        const d = [...draftRef.current, p];
        if (d.length === 2) {
          const dx = d[1].x - d[0].x;
          const dy = d[1].y - d[0].y;
          transformSelected((en) => translateEntity(en, dx, dy), tool === "copy");
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
        const base = p;
        const raw = window.prompt("Scale factor:", "1");
        const f = Number(raw);
        if (Number.isFinite(f) && f > 0) {
          transformSelected((en) => scaleEntityAbout(en, base.x, base.y, f));
          onOperationDone?.();
        }
        break;
      }
    }
  }

  // ---- Project overlay geometry to screen ----
  const st = three.current;
  const rect = mountRef.current?.getBoundingClientRect();
  const toScreen = (p: Pt): { x: number; y: number } => {
    if (!st || !rect) return { x: 0, y: 0 };
    const v = new THREE.Vector3(p.x, p.y, 0).project(st.camera);
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  };
  const fmt = (v: number) => (v * unitFactor).toFixed(precision);

  // Measure chain
  const mChain = measuring && hover ? [...pts, hover.p] : pts;
  const mScreen = mChain.map(toScreen);
  let mTotal = 0;
  const mSeg: { x: number; y: number; d: number }[] = [];
  for (let i = 1; i < mChain.length; i++) {
    const d = Math.hypot(mChain[i].x - mChain[i - 1].x, mChain[i].y - mChain[i - 1].y);
    mTotal += d;
    mSeg.push({ x: (mScreen[i].x + mScreen[i - 1].x) / 2, y: (mScreen[i].y + mScreen[i - 1].y) / 2, d });
  }
  const mArea = pts.length >= 3 ? polygonArea(pts) : 0;

  // Draft (draw/modify) preview geometry, computed in world then projected.
  const hp = hover?.p ?? null;
  const previewSegs: [Pt, Pt][] = [];
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
      else if (draft.length >= 2) for (const e of buildDimension(draft[0], draft[1], hp)) if (e.kind === "line") previewSegs.push([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
    } else if (tool === "hatch") {
      for (let i = 1; i < draft.length; i++) previewSegs.push([draft[i - 1], draft[i]]);
      previewSegs.push([draft[draft.length - 1], hp]);
      if (draft.length >= 2) previewSegs.push([hp, draft[0]]); // hint the closing edge
    } else if (isModify(tool)) {
      const sel = modelRef.current.entities.filter((e) => e.id && selection.has(e.id));
      if (tool === "move" || tool === "copy") {
        const dx = hp.x - draft[0].x;
        const dy = hp.y - draft[0].y;
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
  const ghostSegs: [Pt, Pt][] = [];
  let ghostPts = 0;
  for (const e of ghost) {
    const s = entitySegments(e);
    for (let i = 0; i < s.length && ghostPts < 4000; i += 4) {
      ghostSegs.push([{ x: s[i], y: s[i + 1] }, { x: s[i + 2], y: s[i + 3] }]);
      ghostPts++;
    }
  }
  const previewScreen = previewSegs.map(([a, b]) => [toScreen(a), toScreen(b)] as const);
  const ghostScreen = ghostSegs.map(([a, b]) => [toScreen(a), toScreen(b)] as const);

  // Snap marker / ortho-polar tracking overlays
  const hoverScreen = hover?.snapped || hover?.type === "ortho" || hover?.type === "polar" ? toScreen(hover.p) : null;
  const renderBase = draft.length ? draft[draft.length - 1] : measuring && pts.length ? pts[pts.length - 1] : null;
  const trackScreen = renderBase && (hover?.type === "ortho" || hover?.type === "polar") ? toScreen(renderBase) : null;
  const snapLabel = hover?.type ? (hover.type === "ortho" ? "Ortho" : hover.type === "polar" ? "Polar" : SNAP_LABEL[hover.type]) : null;

  const statusHint = (() => {
    if (measuring) return pts.length ? `Total ${fmt(mTotal)} ${units}${pts.length >= 3 ? ` · Area ${(mArea * unitFactor * unitFactor).toFixed(precision)} ${units}²` : ""}` : "Click points to measure · Esc clears";
    if (tool === "select") return selection.size ? `${selection.size} selected · Del erases · Esc clears` : "Click to select · drag a window · Shift adds";
    if (tool === "polyline") return `Click points · Enter/Esc finishes${draft.length ? ` · ${draft.length} pts` : ""}`;
    if (tool === "dimension") return draft.length < 2 ? "Click the two points to dimension" : "Click to place the dimension line";
    if (tool === "hatch") return selection.size ? "Click to hatch the selected closed shape(s)" : draft.length ? `Trace a closed boundary · Enter fills · ${draft.length} pts` : "Trace a closed boundary · Enter fills · or select a shape first";
    if (isDraw(tool)) return `Draw ${tool} · Esc cancels`;
    if (isModify(tool)) return selection.size ? (draft.length ? "Click destination" : tool === "scale" ? "Click base point" : "Click base point") : "Select entities first (Select tool)";
    return "";
  })();

  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#0d1017]"
      onMouseMove={onMove}
      onMouseLeave={() => {
        setCursor(null);
        if (!measuring) setCoords(null);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div ref={mountRef} className={`absolute inset-0 ${tool === "pan" ? "cursor-grab" : "cursor-crosshair"}`} />

      {/* Crosshair */}
      {cursor && tool !== "pan" && (
        <>
          <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-cyan-400/40" style={{ left: cursor.px }} />
          <div className="pointer-events-none absolute right-0 left-0 h-px bg-cyan-400/40" style={{ top: cursor.py }} />
        </>
      )}

      {/* Measure overlay */}
      {mChain.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <polyline points={mScreen.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="5 3" />
          {mScreen.map((p, i) => (
            <rect key={`v-${i}-${p.x.toFixed(0)}-${p.y.toFixed(0)}`} x={p.x - 3} y={p.y - 3} width={6} height={6} fill="#0d1017" stroke="#fbbf24" strokeWidth={1.5} />
          ))}
          {mSeg.map((s, i) => (
            <text key={`s-${i}-${s.x.toFixed(0)}`} x={s.x} y={s.y - 5} fill="#fde68a" fontSize={11} fontFamily="monospace" textAnchor="middle" stroke="#0d1017" strokeWidth={3} paintOrder="stroke">
              {fmt(s.d)} {units}
            </text>
          ))}
        </svg>
      )}

      {/* Draw / modify preview */}
      {(previewScreen.length > 0 || ghostScreen.length > 0) && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {ghostScreen.map(([a, b], i) => (
            <line key={`g-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#38ff9c" strokeOpacity={0.6} strokeWidth={1} />
          ))}
          {previewScreen.map(([a, b], i) => (
            <line key={`p-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#6f8cff" strokeWidth={1.4} strokeDasharray="6 3" />
          ))}
        </svg>
      )}

      {/* Window-select rectangle */}
      {selRect && (
        <div
          className="pointer-events-none absolute border border-cyan-400/70 bg-cyan-400/10"
          style={{ left: Math.min(selRect.x1, selRect.x2), top: Math.min(selRect.y1, selRect.y2), width: Math.abs(selRect.x2 - selRect.x1), height: Math.abs(selRect.y2 - selRect.y1) }}
        />
      )}

      {/* Ortho / polar tracking line + snap glyph */}
      {(hoverScreen || trackScreen) && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {trackScreen && hoverScreen && <line x1={trackScreen.x} y1={trackScreen.y} x2={hoverScreen.x} y2={hoverScreen.y} stroke="#a3e635" strokeWidth={1} strokeDasharray="4 4" />}
          {hoverScreen && hover && <SnapGlyph type={hover.type} x={hoverScreen.x} y={hoverScreen.y} />}
        </svg>
      )}
      {/* Snap-type tooltip near the cursor */}
      {snapLabel && cursor && (
        <div className="pointer-events-none absolute rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-lime-300" style={{ left: cursor.px + 14, top: cursor.py + 14 }}>
          {snapLabel}
        </div>
      )}

      {/* Readouts */}
      <div className="pointer-events-none absolute bottom-2 left-2 space-y-1 font-mono text-xs">
        <div className="rounded bg-black/60 px-2 py-1 text-cyan-300">{coords ? `X ${fmt(coords.x)}  Y ${fmt(coords.y)}${units ? ` ${units}` : ""}` : "X —  Y —"}</div>
        {statusHint && <div className="rounded bg-black/70 px-2 py-1 text-amber-200">{statusHint}</div>}
      </div>
    </div>
  );
});

// AutoCAD-style snap marker: a distinct green glyph per snap type.
function SnapGlyph({ type, x, y }: { type: SnapMode | "ortho" | "polar" | null; x: number; y: number }) {
  const c = "#a3e635";
  const r = 6;
  const common = { fill: "none", stroke: c, strokeWidth: 1.6 };
  switch (type) {
    case "end":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
    case "mid":
      return <polygon points={`${x},${y - r} ${x + r},${y + r} ${x - r},${y + r}`} {...common} />;
    case "center":
      return <circle cx={x} cy={y} r={r} {...common} />;
    case "intersection":
      return (
        <>
          <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} stroke={c} strokeWidth={1.6} />
          <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} stroke={c} strokeWidth={1.6} />
        </>
      );
    case "perp":
      return (
        <>
          <path d={`M ${x - r} ${y - r} L ${x - r} ${y + r} L ${x + r} ${y + r}`} {...common} />
          <rect x={x - r} y={y + r - 4} width={4} height={4} {...common} strokeWidth={1.2} />
        </>
      );
    case "node":
      return (
        <>
          <circle cx={x} cy={y} r={r} {...common} />
          <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} stroke={c} strokeWidth={1.2} />
          <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} stroke={c} strokeWidth={1.2} />
        </>
      );
    case "nearest":
      return <polygon points={`${x - r},${y - r} ${x + r},${y - r} ${x - r},${y + r} ${x + r},${y + r}`} {...common} />;
    default: // ortho / polar — a small diamond
      return <polygon points={`${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`} fill={c} />;
  }
}

// ---- helpers ----

function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function syncVisibility(st: { groups: Map<string, THREE.Group> }, model: DxfModel) {
  const hidden = new Set(model.layers.filter((l) => !l.visible).map((l) => l.name));
  for (const [name, g] of st.groups) g.visible = !hidden.has(name);
}

function gridLines(flat: number[], color: number): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
}

function makeTextSprite(text: string, color: number, h: number, x: number, y: number): THREE.Sprite | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || !text) return null;
  const fp = 48;
  ctx.font = `${fp}px sans-serif`;
  canvas.width = Math.max(1, Math.ceil(ctx.measureText(text).width));
  canvas.height = Math.ceil(fp * 1.3);
  ctx.font = `${fp}px sans-serif`;
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  const hw = h * 1.2;
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(hw * aspect, hw, 1);
  sprite.position.set(x + (hw * aspect) / 2, y + hw / 2, 0);
  return sprite;
}

function disposeChildren(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const any = o as Partial<THREE.Mesh & THREE.Sprite & THREE.LineSegments>;
      (any.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
      const mat = (any as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) for (const m of mat) disposeMaterial(m);
      else if (mat) disposeMaterial(mat);
    });
  }
}
function disposeMaterial(m: THREE.Material) {
  (m as THREE.SpriteMaterial).map?.dispose?.();
  m.dispose();
}

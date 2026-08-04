// The editable drawing — a DXF read into a small mutable model and written back out.
//
// Ported from DrawLogix's `domain/dxf-model`. Deliberately narrow: lines,
// polylines and text. That is not a shortcut, it is what an estimator's markup
// needs — a dimension, a revision cloud, a note, a boundary traced round the
// area being measured. Blocks, xrefs and dimension styles are read for display
// by the sidecar and are not re-authored here, so nothing in an issued drawing
// is silently rewritten.
//
// Pure: no DOM, no network. The viewport draws it, the editor mutates it, and
// `serializeModel` writes an R12 DXF that AutoCAD, BricsCAD and LibreCAD all open.

export type Entity =
  | { kind: "line"; layer: string; x1: number; y1: number; x2: number; y2: number; id?: string }
  | { kind: "poly"; layer: string; pts: { x: number; y: number }[]; closed: boolean; id?: string }
  | { kind: "text"; layer: string; text: string; x: number; y: number; h: number; id?: string };

export interface ModelLayer {
  name: string;
  aci: number;      // AutoCAD colour index
  visible: boolean;
}

export interface DxfModel {
  layers: ModelLayer[];
  entities: Entity[];
  insunits: number; // 0 unknown, 1 in, 2 ft, 4 mm, 5 cm, 6 m
}

// ── identity ────────────────────────────────────────────────────────────────
// The model has no index, so selection needs identity of its own. Ids are
// session-local, assigned on load and on creation; serializeModel ignores them.
let _idc = 0;
export const newId = (): string => `e${++_idc}`;

export function withIds(m: DxfModel): DxfModel {
  let changed = false;
  const entities = m.entities.map((e) => {
    if (e.id) return e;
    changed = true;
    return { ...e, id: newId() };
  });
  return changed ? { ...m, entities } : m;
}

// ── transforms ──────────────────────────────────────────────────────────────
interface Pt2 { x: number; y: number }

export function mapEntityPoints(e: Entity, fn: (x: number, y: number) => Pt2): Entity {
  if (e.kind === "line") {
    const a = fn(e.x1, e.y1);
    const b = fn(e.x2, e.y2);
    return { ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  if (e.kind === "poly") return { ...e, pts: e.pts.map((p) => fn(p.x, p.y)) };
  const p = fn(e.x, e.y);
  return { ...e, x: p.x, y: p.y };
}

export const translateEntity = (e: Entity, dx: number, dy: number): Entity =>
  mapEntityPoints(e, (x, y) => ({ x: x + dx, y: y + dy }));

export const rotateEntity = (e: Entity, cx: number, cy: number, ang: number): Entity => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return mapEntityPoints(e, (x, y) => ({
    x: cx + (x - cx) * c - (y - cy) * s,
    y: cy + (x - cx) * s + (y - cy) * c,
  }));
};

export function scaleEntityAbout(e: Entity, cx: number, cy: number, f: number): Entity {
  const out = mapEntityPoints(e, (x, y) => ({ x: cx + (x - cx) * f, y: cy + (y - cy) * f }));
  // Text scaled about a point must scale its height too, or a plan doubled in
  // size comes back with labels still sized for the old one.
  return out.kind === "text" ? { ...out, h: out.h * Math.abs(f) } : out;
}

/** Reflect an entity across the line through (ax,ay)–(bx,by). */
export function mirrorEntity(e: Entity, ax: number, ay: number, bx: number, by: number): Entity {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return mapEntityPoints(e, (x, y) => {
    const t = ((x - ax) * dx + (y - ay) * dy) / len2;
    const px = ax + t * dx, py = ay + t * dy;
    return { x: 2 * px - x, y: 2 * py - y };
  });
}

/**
 * Scanline hatch: parallel segments at `angle`, `spacing` apart, clipped to the
 * polygon by even-odd crossing. Pure geometry — the caller turns the segments
 * into LINE entities on a hatch layer, so the fill survives a round trip through
 * any CAD package rather than depending on a HATCH pattern definition.
 */
export function hatchSegments(poly: Pt2[], spacing: number, angle: number): [Pt2, Pt2][] {
  if (poly.length < 3 || spacing <= 0) return [];
  const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
  const rot = poly.map((p) => ({ x: p.x * cosA - p.y * sinA, y: p.x * sinA + p.y * cosA }));
  let minY = Infinity, maxY = -Infinity;
  for (const p of rot) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const cosB = Math.cos(angle), sinB = Math.sin(angle);
  const back = (x: number, y: number): Pt2 => ({ x: x * cosB - y * sinB, y: x * sinB + y * cosB });
  const out: [Pt2, Pt2][] = [];
  const n = rot.length;
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot[i], b = rot[(i + 1) % n];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([back(xs[i], y), back(xs[i + 1], y)]);
    if (out.length > 20000) break; // safety on pathological boundaries
  }
  return out;
}

// ── reading a DXF ───────────────────────────────────────────────────────────
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Strip MTEXT inline formatting so "{\fArial|b0|i0;BED ROOM}" reads "BED ROOM". */
export function cleanText(s: string): string {
  return s
    .replace(/\\[fF][^;]*;/g, "")
    .replace(/\\[HhCcTtQqWwAaPpKkOoLlNn][^;\\{}]*;?/g, "")
    .replace(/\\P/gi, " ")
    .replace(/\\~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "Ø")
    .replace(/\s+/g, " ")
    .trim();
}

type RawDxf = {
  entities?: Record<string, unknown>[];
  tables?: Record<string, unknown>;
  header?: Record<string, unknown>;
} | null;

export function parseToModel(dxf: RawDxf): DxfModel {
  const entities: Entity[] = [];
  const layerNames = new Set<string>();
  const insunits = num(dxf?.header?.["$INSUNITS"]);

  const fin = (n: number) => Number.isFinite(n);
  const fin2 = (p: { x: number; y: number }) => fin(num(p.x)) && fin(num(p.y));

  for (const e of dxf?.entities ?? []) {
    const type = String(e.type ?? "");
    const layer = String(e.layer ?? "0");
    layerNames.add(layer);
    if (type === "LINE") {
      const v = (e.vertices as { x: number; y: number }[]) ?? [];
      if (v.length >= 2 && fin2(v[0]) && fin2(v[1])) {
        entities.push({ kind: "line", layer, x1: num(v[0].x), y1: num(v[0].y), x2: num(v[1].x), y2: num(v[1].y) });
      }
    } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const v = (e.vertices as { x: number; y: number; z?: number }[]) ?? [];
      // 3D polylines, polyface meshes and spline-fit polys are skipped: joining
      // their vertices in sequence draws a radiating starburst across the sheet.
      const zs = v.map((p) => num(p.z));
      const is3d = Math.max(...zs, 0) - Math.min(...zs, 0) > 1e-6;
      const mesh = Boolean(
        (e as { polyfaceMesh?: unknown }).polyfaceMesh ?? (e as { is3dPolygonMesh?: unknown }).is3dPolygonMesh
      );
      if (v.length >= 2 && v.length <= 800 && !is3d && !mesh && v.every(fin2)) {
        entities.push({
          kind: "poly", layer, closed: Boolean(e.closed ?? e.shape),
          pts: v.map((p) => ({ x: num(p.x), y: num(p.y) })),
        });
      }
    } else if (type === "CIRCLE" || type === "ARC") {
      const c = e.center as { x: number; y: number } | undefined;
      const r = num(e.radius);
      if (c && fin2(c) && r > 0) {
        const a0 = type === "ARC" ? num(e.startAngle) : 0;
        const a1 = type === "ARC" ? num(e.endAngle) : Math.PI * 2;
        const span = type === "ARC" ? (a1 - a0 + Math.PI * 4) % (Math.PI * 2) || Math.PI * 2 : Math.PI * 2;
        const n = Math.max(8, Math.round((span / (Math.PI * 2)) * 32));
        const pts = Array.from({ length: n + 1 }, (_, i) => ({
          x: num(c.x) + r * Math.cos(a0 + (span * i) / n),
          y: num(c.y) + r * Math.sin(a0 + (span * i) / n),
        }));
        entities.push({ kind: "poly", layer, pts, closed: type === "CIRCLE" });
      }
    } else if (type === "TEXT" || type === "MTEXT") {
      const sp = (e.startPoint ?? e.position) as { x: number; y: number } | undefined;
      const t = cleanText(String(e.text ?? ""));
      if (sp && fin2(sp) && t) {
        entities.push({ kind: "text", layer, text: t, x: num(sp.x), y: num(sp.y), h: num(e.textHeight ?? e.height, 0) });
      }
    }
  }

  // TEXT and MTEXT often carry the same label at the same point; keep one.
  const seenText = new Set<string>();
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e.kind !== "text") continue;
    const k = `${e.text}@${Math.round(e.x)},${Math.round(e.y)}`;
    if (seenText.has(k)) entities.splice(i, 1);
    else seenText.add(k);
  }

  const tableLayers =
    (dxf?.tables as { layer?: { layers?: Record<string, { colorIndex?: number; color?: number; visible?: boolean }> } } | undefined)
      ?.layer?.layers ?? {};
  const layers: ModelLayer[] = [];
  const addLayer = (name: string, aci: number, visible: boolean) => {
    if (!layers.some((l) => l.name === name)) layers.push({ name, aci, visible });
  };
  for (const [name, def] of Object.entries(tableLayers)) addLayer(name, num(def.colorIndex ?? def.color, 7) || 7, def.visible !== false);
  for (const n of layerNames) addLayer(n, 7, true);

  return { layers, entities, insunits };
}

/** Bounding box of all geometry. */
export function modelBounds(m: DxfModel): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const e of m.entities) {
    if (e.kind === "line") { grow(e.x1, e.y1); grow(e.x2, e.y2); }
    else if (e.kind === "poly") for (const p of e.pts) grow(p.x, p.y);
    else grow(e.x, e.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Extents with the outliers trimmed off.
 *
 * One stray entity at the origin — a leftover from an xref, a zero-length line
 * in a block — stretches the true bounding box across an empty square kilometre
 * and fit-to-window renders the drawing as a dot. Taking the 2nd and 98th
 * percentile of the coordinates frames what is actually drawn.
 */
export function robustBounds(m: DxfModel): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs: number[] = [], ys: number[] = [];
  for (const e of m.entities) {
    if (e.kind === "line") { xs.push(e.x1, e.x2); ys.push(e.y1, e.y2); }
    else if (e.kind === "poly") for (const p of e.pts) { xs.push(p.x); ys.push(p.y); }
    else { xs.push(e.x); ys.push(e.y); }
  }
  if (!xs.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))];
  return { minX: q(xs, 0.02), maxX: q(xs, 0.98), minY: q(ys, 0.02), maxY: q(ys, 0.98) };
}

// ── writing a DXF ───────────────────────────────────────────────────────────
const f = (n: number) => n.toFixed(3);

/** Serialize back to a clean R12 DXF. R12 because every CAD package reads it. */
export function serializeModel(m: DxfModel): string {
  const out: string[] = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    ...(m.insunits ? ["9", "$INSUNITS", "70", `${m.insunits}`] : []),
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", `${m.layers.length + 1}`,
    "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
  ];
  for (const l of m.layers) {
    if (l.name === "0") continue;
    // A negative colour index is how R12 records a layer that is off.
    out.push("0", "LAYER", "2", l.name, "70", l.visible ? "0" : "1", "62", `${l.visible ? l.aci : -Math.abs(l.aci)}`, "6", "CONTINUOUS");
  }
  out.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  for (const e of m.entities) {
    if (e.kind === "line") {
      out.push("0", "LINE", "8", e.layer, "10", f(e.x1), "20", f(e.y1), "11", f(e.x2), "21", f(e.y2));
    } else if (e.kind === "poly") {
      out.push("0", "POLYLINE", "8", e.layer, "66", "1", "70", e.closed ? "1" : "0");
      for (const p of e.pts) out.push("0", "VERTEX", "8", e.layer, "10", f(p.x), "20", f(p.y));
      out.push("0", "SEQEND");
    } else {
      out.push("0", "TEXT", "8", e.layer, "10", f(e.x), "20", f(e.y), "40", f(e.h || 0.25), "1", e.text.replace(/[\n\r]/g, " "), "7", "STANDARD");
    }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}

// ── units ───────────────────────────────────────────────────────────────────
export const UNIT_LABEL: Record<number, string> = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m" };
export const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
export const UNIT_OPTIONS = ["mm", "cm", "m", "in", "ft"];
export const nativeUnit = (insunits: number) => UNIT_LABEL[insunits] ?? "mm";

/** How many display units one drawing unit is worth. */
export function unitFactor(insunits: number, display: string): number {
  const from = UNIT_MM[nativeUnit(insunits)] ?? 1;
  const to = UNIT_MM[display] ?? 1;
  return from / to;
}

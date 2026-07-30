/**
 * Editable DXF model — parse a dxf-parser result into a simple, mutable model
 * (layers + line/polyline/text entities), apply copilot edit operations, and
 * serialize back to a clean R12 DXF for export. Pure (no DOM/DB).
 */

export type Entity =
  | { kind: "line"; layer: string; x1: number; y1: number; x2: number; y2: number; id?: string }
  | { kind: "poly"; layer: string; pts: { x: number; y: number }[]; closed: boolean; id?: string }
  | { kind: "text"; layer: string; text: string; x: number; y: number; h: number; id?: string };

// ── Stable entity ids (for on-canvas selection / modify tools) ────────────────
// Index-free model, so selection needs identity. Ids are session-local, assigned
// on load and on creation; serializeModel ignores them. A monotonic counter keeps
// them unique across successive loads within one session.
let _idc = 0;
export const newId = (): string => `e${++_idc}`;

/** Return a model where every entity has an id (assigning one to any that lack it). */
export function withIds(m: DxfModel): DxfModel {
  let changed = false;
  const entities = m.entities.map((e) => {
    if (e.id) return e;
    changed = true;
    return { ...e, id: newId() };
  });
  return changed ? { ...m, entities } : m;
}

interface Pt2 {
  x: number;
  y: number;
}
/** Apply a point transform to every coordinate of an entity (id/layer preserved). */
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
export const translateEntity = (e: Entity, dx: number, dy: number): Entity => mapEntityPoints(e, (x, y) => ({ x: x + dx, y: y + dy }));
export const rotateEntity = (e: Entity, cx: number, cy: number, ang: number): Entity => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return mapEntityPoints(e, (x, y) => ({ x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c }));
};
export function scaleEntityAbout(e: Entity, cx: number, cy: number, f: number): Entity {
  const out = mapEntityPoints(e, (x, y) => ({ x: cx + (x - cx) * f, y: cy + (y - cy) * f }));
  return out.kind === "text" ? { ...out, h: out.h * Math.abs(f) } : out;
}
/**
 * Scanline hatch fill: return parallel line segments (at `angle` radians, `spacing`
 * apart) clipped to the polygon `poly` by even-odd crossing. Pure geometry — the
 * caller turns the segments into LINE entities on a hatch layer.
 */
export function hatchSegments(poly: Pt2[], spacing: number, angle: number): [Pt2, Pt2][] {
  if (poly.length < 3 || spacing <= 0) return [];
  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);
  const rot = poly.map((p) => ({ x: p.x * cosA - p.y * sinA, y: p.x * sinA + p.y * cosA }));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rot) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cosB = Math.cos(angle);
  const sinB = Math.sin(angle);
  const back = (x: number, y: number): Pt2 => ({ x: x * cosB - y * sinB, y: x * sinB + y * cosB });
  const out: [Pt2, Pt2][] = [];
  const n = rot.length;
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot[i];
      const b = rot[(i + 1) % n];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([back(xs[i], y), back(xs[i + 1], y)]);
    if (out.length > 20000) break; // safety on pathological boundaries
  }
  return out;
}

/** Reflect an entity across the line through (ax,ay)–(bx,by). */
export function mirrorEntity(e: Entity, ax: number, ay: number, bx: number, by: number): Entity {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return mapEntityPoints(e, (x, y) => {
    const t = ((x - ax) * dx + (y - ay) * dy) / len2;
    const px = ax + t * dx;
    const py = ay + t * dy;
    return { x: 2 * px - x, y: 2 * py - y };
  });
}

export interface ModelLayer {
  name: string;
  aci: number; // AutoCAD colour index
  visible: boolean;
}

export interface DxfModel {
  layers: ModelLayer[];
  entities: Entity[];
  insunits: number; // 0/unknown, 4=mm, 6=m …
}

const COLOR_ACI: Record<string, number> = { red: 1, yellow: 2, green: 3, cyan: 4, blue: 5, magenta: 6, white: 7, black: 7, gray: 8, grey: 8, orange: 30 };
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Strip MTEXT inline formatting codes so "{\fArial|b0|i0|c0|p34;BED ROOM}" → "BED ROOM". */
export function cleanText(s: string): string {
  return s
    .replace(/\\[fF][^;]*;/g, "") // font run: \fArial|…;
    .replace(/\\[HhCcTtQqWwAaPpKkOoLlNn][^;\\{}]*;?/g, "") // height/colour/width/etc: \H…; \C…;
    .replace(/\\P/gi, " ") // paragraph break
    .replace(/\\~/g, " ")
    .replace(/[{}]/g, "") // grouping braces
    .replace(/\\\\/g, "\\")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "Ø")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseToModel(dxf: { entities?: Record<string, unknown>[]; tables?: Record<string, unknown>; header?: Record<string, unknown> } | null): DxfModel {
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
      if (v.length >= 2 && fin2(v[0]) && fin2(v[1])) entities.push({ kind: "line", layer, x1: num(v[0].x), y1: num(v[0].y), x2: num(v[1].x), y2: num(v[1].y) });
    } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const v = (e.vertices as { x: number; y: number; z?: number }[]) ?? [];
      // Skip 3D polylines / polyface meshes / spline-fit polys — connecting their
      // vertices in sequence produces the radiating "starburst". 2D planar only.
      const zs = v.map((p) => num(p.z));
      const is3d = Math.max(...zs, 0) - Math.min(...zs, 0) > 1e-6;
      const mesh = Boolean((e as { polyfaceMesh?: unknown; is3dPolygonMesh?: unknown }).polyfaceMesh ?? (e as { is3dPolygonMesh?: unknown }).is3dPolygonMesh);
      if (v.length >= 2 && v.length <= 800 && !is3d && !mesh && v.every(fin2)) {
        entities.push({ kind: "poly", layer, pts: v.map((p) => ({ x: num(p.x), y: num(p.y) })), closed: Boolean(e.closed ?? e.shape) });
      }
    } else if (type === "CIRCLE" || type === "ARC") {
      const c = e.center as { x: number; y: number } | undefined;
      const r = num(e.radius);
      if (c && fin2(c) && r > 0) {
        const a0 = type === "ARC" ? num(e.startAngle) : 0;
        const a1 = type === "ARC" ? num(e.endAngle) : Math.PI * 2;
        const span = type === "ARC" ? (a1 - a0 + Math.PI * 4) % (Math.PI * 2) || Math.PI * 2 : Math.PI * 2;
        const n = Math.max(8, Math.round((span / (Math.PI * 2)) * 32));
        const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: num(c.x) + r * Math.cos(a0 + (span * i) / n), y: num(c.y) + r * Math.sin(a0 + (span * i) / n) }));
        entities.push({ kind: "poly", layer, pts, closed: type === "CIRCLE" });
      }
    } else if (type === "TEXT" || type === "MTEXT") {
      const sp = (e.startPoint ?? e.position) as { x: number; y: number } | undefined;
      const t = cleanText(String(e.text ?? ""));
      if (sp && fin2(sp) && t) entities.push({ kind: "text", layer, text: t, x: num(sp.x), y: num(sp.y), h: num(e.textHeight ?? e.height, 0) });
    }
  }

  // Drop exact-coincident duplicate labels (TEXT + MTEXT pairs at the same spot).
  const seenText = new Set<string>();
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e.kind !== "text") continue;
    const k = `${e.text}@${Math.round(e.x)},${Math.round(e.y)}`;
    if (seenText.has(k)) entities.splice(i, 1);
    else seenText.add(k);
  }

  // Layers from the table (with ACI colours) merged with any used by entities.
  const tableLayers = (dxf?.tables as { layer?: { layers?: Record<string, { colorIndex?: number; color?: number; visible?: boolean }> } } | undefined)?.layer?.layers ?? {};
  const layers: ModelLayer[] = [];
  const addLayer = (name: string, aci: number, visible: boolean) => {
    if (!layers.some((l) => l.name === name)) layers.push({ name, aci, visible });
  };
  for (const [name, def] of Object.entries(tableLayers)) addLayer(name, num(def.colorIndex ?? def.color, 7) || 7, def.visible !== false);
  for (const n of layerNames) addLayer(n, 7, true);

  return { layers, entities, insunits };
}

/** Bounding box of all geometry (for placing added text / scaling). */
export function modelBounds(m: DxfModel): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const e of m.entities) {
    if (e.kind === "line") {
      grow(e.x1, e.y1);
      grow(e.x2, e.y2);
    } else if (e.kind === "poly") for (const p of e.pts) grow(p.x, p.y);
    else grow(e.x, e.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export interface EditOp {
  op: string;
  from?: string;
  to?: string;
  layer?: string;
  color?: string;
  find?: string;
  replace?: string;
  text?: string;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  r?: number;
  w?: number;
  h?: number;
  dx?: number;
  dy?: number;
  factor?: number;
  points?: { x: number; y: number }[]; // add_polyline
  a1?: number; // add_arc start angle (deg)
  a2?: number; // add_arc end angle (deg)
  closed?: boolean;
}

/** Apply one copilot operation, returning a new model. Unknown ops are ignored. */
export function applyOp(m: DxfModel, op: EditOp): DxfModel {
  const layers = m.layers.map((l) => ({ ...l }));
  let entities = m.entities.map((e) => ({ ...e }));
  const ci = (s?: string) => (s ? typeof Number(s) === "number" && Number.isFinite(Number(s)) && s.trim() !== "" ? num(s, 7) : (COLOR_ACI[s.toLowerCase()] ?? 7) : 7);
  const eqLayer = (a: string, b?: string) => Boolean(b) && a.toLowerCase() === (b as string).toLowerCase();

  switch (op.op) {
    case "rename_layer": {
      if (op.from && op.to) {
        for (const l of layers) if (eqLayer(l.name, op.from)) l.name = op.to;
        for (const e of entities) if (eqLayer(e.layer, op.from)) e.layer = op.to;
      }
      break;
    }
    case "set_layer_color":
      for (const l of layers) if (eqLayer(l.name, op.layer)) l.aci = ci(op.color);
      break;
    case "hide_layer":
      for (const l of layers) if (eqLayer(l.name, op.layer)) l.visible = false;
      break;
    case "show_layer":
      for (const l of layers) if (eqLayer(l.name, op.layer)) l.visible = true;
      break;
    case "delete_layer":
      entities = entities.filter((e) => !eqLayer(e.layer, op.layer));
      break;
    case "replace_text":
      if (op.find) for (const e of entities) if (e.kind === "text" && e.text.toLowerCase().includes(op.find.toLowerCase())) e.text = e.text.replace(new RegExp(escapeRe(op.find), "gi"), op.replace ?? "");
      break;
    case "delete_text":
      if (op.find) entities = entities.filter((e) => !(e.kind === "text" && e.text.toLowerCase().includes((op.find as string).toLowerCase())));
      break;
    case "add_text": {
      if (op.text) {
        const b = modelBounds(m);
        const h = op.h ?? Math.max(0.25, (b.maxY - b.minY || 1) * 0.03);
        entities.push({ kind: "text", layer: op.layer ?? "NOTES", text: op.text, x: op.x ?? b.minX, y: op.y ?? b.maxY + h, h });
        if (!layers.some((l) => eqLayer(l.name, op.layer ?? "NOTES"))) layers.push({ name: op.layer ?? "NOTES", aci: 2, visible: true });
      }
      break;
    }
    case "add_rectangle": {
      const x = op.x ?? 0;
      const y = op.y ?? 0;
      const w = op.w ?? 1;
      const h = op.h ?? 1;
      const layer = op.layer ?? "WALLS";
      entities.push({ kind: "poly", layer, closed: true, pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
      if (op.text) {
        const th = Math.max(0.25, Math.min(w, h) * 0.12);
        entities.push({ kind: "text", layer: "TEXT", text: op.text, x: x + th, y: y + h - th * 1.5, h: th });
      }
      if (!layers.some((l) => eqLayer(l.name, layer))) layers.push({ name: layer, aci: 7, visible: true });
      break;
    }
    case "add_line": {
      const layer = op.layer ?? "0";
      entities.push({ kind: "line", layer, x1: op.x ?? 0, y1: op.y ?? 0, x2: op.x2 ?? op.x ?? 0, y2: op.y2 ?? op.y ?? 0 });
      if (!layers.some((l) => eqLayer(l.name, layer))) layers.push({ name: layer, aci: 7, visible: true });
      break;
    }
    case "add_circle": {
      const cx = op.x ?? 0;
      const cy = op.y ?? 0;
      const r = op.r ?? op.w ?? 1;
      const layer = op.layer ?? "0";
      if (r > 0) {
        const n = 48;
        const pts = Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * Math.PI * 2), y: cy + r * Math.sin((i / n) * Math.PI * 2) }));
        entities.push({ kind: "poly", layer, closed: true, pts });
        if (!layers.some((l) => eqLayer(l.name, layer))) layers.push({ name: layer, aci: 7, visible: true });
      }
      break;
    }
    case "move": {
      const dx = op.dx ?? 0;
      const dy = op.dy ?? 0;
      entities = entities.map((e) => translate(e, dx, dy));
      break;
    }
    case "scale": {
      const f = op.factor ?? 1;
      if (f > 0) entities = entities.map((e) => scale(e, f));
      break;
    }
    case "add_polyline": {
      const pts = Array.isArray(op.points) ? op.points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
      if (pts.length >= 2) {
        const layer = op.layer ?? "0";
        entities.push({ kind: "poly", layer, closed: Boolean(op.closed), pts: pts.map((p) => ({ x: p.x, y: p.y })) });
        if (!layers.some((l) => eqLayer(l.name, layer))) layers.push({ name: layer, aci: 7, visible: true });
      }
      break;
    }
    case "add_arc": {
      const cx = op.x ?? 0;
      const cy = op.y ?? 0;
      const r = op.r ?? op.w ?? 1;
      const layer = op.layer ?? "0";
      if (r > 0) {
        const a0 = ((op.a1 ?? 0) * Math.PI) / 180;
        const a1 = ((op.a2 ?? 360) * Math.PI) / 180;
        const span = a1 - a0 || Math.PI * 2;
        const n = Math.max(8, Math.round((Math.abs(span) / (Math.PI * 2)) * 48));
        const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: cx + r * Math.cos(a0 + (span * i) / n), y: cy + r * Math.sin(a0 + (span * i) / n) }));
        entities.push({ kind: "poly", layer, closed: false, pts });
        if (!layers.some((l) => eqLayer(l.name, layer))) layers.push({ name: layer, aci: 7, visible: true });
      }
      break;
    }
    case "add_dimension": {
      // A linear dimension drawn as graphics (extension lines + dim line + ticks + text)
      // between (x,y) and (x2,y2), on A-DIMS. Offset perpendicular to the measured line.
      const x1 = op.x ?? 0;
      const y1 = op.y ?? 0;
      const x2 = op.x2 ?? x1;
      const y2 = op.y2 ?? y1;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len > 1e-6) {
        const b = modelBounds(m);
        const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, len) || len;
        const off = op.h ?? span * 0.04; // dim-line offset
        const th = span * 0.02; // text/tick size
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        const nx = -uy;
        const ny = ux;
        const d1 = { x: x1 + nx * off, y: y1 + ny * off };
        const d2 = { x: x2 + nx * off, y: y2 + ny * off };
        const L = "A-DIMS";
        entities.push({ kind: "line", layer: L, x1, y1, x2: d1.x + nx * th, y2: d1.y + ny * th });
        entities.push({ kind: "line", layer: L, x1: x2, y1: y2, x2: d2.x + nx * th, y2: d2.y + ny * th });
        entities.push({ kind: "line", layer: L, x1: d1.x, y1: d1.y, x2: d2.x, y2: d2.y });
        const tick = (p: { x: number; y: number }) => entities.push({ kind: "line", layer: L, x1: p.x - (ux + nx) * th * 0.6, y1: p.y - (uy + ny) * th * 0.6, x2: p.x + (ux + nx) * th * 0.6, y2: p.y + (uy + ny) * th * 0.6 });
        tick(d1);
        tick(d2);
        const label = op.text ?? (m.insunits === 4 ? `${Math.round(len)}` : m.insunits === 6 ? `${Math.round(len * 1000)}` : `${Math.round(len * 100) / 100}`);
        entities.push({ kind: "text", layer: L, text: label, x: (d1.x + d2.x) / 2 + nx * th, y: (d1.y + d2.y) / 2 + ny * th, h: th });
        if (!layers.some((l) => eqLayer(l.name, L))) layers.push({ name: L, aci: 1, visible: true });
      }
      break;
    }
    case "delete_region": {
      // Remove every entity whose CENTRE falls inside the box (matches how the AI targets
      // objects — by centre, from buildSummary — so a small box around an object deletes
      // that object without nuking a large enclosing boundary it happens to overlap).
      const rx1 = Math.min(op.x ?? 0, op.x2 ?? 0);
      const ry1 = Math.min(op.y ?? 0, op.y2 ?? 0);
      const rx2 = Math.max(op.x ?? 0, op.x2 ?? 0);
      const ry2 = Math.max(op.y ?? 0, op.y2 ?? 0);
      const centreOf = (e: Entity): [number, number] => {
        if (e.kind === "line") return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2];
        if (e.kind === "poly") {
          const xs = e.pts.map((p) => p.x);
          const ys = e.pts.map((p) => p.y);
          return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        }
        return [e.x, e.y];
      };
      entities = entities.filter((e) => {
        const [cx, cy] = centreOf(e);
        return !(cx >= rx1 && cx <= rx2 && cy >= ry1 && cy <= ry2);
      });
      break;
    }
    case "clear_all":
      entities = [];
      break;
  }
  return { ...m, layers, entities };
}

function translate(e: Entity, dx: number, dy: number): Entity {
  if (e.kind === "line") return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
  if (e.kind === "poly") return { ...e, pts: e.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return { ...e, x: e.x + dx, y: e.y + dy };
}
function scale(e: Entity, f: number): Entity {
  if (e.kind === "line") return { ...e, x1: e.x1 * f, y1: e.y1 * f, x2: e.x2 * f, y2: e.y2 * f };
  if (e.kind === "poly") return { ...e, pts: e.pts.map((p) => ({ x: p.x * f, y: p.y * f })) };
  return { ...e, x: e.x * f, y: e.y * f, h: e.h * f };
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Serialize the model back to a clean R12 DXF string. */
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
const f = (n: number) => n.toFixed(3);

// ── Copilot model summary (what the AI sees of the drawing) ───────────────────
export interface SummaryEntity {
  kind: string; // line | poly | text
  layer: string;
  cx: number; // centre / insertion point
  cy: number;
  w: number; // extent width  (so the AI can size a delete_region to cover the object)
  h: number; // extent height
  text?: string;
}
export interface ModelSummary {
  layers: string[];
  texts: string[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  insunits: number;
  entities?: SummaryEntity[];
}

/**
 * Compact summary of a drawing for the AI copilot: layer names, text labels, extents,
 * and a bounded, spatially-tagged entity list (kind + layer + centre + label) so the
 * model can TARGET specific things to delete/modify — "remove the shed top-left" works
 * because the AI can see each entity's position.
 */
export function buildSummary(m: DxfModel): ModelSummary {
  const texts = [...new Set(m.entities.filter((e): e is Extract<Entity, { kind: "text" }> => e.kind === "text").map((e) => e.text))].slice(0, 80);
  const entities: SummaryEntity[] = m.entities.slice(0, 300).map((e) => {
    if (e.kind === "line") return { kind: "line", layer: e.layer, cx: (e.x1 + e.x2) / 2, cy: (e.y1 + e.y2) / 2, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    if (e.kind === "poly") {
      const xs = e.pts.map((p) => p.x);
      const ys = e.pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      return { kind: "poly", layer: e.layer, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    }
    return { kind: "text", layer: e.layer, cx: e.x, cy: e.y, w: 0, h: 0, text: e.text };
  });
  return { layers: m.layers.map((l) => l.name), texts, bounds: modelBounds(m), insunits: m.insunits, entities };
}

// ── Faithful model → SVG (draws every entity as-is; for copilot edit previews) ──
const ACI_HEX: Record<number, string> = { 1: "#dc2626", 2: "#ca8a04", 3: "#16a34a", 4: "#0891b2", 5: "#2563eb", 6: "#c026d3", 7: "#111827", 8: "#6b7280", 9: "#9ca3af", 30: "#ea580c" };

/** Render a DxfModel to an inline SVG exactly as it is (all entities, layer colours,
 *  Y flipped for screen). Used to preview/persist copilot geometry edits on ANY drawing
 *  without re-wrapping it in a sheet template. */
export function modelToSvg(m: DxfModel): string {
  const colourOf = (layer: string): string => {
    const l = m.layers.find((x) => x.name === layer);
    return ACI_HEX[l?.aci ?? 7] ?? "#111827";
  };
  const b = modelBounds(m);
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const P = Math.max(0.4, Math.min(40, 1200 / Math.max(spanX, spanY)));
  const M = 16;
  const W = spanX * P + M * 2;
  const H = spanY * P + M * 2;
  const sx = (x: number) => (x - b.minX) * P + M;
  const sy = (y: number) => H - ((y - b.minY) * P + M);
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
  const out: string[] = [];
  for (const e of m.entities) {
    const c = colourOf(e.layer);
    if (e.kind === "line") {
      out.push(`<line x1="${sx(e.x1).toFixed(1)}" y1="${sy(e.y1).toFixed(1)}" x2="${sx(e.x2).toFixed(1)}" y2="${sy(e.y2).toFixed(1)}" stroke="${c}" stroke-width="1.1"/>`);
    } else if (e.kind === "poly") {
      const pts = e.pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
      out.push(`<${e.closed ? "polygon" : "polyline"} points="${pts}" fill="none" stroke="${c}" stroke-width="1.1"/>`);
    } else {
      out.push(`<text x="${sx(e.x).toFixed(1)}" y="${sy(e.y).toFixed(1)}" font-family="Arial, sans-serif" font-size="${Math.max(8, (e.h || 0.3) * P).toFixed(1)}" fill="${c}">${esc(e.text)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}"><rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#ffffff"/>${out.join("")}</svg>`;
}

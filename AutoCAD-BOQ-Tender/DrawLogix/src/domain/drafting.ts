import type { ScheduleRow } from "@/db/schema";
import { type DxfModel, modelBounds } from "./dxf-model";
import { type Envelope, type ResolvedPlan, resolvePlan, solveFloorPlan } from "./floorplan";

/**
 * Professional 2D drafting engine — turns solved floor plans into AutoCAD-grade
 * drawings: double-line walls with real thickness ("depth"), full dimension strings on
 * both axes (every bay + overall), a column grid with A/B/C · 1/2/3 bubbles, room/door/
 * window tags, a north arrow, a scale bar, a title block, per-storey level labels, and a
 * stacking (mini-section) diagram. One drawing routine feeds two "pens": a DXF pen
 * (R12, opens in AutoCAD/Revit) and an SVG pen (in-app preview). Coordinates are in
 * METRES, Y-up, laid out on one sheet. Pure — no DOM/DB.
 */

export interface Construction {
  extWallMm: number; // exterior wall thickness (mm)
  intWallMm: number; // internal partition thickness (mm)
  floorToFloorM: number; // storey height for the stacking diagram
  storeys: number;
  unit: "mm" | "m"; // dimension text unit
}

export const DEFAULT_CONSTRUCTION: Construction = { extWallMm: 200, intWallMm: 100, floorToFloorM: 3.0, storeys: 1, unit: "mm" };

export interface Floor {
  label: string; // "GROUND FLOOR PLAN"
  plan: ResolvedPlan;
}

// ── Pen abstraction: draw once, emit DXF or SVG ──────────────────────────────
interface Pen {
  line(layer: string, x1: number, y1: number, x2: number, y2: number): void;
  pline(layer: string, pts: Array<[number, number]>, closed: boolean): void;
  circle(layer: string, cx: number, cy: number, r: number): void;
  fill(layer: string, pts: Array<[number, number]>): void; // solid fill (arrowheads/north)
  text(layer: string, x: number, y: number, h: number, s: string, align?: "l" | "c" | "r", angleDeg?: number): void;
}

const LAYERS: { name: string; aci: number; hex: string; w: number }[] = [
  { name: "A-WALL", aci: 7, hex: "#1e1b3a", w: 2.4 },
  { name: "A-WALL-PATT", aci: 8, hex: "#94a3b8", w: 0.6 },
  { name: "A-DOOR", aci: 4, hex: "#0891b2", w: 1 },
  { name: "A-GLAZ", aci: 5, hex: "#2563eb", w: 1.2 },
  { name: "A-GRID", aci: 8, hex: "#9aa4b2", w: 0.5 },
  { name: "A-DIMS", aci: 1, hex: "#dc2626", w: 0.7 },
  { name: "A-ANNO", aci: 2, hex: "#0f172a", w: 0.8 },
  { name: "A-AREA", aci: 3, hex: "#16a34a", w: 0.6 },
  { name: "A-TTLB", aci: 7, hex: "#111827", w: 1.2 },
];
const layerHex = (name: string): string => LAYERS.find((l) => l.name === name)?.hex ?? "#1e1b3a";
const layerW = (name: string): number => LAYERS.find((l) => l.name === name)?.w ?? 1;

const f3 = (n: number) => n.toFixed(3);
const cleanTextStr = (s: string) => s.replace(/[\n\r]/g, " ");

/** DXF (R12) pen. */
function dxfPen(): Pen & { finish(name: string, bbox: BBox): string } {
  const ents: string[] = [];
  return {
    line(layer, x1, y1, x2, y2) {
      ents.push("0", "LINE", "8", layer, "10", f3(x1), "20", f3(y1), "11", f3(x2), "21", f3(y2));
    },
    pline(layer, pts, closed) {
      ents.push("0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0");
      for (const [x, y] of pts) ents.push("0", "VERTEX", "8", layer, "10", f3(x), "20", f3(y));
      ents.push("0", "SEQEND");
    },
    circle(layer, cx, cy, r) {
      ents.push("0", "CIRCLE", "8", layer, "10", f3(cx), "20", f3(cy), "40", f3(r));
    },
    fill(layer, pts) {
      // SOLID needs 4 points (3rd/4th swapped ordering); triangle → repeat last.
      const p = pts.length >= 4 ? pts : [pts[0], pts[1], pts[2], pts[2]];
      ents.push(
        "0", "SOLID", "8", layer,
        "10", f3(p[0][0]), "20", f3(p[0][1]),
        "11", f3(p[1][0]), "21", f3(p[1][1]),
        "12", f3(p[3][0]), "22", f3(p[3][1]),
        "13", f3(p[2][0]), "23", f3(p[2][1]),
      );
    },
    text(layer, x, y, h, s, align = "l", angleDeg = 0) {
      const jc = align === "c" ? 1 : align === "r" ? 2 : 0;
      ents.push("0", "TEXT", "8", layer, "10", f3(x), "20", f3(y), "40", f3(h));
      if (angleDeg) ents.push("50", f3(angleDeg));
      ents.push("1", cleanTextStr(s), "7", "STANDARD");
      if (jc) ents.push("72", `${jc}`, "11", f3(x), "21", f3(y));
    },
    finish(name, bbox) {
      const header = [
        "0", "SECTION", "2", "HEADER",
        "9", "$ACADVER", "1", "AC1009",
        "9", "$INSUNITS", "70", "6",
        "9", "$EXTMIN", "10", f3(bbox.minX - 1), "20", f3(bbox.minY - 1),
        "9", "$EXTMAX", "10", f3(bbox.maxX + 1), "20", f3(bbox.maxY + 1),
        "0", "ENDSEC",
      ];
      const table: string[] = ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", `${LAYERS.length + 1}`];
      table.push("0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS");
      for (const l of LAYERS) table.push("0", "LAYER", "2", l.name, "70", "0", "62", `${l.aci}`, "6", "CONTINUOUS");
      table.push("0", "ENDTAB", "0", "ENDSEC");
      return [`999`, `DrawLogix — ${name}`, ...header, ...table, "0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF"].join("\n");
    },
  };
}

/** SVG pen (metres → px, Y flipped). */
function svgPen(bbox: BBox, pxPerM: number, pad: number): Pen & { finish(): string } {
  const H = (bbox.maxY - bbox.minY) * pxPerM + pad * 2;
  const sx = (x: number) => (x - bbox.minX) * pxPerM + pad;
  const sy = (y: number) => H - ((y - bbox.minY) * pxPerM + pad);
  const out: string[] = [];
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
  return {
    line(layer, x1, y1, x2, y2) {
      out.push(`<line x1="${sx(x1).toFixed(1)}" y1="${sy(y1).toFixed(1)}" x2="${sx(x2).toFixed(1)}" y2="${sy(y2).toFixed(1)}" stroke="${layerHex(layer)}" stroke-width="${layerW(layer)}"/>`);
    },
    pline(layer, pts, closed) {
      const s = pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
      out.push(`<${closed ? "polygon" : "polyline"} points="${s}" fill="none" stroke="${layerHex(layer)}" stroke-width="${layerW(layer)}"/>`);
    },
    circle(layer, cx, cy, r) {
      out.push(`<circle cx="${sx(cx).toFixed(1)}" cy="${sy(cy).toFixed(1)}" r="${(r * pxPerM).toFixed(1)}" fill="none" stroke="${layerHex(layer)}" stroke-width="${layerW(layer)}"/>`);
    },
    fill(layer, pts) {
      const s = pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
      out.push(`<polygon points="${s}" fill="${layerHex(layer)}" stroke="none"/>`);
    },
    text(layer, x, y, h, s, align = "l", angleDeg = 0) {
      const anchor = align === "c" ? "middle" : align === "r" ? "end" : "start";
      const px = sx(x);
      const py = sy(y) - 1; // baseline nudge
      const rot = angleDeg ? ` transform="rotate(${-angleDeg} ${px.toFixed(1)} ${py.toFixed(1)})"` : "";
      out.push(`<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-family="Arial, sans-serif" font-size="${Math.max(7, h * pxPerM).toFixed(1)}" fill="${layerHex(layer)}" text-anchor="${anchor}"${rot}>${esc(s)}</text>`);
    },
    finish() {
      const W = (bbox.maxX - bbox.minX) * pxPerM + pad * 2;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}"><rect x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#ffffff"/>${out.join("")}</svg>`;
    },
  };
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ── Drawing helpers ──────────────────────────────────────────────────────────
const uniq = (vals: number[], eps = 0.05): number[] => {
  const sorted = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || Math.abs(v - out[out.length - 1]) > eps) out.push(v);
  return out;
};
const fmtDim = (m: number, c: Construction): string => (c.unit === "m" ? `${Math.round(m * 100) / 100}` : `${Math.round(m * 1000)}`);
const letters = (i: number): string => {
  // A, B … Z, AA, AB …
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** A 45° architectural dimension tick centred on (x,y). */
function tick(pen: Pen, x: number, y: number) {
  const t = 0.12;
  pen.line("A-DIMS", x - t, y - t, x + t, y + t);
}

/** Horizontal dimension line at height `yDim` spanning `xs`, with extension lines up to `yGeom`. */
function horizDim(pen: Pen, xs: number[], yGeom: number, yDim: number, c: Construction) {
  if (xs.length < 2) return;
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  pen.line("A-DIMS", x0, yDim, x1, yDim);
  for (const x of xs) {
    pen.line("A-DIMS", x, yGeom - 0.15, x, yDim - 0.2); // extension line
    tick(pen, x, yDim);
  }
  for (let i = 0; i + 1 < xs.length; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    if (xs[i + 1] - xs[i] < 0.4) continue;
    pen.text("A-DIMS", mid, yDim + 0.12, 0.26, fmtDim(xs[i + 1] - xs[i], c), "c");
  }
}

/** Vertical dimension line at `xDim` spanning `ys`, extension lines out to `xGeom`. */
function vertDim(pen: Pen, ys: number[], xGeom: number, xDim: number, c: Construction) {
  if (ys.length < 2) return;
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  pen.line("A-DIMS", xDim, y0, xDim, y1);
  for (const y of ys) {
    pen.line("A-DIMS", xGeom + 0.15, y, xDim + 0.2, y); // extension line (dim is to the left → xDim < xGeom)
    tick(pen, xDim, y);
  }
  for (let i = 0; i + 1 < ys.length; i++) {
    const mid = (ys[i] + ys[i + 1]) / 2;
    if (ys[i + 1] - ys[i] < 0.4) continue;
    pen.text("A-DIMS", xDim - 0.12, mid, 0.26, fmtDim(ys[i + 1] - ys[i], c), "c", 90);
  }
}

/**
 * Draw one fully-detailed floor plan with its walls, openings, tags, grid and
 * dimensions at sheet origin (ox, oy). Returns the drawn extents (for sheet layout).
 */
function drawFloor(pen: Pen, floor: Floor, c: Construction, ox: number, oy: number): { w: number; h: number } {
  const { rooms, width: W, height: H, doors, windows } = floor.plan;
  const ext = c.extWallMm / 1000;
  const intt = c.intWallMm / 1000;
  // Room y is screen-down within [0,H]; flip into sheet Y-up and offset to (ox,oy).
  const TX = (x: number) => ox + x;
  const TY = (y: number) => oy + (H - y);

  // Exterior wall band: outer envelope + inner offset.
  pen.pline("A-WALL", [[TX(0), TY(0)], [TX(W), TY(0)], [TX(W), TY(H)], [TX(0), TY(H)]], true);
  pen.pline("A-WALL", [[TX(ext), TY(ext)], [TX(W - ext), TY(ext)], [TX(W - ext), TY(H - ext)], [TX(ext), TY(H - ext)]], true);

  const onEdge = (v: number, edge: number) => Math.abs(v - edge) < 0.06;

  // Room boundaries (A-AREA) + inner partition faces (A-WALL) + tags.
  for (const r of rooms) {
    const x = r.x ?? 0;
    const y = r.y ?? 0;
    const w = r.w ?? 0;
    const h = r.h ?? 0;
    const x2 = x + w;
    const y2 = y + h;
    // Closed room polyline so AutoCAD AREA/HATCH works.
    pen.pline("A-AREA", [[TX(x), TY(y)], [TX(x2), TY(y)], [TX(x2), TY(y2)], [TX(x), TY(y2)]], true);
    // Partition faces: offset each non-exterior edge inward by half the wall thickness.
    const faceV = (edgeX: number, dir: number) => {
      const t = onEdge(edgeX, 0) || onEdge(edgeX, W) ? ext : intt / 2;
      pen.line("A-WALL", TX(edgeX + dir * t), TY(y + intt / 2), TX(edgeX + dir * t), TY(y2 - intt / 2));
    };
    const faceH = (edgeY: number, dir: number) => {
      const t = onEdge(edgeY, 0) || onEdge(edgeY, H) ? ext : intt / 2;
      pen.line("A-WALL", TX(x + intt / 2), TY(edgeY + dir * t), TX(x2 - intt / 2), TY(edgeY + dir * t));
    };
    if (!onEdge(x, 0)) faceV(x, +1);
    if (!onEdge(x2, W)) faceV(x2, -1);
    if (!onEdge(y, 0)) faceH(y, +1);
    if (!onEdge(y2, H)) faceH(y2, -1);

    // Tags (room name / area / size).
    const cx = TX(x + 0.3);
    if (r.kind === "circulation") {
      pen.text("A-ANNO", TX(x + w / 2), TY(y + h / 2), 0.32, "CIRCULATION", "c");
    } else {
      pen.text("A-ANNO", cx, TY(y + 0.8), 0.34, r.room.toUpperCase());
      pen.text("A-AREA", cx, TY(y + 1.4), 0.26, `${r.areaSqm} m²   ${r.ref}`);
      pen.text("A-DIMS", cx, TY(y + 1.95), 0.24, `${(w).toFixed(2)} × ${(h).toFixed(2)}`);
    }
  }

  // Doors (leaf + swing) on A-DOOR.
  for (const d of doors) {
    const dx = TX(d.x);
    const dy = TY(d.y);
    const s = d.size;
    const arc: Array<[number, number]> = [];
    if (d.vertical) {
      pen.line("A-DOOR", dx, dy - s / 2, dx + s, dy - s / 2);
      for (let i = 0; i <= 10; i++) {
        const a = (Math.PI / 2) * (i / 10);
        arc.push([dx + s * Math.cos(a), dy - s / 2 + s * Math.sin(a)]);
      }
    } else {
      pen.line("A-DOOR", dx - s / 2, dy, dx - s / 2, dy + s);
      for (let i = 0; i <= 10; i++) {
        const a = (Math.PI / 2) * (i / 10);
        arc.push([dx - s / 2 + s * Math.sin(a), dy + s * Math.cos(a)]);
      }
    }
    pen.pline("A-DOOR", arc, false);
  }

  // Windows (double sill line) on A-GLAZ.
  for (const wn of windows) {
    const wx = TX(wn.x);
    const wy = TY(wn.y);
    const s = wn.size / 2;
    if (wn.vertical) {
      pen.line("A-GLAZ", wx - 0.08, wy - s, wx - 0.08, wy + s);
      pen.line("A-GLAZ", wx + 0.08, wy - s, wx + 0.08, wy + s);
    } else {
      pen.line("A-GLAZ", wx - s, wy - 0.08, wx + s, wy - 0.08);
      pen.line("A-GLAZ", wx - s, wy + 0.08, wx + s, wy + 0.08);
    }
  }

  // Column grid + bubbles (unique room edges).
  const xsPlan = uniq(rooms.flatMap((r) => [(r.x ?? 0), (r.x ?? 0) + (r.w ?? 0)]));
  const ysScreen = uniq(rooms.flatMap((r) => [(r.y ?? 0), (r.y ?? 0) + (r.h ?? 0)]));
  const ysSheet = uniq(ysScreen.map((y) => H - y)); // Y-up positions
  const gridTop = oy + H + 1.4;
  const gridLeft = ox - 4.6;
  for (let i = 0; i < xsPlan.length; i++) {
    const gx = TX(xsPlan[i]);
    pen.line("A-GRID", gx, oy, gx, gridTop - 0.4);
    pen.circle("A-GRID", gx, gridTop, 0.4);
    pen.text("A-GRID", gx, gridTop - 0.13, 0.32, letters(i), "c");
  }
  for (let i = 0; i < ysSheet.length; i++) {
    const gy = oy + ysSheet[i];
    pen.line("A-GRID", gridLeft + 0.4, gy, ox, gy);
    pen.circle("A-GRID", gridLeft, gy, 0.4);
    pen.text("A-GRID", gridLeft, gy - 0.13, 0.32, `${i + 1}`, "c");
  }

  // Dimension chains: per-bay + overall, both axes.
  const xsSheet = xsPlan.map((x) => TX(x));
  horizDim(pen, xsSheet, oy, oy - 1.4, c); // per-bay below plan
  horizDim(pen, [TX(0), TX(W)], oy, oy - 2.8, c); // overall
  const ysDimSheet = ysSheet.map((y) => oy + y);
  vertDim(pen, ysDimSheet, ox, ox - 1.4, c);
  vertDim(pen, [oy, oy + H], ox, ox - 2.8, c);

  // Level label above the plan.
  pen.text("A-ANNO", ox, gridTop + 1.0, 0.6, floor.label, "l");

  return { w: 4.6 + W + 1.0, h: 3.6 + H + 3.0 };
}

/** North arrow at (x,y), radius r. */
function northArrow(pen: Pen, x: number, y: number, r = 1.0, layer = "A-ANNO") {
  pen.circle(layer, x, y, r);
  pen.fill(layer, [[x, y + r * 1.4], [x - r * 0.45, y - r * 0.4], [x + r * 0.45, y - r * 0.4]]);
  pen.text(layer, x, y + r + r * 0.5, r * 0.4, "N", "c");
}

const NICE = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
const niceStep = (target: number): number => {
  let best = NICE[0];
  for (const n of NICE) if (n <= target) best = n;
  return best;
};

/** Graphic scale bar sized to `totalM` (the drawing width in metres) at (x,y). */
function scaleBar(pen: Pen, x: number, y: number, c: Construction, totalM = 10) {
  const seg = niceStep(Math.max(0.5, (totalM * 0.2) / 5)); // ~5 segments over ~20% of width
  const n = 5;
  const h = Math.max(0.15, seg * 0.15);
  const th = Math.max(0.22, seg * 0.28);
  for (let i = 0; i < n; i++) {
    const x0 = x + i * seg;
    if (i % 2 === 0) pen.fill("A-TTLB", [[x0, y], [x0 + seg, y], [x0 + seg, y + h], [x0, y + h]]);
    else pen.pline("A-TTLB", [[x0, y], [x0 + seg, y], [x0 + seg, y + h], [x0, y + h]], true);
  }
  const lbl = (v: number) => (c.unit === "mm" && totalM < 40 ? `${Math.round(v * 1000)}` : `${v}`);
  pen.text("A-TTLB", x, y - th * 1.6, th, lbl(0));
  pen.text("A-TTLB", x + (n / 2) * seg, y - th * 1.6, th, lbl((n / 2) * seg), "c");
  pen.text("A-TTLB", x + n * seg, y - th * 1.6, th, `${lbl(n * seg)} m`, "c");
}

// AIA-ish mapping for freeform/site drawings: keep known layers, guess the rest.
function normFreeLayer(layer: string): string {
  const u = (layer || "0").toUpperCase();
  if (LAYERS.some((l) => l.name === u)) return u;
  if (/DIM/.test(u)) return "A-DIMS";
  if (/GRID|AXIS|SETTING|SETOUT/.test(u)) return "A-GRID";
  if (/GLAZ|WINDOW|GLASS/.test(u)) return "A-GLAZ";
  if (/DOOR|GATE/.test(u)) return "A-DOOR";
  if (/WALL|FENCE|BUILD|SHED|RACK|CONTAINER|YARD|ZONE|BOUND|SLAB|ROAD|KERB|CURB|PLOT/.test(u)) return "A-WALL";
  return "A-ANNO";
}

/**
 * Compose a full CAD sheet from freeform primitives (site plans, schematics, details):
 * draw the AI geometry on mapped AIA layers, auto-dimension the overall extents (if the
 * AI didn't dimension it), then add a drawing frame, north arrow, graphic scale bar and
 * title block — sized to the drawing. Furniture is regenerated each render (old
 * furniture on A-TTLB/A-GRID is stripped first) so copilot edits don't accumulate it.
 */
function composeFreeformSheet(pen: Pen, model: DxfModel, name: string, c: Construction): BBox {
  const FURNITURE = new Set(["A-TTLB", "A-GRID", "A-WALL-PATT"]);
  const content = model.entities.filter((e) => !FURNITURE.has(e.layer.toUpperCase()));
  const gb = modelBounds({ ...model, entities: content });
  const W = Math.max(gb.maxX - gb.minX, 1);
  const Hh = Math.max(gb.maxY - gb.minY, 1);
  const span = Math.max(W, Hh);
  const minLabelH = span * 0.012; // keep labels legible at the drawing's scale

  for (const e of content) {
    const layer = normFreeLayer(e.layer);
    if (e.kind === "line") pen.line(layer, e.x1, e.y1, e.x2, e.y2);
    else if (e.kind === "poly") pen.pline(layer, e.pts.map((p) => [p.x, p.y] as [number, number]), e.closed);
    else pen.text(layer, e.x, e.y, Math.max(e.h || 0, minLabelH), e.text, "l");
  }

  // Auto overall dimensions when the AI gave none — measured off geometry, not labels.
  const hasDims = content.some((e) => e.layer.toUpperCase() === "A-DIMS");
  const geom = content.filter((e) => e.kind !== "text");
  const gg = geom.length ? modelBounds({ ...model, entities: geom }) : gb;
  const off = span * 0.05;
  if (!hasDims) {
    horizDim(pen, [gg.minX, gg.maxX], gg.minY, gg.minY - off, c);
    vertDim(pen, [gg.minY, gg.maxY], gg.minX, gg.minX - off, c);
  }

  // Drawing frame, sized furniture.
  const pad = span * 0.06;
  const fx0 = gb.minX - pad * 2.2;
  const fy0 = gb.minY - pad * 2.6;
  const fx1 = gb.maxX + pad;
  const fy1 = gb.maxY + pad * 1.2;
  pen.pline("A-TTLB", [[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1]], true);
  northArrow(pen, fx1 - pad * 1.3, fy1 - pad * 1.3, span * 0.03, "A-TTLB");
  scaleBar(pen, fx0 + pad * 0.6, fy0 + pad * 0.9, c, W);
  titleBlockFree(pen, fx1, fy0 + pad * 0.4, name, c.unit, span);

  return { minX: fx0 - span * 0.02, minY: fy0 - span * 0.02, maxX: fx1 + span * 0.02, maxY: fy1 + span * 0.02 };
}

/** Right-anchored title block sized to the drawing span. */
function titleBlockFree(pen: Pen, xRight: number, y: number, name: string, unit: string, span: number) {
  const bw = span * 0.42;
  const bh = span * 0.12;
  const x = xRight - bw;
  const th = bh * 0.16;
  pen.pline("A-TTLB", [[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]], true);
  pen.line("A-TTLB", x, y + bh - th * 2.2, x + bw, y + bh - th * 2.2);
  pen.text("A-TTLB", x + th, y + bh - th * 1.4, th * 1.5, name.toUpperCase().slice(0, 48));
  pen.text("A-TTLB", x + th, y + bh * 0.45, th, `DRAWLOGIX (AI)   UNITS: ${unit.toUpperCase()}`);
  pen.text("A-TTLB", x + th, y + bh * 0.18, th, "CONCEPT — NOT FOR CONSTRUCTION");
}

/** AutoCAD-ready R12 DXF for a freeform drawing, with full CAD sheet furniture. */
export function buildFreeformSheetDxf(model: DxfModel, name: string, c: Construction): string {
  const pen = dxfPen();
  const bbox = composeFreeformSheet(pen, model, name, c);
  return pen.finish(name, bbox);
}

/** In-app SVG preview for a freeform drawing sheet. */
export function buildFreeformSheetSvg(model: DxfModel, name: string, c: Construction): string {
  const measure = dxfPen();
  const bbox = composeFreeformSheet(measure, model, name, c);
  const spanX = Math.max(bbox.maxX - bbox.minX, 1);
  const pxPerM = Math.max(0.5, Math.min(30, 1400 / spanX));
  const pen = svgPen(bbox, pxPerM, 10);
  composeFreeformSheet(pen, model, name, c);
  return pen.finish();
}

/** Pick a sensible dimension unit for a freeform drawing from its overall size. */
export function freeformConstruction(model: DxfModel): Construction {
  const b = modelBounds(model);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  return { ...DEFAULT_CONSTRUCTION, unit: span > 60 ? "m" : "mm" };
}

/** Stacking diagram: a mini section showing storeys stacked at floor-to-floor height. */
function stackingDiagram(pen: Pen, x: number, y: number, floors: Floor[], c: Construction) {
  const bw = 6;
  const fh = Math.max(1.8, c.floorToFloorM);
  pen.text("A-ANNO", x, y + floors.length * fh + 1.2, 0.5, "STACKING DIAGRAM");
  for (let i = 0; i < floors.length; i++) {
    const y0 = y + i * fh;
    pen.pline("A-WALL", [[x, y0], [x + bw, y0], [x + bw, y0 + fh], [x, y0 + fh]], true);
    pen.text("A-ANNO", x + 0.3, y0 + fh / 2, 0.34, floors[i].label.replace(/ PLAN$/i, ""));
    pen.text("A-DIMS", x + bw + 0.3, y0 + 0.1, 0.28, `+${(i * c.floorToFloorM).toFixed(2)}`);
    pen.line("A-DIMS", x + bw, y0, x + bw + 0.2, y0);
  }
  pen.line("A-GRID", x, y, x, y + floors.length * fh); // datum
}

/** Title block (bottom-right) with project/title/scale/units/author. */
function titleBlock(pen: Pen, x: number, y: number, projectName: string, subtitle: string, c: Construction) {
  const bw = 16;
  const bh = 4;
  pen.pline("A-TTLB", [[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]], true);
  pen.line("A-TTLB", x, y + bh - 1.2, x + bw, y + bh - 1.2);
  pen.line("A-TTLB", x + bw - 5, y, x + bw - 5, y + bh);
  pen.text("A-TTLB", x + 0.4, y + bh - 0.85, 0.55, projectName.toUpperCase());
  pen.text("A-TTLB", x + 0.4, y + 2.0, 0.34, subtitle);
  pen.text("A-TTLB", x + 0.4, y + 1.3, 0.3, `WALLS: EXT ${c.extWallMm} / INT ${c.intWallMm} mm   UNITS: ${c.unit.toUpperCase()}`);
  pen.text("A-TTLB", x + 0.4, y + 0.6, 0.3, "DRAWN BY: DRAWLOGIX (AI)");
  pen.text("A-TTLB", x + bw - 4.6, y + 2.0, 0.34, "SCALE 1:100");
  pen.text("A-TTLB", x + bw - 4.6, y + 1.3, 0.3, `SHEET: ${c.storeys > 1 ? "FLOOR PLANS" : "FLOOR PLAN"}`);
}

/**
 * Compose a full drawing sheet from one or more solved floors, then render it through a
 * pen. Lays plans left→right, then a stacking diagram, north arrow, scale bar and title
 * block. Returns the sheet's bounding box so the caller can size the output.
 */
function composeSheet(pen: Pen, floors: Floor[], c: Construction, projectName: string): BBox {
  let cursorX = 0;
  const bottom = 3.6; // room below for dimensions
  let maxTop = 0;
  for (const floor of floors) {
    const ox = cursorX + 4.6;
    const oy = bottom;
    const { w, h } = drawFloor(pen, floor, c, ox, oy);
    cursorX += w + 6; // gap between plans
    maxTop = Math.max(maxTop, oy + floor.plan.height + 5.0);
  }
  // Stacking diagram to the right (multi-storey only).
  if (floors.length > 1) {
    stackingDiagram(pen, cursorX, bottom, floors, c);
    cursorX += 10;
  }
  // North arrow + scale bar along the top-left.
  northArrow(pen, 2.0, maxTop + 2.5);
  scaleBar(pen, 6.0, maxTop + 2.0, c);
  // Title block bottom-right.
  const tbX = Math.max(cursorX - 16, 0);
  const subtitle = c.storeys > 1 ? `${c.storeys}-STOREY — ${floors.map((fl) => fl.label.replace(/ FLOOR PLAN/i, "")).join(" · ")}` : "GENERAL ARRANGEMENT";
  titleBlock(pen, tbX, -6, projectName, subtitle, c);

  return { minX: -1, minY: -7, maxX: cursorX + 1, maxY: maxTop + 5 };
}

/** AutoCAD-ready R12 DXF for a set of solved floors. */
export function buildProjectDxf(floors: Floor[], c: Construction, projectName = "DrawLogix Concept"): string {
  const pen = dxfPen();
  const bbox = composeSheet(pen, floors, c, projectName);
  return pen.finish(projectName, bbox);
}

/** In-app SVG preview for the same sheet. */
export function buildProjectSvg(floors: Floor[], c: Construction, projectName = "DrawLogix Concept"): string {
  // Two-pass: compose once against a measuring pen to get the bbox, then render.
  const measure = dxfPen();
  const bbox = composeSheet(measure, floors, c, projectName);
  const spanX = Math.max(bbox.maxX - bbox.minX, 1);
  const pxPerM = Math.max(4, Math.min(30, 1400 / spanX));
  const pen = svgPen(bbox, pxPerM, 10);
  composeSheet(pen, floors, c, projectName);
  return pen.finish();
}

/** Group a flat schedule into per-floor ResolvedPlans (uses `floor`, default 1). */
export function scheduleToFloors(schedule: (ScheduleRow & { floor?: number })[]): Map<number, ScheduleRow[]> {
  const byFloor = new Map<number, ScheduleRow[]>();
  for (const r of schedule) {
    const fl = Math.max(1, Math.round((r as { floor?: number }).floor ?? 1));
    if (!byFloor.has(fl)) byFloor.set(fl, []);
    byFloor.get(fl)?.push(r);
  }
  return byFloor;
}

export const floorLabel = (n: number): string => {
  const names = ["GROUND", "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH", "NINTH", "TENTH"];
  return `${names[n - 1] ?? `LEVEL ${n}`} FLOOR PLAN`;
};

/** Build renderable Floor[] from a flat schedule, solving any bare (geometry-less) rows. */
export function floorsFromSchedule(schedule: ScheduleRow[], footprint?: { widthM: number; lengthM: number }): Floor[] {
  const envelope: Envelope | undefined = footprint
    ? { widthAcross: Math.min(footprint.widthM, footprint.lengthM), lengthAlong: Math.max(footprint.widthM, footprint.lengthM) }
    : undefined;
  const byFloor = scheduleToFloors(schedule);
  const floors: Floor[] = [];
  for (const n of [...byFloor.keys()].sort((a, b) => a - b)) {
    const rows = byFloor.get(n) ?? [];
    const hasGeom = rows.length > 0 && rows.every((r) => typeof r.w === "number" && (r.w as number) > 0);
    const solved = hasGeom
      ? rows
      : solveFloorPlan(rows.map((r) => ({ name: r.room, areaSqm: r.areaSqm, kind: r.kind, requirementRef: r.requirementRef })), envelope);
    if (solved.length === 0) continue;
    floors.push({ label: floorLabel(n), plan: resolvePlan(solved) });
  }
  return floors;
}

// ── Construction persistence (stored as a sentinel in the drawing's traceability) ──
export function encodeConstruction(c: Construction): string {
  return `cfg:${JSON.stringify(c)}`;
}
export function decodeConstruction(trace: string[] | null | undefined): Construction {
  for (const t of trace ?? []) {
    if (typeof t === "string" && t.startsWith("cfg:")) {
      try {
        return { ...DEFAULT_CONSTRUCTION, ...(JSON.parse(t.slice(4)) as Partial<Construction>) };
      } catch {
        /* fall through */
      }
    }
  }
  return DEFAULT_CONSTRUCTION;
}

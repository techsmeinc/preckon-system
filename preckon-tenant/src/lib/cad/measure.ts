// What can honestly be measured off a drawing, and how.
//
// This is the part the agent is only as good as. Everything here is arithmetic
// on the geometry that is actually in the file — no inference about what a line
// "is". A drawing does not record that something is a wall; it records a line
// on a layer a draughtsman named A-WALL, and the difference matters the moment
// a quantity is challenged.
//
// So every figure this produces carries where it came from: which layer, how
// many entities, and by what rule. The agent quotes those back, and the canvas
// draws them. A number an estimator cannot trace is a number they cannot use.

import type { DxfModel, Entity } from "./model";

export interface Pt { x: number; y: number }

/** One closed outline, with the area it encloses. */
export interface Region {
  id: string;
  layer: string;
  area: number;       // drawing units²
  perimeter: number;
  centroid: Pt;
  pts: Pt[];
}

/** A straight run of linework — what a wall or a grid line looks like in a DXF. */
export interface Run {
  id: string;
  layer: string;
  length: number;
  a: Pt;
  b: Pt;
}

export interface LayerFacts {
  layer: string;
  visible: boolean;
  entities: number;
  lines: number;
  polys: number;
  texts: number;
  /** Every segment on the layer, added up. Double-counts a wall drawn as two
   *  faces — which is why it is reported as "linework", never as "wall length". */
  totalLength: number;
  /** Longest single straight run, a better proxy for an overall dimension. */
  longestRun: number;
  closedCount: number;
  largestArea: number;
  /** The sum of every closed outline. Almost never a floor area: overlapping
   *  outlines, hatch boundaries and furniture all land in it. */
  totalArea: number;
}

export interface Digest {
  units: string | null;
  unitsPerMetre: number | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  entityCount: number;
  layers: LayerFacts[];
  /** Biggest closed outlines across the drawing — candidate rooms and slabs. */
  regions: Region[];
  /** Longest straight runs — candidate walls, grids and setting-out lines. */
  runs: Run[];
  texts: Array<{ text: string; n: number }>;
  warnings: string[];
}

const UNIT_M: Record<number, [string, number]> = {
  1: ["in", 39.3701], 2: ["ft", 3.28084], 4: ["mm", 1000], 5: ["cm", 100], 6: ["m", 1],
};

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function segments(e: Entity): Array<[Pt, Pt]> {
  if (e.kind === "line") return [[{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]];
  if (e.kind === "poly") {
    const out: Array<[Pt, Pt]> = [];
    for (let i = 0; i < e.pts.length - 1; i++) out.push([e.pts[i], e.pts[i + 1]]);
    if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1], e.pts[0]]);
    return out;
  }
  return [];
}

/** Shoelace. Sign is dropped — winding order is the draughtsman's business. */
export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function centroidOf(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

/**
 * Read every figure a drawing can support.
 *
 * `insunits` is the only honest source of scale. A drawing that does not
 * declare it is measured in drawing units and said to be — converting on a
 * guess is how a 12 metre wall becomes 12 millimetres in a bill.
 */
export function digest(m: DxfModel, opts: { maxRegions?: number; maxRuns?: number } = {}): Digest {
  const maxRegions = opts.maxRegions ?? 24;
  const maxRuns = opts.maxRuns ?? 24;
  const warnings: string[] = [];

  const unit = UNIT_M[m.insunits];
  if (!unit) warnings.push("This drawing does not declare its units ($INSUNITS is unset), so every figure below is in drawing units, not metres.");

  const hidden = new Set(m.layers.filter((l) => !l.visible).map((l) => l.name));
  const facts = new Map<string, LayerFacts>();
  const blank = (layer: string): LayerFacts => ({
    layer, visible: !hidden.has(layer), entities: 0, lines: 0, polys: 0, texts: 0,
    totalLength: 0, longestRun: 0, closedCount: 0, largestArea: 0, totalArea: 0,
  });

  const regions: Region[] = [];
  const runs: Run[] = [];
  const textCount = new Map<string, number>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (p: Pt) => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  };

  let idc = 0;
  for (const e of m.entities) {
    const f = facts.get(e.layer) ?? blank(e.layer);
    facts.set(e.layer, f);
    f.entities++;

    // A layer that is switched off is not part of the drawing on screen. It is
    // still counted, so "what is on this sheet" stays truthful, but it does not
    // set the extents or win "longest run" — a superseded 99 m setting-out line
    // on a hidden layer would otherwise describe the whole drawing.
    const shown = !hidden.has(e.layer);

    if (e.kind === "text") {
      f.texts++;
      if (shown) grow({ x: e.x, y: e.y });
      const t = e.text.trim();
      if (t) textCount.set(t, (textCount.get(t) ?? 0) + 1);
      continue;
    }

    if (e.kind === "line") f.lines++; else f.polys++;

    let longest = 0;
    for (const [a, b] of segments(e)) {
      const d = dist(a, b);
      f.totalLength += d;
      if (d > longest) longest = d;
      if (d > f.longestRun) f.longestRun = d;
      if (!shown) continue;
      grow(a); grow(b);
      // Straight runs are candidate walls and grids. Only the meaningful ones
      // are kept — a drawing has thousands of two-millimetre segments in its
      // hatching and none of them is a wall.
      if (d > 0) runs.push({ id: `r${++idc}`, layer: e.layer, length: d, a, b });
    }

    if (e.kind === "poly" && e.closed && e.pts.length > 2) {
      const area = polygonArea(e.pts);
      f.closedCount++;
      f.totalArea += area;
      if (area > f.largestArea) f.largestArea = area;
      let per = 0;
      for (const [a, b] of segments(e)) per += dist(a, b);
      if (shown) regions.push({ id: `g${++idc}`, layer: e.layer, area, perimeter: per, centroid: centroidOf(e.pts), pts: e.pts });
    }
  }

  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }

  regions.sort((a, b) => b.area - a.area);
  runs.sort((a, b) => b.length - a.length);

  const layers = [...facts.values()].sort((a, b) => b.entities - a.entities);
  if (layers.some((l) => l.closedCount >= 3 && l.totalArea > l.largestArea * 1.5)) {
    warnings.push("On some layers the closed outlines overlap heavily, so their summed area is much larger than the biggest one. Use the largest outline for a floor area, not the total.");
  }

  return {
    units: unit?.[0] ?? null,
    unitsPerMetre: unit ? unit[1] : null,
    bounds: { minX, minY, maxX, maxY },
    entityCount: m.entities.length,
    layers,
    regions: regions.slice(0, maxRegions),
    runs: runs.slice(0, maxRuns),
    texts: [...textCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([text, n]) => ({ text, n })),
    warnings,
  };
}

/* ── formatting ──────────────────────────────────────────────────────────── */

/** Drawing units to metres, or null when the drawing never said. */
export const toMetres = (v: number, d: Digest) => (d.unitsPerMetre ? v / d.unitsPerMetre : null);

const fmt = (v: number, d: Digest, square = false) => {
  const m = toMetres(v, d);
  if (m == null) return `${v.toFixed(1)} drawing units${square ? "²" : ""}`;
  const val = square ? m / (d.unitsPerMetre ?? 1) : m;   // area divides twice
  return `${val.toFixed(square ? 2 : 3)} ${square ? "m²" : "m"}`;
};

/**
 * The drawing as the agent reads it.
 *
 * Written as prose with the units stated on every figure, because the failure
 * this guards against is the model inventing a unit — and a table of bare
 * numbers is an invitation to do exactly that.
 */
export function describeDigest(d: Digest): string {
  const L: string[] = [];
  L.push(`UNITS: ${d.units ?? "NOT DECLARED — report figures as drawing units and say so"}`);
  const w = d.bounds.maxX - d.bounds.minX, h = d.bounds.maxY - d.bounds.minY;
  L.push(`EXTENTS: ${fmt(w, d)} x ${fmt(h, d)}`);
  L.push(`ENTITIES: ${d.entityCount} across ${d.layers.length} layers`);

  L.push("\nLAYERS (entities · linework total · longest run · closed outlines · largest outline):");
  for (const l of d.layers.slice(0, 40)) {
    L.push(`  ${l.layer}${l.visible ? "" : " [hidden]"} — ${l.entities} · ${fmt(l.totalLength, d)} · ${fmt(l.longestRun, d)} · ${l.closedCount} closed · largest ${fmt(l.largestArea, d, true)}`);
  }

  if (d.regions.length) {
    L.push("\nLARGEST CLOSED OUTLINES (candidate rooms, slabs and hatch boundaries):");
    for (const r of d.regions.slice(0, 12)) {
      L.push(`  ${r.id} on ${r.layer} — ${fmt(r.area, d, true)}, perimeter ${fmt(r.perimeter, d)}, centre (${r.centroid.x.toFixed(0)}, ${r.centroid.y.toFixed(0)})`);
    }
  }

  if (d.runs.length) {
    L.push("\nLONGEST STRAIGHT RUNS (candidate walls, grids and setting-out):");
    for (const r of d.runs.slice(0, 12)) {
      L.push(`  ${r.id} on ${r.layer} — ${fmt(r.length, d)} from (${r.a.x.toFixed(0)}, ${r.a.y.toFixed(0)}) to (${r.b.x.toFixed(0)}, ${r.b.y.toFixed(0)})`);
    }
  }

  if (d.texts.length) {
    L.push("\nTEXT ON THE SHEET (label × times it appears):");
    L.push("  " + d.texts.slice(0, 40).map((t) => `${t.text}${t.n > 1 ? ` ×${t.n}` : ""}`).join(" | "));
  }

  if (d.warnings.length) L.push("\nCAUTION:\n" + d.warnings.map((x) => `  - ${x}`).join("\n"));
  return L.join("\n");
}

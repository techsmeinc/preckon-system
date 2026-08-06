// An isometric view of a flat drawing.
//
// A DXF records no heights. It has lines on layers and closed outlines, and
// nothing anywhere says a wall is three metres tall — so anything three
// dimensional built from one is an ASSUMPTION, and the view says so rather than
// implying the drawing contained it.
//
// What it does with that: outlines lie flat as slabs, linework on layers whose
// names read as walls stands up to an assumed height, everything else stays on
// the ground plane. It is a sense-check — does this read as a building, is that
// courtyard really open — not a model to take quantities from. Quantities come
// from the 2D geometry, which is measured rather than inferred.
//
// Projected rather than rendered: no engine, no lighting, no perspective. A
// rotation and a painter's sort, which is enough to read a plan as a shape and
// costs nothing to ship.

import type { DxfModel, Entity } from "./model";
import { robustBounds } from "./model";

export interface Face {
  /** Screen-space polygon, already projected. */
  pts: Array<{ x: number; y: number }>;
  /** Depth for the painter's sort — larger draws later. */
  depth: number;
  fill: string;
  stroke: string;
  /** Vertical faces read as walls; flat ones as slabs. */
  kind: "wall" | "slab" | "line";
}

export interface IsoOpts {
  /** Rotation about the vertical axis, radians. */
  azimuth: number;
  /** Tilt from plan, radians. 0 is plan, π/2 is elevation. */
  pitch: number;
  /** Assumed wall height, in drawing units. */
  wallHeight: number;
  /** Layer names whose linework should stand up. */
  wallLayers: Set<string>;
}

/** Layer naming is the only clue a DXF gives about what linework is. */
export function guessWallLayers(m: DxfModel): Set<string> {
  const re = /(wall|partition|blockwork|cmu|stud|masonry|جدار)/i;
  return new Set(m.layers.filter((l) => re.test(l.name)).map((l) => l.name));
}

/** A sensible assumed storey height, in the drawing's own units. */
export function assumedHeight(m: DxfModel): number {
  // 3 m, expressed in whatever the drawing counts in. Unitless drawings get a
  // fraction of their own extent, which at least keeps the picture readable.
  switch (m.insunits) {
    case 4: return 3000;    // mm
    case 5: return 300;     // cm
    case 6: return 3;       // m
    case 1: return 118;     // in
    case 2: return 9.84;    // ft
    default: {
      const b = robustBounds(m);
      return Math.max(b.maxX - b.minX, b.maxY - b.minY, 1) * 0.03;
    }
  }
}

/** World (x, y, z) to an unscaled 2D point. */
function project(x: number, y: number, z: number, o: IsoOpts) {
  const ca = Math.cos(o.azimuth), sa = Math.sin(o.azimuth);
  const rx = x * ca - y * sa;
  const ry = x * sa + y * ca;
  const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
  return { x: rx, y: ry * cp - z * sp, depth: ry * sp + z * cp };
}

const ACI: Record<number, string> = {
  1: "#ff5555", 2: "#ffff55", 3: "#55ff55", 4: "#55ffff", 5: "#6f8cff",
  6: "#ff77ff", 7: "#e8e8e8", 8: "#8a8a8a", 9: "#c0c0c0", 30: "#ff9f40",
};

/** Darken a hex by a factor — the cheapest way to read one face from another. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function segments(e: Entity): Array<[number, number, number, number]> {
  if (e.kind === "line") return [[e.x1, e.y1, e.x2, e.y2]];
  if (e.kind === "poly") {
    const out: Array<[number, number, number, number]> = [];
    for (let i = 0; i < e.pts.length - 1; i++) out.push([e.pts[i].x, e.pts[i].y, e.pts[i + 1].x, e.pts[i + 1].y]);
    if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1].x, e.pts[e.pts.length - 1].y, e.pts[0].x, e.pts[0].y]);
    return out;
  }
  return [];
}

/**
 * Build the faces for one drawing.
 *
 * Capped: a sheet with sixty thousand entities would produce a quarter of a
 * million faces and a frame that never finishes. The longest linework is kept,
 * because that is what carries the shape of the building — the rest is
 * hatching, furniture and annotation that adds nothing at this size.
 */
export function buildFaces(m: DxfModel, o: IsoOpts, maxFaces = 6000): { faces: Face[]; truncated: boolean } {
  const hidden = new Set(m.layers.filter((l) => !l.visible).map((l) => l.name));
  const aciOf = (layer: string) => m.layers.find((l) => l.name === layer)?.aci ?? 7;

  const walls: Array<{ seg: [number, number, number, number]; layer: string; len: number }> = [];
  const slabs: Array<{ e: Extract<Entity, { kind: "poly" }>; area: number }> = [];
  const ground: Array<{ seg: [number, number, number, number]; layer: string; len: number }> = [];

  for (const e of m.entities) {
    if (e.kind === "text" || hidden.has(e.layer)) continue;
    if (e.kind === "poly" && e.closed && e.pts.length > 2) {
      let a = 0;
      for (let i = 0; i < e.pts.length; i++) {
        const j = (i + 1) % e.pts.length;
        a += e.pts[i].x * e.pts[j].y - e.pts[j].x * e.pts[i].y;
      }
      slabs.push({ e, area: Math.abs(a) / 2 });
    }
    const standing = o.wallLayers.has(e.layer);
    for (const seg of segments(e)) {
      const len = Math.hypot(seg[2] - seg[0], seg[3] - seg[1]);
      if (len <= 0) continue;
      (standing ? walls : ground).push({ seg, layer: e.layer, len });
    }
  }

  walls.sort((a, b) => b.len - a.len);
  ground.sort((a, b) => b.len - a.len);
  slabs.sort((a, b) => b.area - a.area);

  const faces: Face[] = [];
  const budget = { wall: Math.floor(maxFaces * 0.55), slab: Math.floor(maxFaces * 0.1), line: Math.floor(maxFaces * 0.35) };
  const truncated = walls.length > budget.wall || ground.length > budget.line;

  // Slabs first: they are the ground the rest stands on.
  for (const { e } of slabs.slice(0, budget.slab)) {
    const base = ACI[aciOf(e.layer)] ?? "#8a8a8a";
    const pts = e.pts.map((p) => project(p.x, p.y, 0, o));
    faces.push({
      pts: pts.map((p) => ({ x: p.x, y: p.y })),
      depth: Math.min(...pts.map((p) => p.depth)) - 1e6,   // always underneath
      fill: shade(base, 0.22),
      stroke: shade(base, 0.5),
      kind: "slab",
    });
  }

  for (const { seg, layer } of walls.slice(0, budget.wall)) {
    const [x1, y1, x2, y2] = seg;
    const base = ACI[aciOf(layer)] ?? "#e8e8e8";
    const a = project(x1, y1, 0, o), b = project(x2, y2, 0, o);
    const c = project(x2, y2, o.wallHeight, o), d = project(x1, y1, o.wallHeight, o);
    // Faces pointing away from the viewer are drawn darker, which is enough
    // shading to read a corner without a lighting model.
    const facing = (x2 - x1) * 0 + (y2 - y1);
    faces.push({
      pts: [a, b, c, d].map((p) => ({ x: p.x, y: p.y })),
      depth: (a.depth + b.depth) / 2,
      fill: shade(base, facing >= 0 ? 0.5 : 0.34),
      stroke: shade(base, 0.75),
      kind: "wall",
    });
  }

  for (const { seg, layer } of ground.slice(0, budget.line)) {
    const [x1, y1, x2, y2] = seg;
    const a = project(x1, y1, 0, o), b = project(x2, y2, 0, o);
    faces.push({
      pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
      depth: (a.depth + b.depth) / 2 - 5e5,   // under the walls, over the slabs
      fill: "transparent",
      stroke: shade(ACI[aciOf(layer)] ?? "#8a8a8a", 0.55),
      kind: "line",
    });
  }

  // Painter's algorithm: far things first. With no depth buffer this is what
  // makes a near wall hide the one behind it.
  faces.sort((p, q) => p.depth - q.depth);
  return { faces, truncated };
}

/** Screen extents of a set of projected faces, for fitting the view. */
export function faceBounds(faces: Face[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of faces) {
    for (const p of f.pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

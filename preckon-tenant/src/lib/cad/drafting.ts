// 2D drafting geometry: offset, mirror, array, fillet, trim, extend.
//
// The commands every draughtsman reaches for without thinking, and the reason a
// drawing tool either gets used or gets exported out of. `tools.ts` can draw a
// line and delete a region; it cannot offset a wall by 100mm, which is the
// single most-used command in any CAD package.
//
// ── WHY THIS IS A SEPARATE, PURE MODULE ──────────────────────────────────────
//
// All of it is geometry, and geometry is where the subtle errors live. An
// offset that goes the wrong way, a fillet whose arc is tangent to nothing, a
// polar array that rotates the objects but does not move them — each produces
// output that renders, looks approximately right, and is wrong. None of those
// are caught by a UI test.
//
// So the arithmetic is here, pure and checkable against numbers worked out by
// hand, and tools.ts stays a thin layer that turns an intent into these calls.
//
// ── THE CONVENTIONS THAT ARE EASY TO INVERT ──────────────────────────────────
//
// Offset side. A positive distance offsets to the LEFT of the direction of
// travel, which is the mathematical convention (rotate the direction vector by
// +90°). Getting this backwards is invisible on a symmetric shape and wrong on
// every other one.
//
// Arc direction on a fillet. The arc must be tangent to both lines and lie
// INSIDE the corner. An arc on the outside is tangent too, and looks like a
// mistake nobody made on purpose.
//
// Angles are radians internally and degrees at the boundary, because every
// draughtsman thinks in degrees and every trig function does not.

export interface Pt { x: number; y: number }

/** Segments are the unit everything here works in. */
export interface Seg { a: Pt; b: Pt }

const EPS = 1e-9;

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k });
const len = (p: Pt): number => Math.hypot(p.x, p.y);
const cross = (p: Pt, q: Pt): number => p.x * q.y - p.y * q.x;
const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y;

/** Unit vector, or null for a zero-length input rather than NaN. */
export function unit(p: Pt): Pt | null {
  const l = len(p);
  return l < EPS ? null : { x: p.x / l, y: p.y / l };
}

/** Rotate 90° anticlockwise — the "left" of a direction of travel. */
const perp = (p: Pt): Pt => ({ x: -p.y, y: p.x });

export const deg = (radians: number) => (radians * 180) / Math.PI;
export const rad = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Round to a sane drawing precision so hand-checkable tests stay checkable.
 *
 * The `+ 0` is not decoration: rounding a tiny negative gives -0, which prints
 * as "-0" in an exported DXF and shows up as a spurious change in every
 * revision diff of a drawing nobody edited. Trigonometry produces these
 * constantly — a 270° rotation of a point on the x-axis lands on exactly -0.
 */
const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const pt = (p: Pt): Pt => ({ x: r6(p.x), y: r6(p.y) });

/* ────────────────────────────────────────────────────────────────────────────
   Offset
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Offset a single segment.
 *
 * Positive distance goes to the LEFT of a→b. Returns null for a degenerate
 * segment rather than a NaN-filled one — a zero-length line has no direction
 * and therefore no side to offset towards.
 */
export function offsetSegment(s: Seg, distance: number): Seg | null {
  const d = unit(sub(s.b, s.a));
  if (!d) return null;
  const n = mul(perp(d), distance);
  return { a: pt(add(s.a, n)), b: pt(add(s.b, n)) };
}

/**
 * Offset a polyline, mitring the joints.
 *
 * The naive version offsets each segment independently and leaves gaps at every
 * convex corner and overlaps at every concave one. Mitring intersects the
 * offset lines instead, which is what makes an offset wall look like a wall.
 *
 * Where two segments are nearly parallel the mitre point runs to infinity, so
 * the joint falls back to the offset endpoint. An unbounded spike is worse than
 * a slightly blunt corner.
 */
export function offsetPolyline(pts: Pt[], distance: number, closed = false): Pt[] {
  if (pts.length < 2) return [];

  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1] });
  if (closed && pts.length > 2) segs.push({ a: pts[pts.length - 1], b: pts[0] });

  const offs = segs.map((s) => offsetSegment(s, distance)).filter((s): s is Seg => s != null);
  if (!offs.length) return [];

  const out: Pt[] = [];
  if (!closed) out.push(offs[0].a);

  for (let i = 0; i < offs.length - (closed ? 0 : 1); i++) {
    const cur = offs[i];
    const next = offs[(i + 1) % offs.length];
    const x = intersectLines(cur, next);
    out.push(x ? pt(x) : pt(cur.b));
  }

  if (!closed) out.push(offs[offs.length - 1].b);
  else {
    // A closed offset starts at the joint between the last and first segments,
    // so the point list has to be rotated to line up with the input.
    out.unshift(out.pop()!);
  }
  return out;
}

/**
 * Where two infinite lines through these segments meet.
 *
 * Infinite, not the segments themselves — mitring and extending both need the
 * intersection beyond the drawn ends. Parallel lines return null.
 */
export function intersectLines(p: Seg, q: Seg): Pt | null {
  const r = sub(p.b, p.a);
  const s = sub(q.b, q.a);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(q.a, p.a), s) / denom;
  return pt(add(p.a, mul(r, t)));
}

/** Where two segments actually cross, within both their extents. */
export function intersectSegments(p: Seg, q: Seg): Pt | null {
  const r = sub(p.b, p.a);
  const s = sub(q.b, q.a);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(q.a, p.a), s) / denom;
  const u = cross(sub(q.a, p.a), r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return pt(add(p.a, mul(r, t)));
}

/* ────────────────────────────────────────────────────────────────────────────
   Mirror, rotate, scale
   ──────────────────────────────────────────────────────────────────────────── */

/** Reflect a point across the infinite line through the axis segment. */
export function mirrorPoint(p: Pt, axis: Seg): Pt {
  const d = unit(sub(axis.b, axis.a));
  if (!d) return pt(p);
  const v = sub(p, axis.a);
  // Component along the axis stays; the perpendicular component flips.
  const along = mul(d, dot(v, d));
  const away = sub(v, along);
  return pt(add(axis.a, sub(along, away)));
}

export const mirrorPoints = (pts: Pt[], axis: Seg): Pt[] => pts.map((p) => mirrorPoint(p, axis));

export function rotatePoint(p: Pt, centre: Pt, degrees: number): Pt {
  const a = rad(degrees);
  const c = Math.cos(a), s = Math.sin(a);
  const v = sub(p, centre);
  return pt({ x: centre.x + v.x * c - v.y * s, y: centre.y + v.x * s + v.y * c });
}

export const rotatePoints = (pts: Pt[], centre: Pt, degrees: number): Pt[] =>
  pts.map((p) => rotatePoint(p, centre, degrees));

export function scalePoint(p: Pt, centre: Pt, factor: number): Pt {
  return pt(add(centre, mul(sub(p, centre), factor)));
}

export const scalePoints = (pts: Pt[], centre: Pt, factor: number): Pt[] =>
  pts.map((p) => scalePoint(p, centre, factor));

/* ────────────────────────────────────────────────────────────────────────────
   Arrays
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Rectangular array.
 *
 * Counts INCLUDE the original, which is the CAD convention: a 3×2 array of a
 * column produces six columns, not seven. Off-by-one here means an extra bay
 * on every gridline.
 */
export function rectangularArray(
  pts: Pt[], opts: { cols: number; rows: number; dx: number; dy: number },
): Pt[][] {
  const cols = Math.max(1, Math.floor(opts.cols));
  const rows = Math.max(1, Math.floor(opts.rows));
  const out: Pt[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(pts.map((p) => pt({ x: p.x + c * opts.dx, y: p.y + r * opts.dy })));
    }
  }
  return out;
}

/**
 * Polar array.
 *
 * `rotateItems` defaults true, which is what a draughtsman means by a polar
 * array: bolts round a flange point outwards. With it false the copies are
 * moved around the circle but keep their original orientation, which is what
 * you want for text and for symbols that must stay upright.
 *
 * For a full 360° sweep the step is 360/count, because the last copy would
 * otherwise land on top of the first.
 */
export function polarArray(
  pts: Pt[],
  opts: { centre: Pt; count: number; totalAngleDeg?: number; rotateItems?: boolean },
): Pt[][] {
  const count = Math.max(1, Math.floor(opts.count));
  const total = opts.totalAngleDeg ?? 360;
  const full = Math.abs(Math.abs(total) - 360) < EPS;
  // A full circle divides by count; a partial sweep divides by the gaps
  // between copies, so the last one lands exactly on the stated angle.
  const step = count === 1 ? 0 : total / (full ? count : count - 1);
  const rotateItems = opts.rotateItems !== false;

  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const angle = step * i;
    out.push(pts.map((p) => {
      const moved = rotatePoint(p, opts.centre, angle);
      if (rotateItems) return moved;
      /* Keep the original orientation: place the item's own reference point on
         the rotated position, then undo the rotation about that point. */
      const anchor = rotatePoint(pts[0], opts.centre, angle);
      return pt(add(anchor, sub(p, pts[0])));
    }));
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   Fillet and chamfer
   ──────────────────────────────────────────────────────────────────────────── */

export interface Fillet {
  /** Trimmed first segment, ending at the arc. */
  first: Seg;
  /** Trimmed second segment, starting at the arc. */
  second: Seg;
  /** Arc approximated as a polyline, tangent to both. */
  arc: Pt[];
  centre: Pt;
  radius: number;
}

/**
 * Round the corner between two segments meeting at a common point.
 *
 * The arc must be tangent to both lines AND inside the corner. Placing the
 * centre on the angle bisector, at distance r/sin(θ/2) from the vertex, is what
 * guarantees both — an arc merely tangent to both lines can sit outside the
 * corner and looks like a mistake nobody made deliberately.
 *
 * Returns null where the radius will not fit, rather than producing an arc that
 * overruns the segments it is supposed to join. A fillet longer than its own
 * legs is geometrically valid and visually nonsense.
 */
export function fillet(first: Seg, second: Seg, radius: number, arcSegments = 8): Fillet | null {
  if (radius <= 0) return null;

  // The corner is wherever the two share an endpoint.
  const vertex = sharedPoint(first, second);
  if (!vertex) return null;

  const d1 = unit(sub(otherEnd(first, vertex), vertex));
  const d2 = unit(sub(otherEnd(second, vertex), vertex));
  if (!d1 || !d2) return null;

  const cosTheta = Math.max(-1, Math.min(1, dot(d1, d2)));
  const theta = Math.acos(cosTheta);
  // Collinear either way: nothing to round.
  if (theta < EPS || Math.abs(theta - Math.PI) < EPS) return null;

  // Distance from the vertex to each tangent point.
  const tangentDist = radius / Math.tan(theta / 2);
  const leg1 = len(sub(otherEnd(first, vertex), vertex));
  const leg2 = len(sub(otherEnd(second, vertex), vertex));
  if (tangentDist > leg1 - EPS || tangentDist > leg2 - EPS) return null;

  const t1 = add(vertex, mul(d1, tangentDist));
  const t2 = add(vertex, mul(d2, tangentDist));

  // Centre on the bisector, inside the corner by construction.
  const bisector = unit(add(d1, d2));
  if (!bisector) return null;
  const centre = add(vertex, mul(bisector, radius / Math.sin(theta / 2)));

  // Sweep from t1 to t2 the short way round — the long way is the same arc
  // going outside the corner.
  const a1 = Math.atan2(t1.y - centre.y, t1.x - centre.x);
  const a2 = Math.atan2(t2.y - centre.y, t2.x - centre.x);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const arc: Pt[] = [];
  const n = Math.max(2, Math.floor(arcSegments));
  for (let i = 0; i <= n; i++) {
    const a = a1 + (sweep * i) / n;
    arc.push(pt({ x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) }));
  }

  return {
    first: { a: pt(otherEnd(first, vertex)), b: pt(t1) },
    second: { a: pt(t2), b: pt(otherEnd(second, vertex)) },
    arc,
    centre: pt(centre),
    radius,
  };
}

/** Straight-cut corner. Same fit rules as a fillet, simpler arithmetic. */
export function chamfer(
  first: Seg, second: Seg, d1Len: number, d2Len = d1Len,
): { first: Seg; second: Seg; cut: Seg } | null {
  const vertex = sharedPoint(first, second);
  if (!vertex || d1Len <= 0 || d2Len <= 0) return null;

  const e1 = otherEnd(first, vertex);
  const e2 = otherEnd(second, vertex);
  const d1 = unit(sub(e1, vertex));
  const d2 = unit(sub(e2, vertex));
  if (!d1 || !d2) return null;
  if (d1Len > len(sub(e1, vertex)) - EPS || d2Len > len(sub(e2, vertex)) - EPS) return null;

  const p1 = add(vertex, mul(d1, d1Len));
  const p2 = add(vertex, mul(d2, d2Len));
  return {
    first: { a: pt(e1), b: pt(p1) },
    second: { a: pt(p2), b: pt(e2) },
    cut: { a: pt(p1), b: pt(p2) },
  };
}

const samePt = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;

function sharedPoint(s1: Seg, s2: Seg): Pt | null {
  for (const p of [s1.a, s1.b]) for (const q of [s2.a, s2.b]) if (samePt(p, q)) return p;
  return null;
}

const otherEnd = (s: Seg, p: Pt): Pt => (samePt(s.a, p) ? s.b : s.a);

/* ────────────────────────────────────────────────────────────────────────────
   Trim and extend
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Extend a segment until it meets a boundary.
 *
 * Only forwards, from the end nearer the boundary. A command that could extend
 * either way silently doubles the length of a line half the time, and the
 * draughtsman finds out at the next print.
 */
export function extendToBoundary(s: Seg, boundary: Seg): Seg | null {
  const x = intersectLines(s, boundary);
  if (!x) return null;

  // The intersection has to lie ON the boundary segment, or the line is being
  // extended to meet something that is not there.
  const onBoundary = paramOn(boundary, x);
  if (onBoundary < -EPS || onBoundary > 1 + EPS) return null;

  const t = paramOn(s, x);
  if (t > 1 + EPS) return { a: pt(s.a), b: pt(x) };   // beyond b: extend b
  if (t < -EPS) return { a: pt(x), b: pt(s.b) };      // before a: extend a
  return null;                                        // already crosses it
}

/**
 * Trim a segment at a boundary, keeping the side the pick point is on.
 *
 * The pick point is what makes trim usable: "cut this line at that wall" is
 * ambiguous about which piece survives, and every CAD package resolves it by
 * asking where you clicked.
 */
export function trimAtBoundary(s: Seg, boundary: Seg, keepNear: Pt): Seg | null {
  const x = intersectSegments(s, boundary);
  if (!x) return null;

  const first: Seg = { a: pt(s.a), b: pt(x) };
  const second: Seg = { a: pt(x), b: pt(s.b) };
  if (len(sub(first.a, first.b)) < EPS || len(sub(second.a, second.b)) < EPS) return null;

  return distanceToSegment(keepNear, first) <= distanceToSegment(keepNear, second) ? first : second;
}

/** Where a point falls along a segment, 0 at a and 1 at b. */
function paramOn(s: Seg, p: Pt): number {
  const d = sub(s.b, s.a);
  const l2 = dot(d, d);
  return l2 < EPS ? 0 : dot(sub(p, s.a), d) / l2;
}

export function distanceToSegment(p: Pt, s: Seg): number {
  const t = Math.max(0, Math.min(1, paramOn(s, p)));
  return len(sub(p, add(s.a, mul(sub(s.b, s.a), t))));
}

/* ────────────────────────────────────────────────────────────────────────────
   Setting out
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Points dividing a segment into equal parts.
 *
 * Interior points only: dividing into 4 gives 3 points, not 5. The endpoints
 * already exist, and adding them produces duplicate nodes that snap oddly and
 * export as zero-length segments.
 */
export function divideSegment(s: Seg, parts: number): Pt[] {
  const n = Math.floor(parts);
  if (n < 2) return [];
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    out.push(pt(add(s.a, mul(sub(s.b, s.a), i / n))));
  }
  return out;
}

/** Points at a fixed spacing from a, leaving any remainder at the far end. */
export function measureAlong(s: Seg, spacing: number): Pt[] {
  if (spacing <= 0) return [];
  const d = sub(s.b, s.a);
  const total = len(d);
  const u = unit(d);
  if (!u || total < spacing) return [];
  const out: Pt[] = [];
  for (let dist = spacing; dist <= total - EPS; dist += spacing) {
    out.push(pt(add(s.a, mul(u, dist))));
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   Dimensions
   ──────────────────────────────────────────────────────────────────────────── */

export interface LinearDimension {
  /** Extension lines from the measured points out to the dimension line. */
  extensions: Seg[];
  /** The dimension line itself. */
  line: Seg;
  /** Tick marks at each end. */
  ticks: Seg[];
  /** Where the text sits, and what it reads. */
  textAt: Pt;
  text: string;
  /** Measured distance in drawing units. */
  value: number;
}

/**
 * Build a linear dimension between two points.
 *
 * `offset` places the dimension line to the left of a→b, matching the offset
 * convention above, so "offset 500" behaves the same way everywhere.
 *
 * The text reads the measured distance to the stated precision. It is never
 * user-supplied: a dimension whose text disagrees with its own geometry is the
 * single worst thing on a drawing, and the only way to guarantee they agree is
 * to refuse to let anyone type it.
 */
export function linearDimension(
  a: Pt, b: Pt, opts: { offset?: number; precision?: number; tickLength?: number; unitSuffix?: string } = {},
): LinearDimension | null {
  const d = unit(sub(b, a));
  if (!d) return null;

  const offset = opts.offset ?? 0;
  const n = mul(perp(d), offset);
  const a2 = add(a, n);
  const b2 = add(b, n);
  const value = len(sub(b, a));
  const precision = opts.precision ?? 0;
  const tick = opts.tickLength ?? Math.max(1, Math.abs(offset) * 0.08);

  // 45° ticks, the architectural convention, rather than arrowheads.
  const tickDir = unit(add(d, perp(d)))!;
  const half = mul(tickDir, tick / 2);

  return {
    extensions: [
      { a: pt(a), b: pt(a2) },
      { a: pt(b), b: pt(b2) },
    ],
    line: { a: pt(a2), b: pt(b2) },
    ticks: [
      { a: pt(sub(a2, half)), b: pt(add(a2, half)) },
      { a: pt(sub(b2, half)), b: pt(add(b2, half)) },
    ],
    textAt: pt(mul(add(a2, b2), 0.5)),
    text: `${value.toFixed(precision)}${opts.unitSuffix ?? ""}`,
    value: r6(value),
  };
}

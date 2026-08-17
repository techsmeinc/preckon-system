/**
 * What changed between two revisions of a drawing.
 *
 * The precondition for everything downstream. "Architect revises A-307" is only
 * actionable if the system can say WHICH lines moved and WHICH dimension text
 * changed — a revision cloud on a title block tells you a sheet changed, not
 * what it changed, and a quantity cannot be marked stale on that.
 *
 * ── WHY THIS CANNOT MATCH BY ID ──────────────────────────────────────────────
 *
 * Entity ids here are session-local: assigned on load, ignored by the
 * serializer. Two revisions of the same sheet therefore share no ids at all, and
 * an id-based diff would report every entity as both removed and added. Matching
 * has to be by CONTENT.
 *
 * ── THE FOUR OUTCOMES, IN THE ORDER THEY ARE DECIDED ─────────────────────────
 *
 *   1. unchanged     same thing, same place
 *   2. text changed  same place, same layer, different words
 *   3. moved         same shape, different place
 *   4. added/removed everything left over
 *
 * The order is the design. Decided naively, a dimension whose text goes from
 * 5100 to 5200 reports as one deletion and one addition — which is true and
 * useless, because the thing an estimator needs to know is that a dimension
 * CHANGED and by how much. Text-in-place is therefore matched before anything
 * else can claim those entities, and movement before add/remove, so the diff
 * describes edits rather than churn.
 *
 * Pure and dependency-free, like the rest of lib/cad.
 */

import type { DxfModel, Entity } from "./model";
import { modelBounds } from "./model";

export interface MovedEntity {
  before: Entity;
  after: Entity;
  dx: number;
  dy: number;
  distance: number;
}

export interface TextChange {
  layer: string;
  before: string;
  after: string;
  at: { x: number; y: number };
  /** Both readable as numbers — a dimension, a level, a room number. */
  delta: number | null;
}

export interface RevisionDiff {
  added: Entity[];
  removed: Entity[];
  moved: MovedEntity[];
  textChanged: TextChange[];
  unchanged: number;
  byLayer: { layer: string; added: number; removed: number; moved: number; textChanged: number }[];
  /** Layers present in one revision and not the other. */
  layersAdded: string[];
  layersRemoved: string[];
  tolerance: number;
  summary: string;
}

/**
 * How close two coordinates must be to count as the same point.
 *
 * Derived from the sheet rather than fixed, because these coordinates might be
 * millimetres or metres and a constant would be either meaningless on one or
 * brutal on the other. A hundred-thousandth of the drawing's span is well below
 * anything a person drew deliberately and well above floating-point noise from
 * a round trip through DXF.
 */
export function toleranceFor(m: DxfModel): number {
  const b = modelBounds(m);
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  return Number.isFinite(span) && span > 0 ? Math.max(span / 1e5, 1e-6) : 1e-6;
}

const snap = (n: number, tol: number): number => Math.round(n / tol);

/** Every entity's points, in a stable order. */
function pointsOf(e: Entity): { x: number; y: number }[] {
  if (e.kind === "line") return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.kind === "poly") return e.pts;
  return [{ x: e.x, y: e.y }];
}

/** Where the entity sits, for reporting. */
function anchorOf(e: Entity): { x: number; y: number } {
  const p = pointsOf(e);
  return p[0] ?? { x: 0, y: 0 };
}

/**
 * Same thing, same place — including its text.
 *
 * A line's endpoints are sorted so that a segment redrawn in the opposite
 * direction is not reported as a change. Nothing on the sheet reads differently
 * for having been drawn right-to-left, and a CAD round trip flips them freely.
 */
function identityKey(e: Entity, tol: number): string {
  const pts = pointsOf(e)
    .map((p) => `${snap(p.x, tol)},${snap(p.y, tol)}`)
    .sort()
    .join(" ");
  const text = e.kind === "text" ? `|${e.text.trim()}` : "";
  return `${e.kind}|${e.layer}|${pts}${text}`;
}

/** Same place and layer, whatever the words — for spotting an edited label. */
function positionKey(e: Entity, tol: number): string {
  const p = anchorOf(e);
  return `${e.kind}|${e.layer}|${snap(p.x, tol)},${snap(p.y, tol)}`;
}

/**
 * Same shape, wherever it is.
 *
 * Position removed, size kept: a 5 m wall moved 300 mm is the same wall, a 5 m
 * wall that became 6 m is not. Built from the offsets between points so the
 * signature travels with the geometry.
 */
function shapeKey(e: Entity, tol: number): string {
  const pts = pointsOf(e);
  const [o] = pts;
  const rel = pts
    .map((p) => `${snap(p.x - o.x, tol)},${snap(p.y - o.y, tol)}`)
    .join(" ");
  const text = e.kind === "text" ? `|${e.text.trim()}` : "";
  return `${e.kind}|${e.layer}|${rel}${text}`;
}

/** Bucket entities by a key, keeping duplicates — a sheet is full of them. */
function bucket(entities: Entity[], key: (e: Entity) => string): Map<string, Entity[]> {
  const m = new Map<string, Entity[]>();
  for (const e of entities) {
    const k = key(e);
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  }
  return m;
}

/** Numeric reading of a label, so a dimension change can be quantified. */
function asNumber(s: string): number | null {
  // Handles "5100", "5,100", "5100 mm", "Ø25". Anything else is prose.
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare two revisions.
 *
 * `before` and `after` are whole drawings, not deltas — that is what the editor
 * has and what a file gives you.
 */
export function compareRevisions(before: DxfModel, after: DxfModel): RevisionDiff {
  // One tolerance for both, from the larger sheet: two different tolerances
  // would snap the same coordinate to two different buckets and report changes
  // that are only rounding.
  const tol = Math.max(toleranceFor(before), toleranceFor(after));

  const remainingA: Entity[] = [];
  const remainingB: Entity[] = [];
  let unchanged = 0;

  // ── 1. Identical, in place ──
  const aById = bucket(before.entities, (e) => identityKey(e, tol));
  const bById = bucket(after.entities, (e) => identityKey(e, tol));

  for (const [k, a] of aById) {
    const b = bById.get(k) ?? [];
    const same = Math.min(a.length, b.length);
    unchanged += same;
    remainingA.push(...a.slice(same));
    if (b.length > same) remainingB.push(...b.slice(same));
    bById.delete(k);
  }
  for (const [, b] of bById) remainingB.push(...b);

  // ── 2. Text edited where it stands ──
  const textChanged: TextChange[] = [];
  const stillA: Entity[] = [];
  const bByPos = bucket(
    remainingB.filter((e) => e.kind === "text"),
    (e) => positionKey(e, tol),
  );
  const claimedB = new Set<Entity>();

  for (const a of remainingA) {
    if (a.kind !== "text") {
      stillA.push(a);
      continue;
    }
    const candidates = (bByPos.get(positionKey(a, tol)) ?? []).filter((b) => !claimedB.has(b));
    const b = candidates[0];
    if (!b || b.kind !== "text") {
      stillA.push(a);
      continue;
    }
    claimedB.add(b);
    const from = asNumber(a.text);
    const to = asNumber(b.text);
    textChanged.push({
      layer: a.layer,
      before: a.text,
      after: b.text,
      at: anchorOf(b),
      delta: from !== null && to !== null ? Number((to - from).toFixed(6)) : null,
    });
  }
  const stillB = remainingB.filter((e) => !claimedB.has(e));

  // ── 3. Same shape, moved ──
  const moved: MovedEntity[] = [];
  const bByShape = bucket(stillB, (e) => shapeKey(e, tol));
  const takenB = new Set<Entity>();
  const removed: Entity[] = [];

  for (const a of stillA) {
    const candidates = (bByShape.get(shapeKey(a, tol)) ?? []).filter((b) => !takenB.has(b));
    if (!candidates.length) {
      removed.push(a);
      continue;
    }
    // Nearest first: with several identical shapes, pairing each to the closest
    // gives the smallest, most believable set of movements.
    const from = anchorOf(a);
    const away = (e: Entity) => {
      const p = anchorOf(e);
      return Math.hypot(p.x - from.x, p.y - from.y);
    };
    candidates.sort((x, y) => away(x) - away(y));
    const b = candidates[0];
    takenB.add(b);
    const to = anchorOf(b);
    const dx = Number((to.x - from.x).toFixed(6));
    const dy = Number((to.y - from.y).toFixed(6));
    moved.push({ before: a, after: b, dx, dy, distance: Number(Math.hypot(dx, dy).toFixed(6)) });
  }

  // ── 4. Whatever is left ──
  const added = stillB.filter((e) => !takenB.has(e));

  // ── Reporting ──
  const layers = new Set<string>([
    ...added.map((e) => e.layer),
    ...removed.map((e) => e.layer),
    ...moved.map((m) => m.after.layer),
    ...textChanged.map((t) => t.layer),
  ]);
  const byLayer = [...layers]
    .map((layer) => ({
      layer,
      added: added.filter((e) => e.layer === layer).length,
      removed: removed.filter((e) => e.layer === layer).length,
      moved: moved.filter((m) => m.after.layer === layer).length,
      textChanged: textChanged.filter((t) => t.layer === layer).length,
    }))
    .sort((a, b) => b.added + b.removed + b.moved + b.textChanged - (a.added + a.removed + a.moved + a.textChanged));

  const namesA = new Set(before.layers.map((l) => l.name));
  const namesB = new Set(after.layers.map((l) => l.name));

  const parts = [
    added.length && `${added.length} added`,
    removed.length && `${removed.length} removed`,
    moved.length && `${moved.length} moved`,
    textChanged.length && `${textChanged.length} text changed`,
  ].filter(Boolean);

  return {
    added,
    removed,
    moved,
    textChanged,
    unchanged,
    byLayer,
    layersAdded: [...namesB].filter((n) => !namesA.has(n)),
    layersRemoved: [...namesA].filter((n) => !namesB.has(n)),
    tolerance: tol,
    summary: parts.length ? parts.join(", ") : "no geometric change",
  };
}

/**
 * Does this revision touch anything a quantity was measured from?
 *
 * The bridge to the rest of the chain. A measurement records the layers it read;
 * if a revision changed one of them, everything derived from it is suspect and
 * should be marked stale rather than silently recalculated — which is the
 * existing propose-then-apply discipline, applied to propagation.
 */
export function affectedLayers(diff: RevisionDiff): string[] {
  return diff.byLayer
    .filter((l) => l.added + l.removed + l.moved + l.textChanged > 0)
    .map((l) => l.layer);
}

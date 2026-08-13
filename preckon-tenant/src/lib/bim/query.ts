/**
 * BIM — the selector engine.
 *
 * Every ArchiLabs demo follows the same shape: a read tool first, then an action
 * tool. `list_rooms_in_active_view` → `tag_specific_elements`. The agent never
 * receives the whole model; it asks for the part it needs.
 *
 * This is that read half, as pure functions over BimDocument. A Selector is
 * DATA, not a predicate function, for two reasons: the agent emits it as JSON,
 * and a user-authored tool can store one (see registry.ts) without us ever
 * evaluating user-supplied code.
 *
 * Pure and dependency-free, like model.ts. Keep it that way.
 */

import { type BimDocument, type Discipline, type Element, type Id, type ParamValue, linLength, list } from "./model";

// ── Selector ─────────────────────────────────────────────────────────────────

/** How a param/name value is compared. Deliberately small — these are the ones estimators actually reach for. */
export type Op = "eq" | "ne" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "exists" | "missing";

export interface ParamTest {
  key: string;
  op: Op;
  value?: ParamValue;
}

export interface Selector {
  /** Match these categories (any of). */
  category?: string | string[];
  discipline?: Discipline | Discipline[];
  level?: Id | Id[];
  /** Match on element.name. */
  name?: { op: Op; value?: string };
  /** All must pass. */
  params?: ParamTest[];
  /** Axis-aligned bounds in metres; an element matches if any of its points fall inside. */
  within?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Explicit ids — when the agent already knows exactly what it wants. */
  ids?: Id[];
  /** Elements hosted on these ids (doors/windows on a wall). */
  hostedOn?: Id[];
  /** Cap the result. Applied last, after ordering by document order. */
  limit?: number;
}

// ── Comparison ───────────────────────────────────────────────────────────────

const arr = <T,>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

const numeric = (a: unknown, b: unknown): [number, number] | null => {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

/**
 * Compare one value. Case-insensitive for the string operators: a user asking
 * for room "307" or a wall type "hr" should not be defeated by capitalisation,
 * and no BIM workflow depends on case-sensitive matching.
 */
export function compare(actual: ParamValue | undefined, op: Op, expected?: ParamValue): boolean {
  if (op === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (op === "missing") return actual === undefined || actual === null || actual === "";
  if (actual === undefined || actual === null) return false;

  const as = String(actual).toLowerCase();
  const es = String(expected ?? "").toLowerCase();

  switch (op) {
    case "eq": {
      const n = numeric(actual, expected);
      return n ? n[0] === n[1] : as === es;
    }
    case "ne": {
      const n = numeric(actual, expected);
      return n ? n[0] !== n[1] : as !== es;
    }
    case "contains":
      return as.includes(es);
    case "startsWith":
      return as.startsWith(es);
    case "endsWith":
      return as.endsWith(es);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const n = numeric(actual, expected);
      if (!n) return false;
      const [x, y] = n;
      return op === "gt" ? x > y : op === "gte" ? x >= y : op === "lt" ? x < y : x <= y;
    }
    default:
      return false;
  }
}

/** Every point an element occupies, for spatial tests. */
export function points(e: Element): { x: number; y: number }[] {
  const g = e.geom ?? { kind: "point" as const };
  const out: { x: number; y: number }[] = [];
  if (g.start) out.push(g.start);
  if (g.end) out.push(g.end);
  if (g.at) out.push(g.at);
  if (g.outline) out.push(...g.outline);
  return out;
}

// ── The engine ───────────────────────────────────────────────────────────────

export function matches(doc: BimDocument, e: Element, s: Selector): boolean {
  if (s.ids && !s.ids.includes(e.id)) return false;

  const cats = arr(s.category);
  if (cats && !cats.includes(e.category)) return false;

  const disc = arr(s.discipline);
  if (disc && !disc.includes(e.discipline)) return false;

  const lvls = arr(s.level);
  if (lvls && !(e.level && lvls.includes(e.level))) return false;

  if (s.hostedOn && !(e.geom?.host && s.hostedOn.includes(e.geom.host))) return false;

  if (s.name && !compare(e.name, s.name.op, s.name.value)) return false;

  if (s.params) {
    for (const t of s.params) {
      // Geometry doubles as queryable parameters — "walls thicker than 300mm" is
      // a param test to the caller even though width lives on geom.
      const geomValue = (e.geom as unknown as Record<string, ParamValue>)?.[t.key];
      const actual = e.params?.[t.key] ?? geomValue;
      if (!compare(actual, t.op, t.value)) return false;
    }
  }

  if (s.within) {
    const { minX, minY, maxX, maxY } = s.within;
    const ps = points(e);
    if (!ps.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) return false;
  }

  return true;
}

/** Run a selector. Results keep document order, so repeated runs are stable. */
export function query(doc: BimDocument, s: Selector = {}): Element[] {
  const out = list(doc).filter((e) => matches(doc, e, s));
  return s.limit !== undefined && s.limit >= 0 ? out.slice(0, s.limit) : out;
}

/** Count without materialising — used by the confirmation gate to size an action. */
export function count(doc: BimDocument, s: Selector = {}): number {
  return list(doc).reduce((n, e) => (matches(doc, e, s) ? n + 1 : n), 0);
}

/**
 * Resolve a loose human reference to elements — "room 307", "the north wall".
 *
 * Tried in order of decreasing confidence, and it stops at the first tier that
 * hits. An exact name match must not be diluted by fuzzy matches, otherwise
 * "tag room 307" also tags 307A and 3070.
 */
export function resolve(doc: BimDocument, text: string, s: Selector = {}): Element[] {
  const pool = query(doc, s);
  const t = text.trim().toLowerCase();
  if (!t) return pool;

  const byId = pool.filter((e) => e.id.toLowerCase() === t);
  if (byId.length) return byId;

  const exact = pool.filter((e) => (e.name ?? "").toLowerCase() === t);
  if (exact.length) return exact;

  // A bare number ("307") should match a name that carries it as a whole word:
  // "Live/Work Unit 307" yes, "3070" no.
  const asWord = new RegExp(`(^|[^0-9a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9a-z]|$)`, "i");
  const word = pool.filter((e) => asWord.test(e.name ?? "") || asWord.test(String(e.params?.number ?? "")));
  if (word.length) return word;

  return pool.filter((e) => (e.name ?? "").toLowerCase().includes(t));
}

/** Describe a selector in words, for confirmation prompts and audit trails. */
export function explain(s: Selector): string {
  const bits: string[] = [];
  if (s.ids) bits.push(`${s.ids.length} element(s) by id`);
  if (s.category) bits.push(`category ${arr(s.category)!.join("/")}`);
  if (s.discipline) bits.push(`discipline ${arr(s.discipline)!.join("/")}`);
  if (s.level) bits.push(`on level ${arr(s.level)!.join("/")}`);
  if (s.hostedOn) bits.push(`hosted on ${s.hostedOn.join("/")}`);
  if (s.name) bits.push(`name ${s.name.op} "${s.name.value ?? ""}"`);
  for (const t of s.params ?? []) bits.push(`${t.key} ${t.op}${t.value !== undefined ? ` "${t.value}"` : ""}`);
  if (s.within) bits.push(`within (${s.within.minX},${s.within.minY})–(${s.within.maxX},${s.within.maxY})`);
  if (s.limit !== undefined) bits.push(`limit ${s.limit}`);
  return bits.length ? bits.join(", ") : "everything";
}

/** Longest linear element matching a selector — "the longest wall on L2". */
export const longest = (doc: BimDocument, s: Selector = {}): Element | undefined =>
  query(doc, s).filter((e) => e.geom?.kind === "linear").sort((a, b) => linLength(b) - linLength(a))[0];

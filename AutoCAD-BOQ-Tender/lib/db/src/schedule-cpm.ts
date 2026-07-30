/**
 * Critical Path Method (CPM) engine for the project Work Programme.
 *
 * PURE, dependency-free module: no drizzle, no DB, no Node APIs — so it can be
 * imported unchanged by the API server (for the Excel export) AND by the React
 * front-end (for the live Gantt). Import it via the package subpath
 * `@workspace/db/schedule-cpm` (NOT the package root, which pulls in mysql2).
 *
 * It models a real scheduling network: each activity has a duration and a set of
 * typed predecessor links (Finish-to-Start / Start-to-Start / Finish-to-Finish /
 * Start-to-Finish, each with an optional lag in days). A forward pass derives
 * every activity's early start/finish FROM its links (so a delay on a predecessor
 * pushes its successors); a backward pass derives the late dates; total float =
 * late − early, and an activity is on the CRITICAL PATH when its float is ≤ 0.
 *
 * Activities with no predecessors anchor at their stored `startOffsetDays`
 * (day 0 by default); everything downstream is computed. The engine is
 * cycle-tolerant: if the links contain a loop it removes the minimum set of
 * offending back-edges (the links that actually close a cycle) and computes a
 * real critical path over what remains, rather than degrading the WHOLE
 * programme to stored offsets. `hasCycle` is still reported so the caller can
 * warn the user that a contradictory link was ignored.
 */

export type RelType = "FS" | "SS" | "FF" | "SF";

/** A typed predecessor link: "this activity depends on activity `id`". */
export interface Dependency {
  /** Predecessor activity id. */
  id: number;
  /** Relationship type. FS = finish-to-start (default), SS, FF, SF. */
  type: RelType;
  /** Lag in calendar days (may be negative for a lead). */
  lag: number;
}

/** Minimal activity shape the CPM engine needs. */
export interface CpmActivity {
  id: number;
  durationDays: number;
  isMilestone: boolean;
  /** Anchor start (day offset) used only when the activity has NO predecessors. */
  startOffsetDays: number;
  dependencies: Dependency[];
}

export interface CpmResult {
  /** Computed (early) start day offset — what the Gantt should render. */
  start: number;
  /** Computed (early) finish day offset (= start + duration). */
  finish: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  /** late − early. 0 (or negative, when over-constrained) ⇒ critical. */
  totalFloat: number;
  isCritical: boolean;
}

export interface CpmComputation {
  results: Map<number, CpmResult>;
  /** Latest finish across the network — the project completion day offset. */
  projectEnd: number;
  /** True when the links contained a cycle; results fell back to stored offsets. */
  hasCycle: boolean;
}

/**
 * Optional calendar-mode inputs. When `isWorking` is supplied the engine treats
 * each activity's `durationDays` as WORKING-day effort and runs in "calendar
 * mode": offsets stay calendar-days from commencement, but a bar is stretched to
 * span the weekends / holidays / driving-resource leave it straddles (via
 * `placeWork` from calendar-engine.ts). Omit it and the engine behaves exactly as
 * before (durations are plain calendar days) — so every existing caller is
 * untouched.
 */
export interface CpmOptions {
  /**
   * Returns a per-activity working-day predicate in calendar-offset space
   * (offset 0 = commencement). Return `null` for a given activity to fall back to
   * legacy (calendar-day) behaviour for just that activity.
   */
  isWorking?: (activityId: number) => ((offset: number) => boolean) | null | undefined;
  /**
   * Places `workingDays` of effort from `startOffset` onto the calendar, given a
   * working-day predicate. Injected (rather than imported) so this module stays
   * dependency-free; pass `placeWork` from `@workspace/db/calendar-engine`.
   */
  placeWork?: (
    isWorking: (offset: number) => boolean,
    startOffset: number,
    workingDays: number,
  ) => { start: number; finish: number };
}

const REL_TYPES: readonly RelType[] = ["FS", "SS", "FF", "SF"];

/** Coerce arbitrary input into a valid relationship type (defaults to FS). */
export function normalizeRelType(t: unknown): RelType {
  const s = String(t ?? "").toUpperCase();
  return (REL_TYPES as readonly string[]).includes(s) ? (s as RelType) : "FS";
}

/** Effective duration in days (milestones are zero-duration). */
function durationOf(a: CpmActivity): number {
  if (a.isMilestone) return 0;
  return Math.max(1, Math.round(Number(a.durationDays) || 0));
}

/**
 * Parse the persisted dependency representation. Prefers the structured
 * `dependencies` JSON column; falls back to the legacy comma-separated
 * `predecessorIds` (treated as Finish-to-Start, zero lag) so programmes created
 * before typed links keep working. De-duplicates by predecessor id.
 */
export function parseDependencies(raw: {
  dependencies?: string | null;
  predecessorIds?: string | null;
}): Dependency[] {
  const out: Dependency[] = [];
  if (raw.dependencies) {
    try {
      const arr = JSON.parse(raw.dependencies);
      if (Array.isArray(arr)) {
        for (const d of arr) {
          const id = Number(d?.id);
          if (!Number.isFinite(id)) continue;
          out.push({ id, type: normalizeRelType(d?.type), lag: Math.round(Number(d?.lag) || 0) });
        }
      }
    } catch {
      /* malformed JSON — fall through to the legacy column */
    }
  }
  if (out.length === 0 && raw.predecessorIds) {
    for (const part of raw.predecessorIds.split(",")) {
      const id = parseInt(part.trim(), 10);
      if (!isNaN(id)) out.push({ id, type: "FS", lag: 0 });
    }
  }
  const seen = new Set<number>();
  return out.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

/** Serialise typed dependencies to the JSON stored in the `dependencies` column. */
export function serializeDependencies(deps: Dependency[]): string | null {
  const clean = deps
    .map((d) => ({ id: Number(d.id), type: normalizeRelType(d.type), lag: Math.round(Number(d.lag) || 0) }))
    .filter((d) => Number.isFinite(d.id));
  return clean.length ? JSON.stringify(clean) : null;
}

/** Short P6-style label for a link, e.g. "FS", "SS+2", "FF-1". (No lag ⇒ just the type.) */
export function relLabel(type: RelType, lag: number): string {
  if (!lag) return type;
  return `${type}${lag > 0 ? "+" : ""}${lag}`;
}

/**
 * Run the full CPM forward/backward pass over the activity network and return
 * computed dates + float + critical-path flags keyed by activity id.
 */
export function computeCpm(activities: CpmActivity[], opts?: CpmOptions): CpmComputation {
  const results = new Map<number, CpmResult>();
  if (activities.length === 0) return { results, projectEnd: 0, hasCycle: false };

  // Calendar mode is active only when BOTH a working-day predicate factory and a
  // placeWork implementation are injected. Otherwise the classic calendar-day
  // arithmetic below runs unchanged. `spanCache` records each activity's actual
  // CALENDAR span from the forward pass so the backward pass reuses it (the span
  // is start-dependent, so we don't recompute it for the late dates).
  const calMode = !!(opts?.isWorking && opts?.placeWork);
  const spanCache = new Map<number, number>();

  const byId = new Map<number, CpmActivity>();
  for (const a of activities) byId.set(a.id, a);

  // Valid predecessor links only (drop self-links and links to missing ids).
  const rawDeps = new Map<number, Dependency[]>();
  // Successor adjacency over the RAW links: predId -> [{ succId, type, lag }].
  // (Used only for cycle detection; the passes below run on the pruned graph.)
  const rawSucc = new Map<number, { succId: number; type: RelType; lag: number }[]>();
  for (const a of activities) {
    const valid = a.dependencies
      .filter((d) => byId.has(d.id) && d.id !== a.id)
      .map((d) => ({ id: d.id, type: normalizeRelType(d.type), lag: Math.round(Number(d.lag) || 0) }));
    rawDeps.set(a.id, valid);
    for (const d of valid) {
      const arr = rawSucc.get(d.id) ?? [];
      arr.push({ succId: a.id, type: d.type, lag: d.lag });
      rawSucc.set(d.id, arr);
    }
  }

  // ── Cycle breaking: drop the back-edges that close loops ─────────────────────
  // A DFS over the time-direction graph (predecessor → successor) classifies any
  // edge that points back to a node still on the recursion stack ("grey") as a
  // back-edge — exactly the links that close a cycle. We remember those and
  // ignore them in the passes below, so a single contradictory link no longer
  // wipes out the critical path for the whole programme. Iterative DFS (the
  // network can be large) keyed by the predecessor→successor edge.
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<number, number>(activities.map((a) => [a.id, WHITE]));
  const dropped = new Set<string>(); // "predId->succId" links to ignore
  for (const a of activities) {
    if (color.get(a.id) !== WHITE) continue;
    color.set(a.id, GREY);
    const stack: { node: number; i: number }[] = [{ node: a.id, i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const outs = rawSucc.get(top.node) ?? [];
      if (top.i < outs.length) {
        const e = outs[top.i++];
        const cv = color.get(e.succId);
        if (cv === WHITE) { color.set(e.succId, GREY); stack.push({ node: e.succId, i: 0 }); }
        else if (cv === GREY) dropped.add(`${top.node}->${e.succId}`); // back-edge ⇒ closes a loop
        // BLACK = already finished (a cross/forward edge) — safe to keep.
      } else {
        color.set(top.node, BLACK);
        stack.pop();
      }
    }
  }
  const hasCycle = dropped.size > 0;

  // Effective graph with the cycle-closing links removed.
  const deps = new Map<number, Dependency[]>();
  const succ = new Map<number, { succId: number; type: RelType; lag: number }[]>();
  for (const a of activities) {
    const valid = rawDeps.get(a.id)!.filter((d) => !dropped.has(`${d.id}->${a.id}`));
    deps.set(a.id, valid);
    for (const d of valid) {
      const arr = succ.get(d.id) ?? [];
      arr.push({ succId: a.id, type: d.type, lag: d.lag });
      succ.set(d.id, arr);
    }
  }

  // ── Topological order (Kahn) over the now-acyclic graph ─────────────────────
  const indeg = new Map<number, number>();
  for (const a of activities) indeg.set(a.id, deps.get(a.id)!.length);
  const queue: number[] = activities.filter((a) => indeg.get(a.id) === 0).map((a) => a.id);
  const order: number[] = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    order.push(id);
    for (const s of succ.get(id) ?? []) {
      const n = (indeg.get(s.succId) ?? 0) - 1;
      indeg.set(s.succId, n);
      if (n === 0) queue.push(s.succId);
    }
  }
  // Safety net: if anything is still unordered (shouldn't happen after pruning),
  // append it so every activity gets a result rather than being dropped.
  if (order.length !== activities.length) {
    const inOrder = new Set(order);
    for (const a of activities) if (!inOrder.has(a.id)) order.push(a.id);
  }

  // ── Forward pass: early start / early finish ────────────────────────────────
  const es = new Map<number, number>();
  const ef = new Map<number, number>();
  for (const id of order) {
    const a = byId.get(id)!;
    const d = durationOf(a);
    const links = deps.get(id)!;
    let start: number;
    if (links.length === 0) {
      start = Math.max(0, Math.round(Number(a.startOffsetDays) || 0));
    } else {
      start = 0;
      for (const link of links) {
        const pEs = es.get(link.id) ?? 0;
        const pEf = ef.get(link.id) ?? 0;
        let cand: number;
        switch (link.type) {
          case "SS": cand = pEs + link.lag; break;
          case "FF": cand = pEf + link.lag - d; break;
          case "SF": cand = pEs + link.lag - d; break;
          case "FS": default: cand = pEf + link.lag; break;
        }
        if (cand > start) start = cand;
      }
      start = Math.max(0, start);
    }
    // Calendar mode: nudge the start to a working day and stretch the bar across
    // the weekends/holidays/leave it straddles. `d` here is WORKING-day effort;
    // the resulting calendar span is cached for the backward pass. A null
    // predicate (or a milestone) falls back to plain calendar-day arithmetic.
    if (calMode && !a.isMilestone) {
      const pred = opts!.isWorking!(id);
      if (pred) {
        const placed = opts!.placeWork!(pred, start, d);
        es.set(id, placed.start);
        ef.set(id, placed.finish);
        spanCache.set(id, placed.finish - placed.start);
        continue;
      }
    }
    es.set(id, start);
    ef.set(id, start + d);
  }

  let projectEnd = 0;
  for (const id of order) projectEnd = Math.max(projectEnd, ef.get(id) ?? 0);

  // ── Backward pass: late finish / late start ─────────────────────────────────
  const ls = new Map<number, number>();
  const lf = new Map<number, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const a = byId.get(id)!;
    // In calendar mode the activity occupies its cached CALENDAR span (which
    // already absorbed weekends/holidays/leave), not its raw working-day duration.
    const d = calMode && spanCache.has(id) ? spanCache.get(id)! : durationOf(a);
    const outgoing = succ.get(id) ?? [];
    // Every activity is bounded above by the project deadline: it can never
    // finish later than projectEnd without pushing the whole programme out.
    // Seeding lfin with projectEnd (instead of only doing so for sink nodes)
    // fixes the case where an activity's OWN finish defines the project end but
    // its successors finish earlier (e.g. via an SS link) — without the cap such
    // an activity wrongly shows float and drops off the critical path.
    let lfin = projectEnd;     // constraints on this activity's late FINISH (FS, FF)
    let lstart = Infinity;     // constraints on this activity's late START  (SS, SF)
    for (const s of outgoing) {
      const sLs = ls.get(s.succId) ?? projectEnd;
      const sLf = lf.get(s.succId) ?? projectEnd;
      switch (s.type) {
        case "SS": lstart = Math.min(lstart, sLs - s.lag); break;
        case "FF": lfin = Math.min(lfin, sLf - s.lag); break;
        case "SF": lstart = Math.min(lstart, sLf - s.lag); break;
        case "FS": default: lfin = Math.min(lfin, sLs - s.lag); break;
      }
    }
    if (lstart !== Infinity) lfin = Math.min(lfin, lstart + d);
    lf.set(id, lfin);
    ls.set(id, lfin - d);
  }

  for (const id of order) {
    const earlyStart = es.get(id) ?? 0;
    const earlyFinish = ef.get(id) ?? 0;
    const lateStart = ls.get(id) ?? earlyStart;
    const lateFinish = lf.get(id) ?? earlyFinish;
    const totalFloat = lateStart - earlyStart;
    results.set(id, {
      start: earlyStart, finish: earlyFinish,
      earlyStart, earlyFinish, lateStart, lateFinish,
      totalFloat, isCritical: totalFloat <= 0,
    });
  }

  return { results, projectEnd, hasCycle };
}

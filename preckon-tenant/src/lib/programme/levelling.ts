// Resource levelling — as a PROPOSAL, never as an edit.
//
// resources.ts computes the demand curve and stops there, on the grounds that
// "a tool that silently rescheduled a programme to fit its own resource
// assumptions would be worse than one that says you need eleven bricklayers on
// the 14th and you have six". That reasoning still holds. This does not weaken
// it; it answers the question that comes next.
//
// A planner looking at that conflict has to decide something, and the decision
// is hard: which activities move, in what order, and does the completion date
// survive. Computing a candidate answer is genuinely useful. APPLYING it is
// not this module's business — it returns moves for somebody to accept or
// reject, and it never touches an activity.
//
// ── WHAT MAKES A LEVELLING RESULT TRUSTWORTHY ────────────────────────────────
//
// Two things, and this module is built around both.
//
// It must not break the logic. An activity cannot start before its predecessors
// finish, no matter how convenient that would be for the histogram. Levelling
// that quietly violates a dependency produces a plan that looks feasible and
// cannot be built.
//
// It must be honest about the cost. Levelling within float is free; levelling
// beyond float moves the end date. Those are completely different conversations
// to have with a client, and a result that blends them is worthless. So the
// output separates them and states the delay in days.
//
// The method is the standard serial one: order activities by priority, then
// place each at the earliest day where its predecessors are done AND its
// resources are free. It is deterministic and explicable, which matters more
// here than optimality — a planner has to defend the resulting programme, and
// "the optimiser decided" is not a defence.

import type { Availability } from "./resources";

export interface LevellingActivity {
  key: string;
  name: string;
  /** Duration in days. A milestone is 0. */
  duration: number;
  /** Earliest start from CPM, in days from commencement. */
  earlyStart: number;
  /** Days it can slip before the project end moves. From CPM. */
  totalFloat: number;
  /** Predecessor keys. Levelling must never violate these. */
  predecessors?: string[];
  /** Roles and units this activity needs for its whole duration. */
  demands?: { role: string; units: number }[];
}

export interface Move {
  key: string;
  name: string;
  fromDay: number;
  toDay: number;
  /** Days delayed. Always positive — levelling never pulls work earlier. */
  delay: number;
  /** True when the delay exceeds the activity's float. */
  beyondFloat: boolean;
  /** Which role's shortage forced the move. */
  drivenBy: string;
  why: string;
}

export interface LevellingResult {
  moves: Move[];
  /** Activities levelled inside their float: no effect on the end date. */
  freeMoves: Move[];
  /** Activities pushed past their float: these are what moves the end date. */
  costlyMoves: Move[];
  /** Project duration before and after, in days. */
  durationBefore: number;
  durationAfter: number;
  /** Days the completion date moves. Zero means levelling was free. */
  delayDays: number;
  /** Peak demand per role, before and after. */
  peaks: { role: string; before: number; after: number }[];
  /** Roles still over-committed after levelling — see below. */
  unresolved: string[];
  feasible: boolean;
  summary: string;
}

/** Availability for a role on a day, honouring windows. */
const availableAt = (a: Availability | undefined, day: number): number => {
  if (!a) return 0;
  const w = a.windows?.find((x) => day >= x.fromDay && day <= x.toDay);
  return w ? w.units : a.units;
};

/**
 * Which activity to place next.
 *
 * Priority is least total float first: an activity with two days of float has
 * two days to give, one with sixty has sixty, and delaying the tight one to
 * accommodate the slack one is how levelling pushes out an end date it did not
 * need to touch. Ties break on early start, then on key — the key only so two
 * runs over the same programme produce the same plan, without which a planner
 * cannot check yesterday's decision against today's.
 *
 * But priority is subordinate to LOGIC. Only activities whose predecessors are
 * already placed are candidates, because an activity's earliest start depends on
 * where its predecessors actually landed. Sorting by float alone would let a
 * slack predecessor be placed after its own tight successor, and the successor's
 * position would then be computed from a date that later moved — a plan whose
 * own moves invalidate it.
 */
function nextCandidate(
  remaining: LevellingActivity[], placed: Set<string>, known: Set<string>,
): LevellingActivity | null {
  const ready = remaining.filter((a) =>
    // Dangling references are cpm.ts's to report; here an unknown predecessor
    // cannot be waited for, so it does not block.
    (a.predecessors ?? []).every((p) => !known.has(p) || placed.has(p)));
  const pool = ready.length ? ready : remaining;   // a cycle: fall through, see below
  return pool.slice().sort((x, y) =>
    x.totalFloat - y.totalFloat ||
    x.earlyStart - y.earlyStart ||
    x.key.localeCompare(y.key))[0] ?? null;
}

/**
 * Level a programme against available resources.
 *
 * `horizon` bounds the search. Without it, an activity needing a resource that
 * will never be available enough would be pushed forward for ever; with it, the
 * activity is placed at its early start and its role reported in `unresolved`.
 * Reporting "this cannot be levelled" is a real answer. Looping until something
 * times out is not.
 */
export function level(
  activities: LevellingActivity[],
  availability: Availability[],
  opts: { horizonDays?: number } = {},
): LevellingResult {
  const availByRole = new Map(availability.map((a) => [a.role, a] as const));
  const byKey = new Map(activities.map((a) => [a.key, a] as const));

  const naturalEnd = activities.reduce(
    (m, a) => Math.max(m, a.earlyStart + Math.max(0, a.duration)), 0);
  // Generous by default: enough room to sequence everything end to end, which
  // is the worst case a solvable programme can need.
  const horizon = opts.horizonDays ??
    naturalEnd + activities.reduce((s, a) => s + Math.max(0, a.duration), 0) + 1;

  /** Committed units per role per day, as levelling proceeds. */
  const used = new Map<string, Map<number, number>>();
  const usedOn = (role: string, day: number) => used.get(role)?.get(day) ?? 0;
  const commit = (role: string, day: number, units: number) => {
    let m = used.get(role);
    if (!m) used.set(role, (m = new Map()));
    m.set(day, (m.get(day) ?? 0) + units);
  };

  const placedStart = new Map<string, number>();
  const moves: Move[] = [];
  const unresolved = new Set<string>();

  const known = new Set(activities.map((a) => a.key));
  const placedKeys = new Set<string>();
  const remaining = [...activities];

  while (remaining.length) {
    const act = nextCandidate(remaining, placedKeys, known);
    if (!act) break;
    remaining.splice(remaining.indexOf(act), 1);
    const dur = Math.max(0, act.duration);
    const demands = act.demands ?? [];

    /* Logic first, resources second.

       An activity cannot start before its predecessors finish, whatever that
       does to the histogram. Predecessors are read from where they were PLACED,
       not from their early starts — levelling one activity moves everything
       downstream of it, and using the original dates here would produce a plan
       whose own moves invalidate it. */
    let earliest = act.earlyStart;
    for (const p of act.predecessors ?? []) {
      const pred = byKey.get(p);
      if (!pred) continue;   // dangling refs are cpm.ts's to report, not ours
      // Placed, because nextCandidate only offers activities whose predecessors
      // are done. The fallback covers the cycle case, where it fell through
      // deliberately and the early start is the best floor available.
      const predStart = placedStart.get(p) ?? pred.earlyStart;
      earliest = Math.max(earliest, predStart + Math.max(0, pred.duration));
    }

    // Zero-duration milestones and activities needing nothing consume no
    // resource, so there is nothing to level them against.
    let start = earliest;
    let driver = "";
    if (dur > 0 && demands.length) {
      let found = false;
      for (let day = earliest; day <= horizon; day++) {
        const blocker = demands.find((d) => {
          for (let k = 0; k < dur; k++) {
            const avail = availableAt(availByRole.get(d.role), day + k);
            if (usedOn(d.role, day + k) + d.units > avail) return true;
          }
          return false;
        });
        if (!blocker) { start = day; found = true; break; }
        driver = blocker.role;
      }
      if (!found) {
        /* Nowhere in the horizon fits. Placing it at its early start is the
           honest failure: the plan is returned unlevelled for this activity and
           the role is named, rather than the activity vanishing into a distant
           day that implies a solution nobody can staff. */
        start = earliest;
        for (const d of demands) {
          const peak = availableAt(availByRole.get(d.role), start);
          if (d.units > peak) unresolved.add(d.role);
        }
        if (driver) unresolved.add(driver);
      }
    }

    placedStart.set(act.key, start);
    placedKeys.add(act.key);
    for (const d of demands) for (let k = 0; k < dur; k++) commit(d.role, start + k, d.units);

    if (start > act.earlyStart) {
      const delay = start - act.earlyStart;
      const beyondFloat = delay > act.totalFloat;
      moves.push({
        key: act.key,
        name: act.name,
        fromDay: act.earlyStart,
        toDay: start,
        delay,
        beyondFloat,
        drivenBy: driver,
        why: beyondFloat
          ? `Delayed ${delay} day(s) — ${delay - act.totalFloat} beyond its ${act.totalFloat} day(s) of float, so this moves the completion date.`
          : `Delayed ${delay} day(s), absorbed by its ${act.totalFloat} day(s) of float.`,
      });
    }
  }

  const durationBefore = naturalEnd;
  const durationAfter = activities.reduce(
    (m, a) => Math.max(m, (placedStart.get(a.key) ?? a.earlyStart) + Math.max(0, a.duration)), 0);

  const peaks = [...new Set(activities.flatMap((a) => (a.demands ?? []).map((d) => d.role)))]
    .sort()
    .map((role) => ({
      role,
      before: peakOf(activities, role, (a) => a.earlyStart),
      after: peakOf(activities, role, (a) => placedStart.get(a.key) ?? a.earlyStart),
    }));

  const costly = moves.filter((m) => m.beyondFloat);
  const free = moves.filter((m) => !m.beyondFloat);
  const delayDays = Math.max(0, durationAfter - durationBefore);

  return {
    moves,
    freeMoves: free,
    costlyMoves: costly,
    durationBefore,
    durationAfter,
    delayDays,
    peaks,
    unresolved: [...unresolved].sort(),
    // Feasible means "resources can meet this plan", not "the date is
    // acceptable". A levelled programme that finishes ten days late is
    // feasible and probably unwelcome, and conflating the two would hide the
    // more important of the two facts.
    feasible: unresolved.size === 0,
    summary: summarise(moves, delayDays, [...unresolved]),
  };
}

/** Peak concurrent demand for a role, given a start-day function. */
function peakOf(
  acts: LevellingActivity[], role: string, startOf: (a: LevellingActivity) => number,
): number {
  const day = new Map<number, number>();
  for (const a of acts) {
    const units = (a.demands ?? []).filter((d) => d.role === role).reduce((s, d) => s + d.units, 0);
    if (!units) continue;
    const s = startOf(a);
    for (let k = 0; k < Math.max(0, a.duration); k++) day.set(s + k, (day.get(s + k) ?? 0) + units);
  }
  return day.size ? Math.max(...day.values()) : 0;
}

function summarise(moves: Move[], delayDays: number, unresolved: string[]): string {
  if (!moves.length && !unresolved.length) {
    return "No levelling needed — the programme already fits the resources available.";
  }
  const parts: string[] = [];
  if (moves.length) {
    const costly = moves.filter((m) => m.beyondFloat).length;
    parts.push(
      costly === 0
        ? `${moves.length} activit${moves.length === 1 ? "y" : "ies"} moved within float; the completion date is unchanged.`
        : `${moves.length} activit${moves.length === 1 ? "y" : "ies"} moved, ${costly} beyond float.`,
    );
  }
  if (delayDays > 0) parts.push(`Completion moves out by ${delayDays} day(s).`);
  if (unresolved.length) {
    parts.push(
      `Cannot be levelled for ${unresolved.join(", ")} — demand exceeds everything available, so the programme needs more resource rather than different dates.`,
    );
  }
  return parts.join(" ");
}

/**
 * Turn a levelling result into the moves a planner would apply.
 *
 * Separate from level() on purpose. This is the shape that would become an
 * artifact proposal going through a review gate — nothing here writes, and the
 * gate is where a human decides whether the delay is acceptable.
 */
export function asProposal(r: LevellingResult): {
  changes: { key: string; startDay: number; delay: number }[];
  requiresApproval: boolean;
  rationale: string;
} {
  return {
    changes: r.moves.map((m) => ({ key: m.key, startDay: m.toDay, delay: m.delay })),
    // Moving the completion date is a commercial decision, not a planning one.
    // Levelling entirely within float still deserves a look, but this flag is
    // what should stop it being applied quietly.
    requiresApproval: r.delayDays > 0 || r.costlyMoves.length > 0,
    rationale: r.summary,
  };
}

// Look-ahead and work readiness.
//
// The master programme says what should happen. The look-ahead asks a harder
// question: of the work due in the next few weeks, what can actually start?
//
// An activity is ready only when every constraint on it is clear — design
// issued, materials on site, permit granted, access available, predecessor
// finished, labour allocated. Miss one and the crew turns up to a job they
// cannot do, which costs a day nobody planned to lose and is the single most
// common way a programme slips without anyone deciding it should.
//
// So readiness here is computed from constraints rather than asserted, and an
// activity with an unresolved constraint is reported as NOT ready even when its
// dates say it starts on Monday. The dates are the plan; the constraints are
// whether the plan is true.

export type ConstraintKind =
  | "design"        // drawing issued for construction
  | "materials"     // delivered to site
  | "permit"        // approval, permit to work, inspection sign-off
  | "access"        // the area is handed over and safe
  | "predecessor"   // the activity before it is complete
  | "labour"
  | "plant"
  | "information";  // an RFI answered

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  description: string;
  /** Cleared, or the date it is expected to clear. */
  clearedAt?: string | null;
  expectedAt?: string | null;
  owner?: string | null;
}

export interface LookaheadActivity {
  key: string;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  /** Total float in days, from the CPM. Zero means critical. */
  float?: number;
  constraints: Constraint[];
  crewSize?: number;
}

export type Readiness = "ready" | "at_risk" | "blocked" | "not_due";

export interface ActivityReadiness {
  key: string;
  name: string;
  plannedStart: string;
  readiness: Readiness;
  /** Constraints still open. */
  outstanding: Constraint[];
  /** Open constraints with no expected date — the ones nobody is chasing. */
  unchased: Constraint[];
  daysToStart: number;
  float: number;
  reason: string;
}

export interface LookaheadReport {
  windowStart: string;
  windowEnd: string;
  activities: ActivityReadiness[];
  ready: number;
  atRisk: number;
  blocked: number;
  /** Blocked work sitting on the critical path. */
  criticalBlocked: ActivityReadiness[];
  /** Grouped by who owns the constraint, for the sub-contractor meeting. */
  byOwner: { owner: string; open: number; blocking: string[] }[];
  summary: string;
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * The next N weeks, and whether it can be built.
 *
 * "At risk" is the useful middle state: the constraint is not cleared but is
 * expected to clear before the activity starts. It is not blocked yet, and
 * reporting it as ready would hide the only window in which anybody can do
 * something about it.
 */
export function lookahead(
  activities: LookaheadActivity[], now: string, weeks = 3,
): LookaheadReport {
  const windowEnd = new Date(Date.parse(now) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const rows: ActivityReadiness[] = [];

  for (const a of activities) {
    const daysToStart = dayDiff(now, a.plannedStart);
    const outstanding = a.constraints.filter((c) => !c.clearedAt);
    const unchased = outstanding.filter((c) => !c.expectedAt);

    if (a.plannedStart > windowEnd) {
      rows.push({
        key: a.key, name: a.name, plannedStart: a.plannedStart, readiness: "not_due",
        outstanding, unchased, daysToStart, float: a.float ?? 0,
        reason: `Starts ${a.plannedStart}, beyond the ${weeks}-week window.`,
      });
      continue;
    }

    let readiness: Readiness;
    let reason: string;

    if (!outstanding.length) {
      readiness = "ready";
      reason = "All constraints cleared.";
    } else {
      // Will every open constraint clear before the activity is due to start?
      const lateClearing = outstanding.filter(
        (c) => !c.expectedAt || Date.parse(c.expectedAt) > Date.parse(a.plannedStart),
      );
      if (lateClearing.length) {
        readiness = "blocked";
        reason =
          `${lateClearing.length} constraint(s) will not clear before the ${a.plannedStart} start: ` +
          lateClearing.map((c) => `${c.kind} — ${c.description}${c.expectedAt ? ` (expected ${c.expectedAt})` : " (no date)"}`).join("; ");
      } else {
        readiness = "at_risk";
        reason =
          `${outstanding.length} constraint(s) still open but expected to clear in time: ` +
          outstanding.map((c) => `${c.kind} by ${c.expectedAt}`).join("; ");
      }
    }

    rows.push({
      key: a.key, name: a.name, plannedStart: a.plannedStart, readiness,
      outstanding, unchased, daysToStart, float: a.float ?? 0, reason,
    });
  }

  // Soonest first, and within a day the least float first — that is the order
  // the look-ahead meeting should work through.
  const order: Record<Readiness, number> = { blocked: 0, at_risk: 1, ready: 2, not_due: 3 };
  rows.sort((a, b) => order[a.readiness] - order[b.readiness] || a.daysToStart - b.daysToStart || a.float - b.float);

  const inWindow = rows.filter((r) => r.readiness !== "not_due");
  const blocked = inWindow.filter((r) => r.readiness === "blocked");
  const criticalBlocked = blocked.filter((r) => r.float <= 0);

  const ownerMap = new Map<string, { open: number; blocking: Set<string> }>();
  for (const r of blocked) {
    for (const c of r.outstanding) {
      const owner = c.owner ?? "unassigned";
      const cur = ownerMap.get(owner) ?? { open: 0, blocking: new Set<string>() };
      cur.open += 1;
      cur.blocking.add(r.name);
      ownerMap.set(owner, cur);
    }
  }

  return {
    windowStart: now,
    windowEnd,
    activities: rows,
    ready: inWindow.filter((r) => r.readiness === "ready").length,
    atRisk: inWindow.filter((r) => r.readiness === "at_risk").length,
    blocked: blocked.length,
    criticalBlocked,
    byOwner: [...ownerMap.entries()]
      .map(([owner, v]) => ({ owner, open: v.open, blocking: [...v.blocking] }))
      .sort((a, b) => b.open - a.open),
    summary:
      `${weeks}-week look-ahead: ${inWindow.filter((r) => r.readiness === "ready").length} ready, ` +
      `${inWindow.filter((r) => r.readiness === "at_risk").length} at risk, ${blocked.length} blocked` +
      (criticalBlocked.length ? `, ${criticalBlocked.length} of them on the critical path` : "") + ".",
  };
}

/**
 * Percent Plan Complete — the Last Planner measure.
 *
 * Deliberately brutal: it counts activities COMPLETED against activities
 * PROMISED, and a task 90% done counts as zero. Partial credit is what turns a
 * reliability measure into a comfort blanket, since a programme where everything
 * is 90% done is a programme where nothing has finished.
 */
export function percentPlanComplete(
  promised: { key: string; completed: boolean }[],
): { ppc: number; promised: number; completed: number; summary: string } {
  const completed = promised.filter((p) => p.completed).length;
  const ppc = promised.length ? Math.round((completed / promised.length) * 100) : 100;
  return {
    ppc, promised: promised.length, completed,
    summary:
      `${ppc}% of ${promised.length} promised task(s) completed` +
      (ppc >= 85 ? " — a reliable plan." : ppc >= 70 ? " — the plan is roughly holding." : " — the plan is not being believed by the people executing it."),
  };
}

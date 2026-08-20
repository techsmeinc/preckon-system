// Resources, roles and the histogram.
//
// A programme that ignores resource is a programme that assumes you can pour
// four slabs at once because the logic allows it. The dates are arithmetically
// correct and physically impossible, and nobody finds out until the week it is
// supposed to happen.
//
// This computes the demand curve — who is needed, when, how many — and reports
// where demand exceeds availability. It deliberately stops short of LEVELLING:
// automatically resolving an over-allocation means moving activities, which
// changes dates, and a tool that silently rescheduled a programme to fit its
// own resource assumptions would be worse than one that says "you need eleven
// bricklayers on the 14th and you have six".
//
// Reporting the conflict is most of the value and all of the honesty.

export interface Assignment {
  activityKey: string;
  activityName: string;
  /** Role or trade: bricklayer, crane, banksman. */
  role: string;
  /** How many of them, for the whole activity. */
  units: number;
  startDay: number;
  /** Inclusive. A one-day activity has finishDay === startDay. */
  finishDay: number;
}

export interface Availability {
  role: string;
  /** Units available. A single figure is the common case. */
  units: number;
  /** Optional windows where availability differs. */
  windows?: { fromDay: number; toDay: number; units: number }[];
}

export interface HistogramPoint {
  day: number;
  demand: number;
  available: number;
  over: number;
  activities: string[];
}

export interface RoleHistogram {
  role: string;
  points: HistogramPoint[];
  peakDemand: number;
  peakDay: number;
  /** Total units × days — the labour content, useful for a cost check. */
  unitDays: number;
  overDays: number;
  worstOver: number;
}

export interface Conflict {
  role: string;
  fromDay: number;
  toDay: number;
  demand: number;
  available: number;
  shortfall: number;
  activities: string[];
  message: string;
}

export interface ResourceReport {
  histograms: RoleHistogram[];
  conflicts: Conflict[];
  /** Roles asked for that nobody said they had. */
  unresourced: string[];
  feasible: boolean;
  summary: string;
}

const availableAt = (a: Availability | undefined, day: number): number => {
  if (!a) return 0;
  const window = a.windows?.find((w) => day >= w.fromDay && day <= w.toDay);
  return window ? window.units : a.units;
};

/**
 * Demand per day per role, and where it cannot be met.
 *
 * Conflicts are merged into RUNS rather than reported per day: "over by 5 on
 * days 12, 13, 14, 15" is one problem a planner solves once, and four rows
 * invite it to be treated as four.
 */
export function resources(assignments: Assignment[], availability: Availability[]): ResourceReport {
  const availByRole = new Map(availability.map((a) => [a.role, a] as const));
  const roles = [...new Set(assignments.map((a) => a.role))].sort();
  const histograms: RoleHistogram[] = [];
  const conflicts: Conflict[] = [];

  for (const role of roles) {
    const mine = assignments.filter((a) => a.role === role);
    const lastDay = Math.max(...mine.map((a) => a.finishDay));
    const firstDay = Math.min(...mine.map((a) => a.startDay));
    const points: HistogramPoint[] = [];

    for (let day = firstDay; day <= lastDay; day++) {
      const active = mine.filter((a) => day >= a.startDay && day <= a.finishDay);
      const demand = active.reduce((s, a) => s + a.units, 0);
      const available = availableAt(availByRole.get(role), day);
      points.push({
        day, demand, available,
        over: Math.max(0, demand - available),
        activities: active.map((a) => a.activityName),
      });
    }

    const peak = points.reduce((m, p) => (p.demand > m.demand ? p : m), points[0]);
    histograms.push({
      role,
      points,
      peakDemand: peak.demand,
      peakDay: peak.day,
      unitDays: points.reduce((s, p) => s + p.demand, 0),
      overDays: points.filter((p) => p.over > 0).length,
      worstOver: points.reduce((m, p) => Math.max(m, p.over), 0),
    });

    // Merge consecutive over-allocated days into one conflict.
    let run: HistogramPoint[] = [];
    const flush = () => {
      if (!run.length) return;
      const demand = Math.max(...run.map((p) => p.demand));
      const available = run[0].available;
      conflicts.push({
        role,
        fromDay: run[0].day,
        toDay: run[run.length - 1].day,
        demand,
        available,
        shortfall: demand - available,
        activities: [...new Set(run.flatMap((p) => p.activities))],
        message:
          `${role}: ${demand} needed on day ${run[0].day}${run.length > 1 ? `–${run[run.length - 1].day}` : ""}, ` +
          `${available} available — short ${demand - available}. Running: ${[...new Set(run.flatMap((p) => p.activities))].join(", ")}.`,
      });
      run = [];
    };
    for (const p of points) {
      if (p.over > 0) run.push(p);
      else flush();
    }
    flush();
  }

  const unresourced = roles.filter((r) => !availByRole.has(r));
  conflicts.sort((a, b) => b.shortfall - a.shortfall || a.fromDay - b.fromDay);

  return {
    histograms,
    conflicts,
    unresourced,
    feasible: conflicts.length === 0 && unresourced.length === 0,
    summary: unresourced.length
      ? `${unresourced.length} role(s) with no stated availability: ${unresourced.join(", ")}. The programme assumes they are unlimited.`
      : conflicts.length
        ? `${conflicts.length} resource conflict(s); worst is ${conflicts[0].role} short ${conflicts[0].shortfall} on day ${conflicts[0].fromDay}.`
        : "Every role fits within its stated availability.",
  };
}

/**
 * How flat the demand curve is, 0..1.
 *
 * A programme that needs two bricklayers, then eleven, then two again is
 * technically feasible and practically miserable: you cannot hire eleven for a
 * week. Smoothness is what a planner is chasing when they level, and reporting
 * it turns "this looks spiky" into something arguable.
 */
export function smoothness(h: RoleHistogram): number {
  const active = h.points.filter((p) => p.demand > 0);
  if (active.length < 2) return 1;
  const mean = active.reduce((s, p) => s + p.demand, 0) / active.length;
  if (mean === 0) return 1;
  const variance = active.reduce((s, p) => s + (p.demand - mean) ** 2, 0) / active.length;
  // Coefficient of variation, inverted and clamped: 1 is flat, 0 is chaos.
  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / mean));
}

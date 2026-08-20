// Progress, data date and percent complete.
//
// Three kinds of "percent complete" get quoted in the same meeting and they are
// not the same number:
//
//   duration  — how much of the time has been used
//   physical  — how much of the work is actually done
//   earned    — physical progress weighted by value
//
// A job can be 70% through its programme, 40% built, and 55% earned. Reporting
// whichever is highest is the oldest trick in progress reporting, so all three
// are computed and named, and the spread between them is reported as its own
// signal — a wide gap between duration and physical IS the delay, before anyone
// has argued about a single date.
//
// Everything is measured at a DATA DATE, never "now". A progress report without
// a data date cannot be reconciled with the one before it, and status collected
// over a week and stamped with today's date says a job is further ahead than it
// is.

export interface ProgressActivity {
  key: string;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  plannedDurationDays: number;
  /** Value or cost weight. Equal weighting is used when absent. */
  weight?: number;
  actualStart?: string | null;
  actualFinish?: string | null;
  /** As reported from site, 0..100. */
  physicalPercent?: number;
  /** Planner's estimate of what is left, in working days. */
  remainingDurationDays?: number | null;
}

export type ActivityStatus = "not_started" | "in_progress" | "complete" | "should_have_started" | "should_have_finished";

export interface ActivityProgress {
  key: string;
  name: string;
  status: ActivityStatus;
  durationPercent: number;
  physicalPercent: number;
  /** Physical progress against what was planned by the data date. */
  planPercent: number;
  /** physical − plan. Negative is behind. */
  variancePercent: number;
  weight: number;
}

export interface ProgressReport {
  dataDate: string;
  activities: ActivityProgress[];
  durationPercent: number;
  physicalPercent: number;
  earnedPercent: number;
  plannedPercent: number;
  /** earned − planned. The headline. */
  scheduleVariancePercent: number;
  behind: ActivityProgress[];
  notStartedButDue: ActivityProgress[];
  summary: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** What SHOULD be complete by the data date, on a straight-line spread. */
function plannedPercentAt(a: ProgressActivity, dataDate: string): number {
  const elapsed = dayDiff(a.plannedStart, dataDate);
  const total = Math.max(1, dayDiff(a.plannedStart, a.plannedFinish));
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 100;
  return clamp((elapsed / total) * 100);
}

export function progress(activities: ProgressActivity[], dataDate: string): ProgressReport {
  const rows: ActivityProgress[] = activities.map((a) => {
    const weight = a.weight ?? 1;
    const plan = plannedPercentAt(a, dataDate);

    // Physical progress is what site reported. Where nothing was reported, a
    // finished activity is 100 and everything else is 0 — never inferred from
    // elapsed time, which would make every late activity look on track.
    const physical = a.actualFinish
      ? 100
      : clamp(a.physicalPercent ?? 0);

    const duration = a.actualStart
      ? a.actualFinish
        ? 100
        : clamp((dayDiff(a.actualStart, dataDate) / Math.max(1, a.plannedDurationDays)) * 100)
      : 0;

    let status: ActivityStatus = "not_started";
    if (a.actualFinish) status = "complete";
    else if (a.actualStart) status = Date.parse(a.plannedFinish) < Date.parse(dataDate) ? "should_have_finished" : "in_progress";
    else if (Date.parse(a.plannedStart) < Date.parse(dataDate)) status = "should_have_started";

    return {
      key: a.key, name: a.name, status,
      durationPercent: Math.round(duration),
      physicalPercent: Math.round(physical),
      planPercent: Math.round(plan),
      variancePercent: Math.round(physical - plan),
      weight,
    };
  });

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const weighted = (pick: (r: ActivityProgress) => number) =>
    Math.round(rows.reduce((s, r) => s + pick(r) * r.weight, 0) / totalWeight);

  const earned = weighted((r) => r.physicalPercent);
  const planned = weighted((r) => r.planPercent);
  const behind = rows.filter((r) => r.variancePercent < -5).sort((a, b) => a.variancePercent - b.variancePercent);
  const notStartedButDue = rows.filter((r) => r.status === "should_have_started");

  const sv = earned - planned;
  return {
    dataDate,
    activities: rows,
    durationPercent: weighted((r) => r.durationPercent),
    physicalPercent: Math.round(rows.reduce((s, r) => s + r.physicalPercent, 0) / (rows.length || 1)),
    earnedPercent: earned,
    plannedPercent: planned,
    scheduleVariancePercent: sv,
    behind,
    notStartedButDue,
    summary:
      `At ${dataDate}: ${earned}% earned against ${planned}% planned ` +
      `(${sv === 0 ? "on plan" : sv > 0 ? `${sv}% ahead` : `${Math.abs(sv)}% behind`}). ` +
      `${notStartedButDue.length} activity(ies) should have started and have not.`,
  };
}

/**
 * The forecast finish for an in-progress activity.
 *
 * Uses the planner's remaining duration when there is one, and falls back to
 * scaling the original duration by the progress achieved. The fallback is
 * deliberately pessimistic — an activity 20% done in half its time is not going
 * to recover on its own, and a forecast that assumes it will is the reason
 * delays surface late.
 */
export function forecastRemainingDays(a: ProgressActivity, dataDate: string): number {
  if (a.actualFinish) return 0;
  if (a.remainingDurationDays != null) return Math.max(0, a.remainingDurationDays);
  const physical = clamp(a.physicalPercent ?? 0);
  if (!a.actualStart || physical <= 0) return a.plannedDurationDays;
  const elapsed = Math.max(1, dayDiff(a.actualStart, dataDate));
  const rate = physical / elapsed;                 // percent per day, achieved
  return Math.ceil((100 - physical) / Math.max(rate, 0.01));
}

// What-if sandbox, and recovery options.
//
// The question after a delay is always the same: what do we do about it. The
// answers are few and well known — crash an activity by adding resource,
// fast-track by overlapping two that were sequential, re-sequence, or accept
// the date. What is never known without doing the arithmetic is which of them
// actually recovers the finish, and what each costs.
//
// So a scenario here is a set of changes applied to a COPY of the programme,
// recomputed end to end and compared against the baseline. Two rules make it
// honest:
//
//   Nothing mutates the live programme. A sandbox that edits the real thing is
//   not a sandbox, and the moment somebody tries three options the programme is
//   whatever the third one left behind.
//
//   Crashing an activity off the critical path recovers nothing. It is the
//   most common wasted spend in delay recovery — money into an activity with
//   float, which moves the finish date not one day.

import { computeCpm } from "../cpm";

export type ChangeKind = "crash" | "overlap" | "resequence" | "extend" | "remove";

export interface Change {
  kind: ChangeKind;
  /** Activity key the change applies to. */
  activity: string;
  /** Days removed for a crash, added for an extend. */
  days?: number;
  /** Cost of doing it, minor units. */
  costMinor?: number;
  /** For overlap: the predecessor to overlap with, and by how much. */
  predecessor?: string;
  reason?: string;
}

export interface Scenario {
  id: string;
  name: string;
  changes: Change[];
}

export interface ScenarioResult {
  id: string;
  name: string;
  /** Project duration in days after the changes. */
  durationDays: number;
  /** Baseline duration − this one. Positive = recovered. */
  recoveredDays: number;
  costMinor: number;
  /** Cost per day recovered. Infinity when nothing is recovered. */
  costPerDayMinor: number;
  criticalPath: string[];
  /** Changes that did nothing, with the reason. */
  wasted: { change: Change; why: string }[];
  warnings: string[];
  summary: string;
}

/**
 * A row in the shape cpm.ts actually consumes: a `schedule_activity` artifact,
 * with everything under `payload`.
 *
 * Worth stating because it is not obvious from the outside — computeCpm() reads
 * `payload.activity` as the key, `payload.duration_days`, and typed links from
 * `payload.depends_on`. A module written against a flatter shape loads, runs,
 * and silently computes a network with no links in it, which produces plausible
 * durations and a critical path that is simply the longest single activity.
 */
export interface Row {
  payload: {
    activity: string;
    duration_days?: number;
    depends_on?: { activity: string; type?: string; lag_days?: number }[];
    /** The untyped form cpm.ts also accepts: plain names, all finish-to-start. */
    predecessors?: string[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

const clone = (rows: Row[]): Row[] => rows.map((r) => ({
  ...r,
  payload: {
    ...r.payload,
    depends_on: (r.payload.depends_on ?? []).map((d) => ({ ...d })),
    predecessors: r.payload.predecessors ? [...r.payload.predecessors] : undefined,
  },
}));

/** The typed link list, promoting the string form so a change can edit it. */
function linksOf(row: Row): { activity: string; type?: string; lag_days?: number }[] {
  if (row.payload.depends_on?.length) return row.payload.depends_on;
  const simple = (row.payload.predecessors ?? []).map((a) => ({ activity: a, type: "FS", lag_days: 0 }));
  row.payload.depends_on = simple;
  row.payload.predecessors = undefined;
  return simple;
}

/**
 * Apply one scenario to a copy and recompute.
 *
 * Every change is checked against the baseline critical path, and one that
 * touches an activity with float is reported as wasted rather than silently
 * counted — the arithmetic still runs, so the report shows it cost money and
 * moved nothing.
 */
export function runScenario(baselineRows: Row[], scenario: Scenario): ScenarioResult {
  const baseline = computeCpm(clone(baselineRows));
  const criticalKeys = new Set(baseline.criticalPath.map((n) => n.key));

  const rows = clone(baselineRows);
  const byKey = new Map(rows.map((r) => [r.payload.activity, r] as const));
  const wasted: { change: Change; why: string }[] = [];
  const warnings: string[] = [];
  let costMinor = 0;

  for (const change of scenario.changes) {
    const row = byKey.get(change.activity);
    if (!row) {
      warnings.push(`${change.activity} is not in the programme; the change was ignored.`);
      continue;
    }
    costMinor += change.costMinor ?? 0;

    const onCritical = criticalKeys.has(change.activity);
    if (!onCritical && (change.kind === "crash" || change.kind === "overlap")) {
      wasted.push({
        change,
        why: `${change.activity} is not on the critical path, so shortening it cannot move the finish date.`,
      });
    }

    switch (change.kind) {
      case "crash": {
        const current = Number(row.payload.duration_days ?? 0);
        const next = Math.max(1, current - (change.days ?? 0));
        if (next === current) warnings.push(`${change.activity} could not be crashed below its current duration.`);
        row.payload.duration_days = next;
        break;
      }
      case "extend":
        row.payload.duration_days = Number(row.payload.duration_days ?? 0) + (change.days ?? 0);
        break;
      case "overlap": {
        // Turn a finish-to-start link into a start-to-start with a lag, which
        // is what fast-tracking actually is.
        const link = linksOf(row).find((p) => p.activity === change.predecessor);
        if (!link) {
          warnings.push(`${change.activity} does not depend on ${change.predecessor}; nothing to overlap.`);
          break;
        }
        link.type = "SS";
        link.lag_days = Math.max(0, (change.days ?? 0));
        break;
      }
      case "resequence":
        row.payload.depends_on = linksOf(row).filter((p) => p.activity !== change.predecessor);
        break;
      case "remove":
        byKey.delete(change.activity);
        break;
    }
  }

  const kept = rows.filter((r) => byKey.has(r.payload.activity));
  // A removed activity leaves dangling references; cpm.ts drops them and warns,
  // but cleaning them here keeps the scenario's warnings about the scenario.
  for (const r of kept) {
    r.payload.depends_on = linksOf(r).filter((p) => byKey.has(p.activity));
  }

  const result = computeCpm(kept);
  const recovered = baseline.total - result.total;

  return {
    id: scenario.id,
    name: scenario.name,
    durationDays: result.total,
    recoveredDays: recovered,
    costMinor,
    costPerDayMinor: recovered > 0 ? Math.round(costMinor / recovered) : Infinity,
    criticalPath: result.criticalPath.map((n) => n.key),
    wasted,
    warnings: [...warnings, ...result.warnings],
    summary:
      recovered > 0
        ? `${scenario.name}: recovers ${recovered} day(s) for ${money(costMinor)} (${money(Math.round(costMinor / recovered))}/day).`
        : recovered === 0
          ? `${scenario.name}: costs ${money(costMinor)} and recovers nothing.`
          : `${scenario.name}: ${Math.abs(recovered)} day(s) WORSE than the baseline.`,
  };
}

export interface Comparison {
  baselineDays: number;
  scenarios: ScenarioResult[];
  /** Cheapest per day among those that actually recover time. */
  best: ScenarioResult | null;
  summary: string;
}

/**
 * Compare options side by side.
 *
 * Ranked by cost per day recovered rather than by days recovered, because the
 * option that saves the most is routinely the one that cannot be afforded, and
 * a comparison that leads with it invites the wrong conversation.
 */
export function compareScenarios(baselineRows: Row[], scenarios: Scenario[]): Comparison {
  const baseline = computeCpm(clone(baselineRows));
  const results = scenarios.map((s) => runScenario(baselineRows, s));
  const effective = results.filter((r) => r.recoveredDays > 0).sort((a, b) => a.costPerDayMinor - b.costPerDayMinor);
  const best = effective[0] ?? null;

  return {
    baselineDays: baseline.total,
    scenarios: results.sort((a, b) => b.recoveredDays - a.recoveredDays),
    best,
    summary: best
      ? `Best value: ${best.name}, ${best.recoveredDays} day(s) at ${money(best.costPerDayMinor)}/day.`
      : "No scenario recovers any time — the finish date has to move, or scope has to come out.",
  };
}

const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Schedule health scoring.
//
// Most programmes that fail an audit fail it structurally, not because the
// dates are wrong but because the network cannot support the dates: activities
// with no predecessor, negative float nobody noticed, a hard constraint holding
// a date that the logic says is impossible. A client's planner finds these in
// twenty minutes, and finding them first is the entire value here.
//
// The checks follow the DCMA 14-point conventions, which are the ones a
// government or oil-and-gas client will actually run against a submission. Not
// all fourteen apply to a bid programme, so the subset implemented is the
// structural half — the part computable from logic and float alone, without
// resource loading or actuals.
//
// Every check reports the offending activities, not just a count. A score with
// no list attached tells a planner they have a problem and not where it is.

import type { CpmNode } from "../cpm";

export type CheckKey =
  | "logic"          // missing predecessor or successor
  | "negative_float"
  | "high_float"
  | "long_duration"
  | "lags"
  | "leads"          // negative lag — the one that hides real slack
  | "hard_constraints"
  | "critical_path_share";

export interface CheckResult {
  key: CheckKey;
  label: string;
  /** Fraction failing, 0..1 — lower is better for every check here. */
  ratio: number;
  count: number;
  total: number;
  /** DCMA convention, where one exists. */
  threshold: number;
  passed: boolean;
  offenders: string[];
  note: string;
}

export interface HealthReport {
  checks: CheckResult[];
  /** 0..100. Weighted, and deliberately harsh on logic. */
  score: number;
  grade: "sound" | "workable" | "weak" | "unsubmittable";
  headline: string;
}

export interface HealthOptions {
  /** Activities longer than this are flagged. DCMA uses 44 working days. */
  longDurationDays?: number;
  /** Float above this is suspiciously high. DCMA uses 44 days. */
  highFloatDays?: number;
  /** Activities carrying a date constraint, by key. */
  constrainedKeys?: string[];
}

/* Logic is weighted hardest because everything else is computed FROM it: float
   on a network with dangling activities is not wrong so much as meaningless. */
const WEIGHTS: Record<CheckKey, number> = {
  logic: 3,
  negative_float: 3,
  hard_constraints: 2,
  leads: 2,
  high_float: 1,
  long_duration: 1,
  lags: 1,
  critical_path_share: 1,
};

export function health(nodes: CpmNode[], opts: HealthOptions = {}): HealthReport {
  const longDuration = opts.longDurationDays ?? 44;
  const highFloat = opts.highFloatDays ?? 44;
  const constrained = new Set(opts.constrainedKeys ?? []);
  const total = nodes.length;

  const hasSuccessor = new Set<string>();
  for (const n of nodes) for (const l of n.links) hasSuccessor.add(l.activity);

  // Milestones legitimately have no duration, and the first and last activity
  // legitimately lack a predecessor or successor. Excluding them stops the
  // check reporting the shape of every correct programme as a fault.
  const first = nodes.filter((n) => !n.links.length);
  const dangling = nodes.filter(
    (n) => n.links.length === 0 && !hasSuccessor.has(n.key),
  );

  const checks: CheckResult[] = [];
  const add = (
    key: CheckKey, label: string, offenders: CpmNode[], threshold: number, note: string,
    denominator = total,
  ) => {
    const ratio = denominator ? offenders.length / denominator : 0;
    checks.push({
      key, label, ratio, count: offenders.length, total: denominator, threshold,
      passed: ratio <= threshold,
      offenders: offenders.slice(0, 10).map((n) => n.name || n.key),
      note,
    });
  };

  add("logic", "Activities with no predecessor and no successor", dangling, 0.05,
      "An activity connected to nothing floats free of the programme; its dates are an assertion, not a result.");
  add("negative_float", "Negative float", nodes.filter((n) => n.float < 0), 0,
      "Negative float means the network cannot deliver the date it is being held to. It is never acceptable in a submission.");
  add("high_float", `Float above ${highFloat} days`, nodes.filter((n) => n.float > highFloat), 0.05,
      "Very high float usually means missing logic rather than genuine slack.");
  add("long_duration", `Duration above ${longDuration} days`, nodes.filter((n) => n.dur > longDuration), 0.05,
      "Long activities hide progress: they sit at 50% for months and cannot be measured.");
  add("lags", "Links with a positive lag",
      nodes.filter((n) => n.links.some((l) => l.lag_days > 0)), 0.05,
      "A lag is time nobody owns. Where it represents real work — curing, delivery — it should be an activity.");
  add("leads", "Links with a negative lag (lead)",
      nodes.filter((n) => n.links.some((l) => l.lag_days < 0)), 0,
      "A lead lets a successor start before its predecessor finishes, which conceals float and is rejected outright by most clients.");
  add("hard_constraints", "Date-constrained activities",
      nodes.filter((n) => constrained.has(n.key)), 0.05,
      "A hard constraint overrides the logic. Too many and the programme is a wish list with a network drawn around it.");

  const criticalShare = total ? nodes.filter((n) => n.critical).length / total : 0;
  checks.push({
    key: "critical_path_share",
    label: "Share of activities on the critical path",
    ratio: criticalShare,
    count: nodes.filter((n) => n.critical).length,
    total,
    threshold: 0.5,
    // Both extremes are wrong: everything critical means no float anywhere,
    // which is not a plan; almost nothing critical usually means broken logic.
    passed: criticalShare <= 0.5 && criticalShare > 0,
    offenders: [],
    note: criticalShare === 0
      ? "No critical path at all — the network is not connected end to end."
      : criticalShare > 0.5
        ? "More than half the programme is critical; there is no room for anything to go wrong."
        : "Healthy proportion of critical activities.",
  });

  const weightSum = checks.reduce((s, c) => s + WEIGHTS[c.key], 0);
  const earned = checks.reduce((s, c) => s + (c.passed ? WEIGHTS[c.key] : 0), 0);
  const score = Math.round((earned / weightSum) * 100);

  const failedHard = checks.filter((c) => !c.passed && WEIGHTS[c.key] >= 3);
  const grade: HealthReport["grade"] =
    failedHard.length ? "unsubmittable" : score >= 90 ? "sound" : score >= 70 ? "workable" : "weak";

  const failed = checks.filter((c) => !c.passed);
  return {
    checks,
    score,
    grade,
    headline: failed.length
      ? `${score}/100 — ${grade}. Failing: ${failed.map((c) => c.label.toLowerCase()).join("; ")}.`
      : `${score}/100 — ${grade}. All structural checks pass.`,
  };
}

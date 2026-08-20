// Baselines and schedule versions.
//
// A programme without a baseline cannot answer the only question that matters
// in a delay conversation: compared to WHAT. Re-planning without one is how a
// job stays permanently "on programme" while finishing eight months late —
// every month the dates move, and every month the current programme agrees
// with itself.
//
// A baseline here is therefore immutable once set. Re-baselining does not edit
// it; it stores another one and records why, so the sequence of baselines is
// itself the story of the job. Variance is always measured against a named
// baseline, never against "the last version", because drift measured against
// something that also drifted measures nothing.

export interface BaselineActivity {
  key: string;
  name: string;
  startDate: string;
  finishDate: string;
  durationDays: number;
  critical?: boolean;
}

export interface Baseline {
  id: string;
  /** 0 is the contract programme; 1+ are approved re-baselines. */
  version: number;
  label: string;
  /** Why a re-baseline was permitted. Empty on version 0. */
  reason: string;
  setAt: string;
  setBy?: string | null;
  activities: BaselineActivity[];
  /** Once true, the rows above may never change. */
  frozen: boolean;
}

export type VarianceState = "on_time" | "ahead" | "slipping" | "late" | "new" | "removed";

export interface ActivityVariance {
  key: string;
  name: string;
  state: VarianceState;
  baselineStart?: string;
  baselineFinish?: string;
  currentStart?: string;
  currentFinish?: string;
  /** Positive = later than baseline. Calendar days. */
  startVarianceDays: number;
  finishVarianceDays: number;
  durationChangeDays: number;
}

export interface VarianceReport {
  baselineLabel: string;
  activities: ActivityVariance[];
  /** Slip of the latest finish across the whole programme. */
  projectFinishVarianceDays: number;
  slipping: number;
  ahead: number;
  added: number;
  removed: number;
  /** The handful worth putting in front of somebody. */
  worst: ActivityVariance[];
  summary: string;
}

const days = (from?: string, to?: string): number =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : 0;

/** Capture a baseline. Frozen from the moment it is taken. */
export function capture(
  version: number, label: string, activities: BaselineActivity[], setAt: string,
  reason = "", setBy?: string,
): Baseline {
  return {
    id: `bl-${version}`, version, label, reason, setAt, setBy,
    activities: activities.map((a) => ({ ...a })),
    frozen: true,
  };
}

export interface Refusal { ok: false; reason: string }
export type Result<T> = { ok: true; value: T } | Refusal;

/**
 * Re-baseline.
 *
 * Requires a reason, in words. The requirement is the control: an unexplained
 * re-baseline is indistinguishable from hiding a delay, and asking for the
 * sentence at the moment it happens is the only time anybody can still write it
 * honestly.
 */
export function rebaseline(
  previous: Baseline, activities: BaselineActivity[], at: string, reason: string, by?: string,
): Result<Baseline> {
  if (!reason || reason.trim().length < 10) {
    return { ok: false, reason: "A re-baseline needs a stated reason — an unexplained one cannot be told apart from concealing slippage." };
  }
  return {
    ok: true,
    value: capture(previous.version + 1, `Baseline ${previous.version + 1}`, activities, at, reason.trim(), by),
  };
}

/** Compare the live programme against a named baseline. */
export function variance(baseline: Baseline, current: BaselineActivity[]): VarianceReport {
  const byKey = new Map(current.map((a) => [a.key, a]));
  const seen = new Set<string>();
  const out: ActivityVariance[] = [];

  for (const b of baseline.activities) {
    const c = byKey.get(b.key);
    seen.add(b.key);
    if (!c) {
      out.push({
        key: b.key, name: b.name, state: "removed",
        baselineStart: b.startDate, baselineFinish: b.finishDate,
        startVarianceDays: 0, finishVarianceDays: 0, durationChangeDays: 0,
      });
      continue;
    }
    const startVariance = days(b.startDate, c.startDate);
    const finishVariance = days(b.finishDate, c.finishDate);
    const state: VarianceState =
      finishVariance > 0 ? (startVariance > 0 ? "late" : "slipping")
      : finishVariance < 0 ? "ahead"
      : "on_time";
    out.push({
      key: b.key, name: b.name, state,
      baselineStart: b.startDate, baselineFinish: b.finishDate,
      currentStart: c.startDate, currentFinish: c.finishDate,
      startVarianceDays: startVariance,
      finishVarianceDays: finishVariance,
      durationChangeDays: c.durationDays - b.durationDays,
    });
  }

  for (const c of current) {
    if (seen.has(c.key)) continue;
    out.push({
      key: c.key, name: c.name, state: "new",
      currentStart: c.startDate, currentFinish: c.finishDate,
      startVarianceDays: 0, finishVarianceDays: 0, durationChangeDays: 0,
    });
  }

  const latest = (rows: { finishDate: string }[]) =>
    rows.reduce((m, r) => (Date.parse(r.finishDate) > Date.parse(m) ? r.finishDate : m), rows[0]?.finishDate ?? "");
  const projectFinishVarianceDays =
    baseline.activities.length && current.length
      ? days(latest(baseline.activities), latest(current))
      : 0;

  const slipping = out.filter((a) => a.state === "late" || a.state === "slipping").length;
  const ahead = out.filter((a) => a.state === "ahead").length;
  const added = out.filter((a) => a.state === "new").length;
  const removed = out.filter((a) => a.state === "removed").length;

  return {
    baselineLabel: baseline.label,
    activities: out,
    projectFinishVarianceDays,
    slipping, ahead, added, removed,
    worst: [...out].sort((a, b) => b.finishVarianceDays - a.finishVarianceDays).slice(0, 5),
    summary:
      projectFinishVarianceDays === 0
        ? `On ${baseline.label}: completion unchanged, ${slipping} activity(ies) slipping within float.`
        : `Against ${baseline.label}: completion ${projectFinishVarianceDays > 0 ? "later" : "earlier"} by ` +
          `${Math.abs(projectFinishVarianceDays)} day(s); ${slipping} slipping, ${ahead} ahead, ` +
          `${added} added, ${removed} removed.`,
  };
}

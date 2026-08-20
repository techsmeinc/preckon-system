// Schedule reconciliation and migration confidence.
//
// When a programme comes in from somewhere else — a client's P6 file, a
// subcontractor's own plan, last month's version of our own — the question is
// never "did it load". It is "how much of it can I trust". A file that imports
// cleanly and quietly drops a calendar, or maps eight constraint types onto
// three, has not migrated: it has changed the programme while reporting success.
//
// So reconciliation compares the two and scores confidence on what actually
// survived. The score is deliberately harsh about the things that change dates
// silently — calendars, constraints, lags — and relaxed about cosmetics like
// activity names, because a renamed activity is annoying and a dropped
// constraint is wrong.

export interface ReconActivity {
  key: string;
  name: string;
  durationDays: number;
  startDate?: string | null;
  finishDate?: string | null;
  predecessors?: { activity: string; type?: string; lagDays?: number }[];
  calendarId?: string | null;
  constraintType?: string | null;
  constraintDate?: string | null;
  percentComplete?: number | null;
}

export type Difference =
  | "missing"            // in source, not in ours
  | "extra"              // in ours, not in source
  | "duration"
  | "dates"
  | "logic"              // a link changed, was added or was lost
  | "calendar"
  | "constraint"
  | "progress"
  | "name";

export interface ActivityDiff {
  key: string;
  name: string;
  differences: Difference[];
  detail: string[];
  /** True when a difference here can move dates on its own. */
  material: boolean;
}

/* Cosmetic differences do not reduce confidence; the ones that silently move
   dates do. Logic and calendars are weighted hardest because a lost link or a
   substituted calendar changes every date downstream of it without warning. */
const WEIGHT: Record<Difference, number> = {
  missing: 10, logic: 8, calendar: 8, constraint: 6,
  duration: 4, dates: 3, progress: 2, extra: 2, name: 0,
};

const MATERIAL: Difference[] = ["missing", "logic", "calendar", "constraint", "duration", "dates"];

export interface Reconciliation {
  matched: number;
  sourceOnly: string[];
  targetOnly: string[];
  diffs: ActivityDiff[];
  /** 0..100. What survived the move, weighted by what matters. */
  confidence: number;
  materialDiffs: number;
  /** Grouped counts, for the migration report. */
  byDifference: { difference: Difference; count: number }[];
  trustworthy: boolean;
  summary: string;
}

const links = (a: ReconActivity) =>
  (a.predecessors ?? [])
    .map((p) => `${p.activity}:${p.type ?? "FS"}:${p.lagDays ?? 0}`)
    .sort()
    .join("|");

/**
 * Compare an imported programme against ours.
 *
 * Matched on activity key, since that is what survives a round trip; names are
 * compared but never used for identity, because renaming is the most common
 * harmless edit and matching on it would report a whole programme as replaced.
 */
export function reconcile(source: ReconActivity[], target: ReconActivity[]): Reconciliation {
  const sourceMap = new Map(source.map((a) => [a.key, a] as const));
  const targetMap = new Map(target.map((a) => [a.key, a] as const));
  const diffs: ActivityDiff[] = [];

  const sourceOnly = source.filter((a) => !targetMap.has(a.key)).map((a) => a.key);
  const targetOnly = target.filter((a) => !sourceMap.has(a.key)).map((a) => a.key);

  for (const key of sourceOnly) {
    const a = sourceMap.get(key)!;
    diffs.push({
      key, name: a.name, differences: ["missing"], material: true,
      detail: [`"${a.name}" is in the source programme and did not arrive.`],
    });
  }
  for (const key of targetOnly) {
    const a = targetMap.get(key)!;
    diffs.push({
      key, name: a.name, differences: ["extra"], material: false,
      detail: [`"${a.name}" exists here and not in the source.`],
    });
  }

  let matched = 0;
  for (const [key, s] of sourceMap) {
    const t = targetMap.get(key);
    if (!t) continue;
    matched += 1;

    const differences: Difference[] = [];
    const detail: string[] = [];

    if (s.name !== t.name) {
      differences.push("name");
      detail.push(`Renamed: "${s.name}" → "${t.name}".`);
    }
    if (s.durationDays !== t.durationDays) {
      differences.push("duration");
      detail.push(`Duration ${s.durationDays} → ${t.durationDays} days.`);
    }
    if ((s.startDate ?? null) !== (t.startDate ?? null) || (s.finishDate ?? null) !== (t.finishDate ?? null)) {
      differences.push("dates");
      detail.push(`Dates ${s.startDate ?? "—"}..${s.finishDate ?? "—"} → ${t.startDate ?? "—"}..${t.finishDate ?? "—"}.`);
    }
    if (links(s) !== links(t)) {
      differences.push("logic");
      detail.push(`Logic changed: ${links(s) || "none"} → ${links(t) || "none"}.`);
    }
    if ((s.calendarId ?? null) !== (t.calendarId ?? null)) {
      differences.push("calendar");
      detail.push(
        `Calendar ${s.calendarId ?? "—"} → ${t.calendarId ?? "—"}. A substituted calendar moves every date on this activity without changing its duration.`,
      );
    }
    if ((s.constraintType ?? null) !== (t.constraintType ?? null) || (s.constraintDate ?? null) !== (t.constraintDate ?? null)) {
      differences.push("constraint");
      detail.push(`Constraint ${s.constraintType ?? "none"} ${s.constraintDate ?? ""} → ${t.constraintType ?? "none"} ${t.constraintDate ?? ""}.`);
    }
    if ((s.percentComplete ?? 0) !== (t.percentComplete ?? 0)) {
      differences.push("progress");
      detail.push(`Progress ${s.percentComplete ?? 0}% → ${t.percentComplete ?? 0}%.`);
    }

    if (differences.length) {
      diffs.push({
        key, name: t.name, differences, detail,
        material: differences.some((d) => MATERIAL.includes(d)),
      });
    }
  }

  // Confidence: every activity starts at full marks and loses weight for each
  // difference that could move a date. Expressed against the source, because
  // the question is how much of THEIR programme we are holding.
  const possible = Math.max(1, source.length) * 10;
  const lost = diffs.reduce(
    (s, d) => s + d.differences.reduce((x, k) => x + WEIGHT[k], 0), 0,
  );
  const confidence = Math.max(0, Math.round(((possible - lost) / possible) * 100));

  const counts = new Map<Difference, number>();
  for (const d of diffs) for (const k of d.differences) counts.set(k, (counts.get(k) ?? 0) + 1);

  const materialDiffs = diffs.filter((d) => d.material).length;
  diffs.sort((a, b) => Number(b.material) - Number(a.material) || a.key.localeCompare(b.key));

  return {
    matched,
    sourceOnly,
    targetOnly,
    diffs,
    confidence,
    materialDiffs,
    byDifference: [...counts.entries()]
      .map(([difference, count]) => ({ difference, count }))
      .sort((a, b) => WEIGHT[b.difference] * b.count - WEIGHT[a.difference] * a.count),
    trustworthy: confidence >= 90 && !sourceOnly.length,
    summary:
      sourceOnly.length
        ? `${confidence}% confidence — ${sourceOnly.length} activity(ies) did not arrive at all. Do not plan against this until they are explained.`
        : materialDiffs
          ? `${confidence}% confidence — ${materialDiffs} activity(ies) differ in ways that move dates.`
          : `${confidence}% confidence — differences are cosmetic.`,
  };
}

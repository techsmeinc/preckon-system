// Budget and cost forecast: the cost report a commercial manager lives in.
//
// evm.ts computes performance indices from a data date. That answers "how are
// we doing". This answers the question the board actually asks: "what will this
// job finish at, and how sure are you".
//
// ── THE FOUR NUMBERS AND WHY THEY DIVERGE ────────────────────────────────────
//
// A cost report has four figures per line and they are all different:
//
//   Budget      what was allowed when the job was won
//   Committed   what has been ordered — real, contractual, not yet all paid
//   Actual      what has been certified and paid
//   Forecast    what it will finish at
//
// The gap that matters is COMMITTED versus BUDGET, and it is the one most
// reports bury. Actual cost lags reality by weeks; a purchase order signed
// today is money gone today, and a report that shows only actuals says a
// package is 40% spent when it is 100% committed. Overruns become visible when
// the invoices arrive, which is months after the decision that caused them.
//
// ── FORECASTING HONESTLY ─────────────────────────────────────────────────────
//
// Three methods, because they disagree and the disagreement is the information:
//
//   Committed   final = committed + remaining budget. Assumes what is ordered
//               is what it costs. Best where procurement is complete.
//   Performance final = budget / CPI. Assumes the overrun so far continues.
//               Brutal early, and usually right.
//   Manual      somebody's number. The only one that can account for a recovery
//               plan, and the only one that can be wishful.
//
// Where they disagree by more than a threshold, the line is flagged. A single
// blended forecast would hide exactly the lines worth arguing about.

export type ForecastMethod = "committed" | "performance" | "manual";

export interface BudgetLine {
  key: string;
  description: string;
  package?: string;
  budgetMinor: number;
  /** Ordered: signed subcontracts and purchase orders. */
  committedMinor: number;
  /** Certified and paid. */
  actualMinor: number;
  /** Physical progress 0–1, for the performance forecast. */
  percentComplete?: number;
  /** An estimator's own final figure, where one exists. */
  manualForecastMinor?: number | null;
  /** Approved variations, which move the budget rather than blow it. */
  variationMinor?: number;
}

export interface ForecastLine {
  key: string;
  description: string;
  package: string;
  /** Original budget plus approved variations — what we are measured against. */
  budgetMinor: number;
  committedMinor: number;
  actualMinor: number;
  /** Committed but not yet paid. */
  accruedMinor: number;
  /** Budget not yet committed — the only money still controllable. */
  uncommittedMinor: number;
  forecastMinor: number;
  method: ForecastMethod;
  /** Forecast minus budget. Positive is an overrun. */
  varianceMinor: number;
  variancePct: number;
  /** What each method says, so the choice can be argued with. */
  candidates: { method: ForecastMethod; valueMinor: number; why: string }[];
  /** True where the methods disagree materially. */
  contested: boolean;
  /** True where commitment alone has already passed the budget. */
  overcommitted: boolean;
  why: string;
}

export interface BudgetReport {
  lines: ForecastLine[];
  budgetMinor: number;
  committedMinor: number;
  actualMinor: number;
  forecastMinor: number;
  varianceMinor: number;
  variancePct: number;
  /** Budget not yet committed across the job — the remaining room to manoeuvre. */
  uncommittedMinor: number;
  /** Lines worth a conversation, worst variance first. */
  exceptions: ForecastLine[];
  byPackage: { package: string; budgetMinor: number; forecastMinor: number; varianceMinor: number }[];
  warnings: string[];
  summary: string;
}

export interface ForecastOptions {
  /** Preferred method. Falls back per line where the inputs are missing. */
  method?: ForecastMethod;
  /** Disagreement between methods, as a proportion of budget, that flags a line. */
  contestedThresholdPct?: number;
  /** Variance, as a proportion of budget, that puts a line in the exceptions. */
  exceptionThresholdPct?: number;
}

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * Build the cost report.
 *
 * Every line gets every applicable forecast, and the chosen one is recorded
 * alongside the others. A cost report whose numbers cannot be interrogated gets
 * argued with rather than acted on, and the argument is always about which
 * assumption was used.
 */
export function forecast(lines: BudgetLine[], opts: ForecastOptions = {}): BudgetReport {
  const preferred = opts.method ?? "committed";
  const contestedAt = opts.contestedThresholdPct ?? 0.1;
  const exceptionAt = opts.exceptionThresholdPct ?? 0.05;
  const warnings: string[] = [];

  const out: ForecastLine[] = lines.map((l) => {
    // Approved variations move the budget. Charging a variation against the
    // original budget shows an overrun that is really a scope change, and that
    // is how a well-run job looks like a failing one.
    const budget = l.budgetMinor + (l.variationMinor ?? 0);
    const committed = l.committedMinor;
    const actual = l.actualMinor;
    const accrued = Math.max(0, committed - actual);
    const uncommitted = budget - committed;

    const candidates: ForecastLine["candidates"] = [];

    /* Committed: what is ordered, plus whatever budget is left uncommitted.
       Floored at the committed figure — once ordered, the money is gone, and a
       forecast below commitment is arithmetic that ignores a contract. */
    const committedForecast = Math.max(committed, committed + Math.max(0, uncommitted));
    candidates.push({
      method: "committed",
      valueMinor: committedForecast,
      why: uncommitted >= 0
        ? `${committed} committed plus ${uncommitted} of budget not yet ordered.`
        : `${committed} already committed, which is ${-uncommitted} over the ${budget} budget. Nothing left to control.`,
    });

    /* Performance: extrapolate the overrun so far. Needs progress to be
       meaningful — without it, CPI is undefined and the number would be a
       guess wearing a formula. */
    const progress = l.percentComplete;
    if (progress != null && progress > 0 && actual > 0) {
      const earned = budget * Math.min(1, progress);
      const cpi = earned / actual;
      const perf = cpi > 0 ? Math.round(budget / cpi) : budget;
      candidates.push({
        method: "performance",
        valueMinor: perf,
        why: `${Math.round(progress * 100)}% complete having spent ${actual} against ${Math.round(earned)} earned (CPI ${Math.round(cpi * 100) / 100}). At this rate the line finishes at ${perf}.`,
      });
    }

    if (l.manualForecastMinor != null) {
      candidates.push({
        method: "manual",
        valueMinor: l.manualForecastMinor,
        why: "Estimator's own final figure. The only method that can account for a recovery plan — and the only one that can be optimistic.",
      });
    }

    // Fall back rather than fail: a line without progress still gets a
    // forecast, and the method it actually used is recorded.
    const chosen = candidates.find((c) => c.method === preferred) ?? candidates[0];
    const values = candidates.map((c) => c.valueMinor);
    const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    const contested = budget > 0 && spread / budget > contestedAt;

    const variance = chosen.valueMinor - budget;

    return {
      key: l.key,
      description: l.description,
      package: l.package ?? "Unpackaged",
      budgetMinor: budget,
      committedMinor: committed,
      actualMinor: actual,
      accruedMinor: accrued,
      uncommittedMinor: uncommitted,
      forecastMinor: chosen.valueMinor,
      method: chosen.method,
      varianceMinor: variance,
      variancePct: pct(variance, budget),
      candidates,
      contested,
      overcommitted: committed > budget,
      why: describe(chosen, variance, budget, committed, contested, spread),
    };
  });

  const sum = (f: (l: ForecastLine) => number) => out.reduce((s, l) => s + f(l), 0);
  const budgetMinor = sum((l) => l.budgetMinor);
  const forecastMinor = sum((l) => l.forecastMinor);
  const varianceMinor = forecastMinor - budgetMinor;

  const overcommitted = out.filter((l) => l.overcommitted);
  if (overcommitted.length) {
    warnings.push(
      `${overcommitted.length} line(s) are committed beyond budget. Commitment is contractual — that money is spent whatever the actuals say.`,
    );
  }
  const noProgress = out.filter((l) => !l.candidates.some((c) => c.method === "performance"));
  if (noProgress.length === out.length && out.length > 0) {
    warnings.push(
      "No line carries progress, so no performance forecast could be computed. Every figure here assumes the committed cost is the final cost.",
    );
  }
  const contested = out.filter((l) => l.contested);
  if (contested.length) {
    warnings.push(
      `${contested.length} line(s) have forecasting methods that disagree materially. Those are the lines worth arguing about.`,
    );
  }

  const packages = [...new Set(out.map((l) => l.package))].sort().map((p) => {
    const mine = out.filter((l) => l.package === p);
    const b = mine.reduce((s, l) => s + l.budgetMinor, 0);
    const f = mine.reduce((s, l) => s + l.forecastMinor, 0);
    return { package: p, budgetMinor: b, forecastMinor: f, varianceMinor: f - b };
  });

  return {
    lines: out,
    budgetMinor,
    committedMinor: sum((l) => l.committedMinor),
    actualMinor: sum((l) => l.actualMinor),
    forecastMinor,
    varianceMinor,
    variancePct: pct(varianceMinor, budgetMinor),
    uncommittedMinor: sum((l) => l.uncommittedMinor),
    exceptions: out
      .filter((l) => l.budgetMinor > 0 && Math.abs(l.varianceMinor) / l.budgetMinor > exceptionAt)
      .sort((a, b) => b.varianceMinor - a.varianceMinor),
    byPackage: packages,
    warnings,
    summary: summarise(budgetMinor, forecastMinor, varianceMinor, overcommitted.length),
  };
}

function describe(
  chosen: { method: ForecastMethod; why: string }, variance: number, budget: number,
  committed: number, contested: boolean, spread: number,
): string {
  const parts: string[] = [chosen.why];
  parts.push(
    variance > 0 ? `Forecast overrun of ${variance} (${pct(variance, budget)}%).`
    : variance < 0 ? `Forecast saving of ${-variance} (${pct(-variance, budget)}%).`
    : "Forecast on budget.",
  );
  if (committed > budget) {
    parts.push(`Already committed ${committed - budget} beyond budget — this is contractual, not a projection.`);
  }
  if (contested) {
    parts.push(`Methods disagree by ${spread}; treat this figure as a position, not a fact.`);
  }
  return parts.join(" ");
}

function summarise(budget: number, forecast: number, variance: number, overcommitted: number): string {
  if (!budget) return "No budget lines.";
  const dir = variance > 0 ? "over" : variance < 0 ? "under" : "on";
  const parts = [
    variance === 0
      ? `Forecast ${forecast} against a budget of ${budget} — on budget.`
      : `Forecast ${forecast} against a budget of ${budget}: ${Math.abs(variance)} ${dir} (${Math.abs(pct(variance, budget))}%).`,
  ];
  if (overcommitted > 0) {
    parts.push(`${overcommitted} line(s) already committed past budget.`);
  }
  return parts.join(" ");
}

/**
 * Where the money went between two reports.
 *
 * A movement report, not two reports side by side. "The forecast moved £180k"
 * is a question; "£140k of it was the piling variation and £40k was groundworks
 * performance" is an answer, and the second is what a monthly cost meeting
 * exists to produce.
 */
export function movement(previous: BudgetReport, current: BudgetReport): {
  totalMinor: number;
  byLine: { key: string; description: string; deltaMinor: number; reason: string }[];
  newLines: string[];
  removedLines: string[];
  summary: string;
} {
  const prev = new Map(previous.lines.map((l) => [l.key, l] as const));
  const curr = new Map(current.lines.map((l) => [l.key, l] as const));

  const byLine: { key: string; description: string; deltaMinor: number; reason: string }[] = [];
  for (const [key, c] of curr) {
    const p = prev.get(key);
    if (!p) {
      byLine.push({
        key, description: c.description, deltaMinor: c.forecastMinor,
        reason: "New line since the last report.",
      });
      continue;
    }
    const delta = c.forecastMinor - p.forecastMinor;
    if (delta === 0) continue;
    // Attributed to the most likely single cause rather than left as a bare
    // number. Budget movement is scope; commitment movement is procurement;
    // anything else is performance.
    const budgetMoved = c.budgetMinor - p.budgetMinor;
    const committedMoved = c.committedMinor - p.committedMinor;
    const reason =
      budgetMoved !== 0 && Math.abs(budgetMoved) >= Math.abs(delta) * 0.8
        ? `Budget moved by ${budgetMoved} — approved variation, not an overrun.`
        : committedMoved !== 0 && Math.abs(committedMoved) >= Math.abs(delta) * 0.8
          ? `Commitment moved by ${committedMoved} — orders placed at a different figure from the allowance.`
          : p.method !== c.method
            ? `Forecast method changed from ${p.method} to ${c.method}.`
            : "Performance against the remaining work.";
    byLine.push({ key, description: c.description, deltaMinor: delta, reason });
  }

  byLine.sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor));
  const total = current.forecastMinor - previous.forecastMinor;
  const removed = [...prev.keys()].filter((k) => !curr.has(k));
  const added = [...curr.keys()].filter((k) => !prev.has(k));

  return {
    totalMinor: total,
    byLine,
    newLines: added,
    removedLines: removed,
    summary: total === 0
      ? "The forecast has not moved since the last report."
      : `Forecast moved ${total > 0 ? "up" : "down"} by ${Math.abs(total)}${byLine.length ? `, largest single mover ${byLine[0].description} at ${byLine[0].deltaMinor}` : ""}.`,
  };
}

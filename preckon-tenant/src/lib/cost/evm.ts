// Earned value.
//
// EVM answers one question a progress report cannot: are we behind because the
// work is late, or because the work is expensive? A job at 40% complete having
// spent 55% of its budget is in trouble; a job at 40% complete having spent 40%
// on 30% of the programme is ahead and cheap. Percent complete alone cannot
// tell those apart, and neither can a cost report.
//
// Three numbers do it, and everything else here is derived from them:
//
//   PV  planned value  — what we said this work would cost by now
//   EV  earned value   — budget for the work actually done
//   AC  actual cost    — what we have actually spent
//
// The discipline that makes it work is that EV is measured against the BUDGET,
// never against spend. Earning value at the rate you spend it makes CPI exactly
// 1.00 forever, which is the most common way EVM is implemented wrongly and the
// reason it gets a reputation for saying nothing.

export interface EvmInput {
  /** Budget at completion, minor units. */
  budgetMinor: number;
  /** Planned value to the data date — cumulative budget for scheduled work. */
  plannedValueMinor: number;
  /** Earned value: budgeted cost of work performed. */
  earnedValueMinor: number;
  /** Actual cost of work performed. */
  actualCostMinor: number;
  dataDate?: string;
}

export type Health = "ahead_and_under" | "on_plan" | "behind" | "over_cost" | "behind_and_over";

export interface Evm {
  budgetMinor: number;
  pvMinor: number;
  evMinor: number;
  acMinor: number;
  /** EV − PV. Negative = behind programme, in money. */
  scheduleVarianceMinor: number;
  /** EV − AC. Negative = over cost. */
  costVarianceMinor: number;
  /** EV / PV. Below 1 = behind. */
  spi: number;
  /** EV / AC. Below 1 = spending faster than earning. */
  cpi: number;
  /** Forecast total cost if current efficiency continues. */
  eacMinor: number;
  /** Forecast cost of the work remaining. */
  etcMinor: number;
  /** Budget − EAC. Negative = forecast overrun. */
  vacMinor: number;
  /** Efficiency the remaining work must achieve to finish on budget. */
  tcpi: number;
  percentComplete: number;
  percentSpent: number;
  health: Health;
  summary: string;
}

const pct = (n: number) => Math.round(n * 1000) / 10;
const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * Compute the full set from the three measurements.
 *
 * EAC uses the CPI method — budget divided by cost efficiency — because it is
 * the one that assumes the future behaves like the past, and on construction
 * work it usually does. The optimistic variant (AC + remaining budget) assumes
 * a project that has overspent every month will stop overspending tomorrow,
 * which is a forecast nobody should sign.
 */
export function evm(input: EvmInput): Evm {
  const { budgetMinor: bac, plannedValueMinor: pv, earnedValueMinor: ev, actualCostMinor: ac } = input;

  const sv = ev - pv;
  const cv = ev - ac;
  const spi = pv > 0 ? ev / pv : 1;
  const cpi = ac > 0 ? ev / ac : 1;

  // A job with no spend has no efficiency to project from; forecasting the
  // budget is the honest answer rather than dividing by zero.
  const eac = ac > 0 && cpi > 0 ? Math.round(bac / cpi) : bac;
  const etc = Math.max(0, eac - ac);
  const vac = bac - eac;
  const remaining = bac - ev;
  const tcpi = bac - ac !== 0 ? remaining / (bac - ac) : 1;

  const behind = spi < 0.95;
  const over = cpi < 0.95;
  const health: Health =
    behind && over ? "behind_and_over"
    : over ? "over_cost"
    : behind ? "behind"
    : spi > 1.05 && cpi > 1.05 ? "ahead_and_under"
    : "on_plan";

  return {
    budgetMinor: bac, pvMinor: pv, evMinor: ev, acMinor: ac,
    scheduleVarianceMinor: sv, costVarianceMinor: cv,
    spi: Math.round(spi * 1000) / 1000,
    cpi: Math.round(cpi * 1000) / 1000,
    eacMinor: eac, etcMinor: etc, vacMinor: vac,
    tcpi: Math.round(tcpi * 1000) / 1000,
    percentComplete: bac ? pct(ev / bac) : 0,
    percentSpent: bac ? pct(ac / bac) : 0,
    health,
    summary: describe({ spi, cpi, sv, cv, vac, tcpi, bac, ac }),
  };
}

function describe(x: {
  spi: number; cpi: number; sv: number; cv: number; vac: number; tcpi: number; bac: number; ac: number;
}): string {
  const parts: string[] = [];
  parts.push(
    x.spi < 0.95 ? `Behind programme: ${money(Math.abs(x.sv))} of work not yet done (SPI ${x.spi.toFixed(2)})`
    : x.spi > 1.05 ? `Ahead of programme (SPI ${x.spi.toFixed(2)})`
    : `On programme (SPI ${x.spi.toFixed(2)})`,
  );
  parts.push(
    x.cpi < 0.95 ? `over cost by ${money(Math.abs(x.cv))} (CPI ${x.cpi.toFixed(2)})`
    : x.cpi > 1.05 ? `under cost (CPI ${x.cpi.toFixed(2)})`
    : `on cost (CPI ${x.cpi.toFixed(2)})`,
  );
  if (x.vac < 0) {
    parts.push(
      `forecast overrun ${money(Math.abs(x.vac))}; the remaining work would have to run at ` +
      `${x.tcpi.toFixed(2)} efficiency to finish on budget` +
      (x.tcpi > 1.1 ? ", which almost never happens" : ""),
    );
  }
  return parts.join("; ") + ".";
}

export interface WorkPackage {
  id: string;
  name: string;
  budgetMinor: number;
  /** 0..100, measured physically — never inferred from spend. */
  percentComplete: number;
  plannedPercentComplete: number;
  actualCostMinor: number;
}

/**
 * Roll packages up into one position.
 *
 * EV is each package's budget times its PHYSICAL progress. Nothing here reads
 * actual cost to decide earned value: doing so would make CPI 1.00 by
 * construction and the whole exercise decorative.
 */
export function rollUp(packages: WorkPackage[], dataDate?: string): Evm & { packages: (WorkPackage & { evMinor: number; cpi: number })[] } {
  const rows = packages.map((p) => {
    const ev = Math.round((p.budgetMinor * Math.min(100, Math.max(0, p.percentComplete))) / 100);
    return { ...p, evMinor: ev, cpi: p.actualCostMinor > 0 ? Math.round((ev / p.actualCostMinor) * 1000) / 1000 : 1 };
  });
  const sum = (f: (p: typeof rows[number]) => number) => rows.reduce((a, p) => a + f(p), 0);

  const result = evm({
    budgetMinor: sum((p) => p.budgetMinor),
    plannedValueMinor: sum((p) => Math.round((p.budgetMinor * p.plannedPercentComplete) / 100)),
    earnedValueMinor: sum((p) => p.evMinor),
    actualCostMinor: sum((p) => p.actualCostMinor),
    dataDate,
  });
  return { ...result, packages: rows };
}

/** The packages doing the most damage, worst cost variance first. */
export function worstPerformers(
  rolled: ReturnType<typeof rollUp>, limit = 5,
): { id: string; name: string; cpi: number; overspendMinor: number }[] {
  return rolled.packages
    .map((p) => ({ id: p.id, name: p.name, cpi: p.cpi, overspendMinor: p.actualCostMinor - p.evMinor }))
    .filter((p) => p.overspendMinor > 0)
    .sort((a, b) => b.overspendMinor - a.overspendMinor)
    .slice(0, limit);
}

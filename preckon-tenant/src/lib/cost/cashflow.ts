// Cash flow and S-curves.
//
// Profit and cash are different questions, and only one of them closes a
// company. A job can be 8% profitable on paper and still run out of money in
// month four, because the spend goes out weekly and the money comes back on a
// certified, delayed, part-retained cycle.
//
// So this models the two curves separately and reports the gap between them:
//   - cost, spread across each activity's own duration
//   - income, being certified work, minus retention, paid after the payment lag
//
// The spread is an S-curve rather than a straight line because work does not
// start at full rate: it ramps up, runs, and tails off. Straight-line spreading
// flatters the early months, which is exactly where the funding requirement is
// decided.

export interface Activity {
  id: string;
  name: string;
  /** Month index from project start, 0-based. */
  startMonth: number;
  durationMonths: number;
  costMinor: number;
}

export interface CashflowTerms {
  /** Percent held back from each certificate. */
  retentionPct?: number;
  /** Months between doing the work and being paid for it. */
  paymentLagMonths?: number;
  /** Margin applied to cost to reach the certified value. */
  marginPct?: number;
  /** Half of retention typically returns at completion; the rest later. */
  retentionReleaseMonth?: number | null;
}

export interface CashflowMonth {
  month: number;
  costMinor: number;
  cumulativeCostMinor: number;
  incomeMinor: number;
  cumulativeIncomeMinor: number;
  /** Cumulative income − cumulative cost. Negative means funding the job. */
  netMinor: number;
}

export interface Cashflow {
  months: CashflowMonth[];
  totalCostMinor: number;
  totalIncomeMinor: number;
  /** The worst cumulative position, and when it happens. */
  peakFundingMinor: number;
  peakFundingMonth: number;
  retentionHeldMinor: number;
}

/**
 * The fraction of an activity's cost incurred by the end of month `i` of `n`.
 *
 * A symmetric cubic S-curve: slow, fast, slow. Chosen over a straight line
 * because it is what a construction activity actually does, and over anything
 * fancier because a curve nobody can explain in a meeting will not be trusted
 * in one.
 */
export function sCurveFraction(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

/** Cost per month for one activity, S-curve spread across its duration. */
export function spread(activity: Activity): Map<number, number> {
  const out = new Map<number, number>();
  const n = Math.max(1, Math.round(activity.durationMonths));
  let previous = 0;
  let allocated = 0;
  for (let i = 1; i <= n; i++) {
    const done = sCurveFraction(i / n);
    const share = Math.round(activity.costMinor * (done - previous));
    previous = done;
    allocated += share;
    out.set(activity.startMonth + i - 1, (out.get(activity.startMonth + i - 1) ?? 0) + share);
  }
  // Rounding each month independently loses or gains a few minor units; the
  // remainder lands on the final month so the activity totals exactly its cost.
  const drift = activity.costMinor - allocated;
  if (drift !== 0) {
    const last = activity.startMonth + n - 1;
    out.set(last, (out.get(last) ?? 0) + drift);
  }
  return out;
}

export function cashflow(activities: Activity[], terms: CashflowTerms = {}): Cashflow {
  const retentionPct = terms.retentionPct ?? 0;
  const lag = Math.max(0, Math.round(terms.paymentLagMonths ?? 0));
  const marginPct = terms.marginPct ?? 0;

  const costByMonth = new Map<number, number>();
  for (const a of activities) {
    for (const [month, amount] of spread(a)) {
      costByMonth.set(month, (costByMonth.get(month) ?? 0) + amount);
    }
  }
  if (!costByMonth.size) {
    return { months: [], totalCostMinor: 0, totalIncomeMinor: 0, peakFundingMinor: 0, peakFundingMonth: 0, retentionHeldMinor: 0 };
  }

  const lastCostMonth = Math.max(...costByMonth.keys());
  const releaseMonth = terms.retentionReleaseMonth ?? null;
  const lastMonth = Math.max(lastCostMonth + lag, releaseMonth ?? 0);

  const incomeByMonth = new Map<number, number>();
  let retentionHeld = 0;
  for (const [month, cost] of costByMonth) {
    const certified = Math.round(cost * (1 + marginPct / 100));
    const retained = Math.round((certified * retentionPct) / 100);
    retentionHeld += retained;
    const paid = certified - retained;
    incomeByMonth.set(month + lag, (incomeByMonth.get(month + lag) ?? 0) + paid);
  }
  if (releaseMonth != null && retentionHeld) {
    incomeByMonth.set(releaseMonth, (incomeByMonth.get(releaseMonth) ?? 0) + retentionHeld);
  }

  const months: CashflowMonth[] = [];
  let cumCost = 0, cumIncome = 0, peak = 0, peakMonth = 0;
  for (let m = 0; m <= lastMonth; m++) {
    const cost = costByMonth.get(m) ?? 0;
    const income = incomeByMonth.get(m) ?? 0;
    cumCost += cost;
    cumIncome += income;
    const net = cumIncome - cumCost;
    if (net < peak) { peak = net; peakMonth = m; }
    months.push({
      month: m, costMinor: cost, cumulativeCostMinor: cumCost,
      incomeMinor: income, cumulativeIncomeMinor: cumIncome, netMinor: net,
    });
  }

  return {
    months,
    totalCostMinor: cumCost,
    totalIncomeMinor: cumIncome,
    // Reported positive: "you need this much cash", not "minus this much".
    peakFundingMinor: Math.abs(peak),
    peakFundingMonth: peakMonth,
    retentionHeldMinor: releaseMonth != null ? 0 : retentionHeld,
  };
}

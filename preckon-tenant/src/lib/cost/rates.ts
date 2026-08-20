// The rate library.
//
// A rate is never just a number. The same "blockwork, m², 52.00" is right or
// wrong depending on when it was captured, where, and whether it came from a
// signed subcontract or somebody's memory. Storing the number and losing the
// rest is how a 2023 rate prices a 2026 bid and nobody can say why the job
// lost money.
//
// So every rate here carries its provenance and its date, lookup returns the
// evidence alongside the figure, and a rate old enough to be doubtful says so
// rather than being silently indexed into looking current.

export type RateSource =
  | "subcontract"      // a signed order. The strongest evidence there is.
  | "quotation"        // a real quote against real scope
  | "historic"         // what this contractor actually paid on a past job
  | "published"        // a published book (SPONS, regional equivalents)
  | "estimate";        // somebody's judgement. Honest, and the weakest.

/** Strongest first — this order decides ties, not the cheapest number. */
export const SOURCE_RANK: Record<RateSource, number> = {
  subcontract: 0, quotation: 1, historic: 2, published: 3, estimate: 4,
};

export interface Rate {
  id: string;
  /** Canonical item key: trade + description, or a library code. */
  itemKey: string;
  description: string;
  unit: string;
  rateMinor: number;
  currency: string;
  source: RateSource;
  /** ISO date the rate was true. Not the date the row was written. */
  capturedAt: string;
  region?: string | null;
  projectId?: string | null;
  vendorId?: string | null;
  supersededBy?: string | null;
}

export interface LookupOptions {
  /** Decision date. Staleness and indexation are judged against this. */
  at: string;
  region?: string | null;
  /** Prefer rates captured on this project before the wider library. */
  projectId?: string | null;
  /** Months after which a rate is called stale. */
  staleAfterMonths?: number;
  /** Annual construction inflation, percent, for the indexed view. */
  indexationPctPerYear?: number;
}

export interface RateHit {
  rate: Rate;
  /** As captured. */
  rateMinor: number;
  /** Indexed to the decision date, when indexation was requested. */
  indexedMinor: number;
  ageMonths: number;
  stale: boolean;
  /** Why this rate was chosen over the others. */
  why: string;
  /** The rates that lost, so the choice can be argued with. */
  alternatives: Rate[];
}

const monthsBetween = (from: string, to: string): number => {
  const a = new Date(from), b = new Date(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};

/**
 * Index a rate forward to the decision date.
 *
 * Compound, monthly, from the capture date. Returned as a separate figure from
 * the captured rate, never replacing it: an indexed rate is a projection, and a
 * projection that looks like evidence is how a bid inherits an assumption
 * nobody agreed to.
 */
export function indexRate(rateMinor: number, months: number, pctPerYear: number): number {
  if (months <= 0 || !pctPerYear) return rateMinor;
  return Math.round(rateMinor * (1 + pctPerYear / 100) ** (months / 12));
}

/**
 * Best available rate for an item.
 *
 * Precedence, in order, and each step is a deliberate choice:
 *   1. Rates captured on THIS project — the same site, the same market.
 *   2. Same region.
 *   3. Strength of source, not price. A signed subcontract beats a cheaper
 *      guess every time; picking the lowest number would systematically
 *      under-price the bid.
 *   4. Most recent.
 */
export function lookupRate(rates: Rate[], itemKey: string, opts: LookupOptions): RateHit | null {
  const staleAfter = opts.staleAfterMonths ?? 18;
  const candidates = rates.filter(
    (r) => r.itemKey === itemKey && !r.supersededBy && Date.parse(r.capturedAt) <= Date.parse(opts.at),
  );
  if (!candidates.length) return null;

  const score = (r: Rate): number[] => [
    opts.projectId && r.projectId === opts.projectId ? 0 : 1,
    opts.region && r.region === opts.region ? 0 : 1,
    SOURCE_RANK[r.source],
    -Date.parse(r.capturedAt),
  ];

  const sorted = [...candidates].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return 0;
  });

  const best = sorted[0];
  const ageMonths = monthsBetween(best.capturedAt, opts.at);
  const stale = ageMonths > staleAfter;

  const why: string[] = [];
  if (opts.projectId && best.projectId === opts.projectId) why.push("captured on this project");
  else if (opts.region && best.region === opts.region) why.push(`captured in ${best.region}`);
  why.push(`source: ${best.source}`);
  why.push(`${ageMonths} month(s) old`);
  if (stale) why.push(`STALE — older than ${staleAfter} months, confirm before relying on it`);

  return {
    rate: best,
    rateMinor: best.rateMinor,
    indexedMinor: opts.indexationPctPerYear
      ? indexRate(best.rateMinor, ageMonths, opts.indexationPctPerYear)
      : best.rateMinor,
    ageMonths,
    stale,
    why: why.join("; ") + ".",
    alternatives: sorted.slice(1, 5),
  };
}

export interface CoverageSummary {
  total: number;
  priced: number;
  stale: number;
  /** Items with no rate at all — the ones that will be guessed. */
  unpriced: string[];
  /** 0..1 */
  coverage: number;
}

/** How much of a bill the library can actually price, before anyone starts. */
export function libraryCoverage(rates: Rate[], itemKeys: string[], opts: LookupOptions): CoverageSummary {
  let priced = 0, stale = 0;
  const unpriced: string[] = [];
  for (const key of itemKeys) {
    const hit = lookupRate(rates, key, opts);
    if (!hit) { unpriced.push(key); continue; }
    priced += 1;
    if (hit.stale) stale += 1;
  }
  return {
    total: itemKeys.length,
    priced,
    stale,
    unpriced,
    coverage: itemKeys.length ? priced / itemKeys.length : 1,
  };
}

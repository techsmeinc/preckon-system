// Quotation capture and comparison.
//
// The whole job of this file is to stop the cheapest-looking quote winning by
// pricing less than the others. That is not a rare edge case — it is the normal
// shape of a quote pack: three vendors, three different sets of exclusions, and
// a bottom line that cannot be compared until every gap is filled at somebody's
// price. A comparison that ranks raw totals rewards whoever excluded the most.
//
// So nothing here ranks on the submitted total. Each quote is brought to the
// SAME scope first — the gaps priced at the best available evidence — and the
// adjustment is reported beside the number so the reader can see what was added
// and on what basis. An unfillable gap does not become zero; it makes the quote
// non-comparable and says so, because "no price" and "no charge" differ by the
// entire value of the item.
//
// Money is in minor units throughout (fils, cents) — integers, so that adding
// up a hundred lines cannot drift.

export interface ScopeItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  /** The estimate's own rate, when there is one. Last-resort basis for a gap. */
  estimateRateMinor?: number;
}

export interface QuoteLine {
  scopeItemId: string;
  /** Rate per unit of the scope item's own unit. */
  rateMinor: number;
  /** Present when the vendor priced a different quantity than the scope says. */
  qty?: number;
}

export interface Quote {
  id: string;
  rfqId: string;
  vendorId: string;
  vendorName: string;
  currency: string;
  lines: QuoteLine[];
  /** Named exclusions. Anything unpriced is treated as excluded regardless. */
  excludedScopeItemIds?: string[];
  qualifications?: string[];
  /** ISO date the price lapses. */
  validUntil?: string | null;
  leadTimeDays?: number | null;
  submittedAt: string;
  /** Arrived after the deadline. Recorded, never hidden. */
  late?: boolean;
}

export type GapBasis = "priced_by_others" | "estimate" | "none";

export interface Gap {
  scopeItemId: string;
  description: string;
  allowanceMinor: number;
  basis: GapBasis;
}

export interface ComparedQuote {
  vendorId: string;
  vendorName: string;
  /** What the vendor actually asked for, over the items they priced. */
  quotedMinor: number;
  /** Added to bring them up to full scope. */
  allowanceMinor: number;
  /** quoted + allowance. The only number that may be compared across vendors. */
  adjustedMinor: number;
  /** Fraction of scope items the vendor priced, 0..1. */
  coverage: number;
  gaps: Gap[];
  issues: string[];
  /** False when something makes the quote unusable as submitted. */
  comparable: boolean;
  rank: number | null;
}

export interface Comparison {
  currency: string;
  rows: ComparedQuote[];
  recommendation: { vendorId: string; vendorName: string; why: string } | null;
  warnings: string[];
}

export interface CompareOptions {
  /** Decision date — validity is judged against this, not against "now". */
  at: string;
  /** Days until the package is needed on site, for lead-time compliance. */
  needByDays?: number;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

const median = (ns: number[]): number => {
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** What one vendor charged for an item, or null if they did not price it. */
function lineTotal(scope: ScopeItem, quote: Quote): number | null {
  const line = quote.lines.find((l) => l.scopeItemId === scope.id);
  if (!line) return null;
  if (quote.excludedScopeItemIds?.includes(scope.id)) return null;
  const qty = line.qty ?? scope.qty;
  return Math.round(line.rateMinor * qty);
}

/**
 * Compare a quote pack like for like.
 *
 * Gaps are filled from the other vendors first and the estimate second. The
 * order matters: what the market actually charged for this item on this
 * enquiry is better evidence than what the estimator guessed before it went
 * out. Where neither exists the gap is reported at zero and the quote is marked
 * not comparable, so it can still be read but cannot win by omission.
 */
export function compareQuotes(
  scope: ScopeItem[], quotes: Quote[], opts: CompareOptions,
): Comparison {
  const warnings: string[] = [];
  if (!scope.length) return { currency: quotes[0]?.currency ?? "", rows: [], recommendation: null, warnings: ["No scope to compare against."] };

  const currencies = new Set(quotes.map((q) => q.currency));
  if (currencies.size > 1) {
    // Deliberately not converted here. A rate picked up from somewhere and
    // applied silently is how a comparison becomes wrong without looking wrong.
    warnings.push(`Quotes are in ${[...currencies].join(", ")}. They are compared as submitted — convert before relying on the ranking.`);
  }

  // Market evidence per scope item: what everyone who priced it charged.
  const marketRate = new Map<string, number>();
  for (const item of scope) {
    const priced = quotes
      .map((q) => {
        const line = q.lines.find((l) => l.scopeItemId === item.id);
        return line && !q.excludedScopeItemIds?.includes(item.id) ? line.rateMinor : null;
      })
      .filter((r): r is number => r != null);
    if (priced.length) marketRate.set(item.id, median(priced));
  }

  const rows: ComparedQuote[] = quotes.map((quote) => {
    const issues: string[] = [];
    const gaps: Gap[] = [];
    let quotedMinor = 0;
    let priced = 0;

    for (const item of scope) {
      const total = lineTotal(item, quote);
      if (total != null) {
        quotedMinor += total;
        priced += 1;
        continue;
      }
      const fromMarket = marketRate.get(item.id);
      const fromEstimate = item.estimateRateMinor;
      const basis: GapBasis = fromMarket != null ? "priced_by_others" : fromEstimate != null ? "estimate" : "none";
      const rate = fromMarket ?? fromEstimate ?? 0;
      gaps.push({
        scopeItemId: item.id,
        description: item.description,
        allowanceMinor: Math.round(rate * item.qty),
        basis,
      });
    }

    const allowanceMinor = sum(gaps.map((g) => g.allowanceMinor));
    const unpriceable = gaps.filter((g) => g.basis === "none");
    if (unpriceable.length) {
      issues.push(
        `${unpriceable.length} item(s) priced by nobody and absent from the estimate — no basis to fill the gap: ` +
        unpriceable.map((g) => g.description).join("; "),
      );
    }
    if (quote.late) issues.push("Arrived after the deadline.");
    if (quote.validUntil && Date.parse(quote.validUntil) < Date.parse(opts.at)) {
      issues.push(`Validity expired ${quote.validUntil}; the price would need reconfirming.`);
    }
    if (opts.needByDays != null && quote.leadTimeDays != null && quote.leadTimeDays > opts.needByDays) {
      issues.push(`Lead time ${quote.leadTimeDays} days exceeds the ${opts.needByDays} days available.`);
    }
    if (quote.qualifications?.length) {
      issues.push(`Qualified: ${quote.qualifications.join("; ")}`);
    }

    return {
      vendorId: quote.vendorId,
      vendorName: quote.vendorName,
      quotedMinor,
      allowanceMinor,
      adjustedMinor: quotedMinor + allowanceMinor,
      coverage: priced / scope.length,
      gaps,
      issues,
      // A qualification is worth reading but does not by itself make a quote
      // incomparable; an unfillable gap or a lapsed price does.
      comparable:
        unpriceable.length === 0 &&
        !(quote.validUntil && Date.parse(quote.validUntil) < Date.parse(opts.at)),
      rank: null,
    };
  });

  const ranked = [...rows]
    .filter((r) => r.comparable)
    .sort((a, b) => a.adjustedMinor - b.adjustedMinor);
  ranked.forEach((r, i) => { r.rank = i + 1; });

  if (rows.length && ranked.length < 2) {
    warnings.push("Fewer than two comparable quotes — this is a price, not a competition.");
  }

  const best = ranked[0] ?? null;
  const recommendation = best
    ? {
        vendorId: best.vendorId,
        vendorName: best.vendorName,
        why: describe(best, ranked[1] ?? null),
      }
    : null;
  if (!best && rows.length) {
    warnings.push("No quote is comparable as submitted. Resolve the gaps or reconfirm the prices before deciding.");
  }

  return { currency: quotes[0]?.currency ?? "", rows, recommendation, warnings };
}

function describe(best: ComparedQuote, next: ComparedQuote | null): string {
  const parts: string[] = [];
  parts.push(
    best.allowanceMinor > 0
      ? `Lowest on a like-for-like basis once ${fmt(best.allowanceMinor)} of gaps are allowed for`
      : "Lowest, and priced the full scope",
  );
  if (next) {
    const margin = next.adjustedMinor - best.adjustedMinor;
    const pct = best.adjustedMinor ? (margin / best.adjustedMinor) * 100 : 0;
    parts.push(
      pct < 2
        ? `only ${fmt(margin)} (${pct.toFixed(1)}%) below ${next.vendorName} — close enough that the qualifications decide it`
        : `${fmt(margin)} (${pct.toFixed(1)}%) below ${next.vendorName}`,
    );
  }
  if (best.issues.length) parts.push(`note: ${best.issues.join("; ")}`);
  return parts.join("; ") + ".";
}

const fmt = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

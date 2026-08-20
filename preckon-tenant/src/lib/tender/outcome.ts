// Award, loss, and win-loss analytics.
//
// Most contractors know their hit rate and almost nothing else, because the
// outcome of a bid gets recorded as a word — won, lost — and the reason lives
// in somebody's memory of a phone call. That is enough to say how often you win
// and useless for changing it.
//
// What makes the difference actionable is the GAP: how far off you were, to
// whom, and on what. A contractor losing by 2% on price to the same competitor
// has a pricing problem; one losing by 25% has a strategy problem and should
// stop bidding that work. Both look identical in a hit-rate report.
//
// So a loss requires a reason and, where it is known, a number. Where the
// number is not known that is recorded as unknown rather than guessed, because
// an invented gap poisons the average that later decisions are made on.

export type Outcome = "won" | "lost" | "no_bid" | "withdrawn" | "cancelled" | "pending";

export type LossReason =
  | "price"
  | "technical_score"
  | "programme"
  | "qualification"     // our qualifications were unacceptable
  | "compliance"        // we were disqualified on a formality
  | "relationship"
  | "capacity"
  | "unknown";

export interface BidOutcome {
  id: string;
  projectId: string;
  client: string;
  sector?: string | null;
  /** Our submitted price. */
  ourPriceMinor: number;
  outcome: Outcome;
  decidedAt?: string | null;
  /** The winner's price, where it is disclosed. */
  winningPriceMinor?: number | null;
  winner?: string | null;
  reason?: LossReason | null;
  /** Technical score out of 100, where the client publishes it. */
  ourScore?: number | null;
  winningScore?: number | null;
  notes?: string | null;
  /** Cost of preparing the bid, for the return-on-effort figure. */
  bidCostMinor?: number | null;
}

export interface Refusal { ok: false; reason: string }
export type Result<T> = { ok: true; value: T } | Refusal;

/**
 * Record the result.
 *
 * A loss without a reason is refused. "Lost" on its own is the single least
 * useful record a bid team can keep, and the moment of recording is the only
 * time anybody still knows why.
 */
export function record(
  bid: BidOutcome, outcome: Outcome, at: string,
  detail: { reason?: LossReason; winningPriceMinor?: number | null; winner?: string | null; notes?: string } = {},
): Result<BidOutcome> {
  if (bid.outcome !== "pending") return { ok: false, reason: `Already recorded as ${bid.outcome}.` };
  if (outcome === "lost" && !detail.reason) {
    return {
      ok: false,
      reason: "A loss needs a reason. Recording it as simply lost is the least useful entry a bid register can hold, and now is the only time anybody still knows why.",
    };
  }
  return {
    ok: true,
    value: {
      ...bid, outcome, decidedAt: at,
      reason: detail.reason ?? null,
      winningPriceMinor: detail.winningPriceMinor ?? null,
      winner: detail.winner ?? null,
      notes: detail.notes ?? bid.notes ?? null,
    },
  };
}

/** How far off we were, as a percentage of the winning price. Null if undisclosed. */
export function gapPercent(bid: BidOutcome): number | null {
  if (bid.winningPriceMinor == null || bid.winningPriceMinor <= 0) return null;
  return ((bid.ourPriceMinor - bid.winningPriceMinor) / bid.winningPriceMinor) * 100;
}

export interface Analytics {
  bids: number;
  decided: number;
  won: number;
  lost: number;
  hitRate: number;
  /** By value, which is the one that pays wages. */
  valueHitRate: number;
  /** Median gap on losses where the winning price was disclosed. */
  medianLossGapPct: number | null;
  /** Losses with a gap under this are pricing; above it, strategy. */
  narrowLosses: number;
  wideLosses: number;
  byReason: { reason: LossReason; count: number; valueMinor: number }[];
  byClient: { client: string; bids: number; won: number; hitRate: number }[];
  /** Bid cost spent per pound of work won. */
  costPerWonMinor: number | null;
  insights: string[];
}

const median = (ns: number[]): number | null => {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The analysis worth acting on.
 *
 * `narrowThresholdPct` splits losses into the two kinds that need different
 * responses: close ones say the pricing is nearly right and something small is
 * wrong; wide ones say this work is not for us at these rates, and the honest
 * response is to stop bidding it rather than to sharpen the pencil again.
 */
export function analyse(bids: BidOutcome[], narrowThresholdPct = 5): Analytics {
  const decided = bids.filter((b) => b.outcome === "won" || b.outcome === "lost");
  const won = decided.filter((b) => b.outcome === "won");
  const lost = decided.filter((b) => b.outcome === "lost");

  const gaps = lost.map(gapPercent).filter((g): g is number => g != null);
  const narrow = gaps.filter((g) => g <= narrowThresholdPct).length;
  const wide = gaps.filter((g) => g > narrowThresholdPct).length;

  const reasonMap = new Map<LossReason, { count: number; valueMinor: number }>();
  for (const b of lost) {
    const key = b.reason ?? "unknown";
    const cur = reasonMap.get(key) ?? { count: 0, valueMinor: 0 };
    cur.count += 1;
    cur.valueMinor += b.ourPriceMinor;
    reasonMap.set(key, cur);
  }

  const clientMap = new Map<string, { bids: number; won: number }>();
  for (const b of decided) {
    const cur = clientMap.get(b.client) ?? { bids: 0, won: 0 };
    cur.bids += 1;
    if (b.outcome === "won") cur.won += 1;
    clientMap.set(b.client, cur);
  }

  const wonValue = won.reduce((s, b) => s + b.ourPriceMinor, 0);
  const decidedValue = decided.reduce((s, b) => s + b.ourPriceMinor, 0);
  const bidSpend = bids.reduce((s, b) => s + (b.bidCostMinor ?? 0), 0);

  const insights: string[] = [];
  const med = median(gaps);
  if (med != null) {
    insights.push(
      med <= narrowThresholdPct
        ? `Losing by a median of ${med.toFixed(1)}% — close enough that this is a pricing problem, not a positioning one.`
        : `Losing by a median of ${med.toFixed(1)}% — too wide to sharpen away. This work is going to somebody with a different cost base.`,
    );
  }
  const compliance = reasonMap.get("compliance");
  if (compliance?.count) {
    insights.push(
      `${compliance.count} bid(s) lost on compliance — ${money(compliance.valueMinor)} of work lost to formalities rather than to price.`,
    );
  }
  const unknown = reasonMap.get("unknown");
  if (unknown && unknown.count > lost.length / 3) {
    insights.push(`${unknown.count} of ${lost.length} losses have no recorded reason, so the analysis above is built on a partial picture.`);
  }
  const worstClient = [...clientMap.entries()]
    .filter(([, v]) => v.bids >= 3)
    .sort((a, b) => a[1].won / a[1].bids - b[1].won / b[1].bids)[0];
  if (worstClient && worstClient[1].won === 0) {
    insights.push(`${worstClient[0]}: ${worstClient[1].bids} bids, none won. Worth asking whether to keep bidding to them.`);
  }

  return {
    bids: bids.length,
    decided: decided.length,
    won: won.length,
    lost: lost.length,
    hitRate: decided.length ? won.length / decided.length : 0,
    valueHitRate: decidedValue ? wonValue / decidedValue : 0,
    medianLossGapPct: med,
    narrowLosses: narrow,
    wideLosses: wide,
    byReason: [...reasonMap.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.count - a.count),
    byClient: [...clientMap.entries()]
      .map(([client, v]) => ({ client, bids: v.bids, won: v.won, hitRate: v.won / v.bids }))
      .sort((a, b) => b.bids - a.bids),
    costPerWonMinor: wonValue ? Math.round((bidSpend / wonValue) * 1_000_000) : null,
    insights,
  };
}

const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

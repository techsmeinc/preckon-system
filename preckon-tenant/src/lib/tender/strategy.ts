// Bid strategy: should we bid, and if so how do we win it.
//
// outcome.ts records what happened and analyses the pattern. This is the other
// end — the decision taken BEFORE the effort is spent, informed by that
// pattern rather than by whoever is most enthusiastic in the room.
//
// ── THE DECISION THAT COSTS THE MOST IS THE ONE NOBODY MAKES ─────────────────
//
// Bid/no-bid is where a contractor's money actually goes. A bid costs real
// money to prepare and the loss is total — there is no partial credit for
// second place. A team bidding everything at a 12% hit rate spends eight bids'
// worth of effort for each win, and the seven losses are not free.
//
// The failure is rarely "we decided badly". It is that no decision was taken:
// the tender arrived, somebody started work on it, and by the time anyone asked
// whether it was worth bidding, three weeks of estimating had been spent and
// walking away felt like waste. So the score below is deliberately blunt and
// produced EARLY.
//
// ── WHY THIS IS NOT A WIN-PROBABILITY MODEL ──────────────────────────────────
//
// It would be easy to output "62% chance of winning". It would also be
// dishonest: nobody has the data to calibrate that, and a number with a decimal
// point in it gets treated as knowledge. What can be defended is a comparison
// against this contractor's OWN history — "your hit rate with this client is
// 1 in 9, and every loss was on price" is a fact, and it is more use than a
// percentage nobody can source.
//
// So the recommendation is a band with reasons attached, and every reason names
// the evidence behind it.

import type { Analytics, BidOutcome } from "./outcome";

/** What a factor contributes. Positive favours bidding. */
export interface Factor {
  key: string;
  label: string;
  /** −2 (strongly against) to +2 (strongly for). */
  score: -2 | -1 | 0 | 1 | 2;
  /** How much this factor matters, 1–3. */
  weight: 1 | 2 | 3;
  /** Where the score came from. A factor without evidence is an opinion. */
  evidence: string;
}

export interface BidContext {
  client: string;
  sector?: string | null;
  /** Contract value, for effort-versus-prize. */
  valueMinor: number;
  /** Estimated cost of preparing the bid. */
  bidCostMinor?: number;
  /** Days until submission. */
  daysToSubmit?: number;
  /** Do we have the people to actually deliver it if we win? */
  capacityAvailable?: boolean;
  /** Have we built this type of work before? */
  relevantExperience?: boolean;
  /** Named competitors, where known. */
  knownCompetitors?: string[];
  /** How many bidders the client has invited, where stated. */
  bidderCount?: number | null;
  /** Weighting the client applies to price, 0–1. The rest is quality. */
  priceWeighting?: number | null;
  /** Anything in the contract we would normally refuse. */
  redFlags?: string[];
}

export type Recommendation = "bid" | "bid_with_conditions" | "marginal" | "no_bid";

export interface StrategyAssessment {
  recommendation: Recommendation;
  /** Weighted total, normalised to −100…+100. */
  score: number;
  factors: Factor[];
  /** The ones dragging it down, worst first. */
  against: Factor[];
  /** The ones supporting it. */
  for: Factor[];
  /** Conditions that would have to be true to proceed. */
  conditions: string[];
  /** Things that end the discussion regardless of the score. */
  blockers: string[];
  /** Effort against prize — what a loss costs us. */
  bidCostPct: number | null;
  why: string;
}

/**
 * Assess a tender.
 *
 * History is consulted where it exists and its absence is stated rather than
 * filled in. "We have never bid this client" is a real input to the decision;
 * silently scoring it as neutral hides that the team is guessing.
 */
export function assess(ctx: BidContext, history?: Analytics): StrategyAssessment {
  const factors: Factor[] = [];
  const blockers: string[] = [];
  const conditions: string[] = [];

  /* ── Red flags end the conversation ─────────────────────────────────────── */
  for (const flag of ctx.redFlags ?? []) {
    blockers.push(flag);
  }

  /* ── Can we actually deliver it ──────────────────────────────────────────
     First, because winning work you cannot build is worse than losing it. A
     stretched contractor delivering late pays damages, loses the client, and
     spends the margin on recovery. */
  if (ctx.capacityAvailable === false) {
    blockers.push("No delivery capacity. Winning work that cannot be resourced costs more than losing it — the damages and the lost client outlast the turnover.");
  } else if (ctx.capacityAvailable === true) {
    factors.push({
      key: "capacity", label: "Capacity to deliver", score: 1, weight: 3,
      evidence: "Resource confirmed available for the programme.",
    });
  } else {
    factors.push({
      key: "capacity", label: "Capacity to deliver", score: 0, weight: 3,
      evidence: "Capacity not confirmed either way — this needs answering before the bid, not after the award.",
    });
    conditions.push("Confirm delivery capacity before committing bid effort.");
  }

  /* ── Have we built this before ───────────────────────────────────────────── */
  factors.push(
    ctx.relevantExperience === true
      ? { key: "experience", label: "Relevant experience", score: 2, weight: 3, evidence: "Comparable work delivered — referenceable, and the rates are grounded in something real." }
      : ctx.relevantExperience === false
        ? { key: "experience", label: "Relevant experience", score: -2, weight: 3, evidence: "No comparable delivery. Both the technical score and the estimate rest on judgement rather than history." }
        : { key: "experience", label: "Relevant experience", score: 0, weight: 3, evidence: "Not assessed." },
  );

  /* ── What history says about this client ─────────────────────────────────── */
  const clientRow = history?.byClient.find((c) => c.client === ctx.client);
  if (clientRow && clientRow.bids >= 3) {
    const rate = clientRow.hitRate;
    const overall = history!.hitRate;
    // Judged against this contractor's OWN average rather than an industry
    // figure: a 20% hit rate is poor for a negotiated framework and excellent
    // for open competition, and only their own numbers know which this is.
    const relative = overall > 0 ? rate / overall : 1;
    factors.push({
      key: "client_history",
      label: `History with ${ctx.client}`,
      score: relative >= 1.5 ? 2 : relative >= 1.05 ? 1 : relative >= 0.7 ? 0 : relative >= 0.4 ? -1 : -2,
      weight: 3,
      evidence: `${clientRow.won} win(s) from ${clientRow.bids} bid(s) — ${Math.round(rate * 100)}% against an overall ${Math.round(overall * 100)}%.`,
    });
  } else {
    factors.push({
      key: "client_history",
      label: `History with ${ctx.client}`,
      score: clientRow ? 0 : -1,
      weight: 2,
      evidence: clientRow
        ? `Only ${clientRow.bids} bid(s) on record — too few to read anything into.`
        : "Never bid this client. An unknown client is a real cost: no relationship, no read on how they score, and no history in the rates.",
    });
  }

  /* ── Why we lose ─────────────────────────────────────────────────────────
     A pattern of wide price losses is the strongest no-bid signal there is,
     because it says the work is not for us at our rates — and the usual
     response, sharpening the pencil again, is how a contractor bids itself
     into a loss-making job. */
  if (history && history.lost >= 3) {
    const price = history.byReason.find((r) => r.reason === "price");
    const priceShare = price ? price.count / history.lost : 0;
    if (priceShare >= 0.6 && history.wideLosses > history.narrowLosses) {
      factors.push({
        key: "loss_pattern", label: "Pattern of losses", score: -2, weight: 3,
        evidence: `${price!.count} of ${history.lost} losses were on price, and most were wide rather than narrow${history.medianLossGapPct != null ? ` (median gap ${Math.round(history.medianLossGapPct)}%)` : ""}. That is a structural cost position, not a pricing mistake — sharpening the pencil again bids into a loss-making job.`,
      });
    } else if (priceShare >= 0.6) {
      factors.push({
        key: "loss_pattern", label: "Pattern of losses", score: 0, weight: 2,
        evidence: `Losses are mostly on price but narrow${history.medianLossGapPct != null ? ` (median gap ${Math.round(history.medianLossGapPct)}%)` : ""} — close enough that something small is wrong rather than the rates.`,
      });
    }
    const compliance = history.byReason.find((r) => r.reason === "compliance");
    if (compliance && compliance.count >= 2) {
      conditions.push(`${compliance.count} bid(s) have been lost on compliance formalities. Have someone outside the bid team check the submission against the instructions before it goes.`);
    }
  }

  /* ── The prize against the effort ────────────────────────────────────────── */
  const bidCostPct = ctx.bidCostMinor != null && ctx.valueMinor > 0
    ? Math.round((ctx.bidCostMinor / ctx.valueMinor) * 10000) / 100
    : null;
  if (bidCostPct != null) {
    factors.push({
      key: "bid_cost", label: "Cost of bidding", weight: 2,
      score: bidCostPct <= 0.25 ? 1 : bidCostPct <= 0.75 ? 0 : bidCostPct <= 1.5 ? -1 : -2,
      evidence: `Bid preparation is ${bidCostPct}% of contract value. A loss writes all of it off, and there is no credit for second place.`,
    });
  }

  /* ── The field ───────────────────────────────────────────────────────────── */
  if (ctx.bidderCount != null && ctx.bidderCount > 0) {
    factors.push({
      key: "field", label: "Size of the field", weight: 2,
      score: ctx.bidderCount <= 3 ? 2 : ctx.bidderCount <= 5 ? 1 : ctx.bidderCount <= 8 ? -1 : -2,
      evidence: `${ctx.bidderCount} bidders invited — a ${Math.round((1 / ctx.bidderCount) * 100)}% share on names alone before anything about us is considered.`,
    });
  }

  /* ── How the client will score it ────────────────────────────────────────── */
  if (ctx.priceWeighting != null) {
    const w = ctx.priceWeighting;
    const strongOnQuality = ctx.relevantExperience === true;
    factors.push({
      key: "award_criteria", label: "Award criteria", weight: 2,
      // A price-dominated award suits the cheapest, not the best. Whether that
      // favours us depends on which of the two we are, and pretending
      // otherwise is how a quality bid loses to a number.
      score: w >= 0.8 ? (strongOnQuality ? -1 : 0) : w <= 0.4 ? (strongOnQuality ? 2 : -1) : 0,
      evidence: `Price weighted ${Math.round(w * 100)}%, quality ${Math.round((1 - w) * 100)}%. ${
        w >= 0.8
          ? "A price-dominated award goes to the cheapest bidder, and quality effort is largely wasted."
          : w <= 0.4
            ? "Quality-weighted: the submission itself is where this is won or lost."
            : "Balanced — both halves have to be right."
      }`,
    });
  }

  /* ── Time ────────────────────────────────────────────────────────────────── */
  if (ctx.daysToSubmit != null) {
    factors.push({
      key: "time", label: "Time to submit", weight: 2,
      score: ctx.daysToSubmit >= 28 ? 1 : ctx.daysToSubmit >= 14 ? 0 : ctx.daysToSubmit >= 7 ? -1 : -2,
      evidence: `${ctx.daysToSubmit} day(s) to submission. A rushed bid is priced with more contingency and written with less care, which loses on both halves at once.`,
    });
    if (ctx.daysToSubmit < 14) {
      conditions.push(`Only ${ctx.daysToSubmit} days available — either resource it properly now or decline, rather than submitting something thin.`);
    }
  }

  /* ── Score ───────────────────────────────────────────────────────────────── */
  const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0);
  const maxWeighted = factors.reduce((s, f) => s + 2 * f.weight, 0);
  const score = maxWeighted ? Math.round((weighted / maxWeighted) * 100) : 0;

  const against = factors.filter((f) => f.score < 0).sort((a, b) => a.score * a.weight - b.score * b.weight);
  const forIt = factors.filter((f) => f.score > 0).sort((a, b) => b.score * b.weight - a.score * a.weight);

  const recommendation: Recommendation =
    blockers.length ? "no_bid"
    : score >= 40 ? (conditions.length ? "bid_with_conditions" : "bid")
    : score >= 10 ? (conditions.length ? "bid_with_conditions" : "bid")
    : score >= -15 ? "marginal"
    : "no_bid";

  return {
    recommendation, score, factors, against, for: forIt, conditions, blockers, bidCostPct,
    why: explain(recommendation, score, blockers, against, forIt, conditions),
  };
}

function explain(
  rec: Recommendation, score: number, blockers: string[],
  against: Factor[], forIt: Factor[], conditions: string[],
): string {
  if (blockers.length) {
    return `No bid. ${blockers.join(" ")} A score does not override this — these are the kind of problems that are not fixed by winning.`;
  }
  const parts: string[] = [];
  switch (rec) {
    case "bid":
      parts.push(`Bid. Score ${score}, with ${forIt[0] ? forIt[0].label.toLowerCase() : "the balance"} the strongest reason.`);
      break;
    case "bid_with_conditions":
      parts.push(`Bid, but only once the conditions below are settled. Score ${score}.`);
      break;
    case "marginal":
      parts.push(`Marginal at ${score}. This is the band where bids get started by default and never formally decided — take the decision now, before the estimating time is spent.`);
      break;
    case "no_bid":
      parts.push(`No bid. Score ${score}${against[0] ? `, driven by ${against[0].label.toLowerCase()}` : ""}.`);
      break;
  }
  if (against.length) parts.push(`Against: ${against.slice(0, 3).map((f) => f.label.toLowerCase()).join(", ")}.`);
  if (conditions.length) parts.push(`${conditions.length} condition(s) to settle first.`);
  return parts.join(" ");
}

/* ────────────────────────────────────────────────────────────────────────────
   Pricing strategy
   ──────────────────────────────────────────────────────────────────────────── */

export interface PricingInput {
  /** Net cost from the estimate, before margin. */
  netCostMinor: number;
  /** Margin the business normally wants. */
  targetMarginPct: number;
  /** Lowest margin the business will accept. */
  floorMarginPct: number;
  /** Historic losses on this client or sector, for the gap. */
  history?: Analytics;
  /** Competitors expected to bid. */
  bidderCount?: number | null;
}

export interface PricingOption {
  label: string;
  marginPct: number;
  priceMinor: number;
  /** What this price is betting on. */
  rationale: string;
  /** What happens if the bet is wrong. */
  risk: string;
}

/**
 * Price options, not a price.
 *
 * A single recommended number gets adopted without the reasoning, and the
 * reasoning is the whole content: what a price is betting on and what it costs
 * if the bet is wrong. Three options with those stated makes the tender board
 * take the decision rather than ratify one.
 *
 * The floor is never crossed. A tool that suggested a below-floor price would
 * be doing the arguing that a commercial director is paid to do, and buying
 * turnover below cost is the classic way for a busy contractor to fail.
 */
export function priceOptions(input: PricingInput): {
  options: PricingOption[];
  medianLossGapPct: number | null;
  note: string;
} {
  const { netCostMinor: cost, targetMarginPct: target, floorMarginPct: floor } = input;
  const at = (marginPct: number) => Math.round(cost * (1 + marginPct));
  const gap = input.history?.medianLossGapPct ?? null;

  const options: PricingOption[] = [
    {
      label: "Target",
      marginPct: target,
      priceMinor: at(target),
      rationale: `The margin the business is set up to make at ${Math.round(target * 100)}%.`,
      risk: gap != null && gap > 0
        ? `Recent losses have been a median ${Math.round(gap)}% above the winner. At target margin this bid is likely to be in that territory.`
        : "No loss-gap history to test this against.",
    },
  ];

  /* A competitive option only where the history says price is the problem.
     Offering one anyway would invite margin to be given away against a
     competitor nobody has evidence exists. */
  if (gap != null && gap > 0) {
    // Enough to close the observed gap, floored. The floor is the constraint,
    // not a suggestion.
    const needed = target - gap / 100;
    const competitive = Math.max(floor, needed);
    options.push({
      label: competitive > needed ? "Competitive (floored)" : "Competitive",
      marginPct: competitive,
      priceMinor: at(competitive),
      rationale: competitive > needed
        ? `Closing the observed ${Math.round(gap)}% gap would need ${Math.round(needed * 100)}% margin, which is below the ${Math.round(floor * 100)}% floor. This is the floor, and it does not close the gap.`
        : `Prices at ${Math.round(competitive * 100)}% margin to close the median ${Math.round(gap)}% loss gap.`,
      risk: competitive > needed
        ? "This bid is still expected to lose on price. Bidding it anyway is a decision to spend the bid cost for the relationship or the pipeline, and worth taking deliberately."
        : `Gives up ${Math.round((target - competitive) * 100)} point(s) of margin on a bet that price is what has been losing these.`,
    });
  }

  if (input.bidderCount != null && input.bidderCount <= 3) {
    options.push({
      label: "Premium",
      marginPct: target + 0.02,
      priceMinor: at(target + 0.02),
      rationale: `Only ${input.bidderCount} bidders. A short list is the one condition under which margin can be taken rather than defended.`,
      risk: "Assumes the field really is short and the client is not running a wider process than it has disclosed.",
    });
  }

  return {
    options,
    medianLossGapPct: gap,
    note: gap == null
      ? "No disclosed winning prices in the history, so none of these options can be tested against what actually wins. Recording winning prices on future losses is what makes this analysis possible."
      : `Median loss gap of ${Math.round(gap)}% is what these options are judged against.`,
  };
}

/**
 * Who else is bidding, and what that has meant before.
 *
 * Only reports competitors actually seen in the record. A named competitor with
 * no history produces "we have no read on them", which is honest and is itself
 * worth knowing before a tender board treats a name as a known quantity.
 */
export function competitors(
  names: string[], bids: BidOutcome[],
): { name: string; metThem: number; theyWon: number; ourWinRate: number | null; note: string }[] {
  return names.map((name) => {
    const met = bids.filter((b) => b.winner === name || (b.notes ?? "").includes(name));
    const theyWon = bids.filter((b) => b.winner === name).length;
    const decided = met.filter((b) => b.outcome === "won" || b.outcome === "lost");
    const ourWins = decided.filter((b) => b.outcome === "won").length;
    return {
      name,
      metThem: met.length,
      theyWon,
      ourWinRate: decided.length ? Math.round((ourWins / decided.length) * 100) / 100 : null,
      note: !met.length
        ? `No record of bidding against ${name}. Treat them as an unknown rather than as a benchmark.`
        : theyWon >= 2
          ? `${name} has taken ${theyWon} of the ${met.length} we have met them on. Worth understanding what they price differently before repeating the same bid.`
          : `Met ${name} ${met.length} time(s); they won ${theyWon}.`,
    };
  });
}

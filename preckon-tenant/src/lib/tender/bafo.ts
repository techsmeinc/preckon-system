// Best and Final Offer: the round where margin quietly disappears.
//
// A BAFO request feels like good news — you are on the short list, they want a
// sharper number. What actually happens is that a contractor under time
// pressure gives away three points of margin, receives nothing in return, and
// finds out later that every bidder was asked the same thing.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────
//
// Nothing is given without something received. A reduction is a concession, and
// a concession without a corresponding gain is just a lower price. The gains
// worth asking for are real and usually available:
//
//   Scope removed, or a specification relaxed
//   Payment terms improved (a fortnight of cash is worth real money)
//   A qualification accepted that the client previously resisted
//   Programme relief, or a risk transferred back
//   Exclusivity, or a commitment on follow-on work
//
// So every reduction here has to name what it buys. A reduction with nothing
// against it is flagged, not silently accepted, because the moment it is
// accepted silently is the moment it stops being visible.
//
// ── WHERE THE REDUCTION COMES FROM MATTERS MORE THAN ITS SIZE ────────────────
//
// Three sources, and they are not equivalent:
//
//   Margin      real money, gone. Recoverable only by winning and performing.
//   Scope       not a reduction at all — less work for less money.
//   Risk/       a bet that the contingency was not needed. This is the
//   contingency dangerous one: it looks like margin on the page and behaves
//               like a liability on site.
//
// A BAFO that reduces price entirely by stripping contingency has not got
// cheaper. It has got riskier, at the same cost, and nothing on the submitted
// page says so.

export type ConcessionSource = "margin" | "scope" | "contingency" | "efficiency" | "supply_chain";

export interface Concession {
  id: string;
  description: string;
  source: ConcessionSource;
  /** Reduction in minor units. Positive. */
  amountMinor: number;
  /** What we get for it. Empty means nothing — which is the point. */
  inReturn?: string | null;
  /** Where this comes out of the estimate. */
  reference?: string | null;
}

export interface BafoInput {
  /** The price originally submitted. */
  originalPriceMinor: number;
  /** Net cost from the estimate, before margin. */
  netCostMinor: number;
  /** Lowest margin the business will accept, as a proportion of cost. */
  floorMarginPct: number;
  /** Contingency included in the original price. */
  contingencyMinor?: number;
  /** What the client asked for, where they named a number or a target. */
  clientTargetMinor?: number | null;
  concessions: Concession[];
}

export interface ConcessionAssessment extends Concession {
  /** True where nothing was obtained for this. */
  unreciprocated: boolean;
  /** Share of the total reduction. */
  sharePct: number;
  verdict: string;
}

export interface BafoAssessment {
  originalPriceMinor: number;
  reductionMinor: number;
  reductionPct: number;
  revisedPriceMinor: number;
  /** Margin before and after, as a proportion of cost. */
  originalMarginPct: number;
  revisedMarginPct: number;
  /** True where the revised price breaches the floor. */
  belowFloor: boolean;
  /** Reduction taken out of real margin, as opposed to scope. */
  marginGivenMinor: number;
  /** Reduction taken out of contingency — risk absorbed, not cost removed. */
  contingencyGivenMinor: number;
  /** Proportion of the original contingency now gone. */
  contingencyStrippedPct: number;
  concessions: ConcessionAssessment[];
  /** Concessions with nothing received against them. */
  unreciprocated: ConcessionAssessment[];
  /** Where the client named a figure, whether this reaches it. */
  meetsTarget: boolean | null;
  warnings: string[];
  recommendation: "submit" | "submit_with_caution" | "do_not_submit";
  why: string;
}

/**
 * Assess a proposed BAFO before it goes out.
 *
 * The output is deliberately uncomfortable where the offer deserves it. A tool
 * that computed the new total and stopped would be helping produce exactly the
 * submission this module exists to prevent.
 */
export function assess(input: BafoInput): BafoAssessment {
  const warnings: string[] = [];
  const original = input.originalPriceMinor;
  const cost = input.netCostMinor;
  const contingency = Math.max(0, input.contingencyMinor ?? 0);

  const reductionMinor = input.concessions.reduce((s, c) => s + Math.max(0, c.amountMinor), 0);
  const revisedPriceMinor = original - reductionMinor;

  const originalMarginPct = cost > 0 ? (original - cost) / cost : 0;
  const revisedMarginPct = cost > 0 ? (revisedPriceMinor - cost) / cost : 0;
  const belowFloor = revisedMarginPct < input.floorMarginPct;

  const by = (s: ConcessionSource) =>
    input.concessions.filter((c) => c.source === s).reduce((t, c) => t + Math.max(0, c.amountMinor), 0);

  const marginGivenMinor = by("margin");
  const contingencyGivenMinor = by("contingency");
  const scopeMinor = by("scope");
  const contingencyStrippedPct = contingency > 0
    ? Math.round((contingencyGivenMinor / contingency) * 1000) / 10
    : contingencyGivenMinor > 0 ? 100 : 0;

  const concessions: ConcessionAssessment[] = input.concessions.map((c) => {
    const unreciprocated = !c.inReturn || !String(c.inReturn).trim();
    return {
      ...c,
      unreciprocated,
      sharePct: reductionMinor ? Math.round((c.amountMinor / reductionMinor) * 1000) / 10 : 0,
      verdict: verdictFor(c, unreciprocated),
    };
  });

  const unreciprocated = concessions.filter((c) => c.unreciprocated);
  const unreciprocatedMinor = unreciprocated.reduce((s, c) => s + c.amountMinor, 0);

  /* ── The warnings that matter ─────────────────────────────────────────────── */

  if (unreciprocated.length) {
    warnings.push(
      `${unreciprocated.length} concession(s) worth ${unreciprocatedMinor} give something away for nothing. Ask for scope, payment terms, a qualification accepted or programme relief against each one before this goes — every bidder is being asked to sharpen, and the ones who ask get something back.`,
    );
  }

  if (contingencyGivenMinor > 0) {
    warnings.push(
      contingencyStrippedPct >= 50
        ? `${contingencyStrippedPct}% of the contingency has been removed to fund this offer. The price is lower and the job is not cheaper — the same risk is now carried at a lower price, and nothing on the submitted page says so.`
        : `${contingencyGivenMinor} of the reduction comes out of contingency rather than cost. That is a bet that the allowance was not needed, not a saving.`,
    );
  }

  if (belowFloor) {
    warnings.push(
      `The revised margin of ${Math.round(revisedMarginPct * 1000) / 10}% is below the ${Math.round(input.floorMarginPct * 1000) / 10}% floor. This needs a decision above the bid team, not inside it.`,
    );
  }

  if (revisedPriceMinor < cost) {
    warnings.push(
      `This offer is below net cost by ${cost - revisedPriceMinor}. Winning it loses money on day one, and the loss grows with every month of the programme.`,
    );
  }

  if (scopeMinor > 0 && scopeMinor === reductionMinor) {
    warnings.push(
      "The whole reduction is scope removed, so this is not a price reduction at all — it is less work for less money. Make sure the client's evaluation is comparing it on that basis, or it reads as a saving we did not offer.",
    );
  }

  const meetsTarget = input.clientTargetMinor != null
    ? revisedPriceMinor <= input.clientTargetMinor
    : null;
  if (meetsTarget === false) {
    warnings.push(
      `This does not reach the client's stated target of ${input.clientTargetMinor}. Submitting short of a named target without explaining why usually reads as unwillingness rather than inability — say which of their requirements is driving the difference.`,
    );
  }

  const recommendation: BafoAssessment["recommendation"] =
    revisedPriceMinor < cost ? "do_not_submit"
    : belowFloor ? "do_not_submit"
    : (unreciprocated.length > 0 || contingencyStrippedPct >= 50) ? "submit_with_caution"
    : "submit";

  return {
    originalPriceMinor: original,
    reductionMinor,
    reductionPct: original ? Math.round((reductionMinor / original) * 1000) / 10 : 0,
    revisedPriceMinor,
    originalMarginPct: Math.round(originalMarginPct * 10000) / 10000,
    revisedMarginPct: Math.round(revisedMarginPct * 10000) / 10000,
    belowFloor,
    marginGivenMinor,
    contingencyGivenMinor,
    contingencyStrippedPct,
    concessions,
    unreciprocated,
    meetsTarget,
    warnings,
    recommendation,
    why: explain(recommendation, reductionMinor, original, revisedMarginPct, unreciprocated.length, contingencyStrippedPct),
  };
}

function verdictFor(c: Concession, unreciprocated: boolean): string {
  const got = unreciprocated ? "Nothing received in return." : `In return: ${c.inReturn}`;
  switch (c.source) {
    case "margin":
      return `Real money given up. ${got}`;
    case "scope":
      return `Not a reduction — less work for less money. ${got}`;
    case "contingency":
      return `Risk absorbed rather than cost removed: the same exposure at a lower price. ${got}`;
    case "efficiency":
      return `A saving only if the efficiency is real and someone owns delivering it. ${got}`;
    case "supply_chain":
      return `Depends on the supplier holding the reduced price to contract — get it in writing before it is offered. ${got}`;
  }
}

function explain(
  rec: BafoAssessment["recommendation"], reduction: number, original: number,
  revisedMargin: number, unreciprocated: number, contingencyPct: number,
): string {
  const pct = original ? Math.round((reduction / original) * 1000) / 10 : 0;
  switch (rec) {
    case "do_not_submit":
      return `Do not submit as it stands. A ${pct}% reduction takes the margin to ${Math.round(revisedMargin * 1000) / 10}%, which is not a decision for the bid team to take alone.`;
    case "submit_with_caution":
      return `Submittable, but not as it stands without a conversation. ${
        unreciprocated ? `${unreciprocated} concession(s) get nothing in return. ` : ""
      }${contingencyPct >= 50 ? `${contingencyPct}% of the contingency has gone, so the price is lower and the risk is not. ` : ""}A ${pct}% reduction leaves ${Math.round(revisedMargin * 1000) / 10}% margin.`;
    case "submit":
      return `Submit. A ${pct}% reduction leaving ${Math.round(revisedMargin * 1000) / 10}% margin, with something obtained against each concession.`;
  }
}

/**
 * What to ask for in return.
 *
 * Generated from what the offer actually gives away rather than as a generic
 * checklist, so the asks are proportionate: a fortnight of payment terms
 * against a small reduction is credible, and against a large one it is not.
 *
 * Bid teams under time pressure do not stop to think of these, which is exactly
 * why the list is produced rather than left to be remembered.
 */
export function asksFor(assessment: BafoAssessment): string[] {
  const asks: string[] = [];
  const value = assessment.reductionMinor;
  if (value <= 0) return asks;

  asks.push("Payment terms shortened — a fortnight of cash on a contract this size is worth real money and costs the client comparatively little.");

  if (assessment.marginGivenMinor > 0) {
    asks.push("A qualification the client has so far resisted, accepted into the contract. Margin given for a risk removed is a trade; margin given for nothing is a discount.");
  }
  if (assessment.contingencyGivenMinor > 0) {
    asks.push("The risk the stripped contingency covered, transferred back or capped. If we are no longer pricing it, we should not be carrying it either.");
  }
  if (assessment.reductionPct >= 3) {
    asks.push("Exclusivity, or a commitment on the follow-on phases. A reduction of this size is worth a position, not just a place on the list.");
  }
  asks.push("Confirmation of the award timetable and that this is the final round — a second BAFO after this one should be refused, and saying so now is what makes that possible.");
  return asks;
}

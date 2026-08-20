// Margin waterfall and markups.
//
// One distinction earns this file its place: a 10% MARKUP on cost is not a 10%
// MARGIN on price. Mark 100 up by 10% and you sell at 110, on which the margin
// is 9.09%. Estimators say "ten percent" meaning either, commercial managers
// read it as the other, and the gap is the difference between the bid winning
// and the job losing money. Both are supported, both are named, and neither is
// the silent default.
//
// The second thing it does is fix the order, which matters less often than it
// looks and matters absolutely when it does. Percentage stages compound
// multiplicatively, so two of them commute: 10% markup then 10% margin lands on
// the same price as 10% margin then 10% markup. What does NOT commute is a
// fixed amount (a bond, a levy) or a stage held out of the base — put the bond
// before profit and you earn profit on the bond; put it after and you do not.
// Both readings are defensible and they are not the same number, so the order
// is explicit and the base each stage was calculated on is reported beside it.
//
// Minor units throughout, rounded once per stage. Rounding at the end only
// looks tidier and makes the printed stages fail to add up to the total, which
// is the first thing a commercial reviewer checks.

export type Basis = "markup_on_cost" | "margin_on_price" | "fixed";

export interface Stage {
  key: string;
  label: string;
  basis: Basis;
  /** Percent for the two percentage bases; ignored for `fixed`. */
  percent?: number;
  /** Minor units for `fixed`. */
  amountMinor?: number;
  /** Excluded from the running base — a stage nothing else compounds on. */
  excludeFromBase?: boolean;
}

export interface StageResult {
  key: string;
  label: string;
  basis: Basis;
  /** What this stage was calculated on. */
  baseMinor: number;
  addedMinor: number;
  /** Running total after this stage. */
  runningMinor: number;
  note: string;
}

export interface Waterfall {
  netCostMinor: number;
  stages: StageResult[];
  sellMinor: number;
  /** Sell − net cost. */
  marginMinor: number;
  /** As a percentage OF THE SELL PRICE, which is what a margin means. */
  marginPct: number;
  /** As a percentage of cost, which is what a markup means. */
  markupPct: number;
}

/**
 * Build the waterfall.
 *
 * `margin_on_price` is solved, not approximated: to leave p% of the FINAL price
 * as this stage, the base must be divided by (1 − p/100). Adding p% of the
 * running cost instead is the error this exists to prevent, and at 15% it
 * understates the price by about 2.6%.
 */
export function waterfall(netCostMinor: number, stages: Stage[]): Waterfall {
  const out: StageResult[] = [];
  let running = netCostMinor;
  let base = netCostMinor;

  for (const stage of stages) {
    let added = 0;
    let note = "";

    if (stage.basis === "fixed") {
      added = Math.round(stage.amountMinor ?? 0);
      note = "fixed amount";
    } else if (stage.basis === "markup_on_cost") {
      const pct = stage.percent ?? 0;
      added = Math.round((base * pct) / 100);
      note = `${pct}% of ${fmt(base)}`;
    } else {
      const pct = stage.percent ?? 0;
      if (pct >= 100) {
        throw new RangeError("A margin of 100% or more of the sell price has no solution.");
      }
      const grossed = base / (1 - pct / 100);
      added = Math.round(grossed - base);
      note = `${pct}% of the resulting price (${fmt(Math.round(grossed))}), not ${pct}% of cost`;
    }

    running += added;
    out.push({ key: stage.key, label: stage.label, basis: stage.basis, baseMinor: base, addedMinor: added, runningMinor: running, note });
    if (!stage.excludeFromBase) base = running;
  }

  const sell = running;
  const margin = sell - netCostMinor;
  return {
    netCostMinor,
    stages: out,
    sellMinor: sell,
    marginMinor: margin,
    marginPct: sell ? (margin / sell) * 100 : 0,
    markupPct: netCostMinor ? (margin / netCostMinor) * 100 : 0,
  };
}

/** The conversions people get wrong in both directions. */
export const markupToMargin = (markupPct: number): number =>
  (markupPct / (100 + markupPct)) * 100;

export const marginToMarkup = (marginPct: number): number => {
  if (marginPct >= 100) throw new RangeError("A margin of 100% or more of the sell price has no markup equivalent.");
  return (marginPct / (100 - marginPct)) * 100;
};

/**
 * The sell price needed to clear a target margin on a known cost.
 *
 * Used when the commercial position is "we will not go below 12%" and the
 * question is what that means for the number on the front page.
 */
export function priceForMargin(netCostMinor: number, marginPct: number): number {
  if (marginPct >= 100) throw new RangeError("A margin of 100% or more of the sell price has no solution.");
  return Math.round(netCostMinor / (1 - marginPct / 100));
}

/**
 * What margin survives if the price is cut to win.
 *
 * Returns negative when the cut goes below cost — deliberately not clamped at
 * zero, because "we are 3% under water" is the fact the meeting needs.
 */
export function marginAtPrice(netCostMinor: number, priceMinor: number): number {
  return priceMinor ? ((priceMinor - netCostMinor) / priceMinor) * 100 : 0;
}

/** A conventional main-contractor stack, in the order it is normally applied. */
export const STANDARD_STAGES: Stage[] = [
  { key: "prelims", label: "Preliminaries", basis: "markup_on_cost", percent: 8 },
  { key: "overhead", label: "Head office overhead", basis: "markup_on_cost", percent: 5 },
  { key: "risk", label: "Risk allowance", basis: "markup_on_cost", percent: 3 },
  { key: "profit", label: "Profit", basis: "margin_on_price", percent: 8 },
];

const fmt = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

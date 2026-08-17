/**
 * Where the quantities disagree, and by how much.
 *
 * The same item can arrive three ways: measured off a drawing, taken off a
 * model, or typed in by an estimator who knows something the drawings do not.
 * They will not agree. The question is never "which is right" — it is "how far
 * apart are they, and is that far enough to matter".
 *
 * ── WHY THIS DOES NOT PICK A WINNER SILENTLY ─────────────────────────────────
 *
 * The tempting design is a precedence rule: manual beats measured beats
 * modelled, take the top one, move on. That produces a bill that is internally
 * consistent and hides its own disagreements, which is worse than one that
 * argues with itself in front of you. A 12% gap between the model and the
 * drawing is either a modelling error, a drawing revision nobody applied, or a
 * scope difference — and all three are worth a minute of an estimator's time
 * before the number goes in a tender.
 *
 * So precedence decides what is USED, and the disagreement is reported either
 * way. A reconciled line always says what it overrode and by how much.
 *
 * ── TOLERANCE IS PROPORTIONAL ────────────────────────────────────────────────
 *
 * Half a cubic metre is a rounding difference on 2,000 m³ and a serious argument
 * on 2 m³. An absolute tolerance is wrong at one end of every bill. There is a
 * small absolute floor as well, because a proportional test alone makes trivial
 * quantities impossible to agree on.
 */

/** Where a quantity came from. Ordered by precedence, lowest first. */
export const SOURCE_ORDER = ["modelled", "measured", "manual"] as const;
export type Source = (typeof SOURCE_ORDER)[number];

export interface QuantityClaim {
  source: Source;
  quantity: number;
  unit: string;
  /** Free text — the sheet, the model element, the estimator's note. */
  basis?: string;
  /** Only for a manual override, and required by convention rather than type. */
  reason?: string;
}

export interface ReconcileOptions {
  /** Fractional gap tolerated before a disagreement is reported. Default 2%. */
  tolerance?: number;
  /** Absolute gap always tolerated, so trivial quantities can agree. */
  floor?: number;
}

export type Verdict =
  /** One source only — nothing to cross-check against. */
  | "unconfirmed"
  /** Sources agree within tolerance. */
  | "agreed"
  /** Sources disagree beyond tolerance. */
  | "disputed"
  /** Sources measure in different units and are not comparable at all. */
  | "incomparable";

export interface Reconciled {
  item: string;
  /** The quantity to use, by precedence. */
  quantity: number;
  unit: string;
  source: Source;
  verdict: Verdict;
  claims: QuantityClaim[];
  /** Largest fractional gap between any two comparable claims. */
  spread: number | null;
  /** What this figure overrode, if anything. */
  overrode: { source: Source; quantity: number; differenceBy: number }[];
  why: string;
}

const DEFAULT_TOLERANCE = 0.02;
const DEFAULT_FLOOR = 0.01;

const rank = (s: Source) => SOURCE_ORDER.indexOf(s);

/**
 * Fractional difference between two quantities.
 *
 * Against the LARGER of the two, so the answer does not change depending on
 * which was passed first — a gap of 1 against 100 is 1%, whichever order they
 * arrive in.
 */
export function gap(a: number, b: number): number {
  const big = Math.max(Math.abs(a), Math.abs(b));
  return big === 0 ? 0 : Math.abs(a - b) / big;
}

/**
 * Reconcile the claims for one item.
 *
 * `claims` should already be the claims for a single item — grouping is the
 * caller's business, because only the caller knows how items are identified in
 * its own bill.
 */
export function reconcileItem(item: string, claims: QuantityClaim[], opts: ReconcileOptions = {}): Reconciled {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const floor = opts.floor ?? DEFAULT_FLOOR;

  if (!claims.length) {
    return {
      item, quantity: 0, unit: "", source: "modelled", verdict: "unconfirmed",
      claims: [], spread: null, overrode: [],
      why: "No quantity was claimed for this item by any source.",
    };
  }

  // Highest precedence wins, and ties go to the later claim so a fresh override
  // supersedes an earlier one of the same kind.
  const winner = [...claims].sort((a, b) => rank(a.source) - rank(b.source)).at(-1)!;

  const units = new Set(claims.map((c) => c.unit.trim().toLowerCase()).filter(Boolean));
  if (units.size > 1) {
    /* Not a variance — a category error. Two sources measuring the same item in
       m² and m³ are not 30% apart, they are answering different questions, and
       reporting a percentage would invite somebody to split the difference. */
    return {
      item,
      quantity: winner.quantity,
      unit: winner.unit,
      source: winner.source,
      verdict: "incomparable",
      claims,
      spread: null,
      overrode: [],
      why: `Sources disagree on the unit (${[...units].join(", ")}), so the quantities cannot be compared. Resolve the unit first.`,
    };
  }

  const comparable = claims.filter((c) => Number.isFinite(c.quantity));
  if (comparable.length < 2) {
    return {
      item,
      quantity: winner.quantity,
      unit: winner.unit,
      source: winner.source,
      verdict: "unconfirmed",
      claims,
      spread: null,
      overrode: [],
      why: `Only the ${winner.source} quantity exists, so nothing cross-checks it.`,
    };
  }

  let spread = 0;
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      spread = Math.max(spread, gap(comparable[i].quantity, comparable[j].quantity));
    }
  }

  const absolute = Math.max(...comparable.map((c) => c.quantity)) - Math.min(...comparable.map((c) => c.quantity));
  const agreed = spread <= tolerance || absolute <= floor;

  const overrode = comparable
    .filter((c) => c !== winner)
    .map((c) => ({
      source: c.source,
      quantity: c.quantity,
      differenceBy: Number((winner.quantity - c.quantity).toFixed(6)),
    }));

  return {
    item,
    quantity: winner.quantity,
    unit: winner.unit,
    source: winner.source,
    verdict: agreed ? "agreed" : "disputed",
    claims,
    spread: Number(spread.toFixed(6)),
    overrode,
    why: agreed
      ? `All sources agree within ${(tolerance * 100).toFixed(0)}%; using the ${winner.source} figure.`
      : `Sources differ by ${(spread * 100).toFixed(1)}%. Using the ${winner.source} figure, but the gap is worth checking before this is priced.`,
  };
}

export interface ReconcileSummary {
  lines: Reconciled[];
  agreed: number;
  disputed: number;
  unconfirmed: number;
  incomparable: number;
  /** Disputed and incomparable lines, worst spread first. */
  needsAttention: Reconciled[];
  summary: string;
}

/** Reconcile a whole bill, grouped by item. */
export function reconcileAll(
  claimsByItem: Record<string, QuantityClaim[]>,
  opts: ReconcileOptions = {},
): ReconcileSummary {
  const lines = Object.entries(claimsByItem).map(([item, claims]) => reconcileItem(item, claims, opts));

  const count = (v: Verdict) => lines.filter((l) => l.verdict === v).length;
  const needsAttention = lines
    .filter((l) => l.verdict === "disputed" || l.verdict === "incomparable")
    // Incomparable first: a unit disagreement is a harder error than a
    // percentage one, and it cannot be ranked among the percentages at all.
    .sort((a, b) => {
      if (a.verdict !== b.verdict) return a.verdict === "incomparable" ? -1 : 1;
      return (b.spread ?? 0) - (a.spread ?? 0);
    });

  const parts = [
    count("disputed") && `${count("disputed")} disputed`,
    count("incomparable") && `${count("incomparable")} incomparable`,
    count("unconfirmed") && `${count("unconfirmed")} unconfirmed`,
    count("agreed") && `${count("agreed")} agreed`,
  ].filter(Boolean);

  return {
    lines,
    agreed: count("agreed"),
    disputed: count("disputed"),
    unconfirmed: count("unconfirmed"),
    incomparable: count("incomparable"),
    needsAttention,
    summary: parts.length ? parts.join(", ") : "nothing to reconcile",
  };
}

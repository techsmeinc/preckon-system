// Quantity dirty propagation and remeasure.
//
// The failure this prevents is specific and quiet: a drawing is revised, the
// quantities measured from it are now wrong, and the bill goes on displaying
// them as if they were current. Nothing errors. The number is simply stale, and
// it is stale in the direction of whatever the old design was.
//
// So staleness is a state a quantity CARRIES, not something a screen works out.
// Three rules follow from that, and they are the whole file:
//
//   1. A stale quantity is never presented as current. It is shown, with what
//      it was measured from and why that is out of date, because hiding it
//      would leave a hole in the bill that reads as zero.
//   2. Staleness propagates. A BOQ line derived from a stale quantity is stale;
//      so is a rate build-up derived from that line.
//   3. Remeasuring is ordered by exposure, not by discovery. With forty stale
//      quantities and an afternoon, the biggest one is the right place to start.

export type Freshness = "current" | "stale" | "unmeasured" | "superseded";

export interface Quantity {
  id: string;
  /** The object or region it was measured from. */
  sourceId: string;
  /** The source revision it was measured against. */
  measuredAgainst: string | null;
  value: number;
  unit: string;
  /** Value at stake, minor units — for ordering the remeasure queue. */
  valueMinor?: number;
  freshness: Freshness;
  measuredAt?: string | null;
}

export interface SourceChange {
  sourceId: string;
  /** The revision it has moved to. */
  revision: string;
  kind?: "geometry" | "attribute" | "deleted";
  at: string;
}

export interface DirtyResult {
  quantities: Quantity[];
  /** Ids that changed state in this pass. */
  markedStale: string[];
  markedSuperseded: string[];
  unaffected: number;
}

/**
 * Mark everything measured against a superseded source.
 *
 * A deleted source supersedes rather than staling: there is nothing left to
 * remeasure, and leaving it "stale" would put it in a queue that can never be
 * cleared.
 */
export function propagate(quantities: Quantity[], changes: SourceChange[]): DirtyResult {
  const bySource = new Map(changes.map((c) => [c.sourceId, c] as const));
  const markedStale: string[] = [];
  const markedSuperseded: string[] = [];

  const out = quantities.map((q) => {
    const change = bySource.get(q.sourceId);
    if (!change) return q;
    if (change.kind === "deleted") {
      markedSuperseded.push(q.id);
      return { ...q, freshness: "superseded" as const };
    }
    // Already measured against this revision: the change is one it has seen.
    if (q.measuredAgainst === change.revision) return q;
    if (q.freshness === "stale") return q;
    markedStale.push(q.id);
    return { ...q, freshness: "stale" as const };
  });

  return {
    quantities: out,
    markedStale,
    markedSuperseded,
    unaffected: out.length - markedStale.length - markedSuperseded.length,
  };
}

export interface DerivedRecord {
  id: string;
  /** Quantities this was computed from. */
  fromQuantityIds: string[];
  freshness: Freshness;
}

/**
 * Carry staleness downstream.
 *
 * A BOQ line is exactly as fresh as the least fresh quantity behind it. This is
 * the rule that stops a correct-looking bill being assembled entirely from
 * stale parts.
 */
export function propagateDerived<T extends DerivedRecord>(records: T[], quantities: Quantity[]): T[] {
  const fresh = new Map(quantities.map((q) => [q.id, q.freshness] as const));
  const rank: Record<Freshness, number> = { superseded: 0, unmeasured: 1, stale: 2, current: 3 };
  return records.map((r) => {
    const states = r.fromQuantityIds.map((id) => fresh.get(id) ?? "unmeasured");
    if (!states.length) return r;
    const worst = states.reduce((a, b) => (rank[a] <= rank[b] ? a : b));
    return worst === r.freshness ? r : { ...r, freshness: worst };
  });
}

export interface QueueItem {
  quantityId: string;
  sourceId: string;
  reason: string;
  valueMinor: number;
  freshness: Freshness;
}

/**
 * What to remeasure, worst exposure first.
 *
 * Superseded items come first despite being unmeasurable, because they need a
 * decision — delete the line or re-scope it — and a decision nobody is prompted
 * for is one nobody takes.
 */
export function remeasureQueue(quantities: Quantity[]): QueueItem[] {
  const rank: Record<Freshness, number> = { superseded: 0, stale: 1, unmeasured: 2, current: 3 };
  return quantities
    .filter((q) => q.freshness !== "current")
    .map((q) => ({
      quantityId: q.id,
      sourceId: q.sourceId,
      valueMinor: q.valueMinor ?? 0,
      freshness: q.freshness,
      reason:
        q.freshness === "superseded"
          ? "The object it was measured from no longer exists — the line needs deleting or re-scoping."
          : q.freshness === "unmeasured"
            ? "Never measured."
            : `Measured against ${q.measuredAgainst ?? "an earlier revision"}, which has since been superseded.`,
    }))
    .sort((a, b) => rank[a.freshness] - rank[b.freshness] || b.valueMinor - a.valueMinor);
}

export interface Confidence {
  total: number;
  current: number;
  stale: number;
  superseded: number;
  unmeasured: number;
  /** Fraction of VALUE that is current, which is the honest headline. */
  valueConfidence: number;
  safeToPrice: boolean;
  summary: string;
}

/**
 * How much of the bill can be trusted right now.
 *
 * Reported by value rather than by count on purpose: thirty-nine fresh
 * quantities and one stale one sounds like 97.5% confidence, and if the stale
 * one is the superstructure it is nothing of the kind.
 */
export function confidence(quantities: Quantity[]): Confidence {
  const total = quantities.length;
  const count = (f: Freshness) => quantities.filter((q) => q.freshness === f).length;
  const valueOf = (f: Freshness) =>
    quantities.filter((q) => q.freshness === f).reduce((s, q) => s + (q.valueMinor ?? 0), 0);
  const totalValue = quantities.reduce((s, q) => s + (q.valueMinor ?? 0), 0);
  const currentValue = valueOf("current");
  const ratio = totalValue ? currentValue / totalValue : 1;

  return {
    total,
    current: count("current"),
    stale: count("stale"),
    superseded: count("superseded"),
    unmeasured: count("unmeasured"),
    valueConfidence: ratio,
    // A bill priced on stale quantities is a bid, and it is wrong by whatever
    // the design did in the meantime.
    safeToPrice: ratio >= 0.999,
    summary:
      ratio >= 0.999
        ? `All ${total} quantities are current.`
        : `${Math.round(ratio * 100)}% of value is current — ${count("stale")} stale, ` +
          `${count("superseded")} superseded, ${count("unmeasured")} never measured. ` +
          `Remeasure before pricing.`,
  };
}

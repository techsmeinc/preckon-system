// BOQ delta between revisions.
//
// cad/compare.ts already answers "what changed in the drawing". This answers
// the question the commercial team actually asks next: what did that do to the
// bill, and who pays for it.
//
// The distinction that earns this file its place is between a quantity that
// changed because the DESIGN changed and one that changed because the
// MEASUREMENT changed. The first is a variation with someone to bill; the
// second is an estimating correction with nobody to bill, and conflating them
// is how a contractor absorbs its own remeasure or claims for its own error.
// Nothing here can infer which is which from numbers alone, so it separates
// what it can prove — the source revision moved, or it did not — and says so.

export interface BoqLine {
  id: string;
  /** Stable across revisions. Two lines with the same key are the same item. */
  code: string;
  description: string;
  unit: string;
  qty: number;
  rateMinor: number;
  /** The drawing/model revision the quantity was measured from. */
  sourceRevision?: string | null;
  workSection?: string | null;
}

export type ChangeKind = "added" | "removed" | "quantity" | "rate" | "both" | "unchanged";
export type Cause = "design_change" | "remeasure" | "repricing" | "new_scope" | "descope";

export interface LineDelta {
  code: string;
  description: string;
  kind: ChangeKind;
  cause: Cause;
  fromQty: number;
  toQty: number;
  fromRateMinor: number;
  toRateMinor: number;
  fromValueMinor: number;
  toValueMinor: number;
  deltaMinor: number;
  /** Plain words, for the variation register. */
  note: string;
}

export interface BoqDelta {
  fromLabel: string;
  toLabel: string;
  lines: LineDelta[];
  fromTotalMinor: number;
  toTotalMinor: number;
  deltaMinor: number;
  deltaPct: number;
  /** Split by cause — the number the commercial conversation turns on. */
  designChangeMinor: number;
  remeasureMinor: number;
  repricingMinor: number;
  summary: string;
}

const value = (l: BoqLine) => Math.round(l.qty * l.rateMinor);
const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * Compare two revisions of a bill.
 *
 * Matched on `code`, not on description or position: descriptions get edited
 * and rows get reordered, and a diff that treats either as identity reports a
 * whole bill as replaced every time somebody tidies it.
 */
export function boqDelta(
  from: BoqLine[], to: BoqLine[], labels: { from: string; to: string } = { from: "Previous", to: "Current" },
): BoqDelta {
  const fromByCode = new Map(from.map((l) => [l.code, l] as const));
  const toByCode = new Map(to.map((l) => [l.code, l] as const));
  const codes = new Set([...fromByCode.keys(), ...toByCode.keys()]);
  const lines: LineDelta[] = [];

  for (const code of codes) {
    const a = fromByCode.get(code);
    const b = toByCode.get(code);

    if (!a && b) {
      lines.push({
        code, description: b.description, kind: "added", cause: "new_scope",
        fromQty: 0, toQty: b.qty, fromRateMinor: 0, toRateMinor: b.rateMinor,
        fromValueMinor: 0, toValueMinor: value(b), deltaMinor: value(b),
        note: `New item: ${b.description}`,
      });
      continue;
    }
    if (a && !b) {
      lines.push({
        code, description: a.description, kind: "removed", cause: "descope",
        fromQty: a.qty, toQty: 0, fromRateMinor: a.rateMinor, toRateMinor: 0,
        fromValueMinor: value(a), toValueMinor: 0, deltaMinor: -value(a),
        note: `Removed: ${a.description}`,
      });
      continue;
    }
    if (!a || !b) continue;

    const qtyChanged = a.qty !== b.qty;
    const rateChanged = a.rateMinor !== b.rateMinor;
    if (!qtyChanged && !rateChanged) continue;

    /* The one inference worth making, and its limit.
       If the source revision moved, the quantity changed because the design
       did. If it did not move and the quantity did, somebody measured it
       differently — that is a remeasure, and there is nobody to bill. */
    const sourceMoved = (a.sourceRevision ?? null) !== (b.sourceRevision ?? null);
    const cause: Cause = qtyChanged
      ? (sourceMoved ? "design_change" : "remeasure")
      : "repricing";

    lines.push({
      code, description: b.description,
      kind: qtyChanged && rateChanged ? "both" : qtyChanged ? "quantity" : "rate",
      cause,
      fromQty: a.qty, toQty: b.qty,
      fromRateMinor: a.rateMinor, toRateMinor: b.rateMinor,
      fromValueMinor: value(a), toValueMinor: value(b),
      deltaMinor: value(b) - value(a),
      note: describe(a, b, cause, sourceMoved),
    });
  }

  lines.sort((x, y) => Math.abs(y.deltaMinor) - Math.abs(x.deltaMinor));

  const fromTotal = from.reduce((s, l) => s + value(l), 0);
  const toTotal = to.reduce((s, l) => s + value(l), 0);
  const by = (c: Cause) => lines.filter((l) => l.cause === c).reduce((s, l) => s + l.deltaMinor, 0);
  const designChangeMinor = by("design_change") + by("new_scope") + by("descope");
  const remeasureMinor = by("remeasure");
  const repricingMinor = by("repricing");

  const parts: string[] = [];
  if (designChangeMinor) parts.push(`${money(Math.abs(designChangeMinor))} from design change`);
  if (remeasureMinor) parts.push(`${money(Math.abs(remeasureMinor))} from remeasurement`);
  if (repricingMinor) parts.push(`${money(Math.abs(repricingMinor))} from repricing`);

  return {
    fromLabel: labels.from, toLabel: labels.to, lines,
    fromTotalMinor: fromTotal, toTotalMinor: toTotal,
    deltaMinor: toTotal - fromTotal,
    deltaPct: fromTotal ? ((toTotal - fromTotal) / fromTotal) * 100 : 0,
    designChangeMinor, remeasureMinor, repricingMinor,
    summary: parts.length
      ? `${labels.from} → ${labels.to}: ${toTotal >= fromTotal ? "up" : "down"} ${money(Math.abs(toTotal - fromTotal))} — ${parts.join(", ")}.`
      : `${labels.from} → ${labels.to}: no change.`,
  };
}

function describe(a: BoqLine, b: BoqLine, cause: Cause, sourceMoved: boolean): string {
  if (cause === "repricing") {
    return `Rate ${a.rateMinor / 100} → ${b.rateMinor / 100}, same quantity.`;
  }
  const direction = b.qty > a.qty ? "increased" : "decreased";
  return sourceMoved
    ? `Quantity ${direction} ${a.qty} → ${b.qty} ${b.unit} against a changed source revision (${a.sourceRevision ?? "—"} → ${b.sourceRevision ?? "—"}) — chargeable as a design change.`
    : `Quantity ${direction} ${a.qty} → ${b.qty} ${b.unit} with no change to the source revision — a remeasure, not a variation.`;
}

/**
 * A baseline snapshot, so a delta can be taken against something fixed.
 *
 * Returned as a frozen copy rather than a reference. A "baseline" that is the
 * live array is not a baseline; it moves with the bill and every delta against
 * it reads as zero.
 */
export function baseline(lines: BoqLine[], label: string, at: string) {
  return {
    label,
    at,
    lines: lines.map((l) => ({ ...l })),
    totalMinor: lines.reduce((s, l) => s + value(l), 0),
  };
}

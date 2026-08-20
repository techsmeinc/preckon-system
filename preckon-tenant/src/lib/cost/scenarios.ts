// Estimate scenarios: base, target, BAFO.
//
// The same bill gets priced more than once. There is the honest build-up, the
// number the board will accept, and — after the client comes back — the best
// and final offer. Teams keep these in three spreadsheets, and by the second
// round nobody can say which lines actually changed or why the BAFO is 6% lower.
//
// A scenario here is therefore an ORDERED LIST OF ADJUSTMENTS against a single
// base, never a copy of the bill. That way the difference between two scenarios
// is always answerable — line by line, with the reason attached — and a BAFO
// that was reached by quietly removing scope cannot be mistaken for one reached
// by sharpening rates.

export type ScenarioKind = "base" | "target" | "bafo" | "what_if";

export type AdjustmentKind =
  | "rate"        // same scope, different rate
  | "quantity"    // remeasured
  | "remove"      // scope taken out — the one that changes what is being offered
  | "add"
  | "markup";     // commercial only, no change to the build-up

export interface Adjustment {
  lineId: string;
  kind: AdjustmentKind;
  /** New value in minor units (rate/markup) or the new quantity. */
  to: number;
  reason: string;
  by?: string;
  at?: string;
}

export interface EstimateLine {
  id: string;
  description: string;
  qty: number;
  unit: string;
  rateMinor: number;
}

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  label: string;
  adjustments: Adjustment[];
}

export interface PricedLine extends EstimateLine {
  totalMinor: number;
  removed: boolean;
  changed: boolean;
}

export interface PricedScenario {
  id: string;
  kind: ScenarioKind;
  label: string;
  lines: PricedLine[];
  totalMinor: number;
  /** Scope actually withdrawn, not just repriced. */
  removedCount: number;
  removedValueMinor: number;
}

const lineTotal = (l: EstimateLine) => Math.round(l.rateMinor * l.qty);

/** Apply a scenario's adjustments to the base bill, in order. */
export function priceScenario(base: EstimateLine[], scenario: Scenario): PricedScenario {
  const byId = new Map(base.map((l) => [l.id, { ...l, removed: false, changed: false } as PricedLine]));

  for (const adj of scenario.adjustments) {
    if (adj.kind === "add") {
      byId.set(adj.lineId, {
        id: adj.lineId, description: adj.reason, qty: 1, unit: "item",
        rateMinor: adj.to, totalMinor: adj.to, removed: false, changed: true,
      });
      continue;
    }
    const line = byId.get(adj.lineId);
    if (!line) continue;
    if (adj.kind === "remove") { line.removed = true; line.changed = true; continue; }
    if (adj.kind === "rate" || adj.kind === "markup") line.rateMinor = adj.to;
    if (adj.kind === "quantity") line.qty = adj.to;
    line.changed = true;
  }

  const lines = [...byId.values()].map((l) => ({ ...l, totalMinor: l.removed ? 0 : lineTotal(l) }));
  const removed = lines.filter((l) => l.removed);
  const baseById = new Map(base.map((l) => [l.id, l]));

  return {
    id: scenario.id,
    kind: scenario.kind,
    label: scenario.label,
    lines,
    totalMinor: lines.reduce((a, l) => a + l.totalMinor, 0),
    removedCount: removed.length,
    removedValueMinor: removed.reduce((a, l) => {
      const original = baseById.get(l.id);
      return a + (original ? lineTotal(original) : 0);
    }, 0),
  };
}

export interface LineDelta {
  lineId: string;
  description: string;
  fromMinor: number;
  toMinor: number;
  deltaMinor: number;
  kind: AdjustmentKind | "unchanged";
  reason: string;
}

export interface ScenarioDelta {
  fromLabel: string;
  toLabel: string;
  fromTotalMinor: number;
  toTotalMinor: number;
  deltaMinor: number;
  deltaPct: number;
  lines: LineDelta[];
  /** The sentence a commercial reviewer actually needs. */
  summary: string;
}

/**
 * What changed between two scenarios, and why.
 *
 * Separates value given away by sharpening from value given away by removing
 * scope, because they are different promises. A BAFO 6% lower on rates is a
 * thinner margin; a BAFO 6% lower because two items vanished is a different bid,
 * and if the client does not know that, the difference reappears as a variation
 * argument later.
 */
export function compareScenarios(
  base: EstimateLine[], from: Scenario, to: Scenario,
): ScenarioDelta {
  const a = priceScenario(base, from);
  const b = priceScenario(base, to);
  const bLines = new Map(b.lines.map((l) => [l.id, l]));
  const reasons = new Map(to.adjustments.map((x) => [x.lineId, x]));

  const lines: LineDelta[] = a.lines.map((la) => {
    const lb = bLines.get(la.id);
    const adj = reasons.get(la.id);
    return {
      lineId: la.id,
      description: la.description,
      fromMinor: la.totalMinor,
      toMinor: lb?.totalMinor ?? 0,
      deltaMinor: (lb?.totalMinor ?? 0) - la.totalMinor,
      kind: adj?.kind ?? "unchanged",
      reason: adj?.reason ?? "",
    };
  }).filter((d) => d.deltaMinor !== 0);

  const removedDelta = lines.filter((l) => l.kind === "remove").reduce((s, l) => s + l.deltaMinor, 0);
  const pricedDelta = lines.filter((l) => l.kind !== "remove").reduce((s, l) => s + l.deltaMinor, 0);
  const delta = b.totalMinor - a.totalMinor;

  const parts: string[] = [];
  if (pricedDelta) parts.push(`${money(Math.abs(pricedDelta))} from repricing`);
  if (removedDelta) parts.push(`${money(Math.abs(removedDelta))} by withdrawing ${b.removedCount - a.removedCount} item(s) of scope`);

  return {
    fromLabel: a.label,
    toLabel: b.label,
    fromTotalMinor: a.totalMinor,
    toTotalMinor: b.totalMinor,
    deltaMinor: delta,
    deltaPct: a.totalMinor ? (delta / a.totalMinor) * 100 : 0,
    lines: lines.sort((x, y) => Math.abs(y.deltaMinor) - Math.abs(x.deltaMinor)),
    summary: parts.length
      ? `${a.label} → ${b.label}: ${delta < 0 ? "down" : "up"} ${money(Math.abs(delta))} — ${parts.join(", ")}.`
      : `${a.label} → ${b.label}: no change.`,
  };
}

const money = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

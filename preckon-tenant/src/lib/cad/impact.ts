/**
 * Which quantities a drawing revision puts in doubt.
 *
 * compareRevisions says what changed on a sheet. This says what that means for
 * the numbers already derived from it — the join between DrawLogix and
 * QuantLogix, and the first real step of the propagation the plan calls the
 * strongest long-term advantage.
 *
 * ── THE THREE ANSWERS, AND WHY THERE ARE THREE ───────────────────────────────
 *
 *   affected    the revision touched a layer this measurement was read from
 *   unaffected  it demonstrably did not
 *   unknown     the measurement does not record where it was read from, so
 *               neither can be shown
 *
 * The third is the one that matters. A measurement with no recorded source
 * cannot be proven safe, and quietly sorting it into "unaffected" is how a stale
 * quantity survives a revision and reaches a bill. Sorting it into "affected"
 * instead would flag every measurement on the sheet and train people to dismiss
 * the whole feature. It is its own answer, and it says what to do about it.
 *
 * ── NOTHING HERE RECALCULATES ────────────────────────────────────────────────
 *
 * Staleness is a flag, never a silent correction. The same discipline the BIM
 * assistant follows: the system proposes, a person decides. A quantity that
 * changed under a signed-off bill without anyone agreeing is exactly the failure
 * the artifact chain exists to prevent.
 */

import type { RevisionDiff } from "./compare";
import { affectedLayers } from "./compare";

/** What a measurement must carry for this to reason about it. */
export interface MeasurementRef {
  id: string;
  sheet_no: string;
  item: string;
  quantity: number;
  unit: string;
  /** Layers it was read from. Optional — older records predate it. */
  source_layers?: string[];
}

export type Verdict = "affected" | "unaffected" | "unknown";

export interface ImpactedMeasurement {
  id: string;
  item: string;
  sheet_no: string;
  quantity: number;
  unit: string;
  verdict: Verdict;
  /** Which changed layers it reads from. Empty for unaffected and unknown. */
  via: string[];
  why: string;
}

export interface ImpactReport {
  sheetNo: string;
  changed: string;
  affected: ImpactedMeasurement[];
  unknown: ImpactedMeasurement[];
  unaffected: number;
  /** Layers the revision touched, whether or not anything reads from them. */
  changedLayers: string[];
  summary: string;
  /** True when nothing on this sheet can be shown safe. */
  needsReview: boolean;
}

/**
 * Assess a revision against the measurements taken from that sheet.
 *
 * `measurements` should already be the ones for this sheet; passing the whole
 * project's would make the sheet filter this function's business rather than the
 * caller's, and the caller is the one that knows how sheets are identified in
 * its own data.
 */
export function assessRevisionImpact(
  sheetNo: string,
  diff: RevisionDiff,
  measurements: MeasurementRef[],
): ImpactReport {
  const changed = affectedLayers(diff);
  const changedSet = new Set(changed.map((l) => l.toLowerCase()));

  const affected: ImpactedMeasurement[] = [];
  const unknown: ImpactedMeasurement[] = [];
  let unaffected = 0;

  for (const m of measurements) {
    const base = {
      id: m.id,
      item: m.item,
      sheet_no: m.sheet_no,
      quantity: m.quantity,
      unit: m.unit,
    };

    // No recorded source. Cannot be shown safe, and must not be assumed so.
    if (!m.source_layers?.length) {
      unknown.push({
        ...base,
        verdict: "unknown",
        via: [],
        why: "This measurement does not record which layers it was read from, so the revision cannot be shown to leave it alone.",
      });
      continue;
    }

    const via = m.source_layers.filter((l) => changedSet.has(l.toLowerCase()));
    if (via.length) {
      affected.push({
        ...base,
        verdict: "affected",
        via,
        why: `The revision changed ${via.join(", ")}, which this measurement was read from.`,
      });
    } else {
      unaffected++;
    }
  }

  /* A revision that only added a layer still counts: geometry on a new layer can
     be work nobody has measured yet, which is a different problem from a stale
     quantity and just as much worth surfacing. */
  const newLayers = diff.layersAdded;

  const parts = [
    affected.length && `${affected.length} affected`,
    unknown.length && `${unknown.length} unverifiable`,
    unaffected && `${unaffected} unaffected`,
  ].filter(Boolean);

  return {
    sheetNo,
    changed: diff.summary,
    affected,
    unknown,
    unaffected,
    changedLayers: changed,
    needsReview: affected.length > 0 || unknown.length > 0 || newLayers.length > 0,
    summary: parts.length
      ? `${diff.summary}. ${parts.join(", ")}.`
      : `${diff.summary}. No measurements taken from this sheet.`,
  };
}

/**
 * Dimension changes worth a person's eye regardless of layer bookkeeping.
 *
 * A label going from 5100 to 5200 is a 100 mm change to something somebody
 * measured, and it is legible without any provenance at all. Surfaced separately
 * because it is the one signal in a revision that a reader can act on
 * immediately — and the one most likely to be missed in a diff of two thousand
 * entities.
 */
export function dimensionChanges(diff: RevisionDiff): {
  layer: string;
  before: string;
  after: string;
  delta: number;
  percent: number | null;
}[] {
  return diff.textChanged
    .filter((t) => t.delta !== null && t.delta !== 0)
    .map((t) => {
      const from = Number(t.before.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
      return {
        layer: t.layer,
        before: t.before,
        after: t.after,
        delta: t.delta!,
        // Percentage is the honest way to rank: 100 mm on a 5 m wall and 100 mm
        // on a 200 mm upstand are not the same news.
        percent: Number.isFinite(from) && from !== 0 ? Number(((t.delta! / Math.abs(from)) * 100).toFixed(2)) : null,
      };
    })
    .sort((a, b) => Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0));
}

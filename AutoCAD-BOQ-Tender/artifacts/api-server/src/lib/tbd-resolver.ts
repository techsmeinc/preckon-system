/**
 * TBD Resolver — derives a real (preliminary) quantity for a TBD line from the
 * project's measured CAD footprint, using standard QS formulas. Zero model
 * tokens, evidence-based:
 *   • horizontal-surface AREA (slab/floor/ceiling/roof/vapour/screed/sub-base)
 *       → quantity = building footprint (m²)
 *   • VOLUME (concrete slab/blinding/screed/topping) → footprint × thickness
 * Vertical areas (walls/partitions) and MEP lengths are NOT resolvable from the
 * footprint and stay TBD. Shared by scripts/resolve-tbd.ts and the
 * approve-reviewed endpoint so the logic never diverges.
 */
import { detectMeasurementMethod, inferScopeType, type AssessableItem } from "./estimator-style";

const UNIT_TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, dm: 0.1, m: 1, inches: 0.0254, feet: 0.3048 };
const areaFactor = (u?: string | null): number | null => {
  const f = u && UNIT_TO_M[u] != null ? UNIT_TO_M[u] : null;
  return f == null ? null : f * f;
};

// Annotation/tag/dim layers carry huge bounding boxes — never the footprint.
const NON_STRUCTURAL = /note|tag|anno|level|\blvl\b|title|\btb[-_ ]|dim|text|txt|hatch|furn|legend|grid|north|scale|symbol/i;
// Horizontal surfaces that track the building footprint.
const RE_FOOTPRINT_AREA = /\b(slab|floor|flooring|ceiling|roof|vapou?r barrier|damp[- ]?proof|screed|sub[- ]?base|blinding|deck)\b/i;
const RE_VOLUME_FOOTPRINT = /\b(slab|blinding|sub[- ]?base|screed|topping)\b/i;
// Vertical elements that are m² but do NOT track the footprint — exclude so a
// façade panel or partition isn't given the floor area.
const RE_VERTICAL = /\b(wall|partition|fa[çc]ade|curtain|cladding|spandrel|parapet|glazing|riser|upstand)\b/i;
const isM2 = (u: string) => { const x = u.trim().toLowerCase(); return x === "m²" || x === "m2"; };
const isM3 = (u: string) => { const x = u.trim().toLowerCase(); return x === "m³" || x === "m3"; };

export interface FootprintResult { m2: number; source: string; }

/** Largest closed outline on a structural layer across the drawings, in m². */
export function footprintFromSummaries(summaries: any[], override?: number | null): FootprintResult | null {
  if (override && override > 0) return { m2: override, source: "stated dimensions" };
  let best = 0;
  let src = "";
  for (const s of summaries) {
    if (!s || !Array.isArray(s.layers)) continue;
    const af = areaFactor(s.units);
    if (af == null) continue;
    for (const l of s.layers) {
      if (NON_STRUCTURAL.test(l.layer ?? "")) continue;
      const tops: number[] | undefined = l.closed_polyline_top_areas;
      const maxA = Array.isArray(tops) && tops.length ? Math.max(...tops) : Number(l.polyline_area_total ?? 0);
      const m2 = maxA * af;
      // Sanity band: a real footprint, not a detail or a runaway duplicate.
      if (m2 > 30 && m2 < 100000 && m2 > best) { best = m2; src = `CAD: ${s.file ?? "drawing"} layer ${l.layer}`; }
    }
  }
  return best > 0 ? { m2: Math.round(best * 100) / 100, source: src } : null;
}

/** Pull a thickness in metres from a description, e.g. "150 mm slab" → 0.15. */
function thicknessM(desc: string): number | null {
  const mm = desc.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mm) return Number(mm[1]) / 1000;
  const cm = desc.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
  if (cm) return Number(cm[1]) / 100;
  return null;
}

export interface ResolvedQty { quantity: number; basis: string; }

/**
 * Try to derive a preliminary quantity for ONE item from the footprint. Returns
 * null when it isn't footprint-resolvable (the line should stay TBD).
 */
export function resolveTbdQuantity(item: AssessableItem, footprint: FootprintResult | null): ResolvedQty | null {
  if (!footprint) return null;
  const desc = item.description ?? "";
  const unit = (item.unit ?? "").trim();
  const scopeType = inferScopeType(desc, item.category);
  const method = detectMeasurementMethod(desc, item.category, unit, scopeType);

  // Only a horizontal m² surface (not a vertical façade/wall) gets the footprint.
  if (method === "area" && isM2(unit) && RE_FOOTPRINT_AREA.test(desc) && !RE_VERTICAL.test(desc)) {
    return {
      quantity: footprint.m2,
      basis: `Preliminary qty = ${footprint.m2} m² building footprint (${footprint.source}); verify per-room takeoff.`,
    };
  }
  // Only an m³ concrete/screed slab gets footprint × thickness.
  if (method === "volume" && isM3(unit) && RE_VOLUME_FOOTPRINT.test(desc)) {
    const t = thicknessM(desc);
    if (t) {
      const q = Math.round(footprint.m2 * t * 1000) / 1000;
      return { quantity: q, basis: `Preliminary qty = footprint ${footprint.m2} m² × ${t} m thickness = ${q} m³; verify.` };
    }
  }
  return null;
}

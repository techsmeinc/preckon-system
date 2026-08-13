// Units — the boring file that stops a wall being a kilometre long.
//
// PCM stores metres. Nothing else. Every source that reaches it declares what
// it was in, gets converted once, and the conversion is recorded.
//
// This matters more than it sounds. A DXF says 5100 and means 5,100 mm; PCM
// reads 5100 and means 5.1 km. The arithmetic downstream is flawless either
// way — the wall measures, the bill prices, the total adds up, and it is wrong
// by a factor of a thousand. No test of the measurement engine catches it,
// because the measurement engine did nothing wrong.
//
// So the defence is here, at the boundary, in two parts: convert from what the
// source declared, and refuse anything that is not the size of a building.

export type LinearUnit = "mm" | "cm" | "m" | "km" | "in" | "ft" | "yd" | "mi";

/** Metres per one of each unit. */
const TO_M: Record<LinearUnit, number> = {
  mm: 0.001, cm: 0.01, m: 1, km: 1000,
  in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344,
};

/**
 * DXF $INSUNITS. The numbers are the format's, not ours.
 *
 * 0 means "unitless", which is not the same as metres — it means the file
 * declined to say. Treated as unknown so the caller has to decide rather than
 * inheriting a guess dressed up as a fact.
 */
const INSUNITS: Record<number, LinearUnit> = {
  1: "in", 2: "ft", 3: "mi", 4: "mm", 5: "cm", 6: "m", 7: "km", 10: "yd",
};

export const unitFromInsunits = (code: number | null | undefined): LinearUnit | null =>
  (code != null && INSUNITS[code]) || null;

export const isLinearUnit = (u: string): u is LinearUnit => u in TO_M;

/** The multiplier that takes a source coordinate to metres. */
export function scaleToMetres(unit: LinearUnit): number {
  return TO_M[unit];
}

export interface UnitDecision {
  unit: LinearUnit;
  scaleToM: number;
  basis: "DECLARED" | "INFERRED" | "PROJECT_DEFAULT" | "USER_OVERRIDE";
  /** Said on screen when the source did not declare, so an assumption is never
   *  invisible. */
  note?: string;
}

/**
 * Decide what a source's units are, and be honest about how sure that is.
 *
 * Order: what the user said, then what the file said, then an inference from
 * the size of the thing, then the project default. The `basis` travels with the
 * answer because "the file told us" and "we guessed from the extents" deserve
 * different amounts of trust, and a reviewer should be able to tell them apart
 * a year later.
 */
export function decideUnit(input: {
  override?: string | null;
  declared?: LinearUnit | null;
  /** The largest dimension in the source's own numbers, when known. */
  extent?: number | null;
  projectDefault?: LinearUnit;
}): UnitDecision {
  const fallback = input.projectDefault ?? "m";

  if (input.override && isLinearUnit(input.override)) {
    return { unit: input.override, scaleToM: TO_M[input.override], basis: "USER_OVERRIDE" };
  }
  if (input.declared) {
    return { unit: input.declared, scaleToM: TO_M[input.declared], basis: "DECLARED" };
  }

  // Nothing declared. Infer from magnitude, and only when the answer is not
  // close: a drawing whose longest dimension is 40,000 is millimetres, because
  // nothing anybody builds is 40 km across. Between the two, refuse to guess.
  const extent = input.extent ?? null;
  if (extent != null && extent > 0) {
    if (extent >= 2000) {
      return { unit: "mm", scaleToM: TO_M.mm, basis: "INFERRED",
        note: `No units declared. The drawing is ${Math.round(extent).toLocaleString()} units across, which is only a building if those units are millimetres.` };
    }
    if (extent <= 500) {
      return { unit: "m", scaleToM: TO_M.m, basis: "INFERRED",
        note: `No units declared. The drawing is ${Math.round(extent)} units across, which reads as metres.` };
    }
  }

  return { unit: fallback, scaleToM: TO_M[fallback], basis: "PROJECT_DEFAULT",
    note: "No units declared and the extents are ambiguous — the project default was used. Check the scale before pricing from it." };
}

/* ── the sanity guard ─────────────────────────────────────────────────────── */

/** What a building part can plausibly measure, in metres. Generous on purpose:
 *  this is here to catch a factor of a thousand, not to have an opinion about
 *  architecture. A 400 m runway canopy passes; a 5,100 m wall does not. */
const PLAUSIBLE: Record<string, { max: number; what: string }> = {
  WALL:   { max: 500, what: "wall" },
  BEAM:   { max: 200, what: "beam" },
  SLAB:   { max: 1000, what: "slab" },
  ROOM:   { max: 500, what: "room" },
  COLUMN: { max: 50,  what: "column" },
};

export interface ScaleWarning { objectType: string; measured: number; limit: number; message: string }

/**
 * Is this object the size of a thing people build?
 *
 * Returns a warning rather than throwing. The caller decides whether to refuse
 * the import or flag it — refusing a whole drawing because one polyline is
 * long would be its own kind of wrong, and a warning somebody reads beats a
 * rejection they route around.
 */
export function checkScale(objectType: string, largestDimensionM: number): ScaleWarning | null {
  const rule = PLAUSIBLE[objectType];
  if (!rule || !Number.isFinite(largestDimensionM) || largestDimensionM <= rule.max) return null;
  // The 1000x hint is the whole reason this exists — say it, rather than making
  // somebody work out why the number is strange.
  const looksLikeMm = largestDimensionM > rule.max * 100;
  return {
    objectType,
    measured: Math.round(largestDimensionM),
    limit: rule.max,
    message: looksLikeMm
      ? `A ${rule.what} ${Math.round(largestDimensionM).toLocaleString()} m long is almost certainly millimetres read as metres — the source's units are probably wrong.`
      : `A ${rule.what} ${Math.round(largestDimensionM).toLocaleString()} m long is beyond anything normally built. Check the scale.`,
  };
}

/** Scale every coordinate in a geometry. Applied once, at the boundary. */
export function scaleGeometry<T extends Record<string, any>>(g: T, k: number): T {
  if (k === 1) return g;
  const pt = (p: [number, number]): [number, number] => [p[0] * k, p[1] * k];
  const out: any = { ...g };
  if (g.baseline) out.baseline = g.baseline.map(pt);
  if (g.outline) out.outline = g.outline.map(pt);
  if (g.at) out.at = pt(g.at);
  for (const key of ["thicknessM", "heightM", "widthM", "depthM", "elevationM", "offsetM", "sillM"]) {
    if (typeof g[key] === "number") out[key] = g[key] * k;
  }
  return out as T;
}

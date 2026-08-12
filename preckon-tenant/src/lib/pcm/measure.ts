// The measurement engine — where an object becomes a number.
//
// Pure functions over geometry. No database, no network, no model: given a
// wall, its type and the openings hosted in it, this returns square metres and
// the arithmetic that produced them.
//
// That purity is the point. This is the code a bill is defensible on, so it has
// to be testable against a hand-measured drawing, and a quantity has to be able
// to show its working. "386.42 m²" is not an answer to "why"; the deduction
// list is.

import type { MeasurementRule, PcmGeometry, PcmType } from "./types";

export interface MeasuredObject {
  id: string;
  typeCode: string;
  geometry: PcmGeometry;
  /** Objects hosted in this one — doors and windows in a wall. Their openings
   *  come out of its area. */
  hosted?: MeasuredObject[];
}

export interface QuantityResult {
  ruleCode: string;
  name: string;
  value: number;
  unit: string;
  /** The working out, kept and shown. */
  calculation: {
    basis: string;
    inputs: Record<string, number | string>;
    deductions?: Array<{ objectId: string; description: string; areaM2: number }>;
    /** Set when the rule could not be applied — a wall with no height, say.
     *  A missing quantity is reported, never guessed at. */
    problem?: string;
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Polyline length in metres. */
function polylineLength(pts: [number, number][] | undefined): number {
  if (!pts || pts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

/**
 * Polygon area by the shoelace formula, unsigned.
 *
 * Unsigned because a draughtsman's outline may run either way round and a
 * negative floor area is never what anyone meant.
 */
function polygonArea(pts: [number, number][] | undefined): number {
  if (!pts || pts.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

function polygonPerimeter(pts: [number, number][] | undefined): number {
  if (!pts || pts.length < 3) return 0;
  return polylineLength([...pts, pts[0]]);
}

/** The area an opening removes from the wall it is hosted in. */
const openingArea = (o: MeasuredObject) => num(o.geometry.widthM) * num(o.geometry.heightM);

/**
 * Measure one object under one rule.
 *
 * Returns null when the rule does not apply to this type at all. Returns a
 * result WITH a `problem` when it applies but the geometry cannot support it —
 * those must surface as "this wall has no height" rather than as a silent zero
 * that adds up to a total somebody prices.
 */
export function applyRule(obj: MeasuredObject, rule: MeasurementRule): QuantityResult | null {
  const g = obj.geometry ?? {};
  const say = (value: number, inputs: Record<string, number | string>, extra?: Partial<QuantityResult["calculation"]>): QuantityResult =>
    ({ ruleCode: rule.code, name: rule.name, value: r3(value), unit: rule.unit,
       calculation: { basis: rule.basis, inputs, ...extra } });

  switch (rule.code) {
    case "COUNT:v1":
      return say(1, {});

    case "WALL_LENGTH:v1":
    case "BEAM_LENGTH:v1": {
      const length = polylineLength(g.baseline);
      return say(length, { lengthM: r3(length) },
        length > 0 ? undefined : { problem: "This object has no baseline, so it cannot be measured for length." });
    }

    case "PERIMETER:v1": {
      const p = polygonPerimeter(g.outline);
      return say(p, { perimeterM: r3(p) },
        p > 0 ? undefined : { problem: "This object has no closed outline." });
    }

    case "NET_FLOOR_AREA:v1":
    case "SLAB_AREA:v1": {
      const area = polygonArea(g.outline);
      return say(area, { areaM2: r3(area) },
        area > 0 ? undefined : { problem: "This object has no closed outline, so it has no area." });
    }

    case "NET_WALL_AREA:v1": {
      const length = polylineLength(g.baseline);
      const height = num(g.heightM);
      const gross = length * height;
      if (gross <= 0) {
        return say(0, { lengthM: r3(length), heightM: r3(height) },
          { problem: height <= 0 ? "This wall has no height set, so its area cannot be measured." : "This wall has no baseline." });
      }
      // Openings out. The threshold is the rule's, not a constant here, because
      // different methods of measurement set it differently and the number has
      // to be able to say which one it used.
      const threshold = rule.deductOpeningsOverM2 ?? 0;
      const deductions = (obj.hosted ?? [])
        .map((h) => ({ objectId: h.id, description: `${h.typeCode.toLowerCase()} opening`, areaM2: r3(openingArea(h)) }))
        .filter((d) => d.areaM2 > threshold);
      const deducted = deductions.reduce((n, d) => n + d.areaM2, 0);
      return say(Math.max(0, gross - deducted),
        { lengthM: r3(length), heightM: r3(height), grossAreaM2: r3(gross),
          deductedM2: r3(deducted), deductionThresholdM2: threshold },
        { deductions });
    }

    case "WALL_VOLUME:v1": {
      const net = applyRule(obj, { ...rule, code: "NET_WALL_AREA:v1", kind: "AREA", unit: "m2" });
      const thickness = num(g.thicknessM);
      const area = net?.value ?? 0;
      return say(area * thickness, { netAreaM2: area, thicknessM: r3(thickness) },
        thickness > 0 ? undefined : { problem: "This wall has no thickness set, so its volume cannot be measured." });
    }

    case "SLAB_VOLUME:v1": {
      const area = polygonArea(g.outline);
      const thickness = num(g.thicknessM);
      return say(area * thickness, { areaM2: r3(area), thicknessM: r3(thickness) },
        thickness > 0 ? undefined : { problem: "This slab has no thickness set." });
    }

    case "COLUMN_VOLUME:v1": {
      const w = num(g.widthM), d = num(g.depthM), h = num(g.heightM);
      return say(w * d * h, { widthM: w, depthM: d, heightM: h },
        w > 0 && d > 0 && h > 0 ? undefined : { problem: "This column is missing a section size or a height." });
    }

    case "COLUMN_FORMWORK:v1": {
      const w = num(g.widthM), d = num(g.depthM), h = num(g.heightM);
      // Four faces. Not the top or bottom: one is cast against the slab above
      // and the other sits on what is below, and neither is shuttered.
      const area = 2 * (w + d) * h;
      return say(area, { perimeterM: r3(2 * (w + d)), heightM: h },
        area > 0 ? undefined : { problem: "This column is missing a section size or a height." });
    }

    case "BEAM_VOLUME:v1": {
      const length = polylineLength(g.baseline);
      const w = num(g.widthM), d = num(g.depthM);
      return say(length * w * d, { lengthM: r3(length), widthM: w, depthM: d },
        length > 0 && w > 0 && d > 0 ? undefined : { problem: "This beam is missing a length or a section size." });
    }

    default:
      return null;
  }
}

/** Every quantity this object's type produces. */
export function measureObject(obj: MeasuredObject, type: PcmType): QuantityResult[] {
  const out: QuantityResult[] = [];
  for (const rule of type.rules) {
    const q = applyRule(obj, rule);
    if (q) out.push(q);
  }
  return out;
}

export const geometryBounds = (g: PcmGeometry): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  const pts = g.baseline ?? g.outline ?? (g.at ? [g.at] : []);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  // A point object has no extent of its own; give it its footprint so a
  // bounding-box query can still find it.
  const pad = g.baseline || g.outline ? 0 : Math.max(num(g.widthM), num(g.depthM)) / 2;
  return {
    minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad,
  };
};

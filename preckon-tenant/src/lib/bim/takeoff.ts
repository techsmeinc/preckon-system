// Quantity takeoff from the BIM model.
//
// This is the join that makes the chain real: elements a person modelled become
// `drawing_measurement` records, which QuantLogix derives BOQ lines from, which
// CostLogix prices, which PlanLogix sizes durations off. Nothing here is an
// estimate or a guess — every number is arithmetic on geometry the user drew,
// which is why these land CONFIRMED rather than as proposals to review.
//
// Pure: no database, no React. Same rule as model.ts — the agent and the UI must
// be able to compute the same takeoff from the same document.

import { CATALOG, levelElev, linLength, list, type BimDocument, type Element } from "./model";

export interface Measurement {
  sheet_no: string;
  item: string;
  quantity: number;
  /** drawing_measurement's enum: m | m2 | m3 | nr | kg | t | lm */
  unit: string;
  location?: string;
  method: string;
  /**
   * The model elements this quantity was measured from.
   *
   * Carried so the measurement can be anchored back to what produced it — the
   * difference between a bill that says "120 m² of blockwork" and one where
   * clicking that figure lights up the walls it came from. Without it the
   * method string is the only evidence, and prose is not a trace.
   */
  element_ids?: string[];
}

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/** Shoelace area of a closed polygon, in m². */
function polygonArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

/**
 * How each geometry archetype is measured. This mirrors how a QS measures off a
 * drawing rather than what is easiest to compute:
 *
 *   linear walls      → elevational area (length x height), m² — how walls are billed
 *   linear services   → run length, m — how pipe, duct, tray and conduit are billed
 *   area              → plan area, m² (or volume where a thickness is a real pour)
 *   point / hosted    → count, nr
 *
 * Deductions for openings are applied to their host wall, because a wall billed
 * without its door and window openings taken out is the classic overmeasure.
 */
/**
 * Categories that are drawn but never built.
 *
 * A tag, a dimension, a view, a sheet, a viewport — none of them is a thing
 * anybody pours, erects or is paid for. Measuring them would put lines in a bill
 * for annotation, which is an overmeasure nobody would think to look for because
 * the geometry it came from is real enough to survive a glance.
 *
 * This list must grow whenever a documentation category is added to CATALOG.
 * The takeoff test asserts that every zero-extent general category is in here.
 */
const NOT_MEASURED = new Set([
  "level",
  // A grid line is setting-out, not construction. It was being measured as
  // linear metres — a 200 m grid line on a 16-grid frame adds kilometres of
  // billed "Grid line" to a bill that nobody ordered, and it looks plausible
  // enough in a category list to survive review.
  "grid",
  "tag", "dimension", "view", "sheet", "viewport",
]);

export function takeoff(doc: BimDocument): Measurement[] {
  const out: Measurement[] = [];
  const elements = list(doc).filter((e) => !NOT_MEASURED.has(e.category));

  // Opening area per host wall, so wall areas come out net.
  const deductions = new Map<string, number>();
  for (const e of elements) {
    if (e.geom.kind !== "hosted" || !e.geom.host) continue;
    const w = e.geom.width ?? 0;
    const h = e.geom.height ?? 0;
    if (w > 0 && h > 0) deductions.set(e.geom.host, (deductions.get(e.geom.host) ?? 0) + w * h);
  }

  // Points and hosted elements are counted by category, not listed one by one —
  // a bill wants "Sprinkler head — 120 nr", not 120 lines. The ids are still
  // collected: the bill shows one line, and clicking it should still light up
  // all 120 heads rather than none of them.
  const counts = new Map<string, { n: number; e: Element; ids: string[] }>();

  for (const e of elements) {
    const cat = CATALOG[e.category];
    const label = cat?.label ?? e.category;
    const sheet = e.level ? `L${round(levelElev(doc, e.level), 1)}` : "MODEL";

    if (e.geom.kind === "linear") {
      const len = linLength(e);
      if (len <= 0) continue;
      const isWall = /wall|railing|fence/.test(e.category);
      if (isWall) {
        const h = e.geom.height ?? 3;
        const gross = len * h;
        const net = Math.max(0, gross - (deductions.get(e.id) ?? 0));
        const ded = gross - net;
        out.push({
          sheet_no: sheet,
          item: `${label} — ${e.geom.width ?? 0.2} m thick, ${h} m high`,
          quantity: round(net),
          unit: "m2",
          element_ids: [e.id],
          location: e.name,
          method: ded > 0
            ? `${round(len)} m x ${h} m less ${round(ded)} m² openings (BIM model)`
            : `${round(len)} m x ${h} m elevational area (BIM model)`,
        });
      } else {
        out.push({
          sheet_no: sheet,
          item: `${label}${e.geom.width ? ` — ${e.geom.width} m` : ""}`,
          quantity: round(len),
          unit: "m",
          element_ids: [e.id],
          location: e.name,
          method: "Run length measured on the BIM model",
        });
      }
      continue;
    }

    if (e.geom.kind === "area" && e.geom.outline?.length) {
      const area = polygonArea(e.geom.outline);
      if (area <= 0) continue;
      const th = e.geom.thickness ?? 0;
      // A structural pour is billed by volume; a finish by area.
      const asVolume = th > 0 && /slab|footing|pad|site_pad/.test(e.category);
      out.push({
        sheet_no: sheet,
        item: `${label}${th ? ` — ${th} m thick` : ""}`,
        quantity: round(asVolume ? area * th : area),
        unit: asVolume ? "m3" : "m2",
        element_ids: [e.id],
        location: e.name,
        method: asVolume
          ? `${round(area)} m² x ${th} m thickness (BIM model)`
          : `Plan area measured on the BIM model`,
      });
      continue;
    }

    // point + hosted → counted
    const key = `${e.category}|${sheet}`;
    const cur = counts.get(key);
    if (cur) { cur.n += 1; cur.ids.push(e.id); }
    else counts.set(key, { n: 1, e, ids: [e.id] });
  }

  for (const [key, { n, e, ids }] of counts) {
    const cat = CATALOG[e.category];
    const sheet = key.split("|")[1];
    out.push({
      sheet_no: sheet,
      item: cat?.label ?? e.category,
      quantity: n,
      unit: "nr",
      element_ids: ids,
      method: "Counted on the BIM model",
    });
  }

  return out.sort((a, b) => a.item.localeCompare(b.item));
}

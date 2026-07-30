/**
 * Instant takeoff → priced BOQ for the live editor. The editor holds an in-memory
 * DxfModel (layers + line/poly/text entities); this adapts it to the shape the
 * takeoff engine expects (a dxf-parser result) and runs the SAME analyzeDxf + buildBom
 * pipeline the platform uses. Pure and client-safe — no server round-trip, no API key —
 * so quantities update live as the drawing is edited.
 *
 * This is the DrawLogix moat in one flow: brief → drawing → measured, priced BOQ.
 */
import type { DxfModel } from "./dxf-model";
import { type BomItem, buildBom, type RateRow } from "./bom";
import { analyzeDxf, type Takeoff, type UnitChoice } from "./takeoff";

/** Convert the editor model to the dxf-parser entity shape analyzeDxf reads. */
export function modelToParsed(model: DxfModel): { entities: Record<string, unknown>[]; header: Record<string, unknown> } {
  const entities: Record<string, unknown>[] = model.entities.map((e) => {
    if (e.kind === "line") return { type: "LINE", layer: e.layer, vertices: [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }] };
    if (e.kind === "poly") return { type: "LWPOLYLINE", layer: e.layer, closed: e.closed, shape: e.closed, vertices: e.pts };
    return { type: "TEXT", layer: e.layer, text: e.text, startPoint: { x: e.x, y: e.y } };
  });
  return { entities, header: model.insunits ? { $INSUNITS: model.insunits } : {} };
}

export function takeoffFromModel(model: DxfModel, unit: UnitChoice = "auto"): Takeoff {
  return analyzeDxf(modelToParsed(model), unit);
}

export interface Boq {
  takeoff: Takeoff;
  items: BomItem[];
  total: number;
}

/** Take off quantities from the current drawing and price them against the rate card. */
export function boqFromModel(model: DxfModel, rates: RateRow[], unit: UnitChoice = "auto"): Boq {
  const takeoff = takeoffFromModel(model, unit);
  const { items, total } = buildBom(takeoff, rates);
  return { takeoff, items, total };
}

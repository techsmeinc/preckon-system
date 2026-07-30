import type { FreeformEntity } from "@/ai/agent";
import { buildFreeformSheetDxf, buildFreeformSheetSvg, freeformConstruction } from "./drafting";
import type { DxfModel, Entity, ModelLayer } from "./dxf-model";

/**
 * Freeform drawing pipeline: turn the AI's primitive entity list (lines/rects/circles/
 * text, in metres) into an editable DxfModel, then render it through the shared drafting
 * engine so a site plan / schematic / detail gets the SAME CAD sheet treatment as a
 * floor plan — mapped AIA layers, overall dimensions, a frame, north arrow, scale bar
 * and title block. Pure — no DOM/DB.
 */

/** Convert AI primitives into an editable DxfModel (metres, Y-up). */
export function entitiesToModel(entities: FreeformEntity[]): DxfModel {
  const ents: Entity[] = [];
  const layerNames = new Set<string>(["0"]);

  for (const e of entities) {
    const layer = (e.layer ?? "0").trim() || "0";
    layerNames.add(layer);
    if (e.kind === "line") {
      ents.push({ kind: "line", layer, x1: e.x, y1: e.y, x2: e.x2 ?? e.x, y2: e.y2 ?? e.y });
    } else if (e.kind === "rect") {
      const w = e.w ?? 1;
      const h = e.h ?? 1;
      ents.push({ kind: "poly", layer, closed: true, pts: [
        { x: e.x, y: e.y },
        { x: e.x + w, y: e.y },
        { x: e.x + w, y: e.y + h },
        { x: e.x, y: e.y + h },
      ] });
    } else if (e.kind === "circle") {
      const r = e.r ?? 0.5;
      const n = 48;
      const pts = Array.from({ length: n }, (_, i) => ({
        x: e.x + r * Math.cos((i / n) * Math.PI * 2),
        y: e.y + r * Math.sin((i / n) * Math.PI * 2),
      }));
      ents.push({ kind: "poly", layer, closed: true, pts });
    } else {
      ents.push({ kind: "text", layer, text: e.text ?? "", x: e.x, y: e.y, h: e.height ?? 0.3 });
    }
  }

  const layers: ModelLayer[] = [...layerNames].map((name) => ({ name, aci: 7, visible: true }));
  return { layers, entities: ents, insunits: 6 /* metres */ };
}

/** AutoCAD-ready R12 DXF for a freeform drawing (full CAD sheet). */
export function buildFreeformDxf(entities: FreeformEntity[], name = "Concept Drawing"): string {
  const model = entitiesToModel(entities);
  return buildFreeformSheetDxf(model, name, freeformConstruction(model));
}

/** Inline SVG preview of a freeform drawing (full CAD sheet). */
export function buildFreeformSvg(entities: FreeformEntity[], name = "Concept Drawing"): string {
  const model = entitiesToModel(entities);
  return buildFreeformSheetSvg(model, name, freeformConstruction(model));
}

/** SVG preview of an editable DxfModel (used by the freeform modification assistant). */
export function renderModelSvg(model: DxfModel, name = "Concept Drawing"): string {
  return buildFreeformSheetSvg(model, name, freeformConstruction(model));
}

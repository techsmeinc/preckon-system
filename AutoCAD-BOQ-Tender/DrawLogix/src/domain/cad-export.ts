import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DxfParser from "dxf-parser";
import type { FreeformEntity } from "@/ai/agent";
import type { ScheduleRow } from "@/db/schema";
import { decodeConstruction, floorsFromSchedule } from "./drafting";
import { type DxfModel, parseToModel } from "./dxf-model";

// Furniture layers we add at render time — never treat them as source geometry.
const FURNITURE = new Set(["A-TTLB", "A-GRID", "A-WALL-PATT"]);

/** Reconstruct freeform primitives from a stored DXF (fallback when raw entities weren't saved). */
function modelToFreeform(model: DxfModel): FreeformEntity[] {
  const out: FreeformEntity[] = [];
  for (const e of model.entities) {
    if (FURNITURE.has(e.layer.toUpperCase())) continue;
    if (e.kind === "line") {
      out.push({ kind: "line", layer: e.layer, x: e.x1, y: e.y1, x2: e.x2, y2: e.y2 });
    } else if (e.kind === "poly") {
      // Emit each polyline edge as a line (preserves rectangles, circles-as-polygons, etc.).
      for (let i = 0; i < e.pts.length - (e.closed ? 0 : 1); i++) {
        const a = e.pts[i];
        const b = e.pts[(i + 1) % e.pts.length];
        out.push({ kind: "line", layer: e.layer, x: a.x, y: a.y, x2: b.x, y2: b.y });
      }
    } else {
      out.push({ kind: "text", layer: e.layer, x: e.x, y: e.y, text: e.text, height: e.h });
    }
  }
  return out;
}

/**
 * Professional CAD export bridge. Turns a stored concept drawing into a professional
 * AutoCAD file by handing a structured plan to the Python `tools/compose_cad.py`
 * (ezdxf), which writes a DXF with REAL DIMENSION entities, proper layers / text style /
 * dimension style, double-line walls, hatches, a grid and title block — then converts
 * to a native DWG via the ODA File Converter. Runs on demand (a few seconds per call).
 */

export interface CadExportResult {
  dxf: Buffer;
  dwg: Buffer | null;
  dwgError?: string | null;
}

export interface DrawingForExport {
  title: string;
  kind: string;
  schedule: unknown;
  traceability: string[] | null;
  dxf?: string | null;
}

/** Freeform primitives for a drawing: stored raw entities, else reconstructed from its DXF. */
export function freeformEntitiesFor(drawing: DrawingForExport): FreeformEntity[] {
  const stored = (Array.isArray(drawing.schedule) ? drawing.schedule : []) as FreeformEntity[];
  if (stored.length > 0) return stored;
  if (drawing.dxf) {
    try {
      return modelToFreeform(parseToModel(new DxfParser().parseSync(drawing.dxf)));
    } catch {
      /* fall through to empty */
    }
  }
  return stored;
}

export async function composeCad(drawing: DrawingForExport): Promise<CadExportResult> {
  const construction = decodeConstruction(drawing.traceability);
  let plan: Record<string, unknown>;

  if (drawing.kind === "freeform_sketch") {
    const entities = freeformEntitiesFor(drawing);
    plan = { projectName: drawing.title, mode: "freeform", construction, freeform: entities };
  } else {
    const schedule = (Array.isArray(drawing.schedule) ? drawing.schedule : []) as ScheduleRow[];
    const floors = floorsFromSchedule(schedule).map((f) => ({
      label: f.label,
      width: f.plan.width,
      height: f.plan.height,
      rooms: f.plan.rooms,
      doors: f.plan.doors,
      windows: f.plan.windows,
    }));
    if (floors.length === 0) throw new Error("This drawing has no plan geometry to export.");
    plan = { projectName: drawing.title, mode: "floorplan", construction: { ...construction, storeys: Math.max(1, floors.length) }, floors };
  }

  return runComposeCad(plan);
}

function runComposeCad(plan: Record<string, unknown>): Promise<CadExportResult> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "dl_cad_"));
    const planFile = join(dir, "plan.json");
    writeFileSync(planFile, JSON.stringify(plan));
    const script = join(process.cwd(), "tools", "compose_cad.py");
    const python = process.env.DRAWLOGIX_PYTHON || "python";
    const oda = process.env.DRAWLOGIX_ODA || "C:/Users/IKIO/ODA/ODAFileConverter.exe";

    const child = spawn(python, [script, planFile, dir, oda], { env: { ...process.env, DRAWLOGIX_ODA: oda } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", (e) => reject(new Error(`Couldn't run the CAD composer (${python}): ${e.message}`)));
    child.on("close", () => {
      try {
        const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        const res = JSON.parse(line) as { dxf?: string; dwg?: string | null; dwgError?: string | null };
        if (!res.dxf || !existsSync(res.dxf)) {
          reject(new Error(err.trim() || "The CAD composer produced no DXF."));
          return;
        }
        const dxf = readFileSync(res.dxf);
        const dwg = res.dwg && existsSync(res.dwg) ? readFileSync(res.dwg) : null;
        resolve({ dxf, dwg, dwgError: res.dwgError ?? null });
      } catch (e) {
        reject(new Error(err.trim() || (e as Error).message));
      }
    });
  });
}

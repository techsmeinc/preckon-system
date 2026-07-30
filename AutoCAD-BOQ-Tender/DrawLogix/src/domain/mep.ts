/**
 * MEP / electrical auto-layout (the "Augmenta" capability, web-native). Given the
 * current drawing, detect rooms (closed polylines on a room/area layer, or any
 * room-sized closed shapes) and place a first-pass electrical design onto dedicated
 * E-* layers: ceiling lights on a grid (by area), socket outlets around the walls, a
 * light switch per room, one distribution board, and a radial cable route from the
 * board to each room. The symbols count straight into the takeoff → priced BOQ, so
 * "add electrical" and "price it" are one action. Pure — returns entities + layers to
 * merge; the caller applies them (undoable).
 *
 * This is schematic/concept-grade MEP (no clash detection or circuit sizing) — the
 * licence-free web equivalent of a detailed-engineering tool, feeding the tender BOQ.
 */
import type { DxfModel, Entity, ModelLayer } from "./dxf-model";

export const MEP_LAYERS: ModelLayer[] = [
  { name: "E-LITE", aci: 2, visible: true }, // lights — yellow
  { name: "E-POWR", aci: 3, visible: true }, // sockets — green
  { name: "E-SWCH", aci: 4, visible: true }, // switches — cyan
  { name: "E-DIST", aci: 1, visible: true }, // distribution board — red
  { name: "E-CABL", aci: 6, visible: true }, // cable routes — magenta
];

export interface MepResult {
  entities: Entity[];
  layers: ModelLayer[];
  lights: number;
  sockets: number;
  switches: number;
  boards: number;
  rooms: number;
}

interface Pt {
  x: number;
  y: number;
}
interface Room {
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  areaM2: number;
}

// metres-per-drawing-unit, from $INSUNITS or inferred from overall size (mirrors takeoff).
const UNIT_M: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };
function metresPerUnit(model: DxfModel, ext: number): number {
  if (UNIT_M[model.insunits]) return UNIT_M[model.insunits];
  return ext > 3000 ? 0.001 : ext > 300 ? 0.01 : 1; // mm : cm : m
}

function shoelace(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

const ROOM_LAYER = /room|area|space|a-area/i;

/** Generate a first-pass electrical layout for the drawing's rooms. */
export function generateMep(model: DxfModel): MepResult {
  const polys = model.entities.filter((e): e is Extract<Entity, { kind: "poly" }> => e.kind === "poly" && e.closed && e.pts.length >= 3);
  // Overall extent → unit scale + a sensible symbol size.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polys) for (const v of p.pts) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  if (!Number.isFinite(minX)) return { entities: [], layers: [], lights: 0, sockets: 0, switches: 0, boards: 0, rooms: 0 };
  const ext = Math.max(maxX - minX, maxY - minY);
  const mpu = metresPerUnit(model, ext);
  const u = 1 / mpu; // drawing units per metre
  const sym = 0.15 * u; // ~150 mm fixture symbol

  // Prefer polys on a room/area layer; else use any room-sized closed shape and drop
  // the single largest (the building envelope) so we don't treat the whole floor as a room.
  const onRoomLayer = polys.filter((p) => ROOM_LAYER.test(p.layer));
  let source = onRoomLayer.length ? onRoomLayer : polys.slice();
  if (!onRoomLayer.length && source.length > 1) {
    let bigIdx = 0;
    let bigA = -1;
    source.forEach((p, i) => {
      const a = shoelace(p.pts);
      if (a > bigA) {
        bigA = a;
        bigIdx = i;
      }
    });
    source = source.filter((_, i) => i !== bigIdx);
  }

  const rooms: Room[] = [];
  const seen = new Set<string>();
  for (const p of source) {
    const areaM2 = shoelace(p.pts) * mpu * mpu;
    if (areaM2 < 2 || areaM2 > 4000) continue;
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    for (const v of p.pts) {
      rMinX = Math.min(rMinX, v.x);
      rMinY = Math.min(rMinY, v.y);
      rMaxX = Math.max(rMaxX, v.x);
      rMaxY = Math.max(rMaxY, v.y);
    }
    const cx = (rMinX + rMaxX) / 2;
    const cy = (rMinY + rMaxY) / 2;
    const key = `${Math.round(cx)}:${Math.round(cy)}:${Math.round(areaM2)}`;
    if (seen.has(key)) continue; // dedupe stacked area + wall polys
    seen.add(key);
    rooms.push({ cx, cy, minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY, areaM2 });
  }
  if (rooms.length === 0) return { entities: [], layers: [], lights: 0, sockets: 0, switches: 0, boards: 0, rooms: 0 };

  const ents: Entity[] = [];
  const circle = (layer: string, cx: number, cy: number, r: number): Entity => {
    const n = 20;
    return { kind: "poly", layer, closed: true, pts: Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * Math.PI * 2), y: cy + r * Math.sin((i / n) * Math.PI * 2) })) };
  };
  const square = (layer: string, cx: number, cy: number, s: number): Entity => ({
    kind: "poly",
    layer,
    closed: true,
    pts: [{ x: cx - s, y: cy - s }, { x: cx + s, y: cy - s }, { x: cx + s, y: cy + s }, { x: cx - s, y: cy + s }],
  });

  let lights = 0;
  let sockets = 0;
  let switches = 0;

  // Distribution board near the lower-left of the whole drawing. Kept to ONE entity on
  // E-DIST so the takeoff counts exactly one board (it counts entities per layer).
  const boardPt: Pt = { x: minX + sym * 3, y: minY + sym * 3 };
  ents.push(square("E-DIST", boardPt.x, boardPt.y, sym * 1.4));

  for (const rm of rooms) {
    const w = rm.maxX - rm.minX;
    const h = rm.maxY - rm.minY;
    // Lights: ~1 per 12 m², arranged in a near-square grid centred in the room.
    const n = Math.max(1, Math.round(rm.areaM2 / 12));
    const cols = Math.max(1, Math.round(Math.sqrt(n * (w / (h || 1)))));
    const rowsN = Math.max(1, Math.ceil(n / cols));
    let placed = 0;
    for (let r = 0; r < rowsN && placed < n; r++) {
      for (let c = 0; c < cols && placed < n; c++) {
        const lx = rm.minX + (w * (c + 1)) / (cols + 1);
        const ly = rm.minY + (h * (r + 1)) / (rowsN + 1);
        ents.push(circle("E-LITE", lx, ly, sym));
        placed++;
        lights++;
      }
    }
    // Sockets: ~1 per 8 m² (min 2), stepped along the bottom wall, just inside it.
    const ns = Math.max(2, Math.round(rm.areaM2 / 8));
    for (let i = 0; i < ns; i++) {
      const sx = rm.minX + (w * (i + 1)) / (ns + 1);
      ents.push(square("E-POWR", sx, rm.minY + sym * 2, sym * 0.8));
      sockets++;
    }
    // One switch by the (bottom-left) doorway.
    ents.push(circle("E-SWCH", rm.minX + sym * 2.5, rm.minY + sym * 2.5, sym * 0.7));
    switches++;
    // Radial cable from the board to the room centre.
    ents.push({ kind: "poly", layer: "E-CABL", closed: false, pts: [boardPt, { x: rm.cx, y: rm.cy }] });
  }

  return { entities: ents, layers: MEP_LAYERS, lights, sockets, switches, boards: 1, rooms: rooms.length };
}

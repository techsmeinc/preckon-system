/**
 * Pure room-layout geometry in METRES — one source of truth for the 2D plan, DXF,
 * IFC, and 3D viewer. Each room is sized so its rectangle area ≈ its real m², so
 * dimensions on the CAD output are truthful (not a bubble diagram). No server imports
 * so the client 3D/DXF viewers can share it.
 */
export interface RoomCell {
  ref: string;
  room: string;
  areaSqm: number;
  requirementRef?: string;
}

export interface PlacedRoom extends RoomCell {
  x: number; // metres
  y: number;
  w: number;
  h: number;
}

export const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444"];

/** px-per-metre used by the SVG renderer (DXF/IFC/3D use metres directly). */
export const PX_PER_M = 26;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pack rooms flush (shared walls) into rows. Each room's footprint area equals its
 * programme area: w = √(area·aspect), h = area/w. Rows wrap at ~ROW_W metres.
 */
export function layoutRooms(rows: RoomCell[]): { placed: PlacedRoom[]; width: number; height: number } {
  const ROW_W = 24; // target row width (m)
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxX = 0;
  const placed: PlacedRoom[] = [];
  for (const r of rows) {
    const area = Math.max(1, r.areaSqm);
    const w = Math.min(14, Math.max(2, r1(Math.sqrt(area * 1.3))));
    const h = Math.min(11, Math.max(2, r1(area / w)));
    if (x > 0 && x + w > ROW_W) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    placed.push({ ...r, x, y, w, h });
    x += w;
    maxX = Math.max(maxX, x);
    rowH = Math.max(rowH, h);
  }
  return { placed, width: maxX, height: y + rowH };
}

export interface Door {
  x: number; // metres
  y: number;
  vertical: boolean; // true = opening in a vertical wall (rooms side by side)
  size: number;
}

/** Doors at shared/near walls — geometric, so plan, DXF, and 3D agree on openings. */
export function findDoors(placed: PlacedRoom[]): Door[] {
  const doors: Door[] = [];
  const GAP = 0.7; // m — rooms within this are "adjacent"
  const MIN = 1.2; // m — minimum shared span to fit a door
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const yo = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const xo = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const door = (x: number, y: number, vertical: boolean, span: number) =>
        doors.push({ x, y, vertical, size: Math.min(1.0, Math.max(0.8, span * 0.5)) });
      if (Math.abs(a.x + a.w - b.x) <= GAP && yo >= MIN) door((a.x + a.w + b.x) / 2, Math.max(a.y, b.y) + yo / 2, true, yo);
      else if (Math.abs(b.x + b.w - a.x) <= GAP && yo >= MIN) door((b.x + b.w + a.x) / 2, Math.max(a.y, b.y) + yo / 2, true, yo);
      if (Math.abs(a.y + a.h - b.y) <= GAP && xo >= MIN) door(Math.max(a.x, b.x) + xo / 2, (a.y + a.h + b.y) / 2, false, xo);
      else if (Math.abs(b.y + b.h - a.y) <= GAP && xo >= MIN) door(Math.max(a.x, b.x) + xo / 2, (b.y + b.h + a.y) / 2, false, xo);
    }
  }
  return doors;
}

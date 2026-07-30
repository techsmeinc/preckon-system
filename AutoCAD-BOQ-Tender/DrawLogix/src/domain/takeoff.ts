/**
 * DXF takeoff — turn a parsed DXF (from dxf-parser) into a structured model: detected
 * spaces (with areas), wall lengths, door/window counts, and equipment. Handles
 * drawing UNITS (most CAD files are in mm) via the $INSUNITS header or a manual
 * override, and reports the drawing extents so the result can be sanity-checked. Pure.
 */

import { cleanText } from "./dxf-model";

export type UnitChoice = "auto" | "mm" | "cm" | "m" | "in" | "ft";

export interface Space {
  name: string;
  areaSqm: number;
}

export interface Takeoff {
  spaces: Space[];
  spacesReliable: boolean; // true when rooms came from a recognised area/room layer
  floorAreaSqm: number;
  grossAreaSqm: number; // bounding-box area, for sanity-checking
  exteriorWallM: number;
  partitionWallM: number;
  doors: number;
  windows: number;
  equipment: number;
  // MEP / electrical (populated when the drawing carries E-* layers).
  lights: number;
  sockets: number;
  switches: number;
  boards: number;
  mepCableM: number;
  layers: string[];
  segments: [number, number, number, number][]; // raw units, for preview only
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  unit: string; // resolved unit name
  unitSource: "header" | "override" | "inferred";
  widthM: number;
  heightM: number;
}

interface Pt {
  x: number;
  y: number;
}

const UNIT_M: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
const INSUNITS: Record<number, string> = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m" };

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function shoelace(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Ray-casting point-in-polygon. */
function inside(px: number, py: number, pts: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const ROOM_LAYER = /room|area|space|gfa|gross|zone|\brm\b|a-area/i;
const DOOR_LAYER = /\bdoor\b|a-door/i;
const WIN_LAYER = /window|glaz|\bwin\b/i;
// MEP / electrical layers (auto-generated E-* layers, or common naming in real files).
const LITE_LAYER = /e-lite|light|lighting|luminaire/i;
const POWR_LAYER = /e-powr|socket|\bpower\b|\bgpo\b/i;
const SWCH_LAYER = /e-swch|switch/i;
const DIST_LAYER = /e-dist|distribution board|\bdb\b/i;
const CABL_LAYER = /e-cabl|cable|conduit/i;

export function analyzeDxf(dxf: { entities?: Record<string, unknown>[]; header?: Record<string, unknown> } | null, unitChoice: UnitChoice = "auto"): Takeoff {
  const entities = dxf?.entities ?? [];
  const layers = new Set<string>();
  const segments: [number, number, number, number][] = [];
  const texts: { t: string; x: number; y: number }[] = [];
  const layerLen: Record<string, number> = {};
  const layerCount: Record<string, number> = {};
  const closedPolys: { pts: Pt[]; areaRaw: number; layer: string }[] = [];
  let equipment = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const grow = (p: Pt) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  const addSeg = (a: Pt, b: Pt, layer: string) => {
    segments.push([a.x, a.y, b.x, b.y]);
    layerLen[layer] = (layerLen[layer] ?? 0) + dist(a, b);
    grow(a);
    grow(b);
  };

  for (const e of entities) {
    const type = String(e.type ?? "");
    const layer = String(e.layer ?? "0");
    layers.add(layer);
    layerCount[layer] = (layerCount[layer] ?? 0) + 1;
    if (type === "LINE") {
      const v = (e.vertices as Pt[]) ?? [];
      if (v.length >= 2) addSeg(v[0], v[1], layer);
    } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const v = (e.vertices as Pt[]) ?? [];
      for (let i = 0; i < v.length - 1; i++) addSeg(v[i], v[i + 1], layer);
      if (Boolean(e.closed ?? e.shape) && v.length >= 3) {
        addSeg(v[v.length - 1], v[0], layer);
        closedPolys.push({ pts: v, areaRaw: shoelace(v), layer });
      }
    } else if (type === "TEXT" || type === "MTEXT") {
      const sp = (e.startPoint ?? e.position) as Pt | undefined;
      const t = cleanText(String(e.text ?? ""));
      if (sp && t) {
        texts.push({ t, x: num(sp.x), y: num(sp.y) });
        grow(sp);
      }
    } else if (type === "INSERT") {
      equipment += 1;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  // Resolve unit → metres-per-drawing-unit.
  let unit = "m";
  let unitSource: Takeoff["unitSource"] = "inferred";
  if (unitChoice !== "auto") {
    unit = unitChoice;
    unitSource = "override";
  } else {
    const ins = num(dxf?.header?.["$INSUNITS"]);
    if (INSUNITS[ins]) {
      unit = INSUNITS[ins];
      unitSource = "header";
    } else {
      // No header: infer from extents (a building is metres; thousands ⇒ mm).
      const ext = Math.max(maxX - minX, maxY - minY);
      unit = ext > 3000 ? "mm" : ext > 300 ? "cm" : "m";
      unitSource = "inferred";
    }
  }
  const s = UNIT_M[unit] ?? 1;
  const s2 = s * s;

  // Wall lengths + opening counts by layer name.
  let exteriorWallM = 0;
  let partitionWallM = 0;
  for (const [layer, len] of Object.entries(layerLen)) {
    const L = layer.toUpperCase();
    if (L.includes("PART") || L.includes("INNER") || L.includes("INT")) partitionWallM += len * s;
    else if (L.includes("WALL")) exteriorWallM += len * s;
  }
  if (exteriorWallM === 0 && partitionWallM === 0) exteriorWallM = Object.values(layerLen).reduce((a, b) => a + b, 0) * s;

  let doors = 0;
  let windows = 0;
  let lights = 0;
  let sockets = 0;
  let switches = 0;
  let boards = 0;
  for (const [layer, count] of Object.entries(layerCount)) {
    // A door/window on a dedicated layer is a leaf+swing (2 entities) or a block; the
    // MEP fixtures below are one symbol each, so their counts are direct.
    if (DOOR_LAYER.test(layer)) doors += count;
    if (WIN_LAYER.test(layer)) windows += count;
    if (LITE_LAYER.test(layer)) lights += count;
    else if (POWR_LAYER.test(layer)) sockets += count;
    else if (SWCH_LAYER.test(layer)) switches += count;
    else if (DIST_LAYER.test(layer)) boards += count;
  }
  let mepCableRaw = 0;
  for (const [layer, len] of Object.entries(layerLen)) if (CABL_LAYER.test(layer)) mepCableRaw += len;
  const mepCableM = Math.round(mepCableRaw * s);

  // Spaces: prefer polylines on a room/area layer; filter to plausible room sizes;
  // dedupe repeated symbols; name by the text inside each polygon.
  const roomPolys = closedPolys.filter((p) => ROOM_LAYER.test(p.layer));
  const spacesReliable = roomPolys.length > 0;
  const source = spacesReliable ? roomPolys : closedPolys;
  const seen = new Set<string>();
  let spaces: Space[] = source
    .map((p) => {
      const area = p.areaRaw * s2;
      const cx = p.pts.reduce((a, q) => a + q.x, 0) / p.pts.length;
      const cy = p.pts.reduce((a, q) => a + q.y, 0) / p.pts.length;
      return { area, cx, cy, pts: p.pts };
    })
    .filter((p) => p.area >= 2 && p.area <= 20000)
    .filter((p) => {
      const k = `${Math.round(p.area)}:${Math.round(p.cx)}:${Math.round(p.cy)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((p) => {
      const label = texts.find((t) => inside(t.x, t.y, p.pts) && !/^[\d.]/.test(t.t));
      return { name: label?.t ?? "Space", areaSqm: Math.round(p.area) };
    });

  // Fall back to metric area labels in the text ("NN m2") if no polygons gave spaces.
  if (spaces.length === 0) {
    spaces = texts
      .map((t) => {
        const m = t.t.match(/^([\d.]+)\s*m2/i);
        return m ? { name: "Space", areaSqm: Math.round(Number(m[1])) } : null;
      })
      .filter((x): x is Space => Boolean(x));
  }

  const floorAreaSqm = Math.round(spaces.reduce((a, x) => a + x.areaSqm, 0));
  const widthM = (maxX - minX) * s;
  const heightM = (maxY - minY) * s;

  return {
    spaces: spaces.slice(0, 300),
    spacesReliable,
    floorAreaSqm,
    grossAreaSqm: Math.round(widthM * heightM),
    exteriorWallM: Math.round(exteriorWallM),
    partitionWallM: Math.round(partitionWallM),
    doors,
    windows,
    equipment,
    lights,
    sockets,
    switches,
    boards,
    mepCableM,
    layers: [...layers].sort(),
    segments,
    bounds: { minX, minY, maxX, maxY },
    unit,
    unitSource,
    widthM: Math.round(widthM * 10) / 10,
    heightM: Math.round(heightM * 10) / 10,
  };
}

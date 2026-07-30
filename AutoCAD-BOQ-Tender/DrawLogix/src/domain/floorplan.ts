import type { ScheduleRow } from "@/db/schema";
import { findDoors, layoutRooms } from "./layout";

/**
 * Floor-plan engine. Instead of packing rooms by area, this lays out a real
 * single-storey plan: a central circulation corridor with rooms on both sides
 * ("double-loaded corridor"), each room doored to the corridor, exterior walls vs
 * partitions, and windows on outside walls. Areas stay true (room footprint = m²), so
 * the CAD output is accurate. The AI supplies the programme + adjacency; the geometry
 * is solved here deterministically.
 */

export type RoomKind = "circulation" | "wet" | "service" | "habitable";

export interface ProgramRoom {
  name: string;
  areaSqm: number; // area of ONE room
  kind?: string;
  connectsTo?: string[];
  requirementRef?: string;
  count?: number; // repeated rooms (e.g. 20 dormitories)
  ensuiteSqm?: number; // each copy has a private en-suite of this area
}

export interface Envelope {
  widthAcross: number; // building width (corridor runs along the long axis)
  lengthAlong: number;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (n: number) => Math.round(n * 10) / 10;
function mkRoom(ref: string, name: string, areaSqm: number, kind: RoomKind, x: number, y: number, w: number, h: number, requirementRef?: string): ScheduleRow {
  return { ref, room: name, areaSqm: Math.round(areaSqm), requirementRef, kind, x: r1(x), y: r1(y), w: r1(w), h: r1(h) };
}

export interface Door {
  x: number;
  y: number;
  vertical: boolean; // opening in a vertical wall
  size: number;
}
export interface Win {
  x: number;
  y: number;
  vertical: boolean;
  size: number;
}

export interface ResolvedPlan {
  rooms: ScheduleRow[]; // each with x,y,w,h,kind in metres
  width: number;
  height: number;
  doors: Door[];
  windows: Win[];
}

const EPS = 0.05;

export function classifyKind(name: string, given?: string): RoomKind {
  const g = (given ?? "").toLowerCase();
  if (g === "circulation" || g === "wet" || g === "service" || g === "habitable") return g as RoomKind;
  const n = name.toLowerCase();
  if (/corridor|circulat|hallway|\bhall\b|lobby route/.test(n)) return "circulation";
  if (/\bwc\b|toilet|restroom|washroom|bath|shower|changing/.test(n)) return "wet";
  if (/plant|server|comms|\bit room\b|store|storage|cupboard|sterilis|steriliz|decontam|riser|cleaner|utility|switch/.test(n))
    return "service";
  return "habitable";
}

const isEntrance = (n: string) => /reception|waiting|lobby|entrance|foyer|atrium/i.test(n);

/** Order rooms so connected/entrance rooms sit near each other (BFS over adjacency). */
function orderRooms(rooms: ProgramRoom[]): ProgramRoom[] {
  const byName = new Map(rooms.map((r) => [r.name.toLowerCase(), r]));
  const adj = new Map<string, string[]>();
  for (const r of rooms) {
    const key = r.name.toLowerCase();
    const list = (r.connectsTo ?? []).map((c) => c.toLowerCase()).filter((c) => byName.has(c) && c !== key);
    adj.set(key, list);
  }
  const start = rooms.find((r) => isEntrance(r.name)) ?? rooms[0];
  const seen = new Set<string>();
  const out: ProgramRoom[] = [];
  const queue = start ? [start.name.toLowerCase()] : [];
  while (queue.length) {
    const k = queue.shift();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const r = byName.get(k);
    if (r) out.push(r);
    for (const c of adj.get(k) ?? []) if (!seen.has(c)) queue.push(c);
  }
  for (const r of rooms) if (!seen.has(r.name.toLowerCase())) out.push(r);
  return out;
}

/**
 * Solve a single-storey plan: a central corridor with rooms on both sides, vestibules
 * at each end, repeated rooms expanded to `count`, and en-suites nested inside their
 * parent room. Honours a stated building footprint when given. Areas are preserved.
 */
export function solveFloorPlan(program: ProgramRoom[], envelope?: Envelope): ScheduleRow[] {
  // 1. Expand repeated rooms; classify; drop explicit corridor rooms (we make our own).
  const expanded: ProgramRoom[] = [];
  for (const p of program) {
    const kind = classifyKind(p.name, p.kind);
    if (kind === "circulation" && !/vestibule|entrance|foyer|lobby/i.test(p.name)) continue;
    const count = clampN(Math.round(p.count ?? 1), 1, 80);
    for (let i = 0; i < count; i++) expanded.push({ ...p, kind, name: count > 1 ? `${p.name} ${i + 1}` : p.name });
  }
  if (expanded.length === 0) return [];

  const isVest = (n: string) => /vestibule|entrance|foyer|lobby/i.test(n);
  const vestibules = expanded.filter((r) => isVest(r.name)).slice(0, 2);
  let mains = expanded.filter((r) => !isVest(r.name));
  if (mains.length === 0) {
    mains = expanded;
    vestibules.length = 0;
  }

  // Tiny programme → single row.
  if (mains.length <= 2 && vestibules.length === 0) {
    const rowH = clampN(Math.sqrt(mains.reduce((a, r) => a + r.areaSqm, 0)), 3, 8);
    let x = 0;
    let n = 0;
    return mains.map((r) => {
      const w = r.areaSqm / rowH;
      const row = mkRoom(`A-${String(++n).padStart(2, "0")}`, r.name, r.areaSqm, classifyKind(r.name, r.kind), x, 0, w, rowH, r.requirementRef);
      x += w;
      return row;
    });
  }

  // 2. Envelope (honour stated footprint; corridor runs along the long axis).
  const moduleArea = (r: ProgramRoom) => r.areaSqm + (r.ensuiteSqm ?? 0);
  const totalMain = mains.reduce((a, r) => a + moduleArea(r), 0);
  const corridorH = 1.6;
  const buildingWidth = clampN(
    envelope ? Math.min(envelope.widthAcross, envelope.lengthAlong) : Math.sqrt(totalMain / 3.2),
    corridorH + 5,
    26,
  );
  const sideDepth = (buildingWidth - corridorH) / 2;
  const corBotY = sideDepth + corridorH;

  // 3. Order + split into two rows balancing length.
  const ordered = orderRooms(mains);
  const slotW = (r: ProgramRoom) => moduleArea(r) / sideDepth;
  const totalW = ordered.reduce((a, r) => a + slotW(r), 0);
  const top: ProgramRoom[] = [];
  const bottom: ProgramRoom[] = [];
  let acc = 0;
  for (const r of ordered) {
    (acc < totalW / 2 ? top : bottom).push(r);
    acc += slotW(r);
  }
  if (bottom.length === 0 && top.length > 1) bottom.push(top.pop() as ProgramRoom);

  const out: ScheduleRow[] = [];
  let ref = 0;
  const nref = () => `A-${String(++ref).padStart(2, "0")}`;

  const placeRow = (list: ProgramRoom[], side: "top" | "bottom", x0: number) => {
    let x = x0;
    for (const r of list) {
      const w = slotW(r);
      const kind = classifyKind(r.name, r.kind);
      if (r.ensuiteSqm && r.ensuiteSqm > 0) {
        const bath = clampN(r.ensuiteSqm / w, 1.5, sideDepth - 1.5);
        const dorm = sideDepth - bath;
        if (side === "top") {
          out.push(mkRoom(nref(), `${r.name} En-suite`, r.ensuiteSqm, "wet", x, 0, w, bath, r.requirementRef));
          out.push(mkRoom(nref(), r.name, r.areaSqm, kind, x, bath, w, dorm, r.requirementRef));
        } else {
          out.push(mkRoom(nref(), r.name, r.areaSqm, kind, x, corBotY, w, dorm, r.requirementRef));
          out.push(mkRoom(nref(), `${r.name} En-suite`, r.ensuiteSqm, "wet", x, corBotY + dorm, w, bath, r.requirementRef));
        }
      } else {
        out.push(mkRoom(nref(), r.name, r.areaSqm, kind, x, side === "top" ? 0 : corBotY, w, sideDepth, r.requirementRef));
      }
      x += w;
    }
    return x;
  };

  const leftVestW = vestibules[0] ? clampN(vestibules[0].areaSqm / buildingWidth, 2, 4) : 0;
  const rightVestW = vestibules[1] ? clampN(vestibules[1].areaSqm / buildingWidth, 2, 4) : 0;
  const bodyEnd = Math.max(placeRow(top, "top", leftVestW), placeRow(bottom, "bottom", leftVestW));
  let length = bodyEnd + rightVestW;
  if (envelope) length = Math.max(length, envelope.widthAcross, envelope.lengthAlong);
  const rightVestX = length - rightVestW;

  if (vestibules[0]) out.push(mkRoom(nref(), vestibules[0].name, vestibules[0].areaSqm, "circulation", 0, 0, leftVestW, buildingWidth, vestibules[0].requirementRef));
  if (vestibules[1]) out.push(mkRoom(nref(), vestibules[1].name, vestibules[1].areaSqm, "circulation", rightVestX, 0, rightVestW, buildingWidth, vestibules[1].requirementRef));

  const corX0 = leftVestW;
  const corX1 = vestibules[1] ? rightVestX : bodyEnd;
  out.push(mkRoom("C-1", "Circulation", (corX1 - corX0) * corridorH, "circulation", corX0, sideDepth, corX1 - corX0, corridorH));

  return out;
}

type Wall = { x: number; y: number; vertical: boolean; size: number; overlap: number };

/** Detect a shared wall between two room rectangles; null if they don't touch. */
function sharedWall(a: ScheduleRow, b: ScheduleRow): Wall | null {
  const ax = a.x as number;
  const ay = a.y as number;
  const aw = a.w as number;
  const ah = a.h as number;
  const bx = b.x as number;
  const by = b.y as number;
  const bw = b.w as number;
  const bh = b.h as number;
  const yo = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  if (yo >= 0.9) {
    const my = Math.max(ay, by) + yo / 2;
    const size = clampN(yo * 0.45, 0.8, 1.1);
    if (Math.abs(ax + aw - bx) < EPS) return { x: ax + aw, y: my, vertical: true, size, overlap: yo };
    if (Math.abs(bx + bw - ax) < EPS) return { x: ax, y: my, vertical: true, size, overlap: yo };
  }
  const xo = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  if (xo >= 0.9) {
    const mx = Math.max(ax, bx) + xo / 2;
    const size = clampN(xo * 0.45, 0.8, 1.1);
    if (Math.abs(ay + ah - by) < EPS) return { x: mx, y: ay + ah, vertical: false, size, overlap: xo };
    if (Math.abs(by + bh - ay) < EPS) return { x: mx, y: ay, vertical: false, size, overlap: xo };
  }
  return null;
}

/** Doors: each room ↔ the corridor it touches; en-suites/service ↔ their parent room. */
export function planDoors(rooms: ScheduleRow[]): Door[] {
  const placed = rooms.filter((r) => r.x != null);
  const corridors = placed.filter((r) => r.kind === "circulation");
  const doors: Door[] = [];
  const doored = new Set<ScheduleRow>();
  const push = (w: Wall) => doors.push({ x: w.x, y: w.y, vertical: w.vertical, size: w.size });

  for (const r of placed) {
    if (r.kind === "circulation") continue;
    for (const c of corridors) {
      const w = sharedWall(r, c);
      if (w) {
        push(w);
        doored.add(r);
        break;
      }
    }
  }
  for (const r of placed) {
    if (doored.has(r) || r.kind === "circulation" || (r.kind !== "wet" && r.kind !== "service")) continue;
    let best: Wall | null = null;
    for (const o of placed) {
      if (o === r || o.kind === "circulation") continue;
      const w = sharedWall(r, o);
      if (w && (!best || w.overlap > best.overlap)) best = w;
    }
    if (best) push(best);
  }
  return doors;
}

/** Windows: habitable rooms get a window on each exterior wall (envelope boundary). */
export function planWindows(rooms: ScheduleRow[]): Win[] {
  const placed = rooms.filter((r) => r.x != null);
  if (placed.length === 0) return [];
  const W = Math.max(...placed.map((r) => (r.x as number) + (r.w as number)));
  const H = Math.max(...placed.map((r) => (r.y as number) + (r.h as number)));
  const wins: Win[] = [];
  for (const r of placed) {
    if (r.kind === "circulation" || r.kind === "wet" || r.kind === "service") continue;
    const x = r.x as number;
    const y = r.y as number;
    const w = r.w as number;
    const h = r.h as number;
    const win = (cx: number, cy: number, vertical: boolean, span: number) => {
      if (span >= 1.4) wins.push({ x: cx, y: cy, vertical, size: Math.min(2.2, span * 0.55) });
    };
    if (Math.abs(y) < EPS) win(x + w / 2, 0, false, w); // top exterior
    if (Math.abs(y + h - H) < EPS) win(x + w / 2, H, false, w); // bottom exterior
    if (Math.abs(x) < EPS) win(0, y + h / 2, true, h); // left exterior
    if (Math.abs(x + w - W) < EPS) win(W, y + h / 2, true, h); // right exterior
  }
  return wins;
}

/**
 * Resolve rows to geometry for rendering. New plans already carry x/y/w/h (use them +
 * derive doors/windows). Old plans (no geometry) fall back to the area packer.
 */
export function resolvePlan(rows: ScheduleRow[]): ResolvedPlan {
  const hasGeom = rows.length > 0 && rows.every((r) => typeof r.w === "number" && (r.w as number) > 0);
  if (hasGeom) {
    const width = Math.max(...rows.map((r) => (r.x as number) + (r.w as number)));
    const height = Math.max(...rows.map((r) => (r.y as number) + (r.h as number)));
    return { rooms: rows, width, height, doors: planDoors(rows), windows: planWindows(rows) };
  }
  const { placed, width, height } = layoutRooms(rows);
  return { rooms: placed, width, height, doors: findDoors(placed), windows: [] };
}

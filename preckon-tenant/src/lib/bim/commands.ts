/**
 * DrawLogix BIM — the command layer (multi-discipline).
 *
 * Every operation is a COMMAND as data. One interpreter (applyCommand) turns it into a
 * new document, using the CATALOG for per-category defaults and discipline. The manual
 * toolbar and the AI assistant emit the SAME commands, so any construction item in any
 * division (arch/struct/civil/MEP/fire) that a user can place, the AI can place too.
 */

import { addElement, type BimDocument, CATALOG, defaultLevel, type Geometry, type Id, levelElev, linLength, type ParamValue, removeElement, updateElement, type Vec2 } from "./model";

export type Command =
  | { name: "add"; args: AddArgs }
  | { name: "add_room"; args: { x: number; y: number; width: number; depth: number; height?: number; wallThickness?: number; level?: Id; name?: string } }
  | { name: "add_level"; args: { name: string; elevation: number } }
  | { name: "set_param"; args: { id: Id; key: string; value: number | string | boolean } }
  | { name: "move"; args: { id: Id; dx: number; dy: number } }
  | { name: "delete"; args: { id: Id } }
  | { name: "clear"; args: Record<string, never> };

interface AddArgs {
  category: string;
  start?: Vec2;
  end?: Vec2;
  outline?: Vec2[];
  at?: Vec2;
  host?: Id;
  offset?: number;
  sill?: number;
  rot?: number;
  width?: number;
  depth?: number;
  height?: number;
  thickness?: number;
  elevation?: number;
  level?: Id;
  name?: string;
  /** Set at creation. A tag needs its target in the same command that makes it. */
  params?: Record<string, ParamValue>;
}

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const vec = (v: unknown): Vec2 => {
  const o = (v ?? {}) as { x?: unknown; y?: unknown };
  return { x: num(o.x, 0), y: num(o.y, 0) };
};

/** Build an element from the catalog + args (used by `add` and compound commands). */
function makeGeom(item: (typeof CATALOG)[string], a: AddArgs, doc: BimDocument): Geometry | null {
  const d = item.defaults;
  const g: Geometry = { kind: item.kind };
  const hasElev = a.elevation !== undefined || d.elevation !== undefined;
  if (item.kind === "linear") {
    g.start = vec(a.start);
    g.end = a.end ? vec(a.end) : { x: g.start.x + 3, y: g.start.y };
    g.width = num(a.width, d.width ?? 0.2);
    g.height = num(a.height, d.height ?? 3);
    if (hasElev) g.elevation = num(a.elevation, d.elevation ?? 0);
  } else if (item.kind === "area") {
    g.outline = (Array.isArray(a.outline) ? a.outline : []).map(vec);
    if (g.outline.length < 3) return null;
    g.thickness = num(a.thickness, d.thickness ?? 0.2);
    if (hasElev) g.elevation = num(a.elevation, d.elevation ?? 0);
  } else if (item.kind === "point") {
    g.at = vec(a.at);
    g.width = num(a.width, d.width ?? 0.4);
    g.depth = num(a.depth, d.depth ?? 0.4);
    g.height = num(a.height, d.height ?? 1);
    g.rot = num(a.rot, 0);
    if (hasElev) g.elevation = num(a.elevation, d.elevation ?? 0);
  } else {
    const host = a.host ? doc.elements[a.host] : undefined;
    if (!host || host.geom.kind !== "linear") return null;
    const width = num(a.width, d.width ?? 0.9);
    g.host = host.id;
    g.width = width;
    g.height = num(a.height, d.height ?? 2.1);
    g.sill = num(a.sill, d.sill ?? 0);
    g.offset = num(a.offset, Math.max(0, linLength(host) / 2 - width / 2));
  }
  return g;
}

export function applyCommand(doc: BimDocument, cmd: Command): BimDocument {
  switch (cmd.name) {
    case "add": {
      if (cmd.args.category === "level") return applyCommand(doc, { name: "add_level", args: { name: cmd.args.name ?? "Level", elevation: num(cmd.args.elevation, 0) } });
      const item = CATALOG[cmd.args.category];
      if (!item) return doc;
      const geom = makeGeom(item, cmd.args, doc);
      if (!geom) return doc;
      const level = item.kind === "hosted" ? doc.elements[geom.host ?? ""]?.level : (cmd.args.level ?? defaultLevel(doc));
      return addElement(doc, { discipline: item.discipline, category: item.category, name: cmd.args.name, level, geom, params: cmd.args.params ?? {} }).doc;
    }

    case "add_level":
      return addElement(doc, { discipline: "general", category: "level", name: cmd.args.name || "Level", geom: { kind: "point", elevation: num(cmd.args.elevation, 0) }, params: {} }).doc;

    case "add_room": {
      const { x, y, width, depth } = cmd.args;
      const h = num(cmd.args.height, 3);
      const t = num(cmd.args.wallThickness, 0.2);
      const level = cmd.args.level ?? defaultLevel(doc);
      const corners: Vec2[] = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + depth },
        { x, y: y + depth },
      ];
      let d = doc;
      for (let i = 0; i < 4; i++) {
        d = addElement(d, { discipline: "architectural", category: "wall", level, geom: { kind: "linear", start: corners[i], end: corners[(i + 1) % 4], width: t, height: h }, params: {} }).doc;
      }
      d = addElement(d, { discipline: "architectural", category: "floor", level, geom: { kind: "area", outline: corners, thickness: 0.2 }, params: {} }).doc;
      d = addElement(d, { discipline: "architectural", category: "room", name: cmd.args.name, level, geom: { kind: "area", outline: corners, thickness: 0 }, params: {} }).doc;
      return d;
    }

    case "set_param": {
      const el = doc.elements[cmd.args.id];
      if (!el) return doc;
      const key = String(cmd.args.key);
      const geomKeys = new Set(["width", "depth", "height", "thickness", "elevation", "offset", "sill", "rot"]);
      if (geomKeys.has(key)) return updateElement(doc, el.id, { geom: { ...el.geom, [key]: Number(cmd.args.value) } });
      if (key === "name") return updateElement(doc, el.id, { name: String(cmd.args.value) });
      return updateElement(doc, el.id, { params: { ...el.params, [key]: cmd.args.value } });
    }

    case "move": {
      const el = doc.elements[cmd.args.id];
      if (!el) return doc;
      const dx = num(cmd.args.dx, 0);
      const dy = num(cmd.args.dy, 0);
      const mv = (p?: Vec2): Vec2 | undefined => (p ? { x: p.x + dx, y: p.y + dy } : p);
      const g = el.geom;
      return updateElement(doc, el.id, {
        geom: { ...g, start: mv(g.start), end: mv(g.end), at: mv(g.at), outline: g.outline?.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
      });
    }

    case "delete":
      return removeElement(doc, cmd.args.id);

    case "clear": {
      let d = doc;
      for (const e of Object.values(doc.elements)) if (e.category !== "level") d = removeElement(d, e.id);
      return d;
    }

    default:
      return doc;
  }
}

export function applyCommands(doc: BimDocument, cmds: Command[]): BimDocument {
  return cmds.reduce((d, c) => applyCommand(d, c), doc);
}

// keep the import used for level-aware elevation defaults in future commands
void levelElev;

// ── Undo / redo bus (pure) ───────────────────────────────────────────────────
export interface History {
  doc: BimDocument;
  past: BimDocument[];
  future: BimDocument[];
}
export const initHistory = (doc: BimDocument): History => ({ doc, past: [], future: [] });
export function run(h: History, cmds: Command | Command[]): History {
  const arr = Array.isArray(cmds) ? cmds : [cmds];
  const doc = applyCommands(h.doc, arr);
  if (doc === h.doc) return h;
  return { doc, past: [...h.past.slice(-99), h.doc], future: [] };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  return { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.doc, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return { doc: h.future[0], past: [...h.past, h.doc], future: h.future.slice(1) };
}

/**
 * Issued drawings — the tool catalogue.
 *
 * The same architecture BIM Studio uses (bim/registry.ts), pointed at a
 * different model: a DxfModel of layers and entities rather than a BimDocument
 * of elements, emitting CadOps rather than Commands. The registry, the search,
 * the argument coercion and the agent loop are shared; only these tools differ.
 *
 * The read tools matter more here than in BIM Studio. A modelled building knows
 * what its elements are; an issued sheet knows only that there is text reading
 * "307" on a layer called A-ANNO-ROOM. Finding things is most of the work, which
 * is why find_text and list_layers come first.
 *
 * Nothing here mutates. Tools return CadOps for applyCadOps to run.
 */

import type { CadOp } from "./agent";
import { type DxfModel, type Entity, modelBounds, nativeUnit } from "./model";
import type { Tool, ToolContext, ToolResult } from "../bim/registry";

export type CadTool = Tool<DxfModel, CadOp>;
type Ctx = ToolContext<DxfModel>;

const ok = (summary: string, extra: Partial<ToolResult<CadOp>> = {}): ToolResult<CadOp> => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Partial<ToolResult<CadOp>> = {}): ToolResult<CadOp> => ({ ok: false, summary, ...extra });

/** Where an entity sits, for spatial filtering and for reporting a hit. */
function entityPoints(e: Entity): { x: number; y: number }[] {
  if (e.kind === "line") return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.kind === "poly") return e.pts;
  return [{ x: e.x, y: e.y }];
}

const norm = (b: { x1: number; y1: number; x2: number; y2: number }) => ({
  minX: Math.min(b.x1, b.x2),
  maxX: Math.max(b.x1, b.x2),
  minY: Math.min(b.y1, b.y2),
  maxY: Math.max(b.y1, b.y2),
});

/** Touches the box. The right test for SEARCHING: show me what is in this area. */
const inBox = (e: Entity, b: { x1: number; y1: number; x2: number; y2: number }) => {
  const { minX, maxX, minY, maxY } = norm(b);
  return entityPoints(e).some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
};

/**
 * Centre lies in the box. The right test for DELETING, and not the same test.
 *
 * applyCadOps deletes by centre on purpose — "a box round a door should take the
 * door, not the wall it happens to cross". A tool that counted by overlap would
 * quote a larger number than the operation goes on to delete, which is worse
 * than useless when that number is what the confirmation gate shows.
 */
const centreOf = (e: Entity): { x: number; y: number } => {
  if (e.kind === "line") return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
  if (e.kind === "poly") {
    const xs = e.pts.map((p) => p.x);
    const ys = e.pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  return { x: e.x, y: e.y };
};

const centreInBox = (e: Entity, b: { x1: number; y1: number; x2: number; y2: number }) => {
  const { minX, maxX, minY, maxY } = norm(b);
  const c = centreOf(e);
  return c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY;
};

const brief = (e: Entity) => ({
  id: e.id,
  kind: e.kind,
  layer: e.layer,
  ...(e.kind === "text" ? { text: e.text, at: { x: e.x, y: e.y }, height: e.h } : {}),
  ...(e.kind === "line" ? { from: { x: e.x1, y: e.y1 }, to: { x: e.x2, y: e.y2 } } : {}),
  ...(e.kind === "poly" ? { points: e.pts.length, closed: e.closed } : {}),
});

// ── Module: Drawing ──────────────────────────────────────────────────────────

const drawingOverview: CadTool = {
  name: "drawing_overview",
  label: "Drawing Overview",
  module: "Drawing",
  scope: "global",
  kind: "read",
  description: "Layers with entity counts, drawing extents and units. Use to orient before looking for anything specific.",
  keywords: ["overview", "summary", "layers", "extents", "units", "what", "counts"],
  params: [],
  run: (ctx: Ctx) => {
    const m = ctx.doc;
    const byLayer: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const e of m.entities) {
      byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    }
    const b = modelBounds(m);
    return ok(`${m.entities.length} entities across ${Object.keys(byLayer).length} layer(s), in ${nativeUnit(m.insunits)}.`, {
      data: {
        entities: m.entities.length,
        units: nativeUnit(m.insunits),
        // Unknown units are worth saying out loud: every measurement the agent
        // reasons about downstream is wrong by a factor if this is a guess.
        unitsDeclared: m.insunits !== 0,
        extents: b,
        byKind,
        layers: m.layers.map((l) => ({ name: l.name, visible: l.visible, entities: byLayer[l.name] ?? 0 })),
      },
    });
  },
};

const listLayers: CadTool = {
  name: "list_layers",
  label: "List Layers",
  module: "Drawing",
  scope: "global",
  kind: "read",
  description: "Every layer in the drawing with how many entities it holds and whether it is visible.",
  keywords: ["layer", "layers", "list", "which", "visible", "hidden"],
  params: [{ name: "match", type: "string", description: 'Optional substring filter, e.g. "ANNO"' }],
  run: (ctx: Ctx, a) => {
    const needle = String(a.match ?? "").toLowerCase();
    const counts: Record<string, number> = {};
    for (const e of ctx.doc.entities) counts[e.layer] = (counts[e.layer] ?? 0) + 1;
    const row = (l: { name: string; visible: boolean }) => ({ name: l.name, visible: l.visible, entities: counts[l.name] ?? 0 });
    const all = ctx.doc.layers.map(row);
    const rows = needle ? all.filter((l) => l.name.toLowerCase().includes(needle)) : all;

    /* A filter that matches nothing must not read as "this drawing has no
       layers". It happens constantly on imported sheets: a question about wall
       layers filters on "wall", a PDF import has everything flattened onto one
       PDF_GEOMETRY layer, and a bare "0 layer(s)." sends the agent off to
       explain an absence that is really a naming mismatch. Say what was searched
       for, and show what is actually there so the next step can be right. */
    if (needle && !rows.length) {
      return fail(`No layer name contains "${a.match}". This drawing has ${all.length}: ${all.map((l) => l.name).join(", ")}.`, {
        data: { matched: 0, filter: a.match, layers: all },
      });
    }

    return ok(needle ? `${rows.length} of ${all.length} layer(s) match "${a.match}".` : `${rows.length} layer(s).`, {
      data: { matched: rows.length, total: all.length, ...(needle ? { filter: a.match } : {}), layers: rows },
    });
  },
};

const findText: CadTool = {
  name: "find_text",
  label: "Find Text",
  module: "Drawing",
  scope: "global",
  kind: "read",
  description: 'Find text on the sheet — room numbers, tags, titles, notes. Matches as a whole word first, so "307" does not also return 3070.',
  keywords: ["text", "find", "search", "room", "number", "tag", "label", "note", "title", "where"],
  params: [
    { name: "text", type: "string", description: "What to look for", required: true },
    { name: "layer", type: "string", description: "Restrict to one layer" },
    { name: "exact", type: "boolean", description: "Require the whole string to match exactly", default: false },
  ],
  run: (ctx: Ctx, a) => {
    const needle = String(a.text).trim().toLowerCase();
    const layer = a.layer ? String(a.layer).toLowerCase() : null;
    const texts = ctx.doc.entities.filter(
      (e): e is Extract<Entity, { kind: "text" }> => e.kind === "text" && (!layer || e.layer.toLowerCase() === layer),
    );

    const exact = texts.filter((e) => e.text.trim().toLowerCase() === needle);
    if (a.exact) {
      return exact.length
        ? ok(`${exact.length} exact match(es) for "${a.text}".`, { data: { count: exact.length, matches: exact.slice(0, 100).map(brief) } })
        : fail(`No text exactly matches "${a.text}".`, { data: { count: 0, matches: [] } });
    }
    if (exact.length) return ok(`${exact.length} exact match(es) for "${a.text}".`, { data: { count: exact.length, matches: exact.slice(0, 100).map(brief) } });

    // Whole-word before substring, for the same reason the BIM resolver does it:
    // a sheet full of room numbers will substring-match 307 against 3070.
    const word = new RegExp(`(^|[^0-9a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9a-z]|$)`, "i");
    const whole = texts.filter((e) => word.test(e.text));
    if (whole.length) return ok(`${whole.length} match(es) for "${a.text}".`, { data: { count: whole.length, matches: whole.slice(0, 100).map(brief) } });

    const loose = texts.filter((e) => e.text.toLowerCase().includes(needle));
    return loose.length
      ? ok(`${loose.length} partial match(es) for "${a.text}".`, {
          assumptions: ["Matched as a substring — no whole-word match was found."],
          data: { count: loose.length, matches: loose.slice(0, 100).map(brief) },
        })
      : fail(`No text on the sheet contains "${a.text}".`, { data: { count: 0, matches: [] } });
  },
};

const findEntities: CadTool = {
  name: "find_entities",
  label: "Find Entities",
  module: "Drawing",
  scope: "global",
  kind: "read",
  description: "Find lines, polylines or text by layer and/or within a rectangular region.",
  keywords: ["entity", "entities", "find", "line", "poly", "region", "area", "within", "on layer"],
  params: [
    { name: "layer", type: "string", description: "Layer name" },
    { name: "kind", type: "enum", description: "Entity kind", options: ["line", "poly", "text"] },
    { name: "region", type: "selector", description: "Optional {x1,y1,x2,y2} bounding box in drawing units" },
    { name: "limit", type: "number", description: "Maximum to return", default: 100 },
  ],
  run: (ctx: Ctx, a) => {
    const layer = a.layer ? String(a.layer).toLowerCase() : null;
    let out = ctx.doc.entities.filter(
      (e) => (!layer || e.layer.toLowerCase() === layer) && (!a.kind || e.kind === a.kind),
    );
    if (a.region) out = out.filter((e) => inBox(e, a.region));
    const limit = Number(a.limit ?? 100);
    return ok(`${out.length} entit${out.length === 1 ? "y" : "ies"} found.`, {
      data: { count: out.length, entities: out.slice(0, limit).map(brief), truncated: out.length > limit },
    });
  },
};

// ── Module: Markup ───────────────────────────────────────────────────────────

const MARKUP_LAYER = "AL-MARKUP";

const addNote: CadTool = {
  name: "add_note",
  label: "Add Note",
  module: "Markup",
  scope: "global",
  kind: "write",
  description: "Place a text note on the drawing at a point. Goes on a markup layer, never on the sheet's own layers.",
  keywords: ["note", "text", "annotate", "label", "comment", "mark", "write", "tag"],
  params: [
    { name: "text", type: "string", description: "The note", required: true },
    { name: "x", type: "number", description: "X in drawing units", required: true },
    { name: "y", type: "number", description: "Y in drawing units", required: true },
    { name: "height", type: "number", description: "Text height in drawing units" },
    { name: "layer", type: "string", description: "Layer to draw on", default: MARKUP_LAYER },
  ],
  run: (ctx: Ctx, a) => {
    // Height scaled from the sheet rather than fixed: 2.5 units is legible on a
    // millimetre drawing and invisible on one in metres.
    const b = modelBounds(ctx.doc);
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1000;
    const h = Number(a.height ?? Math.max(span / 400, 1e-6));
    const assumptions = a.height === undefined ? [`Text height ${h.toFixed(3)} taken from the sheet size.`] : [];
    if (a.layer === undefined) assumptions.push(`Drawn on ${MARKUP_LAYER}, leaving the issued layers untouched.`);
    return ok(`Adding a note at (${a.x}, ${a.y}).`, {
      commands: [{ op: "add_text", layer: String(a.layer ?? MARKUP_LAYER), text: String(a.text), x: Number(a.x), y: Number(a.y), h }],
      affected: 1,
      assumptions,
    });
  },
};

const cloudRegion: CadTool = {
  name: "cloud_region",
  label: "Cloud a Region",
  module: "Markup",
  scope: "global",
  kind: "write",
  description: "Draw a revision box around a region, optionally with a label. Use to flag an area for attention.",
  keywords: ["cloud", "revision", "box", "highlight", "circle", "flag", "mark", "region", "around"],
  params: [
    { name: "x", type: "number", description: "Lower-left X", required: true },
    { name: "y", type: "number", description: "Lower-left Y", required: true },
    { name: "w", type: "number", description: "Width", required: true },
    { name: "h", type: "number", description: "Height", required: true },
    { name: "label", type: "string", description: "Optional text placed above the box" },
    { name: "layer", type: "string", description: "Layer to draw on", default: MARKUP_LAYER },
  ],
  run: (ctx: Ctx, a) => {
    const layer = String(a.layer ?? MARKUP_LAYER);
    const b = modelBounds(ctx.doc);
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1000;
    const ops: CadOp[] = [{ op: "add_rect", layer, x: Number(a.x), y: Number(a.y), w: Number(a.w), h: Number(a.h) }];
    if (a.label) {
      const th = Math.max(span / 400, 1e-6);
      ops.push({ op: "add_text", layer, text: String(a.label), x: Number(a.x), y: Number(a.y) + Number(a.h) + th, h: th });
    }
    return ok(`Clouding a ${a.w} × ${a.h} region at (${a.x}, ${a.y}).`, {
      commands: ops,
      affected: ops.length,
      assumptions: a.layer === undefined ? [`Drawn on ${layer}, leaving the issued layers untouched.`] : [],
    });
  },
};

const drawLine: CadTool = {
  name: "draw_line",
  label: "Draw Line",
  module: "Markup",
  scope: "global",
  kind: "write",
  description: "Draw a straight line between two points — a leader, a setting-out line, a correction.",
  keywords: ["line", "draw", "leader", "arrow", "connect", "between"],
  params: [
    { name: "x1", type: "number", description: "Start X", required: true },
    { name: "y1", type: "number", description: "Start Y", required: true },
    { name: "x2", type: "number", description: "End X", required: true },
    { name: "y2", type: "number", description: "End Y", required: true },
    { name: "layer", type: "string", description: "Layer to draw on", default: MARKUP_LAYER },
  ],
  run: (_ctx: Ctx, a) =>
    ok(`Drawing a line from (${a.x1}, ${a.y1}) to (${a.x2}, ${a.y2}).`, {
      commands: [{ op: "add_line", layer: String(a.layer ?? MARKUP_LAYER), x1: Number(a.x1), y1: Number(a.y1), x2: Number(a.x2), y2: Number(a.y2) }],
      affected: 1,
    }),
};

// ── Module: Cleanup ──────────────────────────────────────────────────────────

const deleteLayer: CadTool = {
  name: "delete_layer",
  label: "Delete a Layer",
  module: "Cleanup",
  scope: "global",
  kind: "write",
  description: "Remove every entity on a named layer. Counts what would go first, so the size of the change is known before it is made.",
  keywords: ["delete", "remove", "purge", "layer", "strip", "clear"],
  params: [{ name: "layer", type: "string", description: "Layer name", required: true }],
  run: (ctx: Ctx, a) => {
    const layer = String(a.layer);
    const n = ctx.doc.entities.filter((e) => e.layer.toLowerCase() === layer.toLowerCase()).length;
    if (!n) return fail(`No layer named "${layer}" holds any entities.`, { affected: 0 });
    return ok(`Deleting ${n} entit${n === 1 ? "y" : "ies"} on layer "${layer}".`, {
      commands: [{ op: "delete_layer", layer }],
      affected: n,
      data: { layer, entities: n },
    });
  },
};

const clearRegion: CadTool = {
  name: "clear_region",
  label: "Clear a Region",
  module: "Cleanup",
  scope: "global",
  kind: "write",
  description: "Delete everything inside a rectangular region, across all layers.",
  keywords: ["clear", "delete", "erase", "region", "area", "remove", "within", "box"],
  params: [
    { name: "x1", type: "number", description: "Corner X", required: true },
    { name: "y1", type: "number", description: "Corner Y", required: true },
    { name: "x2", type: "number", description: "Opposite corner X", required: true },
    { name: "y2", type: "number", description: "Opposite corner Y", required: true },
  ],
  run: (ctx: Ctx, a) => {
    const box = { x1: Number(a.x1), y1: Number(a.y1), x2: Number(a.x2), y2: Number(a.y2) };
    // Counted by centre, matching what delete_region actually removes. Counting
    // by overlap here would make the gate quote a number the operation then
    // fails to honour.
    const hit = ctx.doc.entities.filter((e) => centreInBox(e, box));
    const crossing = ctx.doc.entities.filter((e) => inBox(e, box) && !centreInBox(e, box)).length;
    if (!hit.length) return fail("Nothing has its centre inside that region.", { affected: 0 });
    return ok(`Clearing ${hit.length} entit${hit.length === 1 ? "y" : "ies"} from the region.`, {
      commands: [{ op: "delete_region", ...box }],
      affected: hit.length,
      assumptions: crossing
        ? [`${crossing} entit${crossing === 1 ? "y" : "ies"} cross the region but are centred outside it, and will be left alone.`]
        : [],
      data: { region: box, entities: hit.length, crossingKept: crossing },
    });
  },
};

export const CAD_TOOLS: CadTool[] = [
  drawingOverview,
  listLayers,
  findText,
  findEntities,
  addNote,
  cloudRegion,
  drawLine,
  deleteLayer,
  clearRegion,
];

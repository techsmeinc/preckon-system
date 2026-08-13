/**
 * BIM — the built-in tool catalogue.
 *
 * Modelled on what the ArchiLabs recordings actually do: a read tool finds the
 * elements, a write tool acts on them. No tool mutates; write tools return
 * Commands for commands.ts to apply.
 *
 * Modules group tools for the authoring UI. They are a filing convenience, not a
 * taxonomy — ArchiLabs files `list_rooms_in_active_view` under "Filled Region" —
 * so do not agonise over placement.
 */

import type { Command } from "./commands";
import { CATALOG, type Element, type Vec2, levels, linLength } from "./model";
import { count, explain, query, resolve, type Selector } from "./query";
import type { Tool, ToolContext, ToolResult } from "./registry";

// ── helpers ──────────────────────────────────────────────────────────────────

const ok = (summary: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: false, summary, ...extra });

/** What a read tool hands back per element — enough to act on, small enough to read. */
const brief = (e: Element) => ({
  id: e.id,
  name: e.name,
  category: e.category,
  discipline: e.discipline,
  level: e.level,
  ...(e.geom?.kind === "linear" ? { length_m: Number(linLength(e).toFixed(3)) } : {}),
  ...(Object.keys(e.params ?? {}).length ? { params: e.params } : {}),
});

/** Centroid of whatever geometry an element has — where a tag goes by default. */
export function centroid(e: Element): Vec2 {
  const g = e.geom ?? { kind: "point" as const };
  if (g.outline?.length) {
    const n = g.outline.length;
    return { x: g.outline.reduce((s, p) => s + p.x, 0) / n, y: g.outline.reduce((s, p) => s + p.y, 0) / n };
  }
  if (g.start && g.end) return { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };
  if (g.at) return { ...g.at };
  return { x: 0, y: 0 };
}

// ── Module: Selection ────────────────────────────────────────────────────────

const findElements: Tool = {
  name: "find_elements",
  label: "Find Elements",
  module: "Selection",
  scope: "global",
  kind: "read",
  description: "Find elements by category, discipline, level, name, parameter value or area. The first step of almost every task.",
  keywords: ["query", "select", "search", "list", "get", "filter", "where", "which"],
  params: [
    { name: "selector", type: "selector", description: "Selector object: {category, discipline, level, name:{op,value}, params:[{key,op,value}], within, ids, limit}", required: true },
  ],
  run: (ctx: ToolContext, a) => {
    const s = a.selector as Selector;
    const els = query(ctx.doc, s);
    return ok(`Found ${els.length} element(s) matching ${explain(s)}.`, {
      data: { count: els.length, elements: els.slice(0, 100).map(brief), truncated: els.length > 100 },
    });
  },
};

const resolveReference: Tool = {
  name: "resolve_reference",
  label: "Resolve Reference",
  module: "Selection",
  scope: "global",
  kind: "read",
  description: 'Resolve a human reference such as "room 307" or "Corridor" to concrete elements. Use when the instruction names something rather than describing it.',
  keywords: ["room", "named", "called", "identify", "lookup", "reference"],
  params: [
    { name: "text", type: "string", description: 'The reference as the user said it, e.g. "307" or "north corridor"', required: true },
    { name: "selector", type: "selector", description: "Optional selector to search within, e.g. {category:'room'}" },
  ],
  run: (ctx, a) => {
    const els = resolve(ctx.doc, a.text, (a.selector as Selector) ?? {});
    if (!els.length) return fail(`Nothing matches "${a.text}".`, { data: { count: 0, elements: [] } });
    return ok(`"${a.text}" resolves to ${els.length} element(s).`, {
      data: { count: els.length, elements: els.slice(0, 50).map(brief) },
    });
  },
};

const modelOverview: Tool = {
  name: "model_overview",
  label: "Model Overview",
  module: "Selection",
  scope: "global",
  kind: "read",
  description: "Counts by category and discipline, plus the level list. Use to orient before querying in detail.",
  keywords: ["summary", "overview", "counts", "levels", "how many", "stats"],
  params: [],
  run: (ctx) => {
    const all = query(ctx.doc);
    const byCat: Record<string, number> = {};
    const byDisc: Record<string, number> = {};
    for (const e of all) {
      byCat[e.category] = (byCat[e.category] ?? 0) + 1;
      byDisc[e.discipline] = (byDisc[e.discipline] ?? 0) + 1;
    }
    return ok(`${all.length} elements across ${Object.keys(byCat).length} categories.`, {
      data: { total: all.length, byCategory: byCat, byDiscipline: byDisc, levels: levels(ctx.doc).map(brief) },
    });
  },
};

// ── Module: Tagging ──────────────────────────────────────────────────────────

const tagElements: Tool = {
  name: "tag_elements",
  label: "Tag Elements",
  module: "Tagging",
  scope: "global",
  kind: "write",
  description: "Place a tag on every element matching a selector. The tag text defaults to the element name. Skips elements that already carry a tag.",
  keywords: ["tag", "label", "annotate", "annotation", "mark", "identify"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to tag", required: true },
    { name: "text", type: "string", description: "Tag text. Defaults to each element's name, then its id." },
    { name: "skipTagged", type: "boolean", description: "Skip elements that already have a tag", default: true },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)} — nothing to tag.`, { affected: 0 });

    const tagged = new Set(
      query(ctx.doc, { category: "tag" })
        .map((t) => String(t.params?.target ?? ""))
        .filter(Boolean),
    );
    const todo = a.skipTagged === false ? targets : targets.filter((e) => !tagged.has(e.id));
    const skipped = targets.length - todo.length;

    const commands: Command[] = todo.map((e) => ({
      name: "add" as const,
      args: {
        category: "tag",
        at: centroid(e),
        level: e.level,
        name: a.text ?? e.name ?? e.id,
        params: { target: e.id, text: a.text ?? e.name ?? e.id },
      },
    }));

    const assumptions: string[] = [];
    if (!a.text) assumptions.push("Tag text taken from each element's name.");
    if (skipped) assumptions.push(`${skipped} element(s) already tagged and were skipped.`);

    return ok(`Tagging ${todo.length} element(s).`, {
      commands,
      affected: todo.length,
      assumptions,
      data: { tagged: todo.length, skipped, targets: todo.slice(0, 50).map((e) => e.id) },
    });
  },
};

const findUntagged: Tool = {
  name: "find_untagged",
  label: "Find Untagged Elements",
  module: "Tagging",
  scope: "global",
  kind: "read",
  description: "List elements of a category that have no tag. Use to answer 'what is missing a tag'.",
  keywords: ["untagged", "missing", "tag", "audit", "incomplete", "check"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to check, e.g. {category:'room'}", required: true },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    const tagged = new Set(query(ctx.doc, { category: "tag" }).map((t) => String(t.params?.target ?? "")));
    const missing = targets.filter((e) => !tagged.has(e.id));
    return ok(`${missing.length} of ${targets.length} element(s) have no tag.`, {
      data: { total: targets.length, untagged: missing.length, elements: missing.slice(0, 100).map(brief) },
    });
  },
};

// ── Module: Parameters ───────────────────────────────────────────────────────

const setParameter: Tool = {
  name: "set_parameter",
  label: "Set Parameter Values",
  module: "Parameters",
  scope: "global",
  kind: "write",
  description: "Set one parameter on every element matching a selector. Handles bulk edits such as updating a date or a fire rating across many elements.",
  keywords: ["set", "update", "change", "parameter", "property", "value", "bulk", "rename"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to change", required: true },
    { name: "key", type: "string", description: 'Parameter name. "name" renames the element; geometry keys (width, height, thickness, elevation…) change geometry.', required: true },
    { name: "value", type: "string", description: "New value", required: true },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)}.`, { affected: 0 });
    const commands: Command[] = targets.map((e) => ({
      name: "set_param" as const,
      args: { id: e.id, key: a.key, value: a.value },
    }));
    return ok(`Setting ${a.key} = "${a.value}" on ${targets.length} element(s).`, {
      commands,
      affected: targets.length,
      data: { changed: targets.length, key: a.key, value: a.value, targets: targets.slice(0, 50).map((e) => e.id) },
    });
  },
};

// ── Module: Authoring ────────────────────────────────────────────────────────

const placeElements: Tool = {
  name: "place_elements",
  label: "Place Elements",
  module: "Authoring",
  scope: "global",
  kind: "write",
  description: "Place one or more elements of a catalog category at given positions. Linear items take start/end, point items take at, area items take an outline.",
  keywords: ["place", "add", "create", "draw", "insert", "wall", "column", "beam", "door", "new"],
  params: [
    { name: "category", type: "string", description: "Catalog category, e.g. wall, column, beam, door", required: true },
    { name: "placements", type: "selector", description: "Array of placement objects, each {start,end} | {at} | {outline} | {host,offset}, optionally with name/level/params", required: true },
  ],
  run: (ctx, a) => {
    const item = CATALOG[a.category];
    if (!item) return fail(`Unknown category "${a.category}". Use one from the catalog.`, { affected: 0 });
    const list = Array.isArray(a.placements) ? a.placements : [a.placements];
    if (!list.length) return fail("No placements given.", { affected: 0 });
    if (ctx.discipline && ctx.discipline !== "all" && item.discipline !== ctx.discipline) {
      return fail(`${a.category} is ${item.discipline}; you are acting as ${ctx.discipline}.`, { affected: 0 });
    }
    const commands: Command[] = list.map((p: Record<string, unknown>) => ({
      name: "add" as const,
      args: { category: a.category, ...p } as any,
    }));
    return ok(`Placing ${list.length} ${item.label.toLowerCase()}(s).`, {
      commands,
      affected: list.length,
      data: { category: a.category, placed: list.length },
    });
  },
};

const deleteElements: Tool = {
  name: "delete_elements",
  label: "Delete Elements",
  module: "Authoring",
  scope: "global",
  kind: "write",
  description: "Delete every element matching a selector. Hosted items and level contents are removed with their host, so check the count before confirming.",
  keywords: ["delete", "remove", "erase", "clear", "purge"],
  params: [{ name: "selector", type: "selector", description: "Which elements to delete", required: true }],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)}.`, { affected: 0 });
    const assumptions: string[] = [];
    const hosts = targets.filter((e) => e.geom?.kind === "linear" && count(ctx.doc, { hostedOn: [e.id] }) > 0);
    if (hosts.length) assumptions.push(`${hosts.length} of these host doors/windows, which will be deleted too.`);
    return ok(`Deleting ${targets.length} element(s).`, {
      commands: targets.map((e) => ({ name: "delete" as const, args: { id: e.id } })),
      affected: targets.length,
      assumptions,
      data: { deleting: targets.length, targets: targets.slice(0, 50).map((e) => e.id) },
    });
  },
};

const moveElements: Tool = {
  name: "move_elements",
  label: "Move Elements",
  module: "Authoring",
  scope: "global",
  kind: "write",
  description: "Shift every element matching a selector by a plan offset in metres.",
  keywords: ["move", "shift", "offset", "translate", "nudge", "reposition"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to move", required: true },
    { name: "dx", type: "number", description: "Metres east", default: 0 },
    { name: "dy", type: "number", description: "Metres north", default: 0 },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)}.`, { affected: 0 });
    if (!a.dx && !a.dy) return fail("dx and dy are both zero — nothing would move.", { affected: 0 });
    return ok(`Moving ${targets.length} element(s) by (${a.dx ?? 0}, ${a.dy ?? 0}) m.`, {
      commands: targets.map((e) => ({ name: "move" as const, args: { id: e.id, dx: a.dx ?? 0, dy: a.dy ?? 0 } })),
      affected: targets.length,
      data: { moved: targets.length, dx: a.dx ?? 0, dy: a.dy ?? 0 },
    });
  },
};

// ── Module: Dimensioning ─────────────────────────────────────────────────────

const dimensionElements: Tool = {
  name: "dimension_elements",
  label: "Dimension Elements",
  module: "Dimensioning",
  scope: "global",
  kind: "write",
  description: "Place a dimension along every linear element matching a selector, measuring its length.",
  keywords: ["dimension", "measure", "size", "length", "annotate"],
  params: [
    { name: "selector", type: "selector", description: "Which linear elements to dimension", required: true },
    { name: "offset", type: "number", description: "Metres to offset the dimension line from the element", default: 0.5 },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector).filter((e) => e.geom?.kind === "linear" && e.geom.start && e.geom.end);
    if (!targets.length) return fail("No linear elements match — only linear elements can be dimensioned.", { affected: 0 });
    const off = Number(a.offset ?? 0.5);
    const commands: Command[] = targets.map((e) => {
      const { start, end } = e.geom as { start: Vec2; end: Vec2 };
      // Offset perpendicular to the run so the dimension sits clear of the element.
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * off;
      const ny = (dx / len) * off;
      return {
        name: "add" as const,
        args: {
          category: "dimension",
          start: { x: start.x + nx, y: start.y + ny },
          end: { x: end.x + nx, y: end.y + ny },
          level: e.level,
          params: { target: e.id, value_m: Number(linLength(e).toFixed(3)) },
        },
      };
    });
    return ok(`Dimensioning ${targets.length} element(s).`, {
      commands,
      affected: targets.length,
      assumptions: [`Dimension lines offset ${off} m perpendicular to each element.`],
      data: { dimensioned: targets.length },
    });
  },
};

export const BUILTIN_TOOLS: Tool[] = [
  findElements,
  resolveReference,
  modelOverview,
  tagElements,
  findUntagged,
  setParameter,
  placeElements,
  deleteElements,
  moveElements,
  dimensionElements,
];

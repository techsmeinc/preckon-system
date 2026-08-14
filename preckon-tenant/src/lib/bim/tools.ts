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
import { DOCUMENTATION_TOOLS } from "./documentation";

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

// ── Module: Parameters (continued) ───────────────────────────────────────────

const renameByPattern: Tool = {
  name: "rename_by_pattern",
  label: "Rename By Pattern",
  module: "Parameters",
  scope: "global",
  kind: "write",
  description:
    'Rename matching elements from a template. {name} is the current name, {number} a parameter, {i} the 1-based position. Example: "RM-{number}".',
  keywords: ["rename", "pattern", "template", "renumber", "prefix", "suffix", "naming", "convention"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to rename", required: true },
    { name: "pattern", type: "string", description: 'Template, e.g. "RM-{number}" or "{name} (existing)"', required: true },
    { name: "startAt", type: "number", description: "First value for {i}", default: 1 },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)}.`, { affected: 0 });

    const pattern = String(a.pattern);
    const start = Number(a.startAt ?? 1);
    const unresolved = new Set<string>();

    const commands: Command[] = targets.map((e, i) => {
      const next = pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
        if (key === "name") return e.name ?? "";
        if (key === "i") return String(start + i);
        if (key === "id") return e.id;
        if (key === "category") return e.category;
        const v = e.params?.[key];
        // A placeholder that resolves to nothing would silently produce "RM-"
        // for every element, which looks like a rename that worked.
        if (v === undefined) unresolved.add(key);
        return v === undefined ? "" : String(v);
      });
      return { name: "set_param" as const, args: { id: e.id, key: "name", value: next } };
    });

    const preview = targets.slice(0, 3).map((e, i) => `${e.name ?? e.id} → ${(commands[i].args as any).value}`);
    const assumptions = unresolved.size
      ? [`No value for {${[...unresolved].join("}, {")}} on some elements — that part of the name came out empty.`]
      : [];

    return ok(`Renaming ${targets.length} element(s) to "${pattern}".`, {
      commands,
      affected: targets.length,
      assumptions,
      data: { renaming: targets.length, pattern, preview },
    });
  },
};

// ── Module: Structure ────────────────────────────────────────────────────────

const gridIntersections: Tool = {
  name: "grid_intersections",
  label: "Find Grid Intersections",
  module: "Structure",
  scope: "global",
  kind: "read",
  description: "Compute where the grid lines cross. Use before placing columns or foundations at every intersection.",
  keywords: ["grid", "intersection", "cross", "column", "setting out", "where", "gridline"],
  params: [
    { name: "level", type: "string", description: "Restrict to grids on one level" },
    { name: "tolerance", type: "number", description: "Metres within which two crossings count as one", default: 0.01 },
  ],
  run: (ctx, a) => {
    const grids = query(ctx.doc, { category: "grid", ...(a.level ? { level: a.level } : {}) }).filter(
      (g) => g.geom?.start && g.geom?.end,
    );
    if (grids.length < 2) return fail(`Found ${grids.length} grid line(s) — at least two are needed to cross.`, { data: { grids: grids.length, intersections: [] } });

    const tol = Number(a.tolerance ?? 0.01);
    const pts: { x: number; y: number; a: string; b: string }[] = [];

    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        const p = segmentIntersection(grids[i], grids[j]);
        if (!p) continue;
        // Three grids meeting at a point yield three identical crossings;
        // placing a column at each would triple-stack them.
        if (pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol)) continue;
        pts.push({ ...p, a: grids[i].name ?? grids[i].id, b: grids[j].name ?? grids[j].id });
      }
    }

    const data = {
      grids: grids.length,
      count: pts.length,
      intersections: pts.slice(0, 400).map((p) => ({ x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)), grids: [p.a, p.b] })),
    };

    // No crossings is a failure, not an empty success. Whatever comes next —
    // placing a column at each — is meaningless against nothing, and an agent
    // told "ok" will go on to place zero and report that it did the job.
    if (!pts.length) {
      return fail(`${grids.length} grid lines, but none of them cross — they may all run the same way.`, { data });
    }

    return ok(`${grids.length} grid lines cross at ${pts.length} distinct point(s).`, { data });
  },
};

/** Where two finite grid segments cross, or null if they are parallel or miss. */
function segmentIntersection(g1: Element, g2: Element): { x: number; y: number } | null {
  const a = g1.geom.start!;
  const b = g1.geom.end!;
  const c = g2.geom.start!;
  const d = g2.geom.end!;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  // Grid lines are usually drawn a little short of each other, so the crossing
  // is allowed slightly outside both segments rather than only strictly within.
  const pad = 0.05;
  if (t < -pad || t > 1 + pad || u < -pad || u > 1 + pad) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

const placeAtPoints: Tool = {
  name: "place_at_points",
  label: "Place At Points",
  module: "Structure",
  scope: "global",
  kind: "write",
  description:
    "Place a point-type element (column, footing, pile, equipment) at each of a list of points, optionally offset in four directions from each.",
  keywords: ["place", "column", "grid", "each", "every", "intersection", "array", "repeat", "footing"],
  params: [
    { name: "category", type: "string", description: "Catalog category, e.g. column", required: true },
    { name: "points", type: "selector", description: "Array of {x,y}", required: true },
    {
      name: "offsets",
      type: "string[]",
      description: 'Directions to offset from each point: any of up, down, left, right, none. Defaults to ["none"].',
    },
    { name: "offset", type: "number", description: "Offset distance in metres", default: 0 },
    { name: "level", type: "string", description: "Level id" },
  ],
  run: (ctx, a) => {
    const item = CATALOG[a.category];
    if (!item) return fail(`Unknown category "${a.category}".`, { affected: 0 });
    if (item.kind !== "point") return fail(`${item.label} is not a point item — use place_elements for ${item.kind} items.`, { affected: 0 });
    if (ctx.discipline && ctx.discipline !== "all" && item.discipline !== ctx.discipline) {
      return fail(`${a.category} is ${item.discipline}; you are acting as ${ctx.discipline}.`, { affected: 0 });
    }

    const pts = (Array.isArray(a.points) ? a.points : [a.points]).filter(
      (p: any) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)),
    );
    if (!pts.length) return fail("No usable points given.", { affected: 0 });

    const DIRS: Record<string, [number, number]> = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0], none: [0, 0] };
    const dirs: string[] = (a.offsets?.length ? a.offsets : ["none"]).map((d: string) => String(d).toLowerCase());
    const bad = dirs.filter((d) => !(d in DIRS));
    if (bad.length) return fail(`Unknown direction(s): ${bad.join(", ")}. Use up, down, left, right or none.`, { affected: 0 });

    const off = Number(a.offset ?? 0);
    const commands: Command[] = [];
    for (const p of pts) {
      for (const d of dirs) {
        const [dx, dy] = DIRS[d];
        commands.push({
          name: "add",
          args: { category: a.category, at: { x: Number(p.x) + dx * off, y: Number(p.y) + dy * off }, level: a.level },
        });
      }
    }

    return ok(`Placing ${commands.length} ${item.label.toLowerCase()}(s) — ${dirs.length} per point across ${pts.length} point(s).`, {
      commands,
      affected: commands.length,
      assumptions: off === 0 && dirs.length > 1 ? ["Offset is zero, so the items at each point will coincide."] : [],
      data: { category: a.category, points: pts.length, perPoint: dirs.length, total: commands.length },
    });
  },
};

// ── Module: Views and Schedules ──────────────────────────────────────────────

const createSchedule: Tool = {
  name: "create_schedule",
  label: "Create a Schedule",
  module: "Views and Schedules",
  scope: "global",
  kind: "read",
  description:
    "Build a schedule of matching elements with chosen fields — a door schedule, a room area schedule. Returns rows; it does not change the model.",
  keywords: ["schedule", "table", "list", "count", "quantities", "door schedule", "room schedule", "fields", "export"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to schedule", required: true },
    { name: "fields", type: "string[]", description: 'Columns: id, name, category, discipline, level, length, area, or any parameter name' },
    { name: "groupBy", type: "string", description: "Field to group and count by" },
  ],
  run: (ctx, a) => {
    const rows = query(ctx.doc, a.selector as Selector);
    if (!rows.length) return fail(`Nothing matches ${explain(a.selector as Selector)} — the schedule would be empty.`, { data: { rows: [] } });

    const fields: string[] = a.fields?.length ? a.fields : ["id", "name", "category", "level"];
    const value = (e: Element, f: string): string | number | boolean | null => {
      switch (f) {
        case "id": return e.id;
        case "name": return e.name ?? "";
        case "category": return e.category;
        case "discipline": return e.discipline;
        case "level": return e.level ?? "";
        case "length": return e.geom?.kind === "linear" ? Number(linLength(e).toFixed(3)) : null;
        case "area": return e.geom?.kind === "area" ? Number(polygonArea(e.geom.outline ?? []).toFixed(3)) : null;
        default: return (e.params?.[f] ?? (e.geom as any)?.[f] ?? null) as any;
      }
    };

    const table = rows.map((e) => Object.fromEntries(fields.map((f) => [f, value(e, f)])));

    let groups: { key: string; count: number }[] | undefined;
    if (a.groupBy) {
      const g = new Map<string, number>();
      for (const e of rows) {
        const k = String(value(e, a.groupBy) ?? "(none)");
        g.set(k, (g.get(k) ?? 0) + 1);
      }
      groups = [...g.entries()].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count);
    }

    // Empty columns are worth naming: asking for "fire_rating" and getting a
    // blank column means the parameter is not on these elements, which is a
    // different answer from "none of them are fire rated".
    const empty = fields.filter((f) => table.every((r) => r[f] === null || r[f] === ""));

    return ok(`Scheduled ${rows.length} element(s) across ${fields.length} field(s).`, {
      assumptions: [
        ...(a.fields?.length ? [] : [`No fields given — used ${fields.join(", ")}.`]),
        ...(empty.length ? [`No values found for: ${empty.join(", ")}.`] : []),
      ],
      data: { count: rows.length, fields, rows: table.slice(0, 200), truncated: rows.length > 200, groups },
    });
  },
};

const overrideGraphics: Tool = {
  name: "override_graphics",
  label: "Override Graphics",
  module: "Views and Schedules",
  scope: "global",
  kind: "write",
  description:
    'Colour matching elements — "make all fire rated walls red". Sets a display colour parameter; it does not change geometry.',
  keywords: ["colour", "color", "red", "highlight", "override", "graphics", "display", "filter", "show", "paint"],
  params: [
    { name: "selector", type: "selector", description: "Which elements to colour", required: true },
    { name: "color", type: "string", description: 'Colour as a hex string, e.g. "#e11d48", or a name like "red"', required: true },
  ],
  run: (ctx, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)}.`, { affected: 0 });

    const NAMED: Record<string, string> = {
      red: "#e11d48", green: "#16a34a", blue: "#2563eb", yellow: "#eab308",
      orange: "#ea580c", purple: "#9333ea", grey: "#6b7280", gray: "#6b7280", black: "#111827", white: "#ffffff",
    };
    const raw = String(a.color).trim().toLowerCase();
    const hex = NAMED[raw] ?? raw;
    if (!/^#[0-9a-f]{6}$/.test(hex)) {
      return fail(`"${a.color}" is not a colour I can use. Give a hex value like #e11d48, or one of: ${Object.keys(NAMED).join(", ")}.`, { affected: 0 });
    }

    return ok(`Colouring ${targets.length} element(s) ${raw}.`, {
      commands: targets.map((e) => ({ name: "set_param" as const, args: { id: e.id, key: "color", value: hex } })),
      affected: targets.length,
      assumptions: NAMED[raw] ? [`"${raw}" taken as ${hex}.`] : [],
      data: { coloured: targets.length, color: hex, targets: targets.slice(0, 50).map((e) => e.id) },
    });
  },
};

/** Shoelace area of a closed ring, in square metres. */
function polygonArea(pts: Vec2[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export const BUILTIN_TOOLS: Tool[] = [
  ...DOCUMENTATION_TOOLS,
  findElements,
  resolveReference,
  modelOverview,
  tagElements,
  findUntagged,
  setParameter,
  renameByPattern,
  placeElements,
  placeAtPoints,
  deleteElements,
  moveElements,
  dimensionElements,
  gridIntersections,
  createSchedule,
  overrideGraphics,
];

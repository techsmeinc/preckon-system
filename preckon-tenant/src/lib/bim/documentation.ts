/**
 * BIM — views, sheets and viewports.
 *
 * The remaining half of the ArchiLabs recordings is documentation rather than
 * geometry: a 3D view per room, a sheet with section views laid out in four
 * columns, viewports aligned on a common datum, an area plan on a level. None of
 * that is buildable with tools that only add walls.
 *
 * A view is a way of looking at the model. A sheet is a piece of paper. A
 * viewport is a view placed on a sheet at a position. All three are Elements
 * with no physical extent, so the one document model, one command interpreter
 * and one query engine already in place serve them without a parallel structure.
 *
 * As everywhere else here, nothing mutates: tools return Commands.
 */

import type { Command } from "./commands";
import { type Element, type Vec2, levels } from "./model";
import { explain, query, resolve, type Selector } from "./query";
import type { Tool, ToolContext, ToolResult } from "./registry";

const ok = (summary: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: false, summary, ...extra });

export type ViewKind = "plan" | "3d" | "section" | "elevation" | "area" | "rcp";

const brief = (e: Element) => ({ id: e.id, name: e.name, category: e.category, params: e.params });

/** Bounding box of an element, for a view scoped to it. */
function boundsOf(e: Element): { minX: number; minY: number; maxX: number; maxY: number } {
  const g = e.geom ?? { kind: "point" as const };
  const pts: Vec2[] = [];
  if (g.start) pts.push(g.start);
  if (g.end) pts.push(g.end);
  if (g.at) pts.push(g.at);
  if (g.outline) pts.push(...g.outline);
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

// ── Module: Views ────────────────────────────────────────────────────────────

const listViews: Tool = {
  name: "list_views",
  label: "List Views",
  module: "Views",
  scope: "global",
  kind: "read",
  description: "Every view in the project, optionally of one kind. Use before creating one, so an existing view is reused rather than duplicated.",
  keywords: ["view", "views", "list", "existing", "which", "plan", "3d", "section", "elevation", "area"],
  params: [
    { name: "kind", type: "enum", description: "Filter by view kind", options: ["plan", "3d", "section", "elevation", "area", "rcp"] },
    { name: "nameContains", type: "string", description: "Filter by name" },
  ],
  run: (ctx: ToolContext, a) => {
    let views = query(ctx.doc, { category: "view" });
    if (a.kind) views = views.filter((v) => v.params?.viewKind === a.kind);
    if (a.nameContains) {
      const n = String(a.nameContains).toLowerCase();
      views = views.filter((v) => (v.name ?? "").toLowerCase().includes(n));
    }
    return ok(`${views.length} view(s).`, { data: { count: views.length, views: views.slice(0, 100).map(brief) } });
  },
};

const createViewsForElements: Tool = {
  name: "create_views_for_elements",
  label: "Create Views For Elements",
  module: "Views",
  scope: "global",
  kind: "write",
  description:
    'One view per matching element — "make 3D views for all the rooms". Names them from a pattern and crops each to its element plus a margin. Skips elements that already have one.',
  keywords: ["view", "views", "3d", "create", "each", "every", "room", "per", "make", "generate", "crop"],
  params: [
    { name: "selector", type: "selector", description: "Which elements get a view", required: true },
    { name: "kind", type: "enum", description: "View kind", options: ["plan", "3d", "section", "elevation", "area", "rcp"], default: "3d" },
    { name: "pattern", type: "string", description: 'Name template. {name} is the element name. Default "3D - {name}".' },
    { name: "margin", type: "number", description: "Crop margin around the element, in metres", default: 0.05 },
  ],
  run: (ctx: ToolContext, a) => {
    const targets = query(ctx.doc, a.selector as Selector);
    if (!targets.length) return fail(`Nothing matches ${explain(a.selector as Selector)} — no views to create.`, { affected: 0 });

    const kind = String(a.kind ?? "3d") as ViewKind;
    const pattern = String(a.pattern ?? `${kind.toUpperCase()} - {name}`);
    const margin = Number(a.margin ?? 0.05);

    // A second run must not produce "3D - Corridor" twice. Existing views record
    // what they look at, so the check is on the subject, not on the name.
    const seen = new Set(query(ctx.doc, { category: "view" }).map((v) => `${v.params?.viewKind}:${v.params?.ofElement}`));
    const todo = targets.filter((e) => !seen.has(`${kind}:${e.id}`));
    const skipped = targets.length - todo.length;

    const commands: Command[] = todo.map((e) => {
      const b = boundsOf(e);
      return {
        name: "add" as const,
        args: {
          category: "view",
          at: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
          level: e.level,
          name: pattern.replace(/\{name\}/g, e.name ?? e.id),
          params: {
            viewKind: kind,
            ofElement: e.id,
            cropMinX: b.minX - margin, cropMinY: b.minY - margin,
            cropMaxX: b.maxX + margin, cropMaxY: b.maxY + margin,
          },
        },
      };
    });

    const assumptions: string[] = [];
    if (!a.pattern) assumptions.push(`Named "${pattern}".`);
    if (skipped) assumptions.push(`${skipped} element(s) already had a ${kind} view and were skipped.`);

    return ok(`Creating ${todo.length} ${kind} view(s).`, {
      commands,
      affected: todo.length,
      assumptions,
      data: { created: todo.length, skipped, kind, examples: todo.slice(0, 5).map((e) => pattern.replace(/\{name\}/g, e.name ?? e.id)) },
    });
  },
};

const createAreaPlan: Tool = {
  name: "create_area_plan",
  label: "Create an Area Plan",
  module: "Views",
  scope: "global",
  kind: "write",
  description: 'An area plan for a level using an area scheme — "create an Area Plan on Level 3 using the Rentable scheme". Reuses a matching view if one exists.',
  keywords: ["area", "plan", "scheme", "rentable", "gross", "level", "create"],
  params: [
    { name: "level", type: "string", description: "Level name or id", required: true },
    { name: "scheme", type: "string", description: 'Area scheme, e.g. "Rentable" or "Gross Building"', required: true },
    { name: "name", type: "string", description: "View name. Defaults to the level's name." },
  ],
  run: (ctx: ToolContext, a) => {
    const lvl = resolve(ctx.doc, String(a.level), { category: "level" })[0];
    if (!lvl) {
      const names = levels(ctx.doc).map((l) => l.name ?? l.id).join(", ");
      return fail(`No level called "${a.level}". This model has: ${names || "none"}.`, { affected: 0 });
    }

    const scheme = String(a.scheme);
    // Reuse rather than duplicate — the recording is explicit that it found the
    // existing view rather than making a second one.
    const existing = query(ctx.doc, { category: "view" }).find(
      (v) => v.params?.viewKind === "area" && v.params?.level === lvl.id && String(v.params?.scheme ?? "").toLowerCase() === scheme.toLowerCase(),
    );
    if (existing) {
      return ok(`An area plan for ${lvl.name ?? lvl.id} on the ${scheme} scheme already exists.`, {
        affected: 0,
        assumptions: [`Reused the existing view "${existing.name ?? existing.id}" rather than creating a second one.`],
        data: { reused: true, id: existing.id, name: existing.name },
      });
    }

    const name = String(a.name ?? lvl.name ?? "Area Plan");
    return ok(`Creating an area plan "${name}" on the ${scheme} scheme.`, {
      commands: [{
        name: "add",
        args: { category: "view", at: { x: 0, y: 0 }, level: lvl.id, name, params: { viewKind: "area", scheme, level: lvl.id } },
      }],
      affected: 1,
      data: { reused: false, name, scheme, level: lvl.name ?? lvl.id },
    });
  },
};

// ── Module: Sheets ───────────────────────────────────────────────────────────

const createSheet: Tool = {
  name: "create_sheet",
  label: "Create a Sheet",
  module: "Sheets",
  scope: "global",
  kind: "write",
  description: 'A drawing sheet — "create a sheet called A405 - Wall Sections". Refuses a number that is already used.',
  keywords: ["sheet", "create", "new", "drawing", "titleblock", "a405", "plot"],
  params: [
    { name: "number", type: "string", description: 'Sheet number, e.g. "A405"', required: true },
    { name: "name", type: "string", description: 'Sheet name, e.g. "Wall Sections"', required: true },
    { name: "width", type: "number", description: "Sheet width in millimetres", default: 841 },
    { name: "height", type: "number", description: "Sheet height in millimetres", default: 594 },
  ],
  run: (ctx: ToolContext, a) => {
    const number = String(a.number).trim();
    const clash = query(ctx.doc, { category: "sheet" }).find(
      (s) => String(s.params?.number ?? "").toLowerCase() === number.toLowerCase(),
    );
    // Two sheets answering to A405 makes "place these on A405" ambiguous, and the
    // wrong one gets the views.
    if (clash) return fail(`Sheet ${number} already exists ("${clash.name ?? clash.id}").`, { affected: 0, data: { existingId: clash.id } });

    return ok(`Creating sheet ${number} — ${a.name}.`, {
      commands: [{
        name: "add",
        args: {
          category: "sheet", at: { x: 0, y: 0 }, name: `${number} - ${a.name}`,
          params: { number, sheetName: String(a.name), widthMm: Number(a.width ?? 841), heightMm: Number(a.height ?? 594) },
        },
      }],
      affected: 1,
      assumptions: a.width === undefined ? ["Sheet size A1 (841 × 594 mm)."] : [],
      data: { number, name: a.name },
    });
  },
};

const placeViewsOnSheet: Tool = {
  name: "place_views_on_sheet",
  label: "Place Views On a Sheet",
  module: "Sheets",
  scope: "global",
  kind: "write",
  description:
    'Lay views out on a sheet in a grid — "place all the Section views with \'Existing to New\' in their name onto A405, in 4 columns, 1.5in from the left and 6in from the right".',
  keywords: ["place", "sheet", "layout", "columns", "arrange", "viewport", "put", "onto", "spacing", "margin"],
  params: [
    { name: "sheet", type: "string", description: "Sheet number or name", required: true },
    { name: "views", type: "selector", description: "Selector for the views to place, e.g. {category:'view', name:{op:'contains', value:'Existing to New'}}", required: true },
    { name: "columns", type: "number", description: "How many columns", default: 4 },
    { name: "marginLeftMm", type: "number", description: "Margin from the left, in millimetres", default: 38.1 },
    { name: "marginRightMm", type: "number", description: "Margin from the right, in millimetres", default: 152.4 },
    { name: "rowGapMm", type: "number", description: "Vertical gap between rows", default: 40 },
  ],
  run: (ctx: ToolContext, a) => {
    const sheetRef = String(a.sheet);
    const sheet =
      query(ctx.doc, { category: "sheet" }).find((s) => String(s.params?.number ?? "").toLowerCase() === sheetRef.toLowerCase()) ??
      resolve(ctx.doc, sheetRef, { category: "sheet" })[0];
    if (!sheet) {
      const have = query(ctx.doc, { category: "sheet" }).map((s) => s.params?.number ?? s.name).join(", ");
      return fail(`No sheet "${sheetRef}". This project has: ${have || "none"}.`, { affected: 0 });
    }

    const views = query(ctx.doc, { category: "view", ...(a.views as Selector) });
    if (!views.length) return fail(`No views match ${explain(a.views as Selector)}.`, { affected: 0 });

    const cols = Math.max(1, Math.floor(Number(a.columns ?? 4)));
    const left = Number(a.marginLeftMm ?? 38.1);
    const right = Number(a.marginRightMm ?? 152.4);
    const gap = Number(a.rowGapMm ?? 40);
    const sheetW = Number(sheet.params?.widthMm ?? 841);
    const sheetH = Number(sheet.params?.heightMm ?? 594);

    const usable = sheetW - left - right;
    if (usable <= 0) {
      return fail(`Those margins leave no room: ${left} + ${right} mm on a ${sheetW} mm sheet.`, { affected: 0 });
    }

    // Evenly spaced across the usable width — column centres, so a viewport sits
    // in the middle of its column rather than hard against the left margin.
    const colWidth = usable / cols;
    const rows = Math.ceil(views.length / cols);
    const rowHeight = Math.max(1, (sheetH - gap) / Math.max(1, rows));

    const commands: Command[] = views.map((v, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return {
        name: "add" as const,
        args: {
          category: "viewport",
          at: { x: 0, y: 0 },
          name: `${sheet.params?.number ?? sheet.name} · ${v.name ?? v.id}`,
          params: {
            sheet: sheet.id,
            view: v.id,
            xMm: left + colWidth * c + colWidth / 2,
            yMm: sheetH - gap - rowHeight * r - rowHeight / 2,
            column: c + 1,
            row: r + 1,
          },
        },
      };
    });

    const assumptions: string[] = [];
    if (a.columns === undefined) assumptions.push("Laid out in 4 columns.");
    if (a.marginLeftMm === undefined || a.marginRightMm === undefined) {
      assumptions.push(`Margins ${left} mm left, ${right} mm right.`);
    }

    return ok(`Placing ${views.length} view(s) on ${sheet.params?.number ?? sheet.name} in ${cols} column(s).`, {
      commands,
      affected: views.length,
      assumptions,
      data: { sheet: sheet.params?.number ?? sheet.name, placed: views.length, columns: cols, rows, usableWidthMm: usable },
    });
  },
};

const alignViewports: Tool = {
  name: "align_viewports",
  label: "Align Viewports By Datum",
  module: "Sheets",
  scope: "global",
  kind: "write",
  description:
    'Line viewports up on a sheet — "the viewports are misaligned, align them by a common datum; L3 is common to all of them". Aligns on one axis and leaves the other alone.',
  keywords: ["align", "viewport", "datum", "misaligned", "line up", "straighten", "common", "level", "grid"],
  params: [
    { name: "sheet", type: "string", description: "Sheet number or name", required: true },
    { name: "axis", type: "enum", description: "Which axis to align on", options: ["x", "y"], default: "y" },
    { name: "datum", type: "string", description: 'What they share, e.g. "L3". Recorded on each viewport for the next person.' },
    { name: "to", type: "enum", description: "Where to align", options: ["first", "min", "max", "average"], default: "first" },
  ],
  run: (ctx: ToolContext, a) => {
    const sheetRef = String(a.sheet);
    const sheet =
      query(ctx.doc, { category: "sheet" }).find((s) => String(s.params?.number ?? "").toLowerCase() === sheetRef.toLowerCase()) ??
      resolve(ctx.doc, sheetRef, { category: "sheet" })[0];
    if (!sheet) return fail(`No sheet "${sheetRef}".`, { affected: 0 });

    const vps = query(ctx.doc, { category: "viewport" }).filter((v) => v.params?.sheet === sheet.id);
    if (vps.length < 2) return fail(`${vps.length} viewport(s) on that sheet — at least two are needed to align.`, { affected: 0 });

    // Aligning on y means every viewport shares a vertical position, which is
    // what makes a row of plans read against a common level line.
    const axis = (a.axis ?? "y") === "x" ? "xMm" : "yMm";
    const values = vps.map((v) => Number(v.params?.[axis] ?? 0));
    const mode = String(a.to ?? "first");
    const target =
      mode === "min" ? Math.min(...values)
      : mode === "max" ? Math.max(...values)
      : mode === "average" ? values.reduce((s, n) => s + n, 0) / values.length
      : values[0];

    const moving = vps.filter((v) => Math.abs(Number(v.params?.[axis] ?? 0) - target) > 1e-6);
    if (!moving.length) {
      return ok(`Those ${vps.length} viewports are already aligned.`, { affected: 0, data: { alreadyAligned: true, target } });
    }

    const commands: Command[] = moving.flatMap((v) => {
      const cmds: Command[] = [{ name: "set_param", args: { id: v.id, key: axis, value: Number(target.toFixed(3)) } }];
      // The datum is recorded, not just applied. Six months on, "why is this row
      // at 412mm" is answerable.
      if (a.datum) cmds.push({ name: "set_param", args: { id: v.id, key: "datum", value: String(a.datum) } });
      return cmds;
    });

    return ok(`Aligning ${moving.length} of ${vps.length} viewport(s) on ${sheet.params?.number ?? sheet.name}.`, {
      commands,
      affected: moving.length,
      assumptions: [
        `Aligned on the ${a.axis ?? "y"} axis to the ${mode} value (${target.toFixed(1)} mm); the other axis is untouched.`,
        ...(a.datum ? [] : ["No datum named — the alignment is recorded but not what it was aligned to."]),
      ],
      data: { sheet: sheet.params?.number ?? sheet.name, aligned: moving.length, of: vps.length, axis: a.axis ?? "y", target },
    });
  },
};

const sheetContents: Tool = {
  name: "sheet_contents",
  label: "What Is On a Sheet",
  module: "Sheets",
  scope: "global",
  kind: "read",
  description: "The viewports on a sheet, with their positions — use before aligning or re-laying-out.",
  keywords: ["sheet", "contents", "what", "viewport", "on", "layout", "check"],
  params: [{ name: "sheet", type: "string", description: "Sheet number or name", required: true }],
  run: (ctx: ToolContext, a) => {
    const ref = String(a.sheet);
    const sheet =
      query(ctx.doc, { category: "sheet" }).find((s) => String(s.params?.number ?? "").toLowerCase() === ref.toLowerCase()) ??
      resolve(ctx.doc, ref, { category: "sheet" })[0];
    if (!sheet) return fail(`No sheet "${ref}".`, { data: { viewports: [] } });

    const vps = query(ctx.doc, { category: "viewport" }).filter((v) => v.params?.sheet === sheet.id);
    return ok(`${vps.length} viewport(s) on ${sheet.params?.number ?? sheet.name}.`, {
      data: {
        sheet: { id: sheet.id, number: sheet.params?.number, name: sheet.name, widthMm: sheet.params?.widthMm, heightMm: sheet.params?.heightMm },
        viewports: vps.map((v) => ({ id: v.id, view: v.params?.view, xMm: v.params?.xMm, yMm: v.params?.yMm, datum: v.params?.datum ?? null })),
      },
    });
  },
};

export const DOCUMENTATION_TOOLS: Tool[] = [
  listViews,
  createViewsForElements,
  createAreaPlan,
  createSheet,
  placeViewsOnSheet,
  alignViewports,
  sheetContents,
];

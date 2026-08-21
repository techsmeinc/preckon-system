/**
 * Drafting commands for the issued-drawing editor.
 *
 * tools.ts could draw a line and delete a region. It could not offset a wall by
 * 100mm, which is the most-used command in any CAD package — so a draughtsman
 * asked to do real work exported the file and opened it somewhere else.
 *
 * These are the standard set: offset, mirror, array, fillet, chamfer, trim,
 * extend, divide, dimension. All the geometry lives in drafting.ts, tested
 * against numbers checkable on paper; this file is the thin layer that turns an
 * intent into those calls and emits CadOps.
 *
 * ── EVERY TOOL REFUSES RATHER THAN GUESSES ───────────────────────────────────
 *
 * A fillet radius that will not fit, an extend to a boundary that is not there,
 * a trim where nothing crosses — each returns a failure that says which. The
 * alternative is geometry that renders, looks approximately right and is wrong,
 * which on an issued drawing is worse than a command that did nothing.
 */

import type { CadOp } from "./agent";
import type { DxfModel, Entity } from "./model";
import type { Tool, ToolContext, ToolResult } from "../bim/registry";
import {
  offsetPolyline, offsetSegment, mirrorPoints, rotatePoints, scalePoints,
  rectangularArray, polarArray, fillet as filletGeom, chamfer as chamferGeom,
  extendToBoundary, trimAtBoundary, divideSegment, measureAlong, linearDimension,
  type Pt, type Seg,
} from "./drafting";

export type CadTool = Tool<DxfModel, CadOp>;
type Ctx = ToolContext<DxfModel>;

const ok = (summary: string, extra: Partial<ToolResult<CadOp>> = {}): ToolResult<CadOp> => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Partial<ToolResult<CadOp>> = {}): ToolResult<CadOp> => ({ ok: false, summary, ...extra });

/** Drafting output lands here unless told otherwise, leaving issued layers alone. */
const DRAFT_LAYER = "AL-DRAFT";

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const segOf = (a: Record<string, any>, p = ""): Seg => ({
  a: { x: num(a[`${p}x1`]), y: num(a[`${p}y1`]) },
  b: { x: num(a[`${p}x2`]), y: num(a[`${p}y2`]) },
});

const asLine = (layer: string, s: Seg): CadOp =>
  ({ op: "add_line", layer, x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y });

const asPoly = (layer: string, pts: Pt[], closed = false): CadOp =>
  ({ op: "add_poly", layer, pts, closed });

const layerParam = { name: "layer", type: "string" as const, description: "Layer to draw on", default: DRAFT_LAYER };
const pointParams = (p = "", label = "") => [
  { name: `${p}x1`, type: "number" as const, description: `${label}Start X`, required: true },
  { name: `${p}y1`, type: "number" as const, description: `${label}Start Y`, required: true },
  { name: `${p}x2`, type: "number" as const, description: `${label}End X`, required: true },
  { name: `${p}y2`, type: "number" as const, description: `${label}End Y`, required: true },
];

/** Entities on a layer, as point lists geometry can work on. */
function pointsOfEntity(e: Entity): Pt[] {
  if (e.kind === "line") return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.kind === "poly") return e.pts.map((p) => ({ x: p.x, y: p.y }));
  return [{ x: (e as any).x, y: (e as any).y }];
}

const layerEntities = (ctx: Ctx, layer: string): Entity[] =>
  ctx.doc.entities.filter((e) => e.layer.toLowerCase() === String(layer).toLowerCase());

// ── Module: Drafting ─────────────────────────────────────────────────────────

const offsetLine: CadTool = {
  name: "offset_line",
  label: "Offset a Line",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Draw a parallel copy of a line at a given distance. A positive distance offsets to the left of the direction the line runs; negative goes right.",
  keywords: ["offset", "parallel", "copy", "cavity", "skin", "wall", "duplicate"],
  params: [
    ...pointParams(),
    { name: "distance", type: "number", description: "Offset distance; positive is left of the direction of travel", required: true },
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const s = segOf(a);
    const d = num(a.distance);
    if (d === 0) return fail("An offset of zero would draw the line on top of itself.");
    const o = offsetSegment(s, d);
    if (!o) return fail("That line has no length, so it has no direction to offset from.");
    return ok(`Offsetting ${Math.abs(d)} to the ${d > 0 ? "left" : "right"} of the line.`, {
      commands: [asLine(String(a.layer ?? DRAFT_LAYER), o)],
      affected: 1,
      assumptions: a.layer === undefined ? [`Drawn on ${DRAFT_LAYER}, leaving the issued layers untouched.`] : [],
    });
  },
};

const offsetLayer: CadTool = {
  name: "offset_layer",
  label: "Offset a Whole Layer",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Offset every line and polyline on a layer by the same distance — the fast way to draw the inner skin of a wall layer. Corners are mitred so the result closes properly.",
  keywords: ["offset", "layer", "skin", "cavity", "inner", "outer", "parallel"],
  params: [
    { name: "source_layer", type: "string", description: "Layer to offset", required: true },
    { name: "distance", type: "number", description: "Offset distance; positive is left of each line's direction", required: true },
    { name: "layer", type: "string", description: "Layer to draw the result on", default: DRAFT_LAYER },
  ],
  run: (ctx: Ctx, a) => {
    const src = String(a.source_layer);
    const d = num(a.distance);
    if (d === 0) return fail("An offset of zero would draw over the original.");

    const ents = layerEntities(ctx, src).filter((e) => e.kind === "line" || e.kind === "poly");
    if (!ents.length) return fail(`No lines or polylines on layer "${src}".`, { affected: 0 });

    const target = String(a.layer ?? DRAFT_LAYER);
    const commands: CadOp[] = [];
    for (const e of ents) {
      const pts = pointsOfEntity(e);
      if (e.kind === "line") {
        const o = offsetSegment({ a: pts[0], b: pts[1] }, d);
        if (o) commands.push(asLine(target, o));
      } else {
        const closed = !!(e as any).closed;
        const o = offsetPolyline(pts, d, closed);
        if (o.length >= 2) commands.push(asPoly(target, o, closed));
      }
    }
    if (!commands.length) return fail("Nothing on that layer could be offset — every entity was zero-length.", { affected: 0 });

    return ok(`Offsetting ${commands.length} entit${commands.length === 1 ? "y" : "ies"} from "${src}" by ${Math.abs(d)}.`, {
      commands, affected: commands.length,
      data: { source: src, target, offset: d, entities: commands.length },
    });
  },
};

const mirrorLayer: CadTool = {
  name: "mirror_layer",
  label: "Mirror a Layer",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Reflect every entity on a layer across an axis line — for a handed unit, or the other half of a symmetrical plan.",
  keywords: ["mirror", "reflect", "flip", "handed", "symmetrical", "opposite"],
  params: [
    { name: "source_layer", type: "string", description: "Layer to mirror", required: true },
    ...pointParams("", "Axis "),
    layerParam,
  ],
  run: (ctx: Ctx, a) => {
    const src = String(a.source_layer);
    const axis = segOf(a);
    if (axis.a.x === axis.b.x && axis.a.y === axis.b.y) {
      return fail("The mirror axis needs two different points — a single point does not define a line to reflect across.");
    }
    const ents = layerEntities(ctx, src).filter((e) => e.kind === "line" || e.kind === "poly");
    if (!ents.length) return fail(`No lines or polylines on layer "${src}".`, { affected: 0 });

    const target = String(a.layer ?? DRAFT_LAYER);
    const commands: CadOp[] = ents.map((e) => {
      const m = mirrorPoints(pointsOfEntity(e), axis);
      return e.kind === "line"
        ? asLine(target, { a: m[0], b: m[1] })
        : asPoly(target, m, !!(e as any).closed);
    });
    return ok(`Mirroring ${commands.length} entit${commands.length === 1 ? "y" : "ies"} from "${src}".`, {
      commands, affected: commands.length,
    });
  },
};

const arrayLayer: CadTool = {
  name: "array_layer",
  label: "Array a Layer",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Repeat everything on a layer in a rectangular grid — columns on a gridline, piles in a cap, joists across a bay. The count includes the original.",
  keywords: ["array", "repeat", "grid", "copy", "pattern", "columns", "bays", "joists"],
  params: [
    { name: "source_layer", type: "string", description: "Layer to repeat", required: true },
    { name: "cols", type: "number", description: "Columns, including the original", required: true },
    { name: "rows", type: "number", description: "Rows, including the original", default: 1 },
    { name: "dx", type: "number", description: "Spacing between columns", default: 0 },
    { name: "dy", type: "number", description: "Spacing between rows", default: 0 },
    layerParam,
  ],
  run: (ctx: Ctx, a) => {
    const src = String(a.source_layer);
    const cols = Math.max(1, Math.floor(num(a.cols, 1)));
    const rows = Math.max(1, Math.floor(num(a.rows, 1)));
    if (cols * rows <= 1) return fail("An array of one is the original. Give a count greater than one.");
    if (num(a.dx) === 0 && num(a.dy) === 0) {
      return fail("Both spacings are zero, so every copy would land on the original.");
    }

    const ents = layerEntities(ctx, src);
    if (!ents.length) return fail(`Nothing on layer "${src}".`, { affected: 0 });

    const target = String(a.layer ?? DRAFT_LAYER);
    const commands: CadOp[] = [];
    for (const e of ents) {
      if (e.kind !== "line" && e.kind !== "poly") continue;
      const copies = rectangularArray(pointsOfEntity(e), { cols, rows, dx: num(a.dx), dy: num(a.dy) });
      // Skip index 0: the original is already on the drawing.
      for (const c of copies.slice(1)) {
        commands.push(e.kind === "line" ? asLine(target, { a: c[0], b: c[1] }) : asPoly(target, c, !!(e as any).closed));
      }
    }
    if (!commands.length) return fail("Nothing on that layer could be arrayed.", { affected: 0 });
    return ok(`Arraying ${ents.length} entit${ents.length === 1 ? "y" : "ies"} into a ${cols}×${rows} grid — ${commands.length} new entit${commands.length === 1 ? "y" : "ies"}.`, {
      commands, affected: commands.length,
    });
  },
};

const polarArrayLayer: CadTool = {
  name: "polar_array_layer",
  label: "Polar Array a Layer",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Repeat a layer around a centre point — bolts on a flange, radial members, a curved façade. Items rotate with the array unless told to stay upright.",
  keywords: ["polar", "radial", "circular", "array", "around", "rotate", "bolts", "circle"],
  params: [
    { name: "source_layer", type: "string", description: "Layer to repeat", required: true },
    { name: "cx", type: "number", description: "Centre X", required: true },
    { name: "cy", type: "number", description: "Centre Y", required: true },
    { name: "count", type: "number", description: "Copies, including the original", required: true },
    { name: "total_angle", type: "number", description: "Sweep in degrees", default: 360 },
    { name: "keep_upright", type: "boolean", description: "Move copies without rotating them — for text and symbols", default: false },
    layerParam,
  ],
  run: (ctx: Ctx, a) => {
    const src = String(a.source_layer);
    const count = Math.max(1, Math.floor(num(a.count, 1)));
    if (count <= 1) return fail("A polar array of one is the original.");

    const ents = layerEntities(ctx, src).filter((e) => e.kind === "line" || e.kind === "poly");
    if (!ents.length) return fail(`No lines or polylines on layer "${src}".`, { affected: 0 });

    const target = String(a.layer ?? DRAFT_LAYER);
    const centre = { x: num(a.cx), y: num(a.cy) };
    const commands: CadOp[] = [];
    for (const e of ents) {
      const copies = polarArray(pointsOfEntity(e), {
        centre, count,
        totalAngleDeg: num(a.total_angle, 360),
        rotateItems: a.keep_upright !== true,
      });
      for (const c of copies.slice(1)) {
        commands.push(e.kind === "line" ? asLine(target, { a: c[0], b: c[1] }) : asPoly(target, c, !!(e as any).closed));
      }
    }
    return ok(`Arraying ${ents.length} entit${ents.length === 1 ? "y" : "ies"} ${count} times around (${centre.x}, ${centre.y}).`, {
      commands, affected: commands.length,
    });
  },
};

const transformLayer: CadTool = {
  name: "transform_layer",
  label: "Rotate or Scale a Layer",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Rotate and/or scale everything on a layer about a base point. Scaling about a base point leaves that point where it is, which is why the command asks for one.",
  keywords: ["rotate", "scale", "resize", "turn", "spin", "enlarge", "shrink", "transform"],
  params: [
    { name: "source_layer", type: "string", description: "Layer to transform", required: true },
    { name: "cx", type: "number", description: "Base point X", required: true },
    { name: "cy", type: "number", description: "Base point Y", required: true },
    { name: "rotate_deg", type: "number", description: "Rotation in degrees, anticlockwise", default: 0 },
    { name: "scale", type: "number", description: "Scale factor; 1 leaves the size alone", default: 1 },
    layerParam,
  ],
  run: (ctx: Ctx, a) => {
    const src = String(a.source_layer);
    const rotateDeg = num(a.rotate_deg, 0);
    const factor = num(a.scale, 1);
    if (rotateDeg === 0 && factor === 1) return fail("No rotation and a scale of 1 would change nothing.");
    if (factor <= 0) return fail("A scale factor must be greater than zero.");

    const ents = layerEntities(ctx, src).filter((e) => e.kind === "line" || e.kind === "poly");
    if (!ents.length) return fail(`No lines or polylines on layer "${src}".`, { affected: 0 });

    const target = String(a.layer ?? DRAFT_LAYER);
    const centre = { x: num(a.cx), y: num(a.cy) };
    const commands: CadOp[] = ents.map((e) => {
      let pts = pointsOfEntity(e);
      if (rotateDeg !== 0) pts = rotatePoints(pts, centre, rotateDeg);
      if (factor !== 1) pts = scalePoints(pts, centre, factor);
      return e.kind === "line"
        ? asLine(target, { a: pts[0], b: pts[1] })
        : asPoly(target, pts, !!(e as any).closed);
    });

    const what = [rotateDeg !== 0 ? `rotated ${rotateDeg}°` : null, factor !== 1 ? `scaled ×${factor}` : null]
      .filter(Boolean).join(" and ");
    return ok(`${commands.length} entit${commands.length === 1 ? "y" : "ies"} ${what} about (${centre.x}, ${centre.y}).`, {
      commands, affected: commands.length,
    });
  },
};

const filletCorner: CadTool = {
  name: "fillet_corner",
  label: "Fillet a Corner",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Round the corner where two lines meet, with an arc tangent to both and inside the corner. Refuses a radius too big for the legs rather than drawing an arc that overruns them.",
  keywords: ["fillet", "round", "radius", "corner", "curve", "arc", "soften"],
  params: [
    ...pointParams("a", "First line "),
    ...pointParams("b", "Second line "),
    { name: "radius", type: "number", description: "Fillet radius", required: true },
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const first = segOf(a, "a");
    const second = segOf(a, "b");
    const radius = num(a.radius);
    const f = filletGeom(first, second, radius);
    if (!f) {
      return fail(
        radius <= 0
          ? "A fillet radius must be greater than zero."
          : "That fillet will not fit: the two lines either do not share a corner, are in line with each other, or are shorter than the radius needs. An arc longer than its own legs is valid geometry and visible nonsense.",
      );
    }
    const layer = String(a.layer ?? DRAFT_LAYER);
    return ok(`Filleting the corner at radius ${radius}.`, {
      commands: [asLine(layer, f.first), asLine(layer, f.second), asPoly(layer, f.arc)],
      affected: 3,
      data: { centre: f.centre, radius: f.radius },
    });
  },
};

const chamferCorner: CadTool = {
  name: "chamfer_corner",
  label: "Chamfer a Corner",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Cut the corner where two lines meet with a straight splay. Distances can differ on each leg for an unequal chamfer.",
  keywords: ["chamfer", "splay", "cut", "corner", "bevel", "angle"],
  params: [
    ...pointParams("a", "First line "),
    ...pointParams("b", "Second line "),
    { name: "d1", type: "number", description: "Distance back along the first line", required: true },
    { name: "d2", type: "number", description: "Distance back along the second line; defaults to d1" },
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const d1 = num(a.d1);
    const d2 = a.d2 === undefined ? d1 : num(a.d2);
    const c = chamferGeom(segOf(a, "a"), segOf(a, "b"), d1, d2);
    if (!c) return fail("That chamfer will not fit: the lines do not share a corner, or a distance is longer than its leg.");
    const layer = String(a.layer ?? DRAFT_LAYER);
    return ok(`Chamfering the corner ${d1}${d2 !== d1 ? ` × ${d2}` : ""}.`, {
      commands: [asLine(layer, c.first), asLine(layer, c.second), asLine(layer, c.cut)],
      affected: 3,
    });
  },
};

const extendLine: CadTool = {
  name: "extend_line",
  label: "Extend a Line to Meet Another",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Carry a line forward until it meets a boundary line. Only extends the end nearer the boundary, so a line is never silently doubled in length.",
  keywords: ["extend", "lengthen", "stretch", "meet", "join", "continue", "boundary"],
  params: [
    ...pointParams("a", "Line to extend: "),
    ...pointParams("b", "Boundary: "),
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const e = extendToBoundary(segOf(a, "a"), segOf(a, "b"));
    if (!e) {
      return fail("Nothing to extend: the lines are parallel, the line already crosses the boundary, or the meeting point falls off the end of the boundary. Extending to a point the boundary does not reach would meet something that is not drawn.");
    }
    return ok(`Extending the line to meet the boundary at (${e.b.x}, ${e.b.y}).`, {
      commands: [asLine(String(a.layer ?? DRAFT_LAYER), e)],
      affected: 1,
    });
  },
};

const trimLine: CadTool = {
  name: "trim_line",
  label: "Trim a Line at a Boundary",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Cut a line where it crosses another and keep the piece nearest a pick point. The pick point is what decides which piece survives.",
  keywords: ["trim", "cut", "shorten", "clip", "break", "split"],
  params: [
    ...pointParams("a", "Line to trim: "),
    ...pointParams("b", "Boundary: "),
    { name: "keep_x", type: "number", description: "Pick point X — the side to keep", required: true },
    { name: "keep_y", type: "number", description: "Pick point Y — the side to keep", required: true },
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const kept = trimAtBoundary(segOf(a, "a"), segOf(a, "b"), { x: num(a.keep_x), y: num(a.keep_y) });
    if (!kept) return fail("Nothing to trim: the lines do not cross, or they meet exactly at an end so one piece would have no length.");
    return ok(`Trimming the line, keeping the piece from (${kept.a.x}, ${kept.a.y}) to (${kept.b.x}, ${kept.b.y}).`, {
      commands: [asLine(String(a.layer ?? DRAFT_LAYER), kept)],
      affected: 1,
      assumptions: ["The original line is left in place — delete it once the trimmed piece is right."],
    });
  },
};

const setOutPoints: CadTool = {
  name: "set_out_points",
  label: "Set Out Points Along a Line",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Mark points along a line, either by dividing it into equal parts or at a fixed spacing — joist centres, pile positions, balusters.",
  keywords: ["divide", "measure", "set out", "setting out", "spacing", "centres", "points", "stations"],
  params: [
    ...pointParams(),
    { name: "parts", type: "number", description: "Divide into this many equal parts" },
    { name: "spacing", type: "number", description: "Or place a point every this far from the start" },
    { name: "size", type: "number", description: "Size of each cross mark", default: 100 },
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const s = segOf(a);
    const parts = a.parts === undefined ? null : Math.floor(num(a.parts));
    const spacing = a.spacing === undefined ? null : num(a.spacing);
    if (parts == null && spacing == null) return fail("Give either a number of parts or a spacing.");
    if (parts != null && spacing != null) {
      return fail("Give parts or spacing, not both — they would put points in different places and only one of them is what you meant.");
    }

    const pts = parts != null ? divideSegment(s, parts) : measureAlong(s, spacing!);
    if (!pts.length) {
      return fail(parts != null
        ? "Dividing into fewer than two parts produces no interior points."
        : "That spacing is longer than the line.");
    }

    const layer = String(a.layer ?? DRAFT_LAYER);
    const h = num(a.size, 100) / 2;
    const commands: CadOp[] = pts.flatMap((p) => [
      { op: "add_line", layer, x1: p.x - h, y1: p.y, x2: p.x + h, y2: p.y } as CadOp,
      { op: "add_line", layer, x1: p.x, y1: p.y - h, x2: p.x, y2: p.y + h } as CadOp,
    ]);
    return ok(`Setting out ${pts.length} point(s) along the line.`, {
      commands, affected: pts.length,
      data: { points: pts },
    });
  },
};

const dimension: CadTool = {
  name: "add_dimension",
  label: "Add a Linear Dimension",
  module: "Drafting",
  scope: "global",
  kind: "write",
  description: "Dimension the distance between two points. The text always reads the measured distance — it cannot be typed, because a dimension that disagrees with its own geometry is the worst thing on a drawing.",
  keywords: ["dimension", "dim", "measure", "annotate", "distance", "size", "label"],
  params: [
    ...pointParams(),
    { name: "offset", type: "number", description: "How far off the measured line to place the dimension; positive is to the left", default: 500 },
    { name: "precision", type: "number", description: "Decimal places", default: 0 },
    { name: "unit_suffix", type: "string", description: "Text appended to the figure, e.g. ' mm'", default: "" },
    layerParam,
  ],
  run: (_ctx: Ctx, a) => {
    const d = linearDimension(
      { x: num(a.x1), y: num(a.y1) }, { x: num(a.x2), y: num(a.y2) },
      { offset: num(a.offset, 500), precision: Math.max(0, Math.floor(num(a.precision, 0))), unitSuffix: String(a.unit_suffix ?? "") },
    );
    if (!d) return fail("Those two points are the same, so there is no distance to dimension.");

    const layer = String(a.layer ?? DRAFT_LAYER);
    const commands: CadOp[] = [
      ...d.extensions.map((s) => asLine(layer, s)),
      asLine(layer, d.line),
      ...d.ticks.map((s) => asLine(layer, s)),
      { op: "add_text", layer, text: d.text, x: d.textAt.x, y: d.textAt.y, h: Math.max(1, Math.abs(num(a.offset, 500)) * 0.25) },
    ];
    return ok(`Dimensioning ${d.text}.`, {
      commands, affected: commands.length,
      data: { value: d.value, text: d.text },
      assumptions: ["The text reads the measured distance and cannot be overridden."],
    });
  },
};

/**
 * The drafting set, for registering alongside CAD_TOOLS.
 *
 * Kept as its own array rather than appended to CAD_TOOLS so the two stay
 * separable: the original set is about reading and marking up an issued sheet,
 * and this one is about drawing on it. A deployment that wants markup without
 * drafting can register one and not the other.
 */
export const DRAFTING_TOOLS: CadTool[] = [
  offsetLine,
  offsetLayer,
  mirrorLayer,
  arrayLayer,
  polarArrayLayer,
  transformLayer,
  filletCorner,
  chamferCorner,
  extendLine,
  trimLine,
  setOutPoints,
  dimension,
];

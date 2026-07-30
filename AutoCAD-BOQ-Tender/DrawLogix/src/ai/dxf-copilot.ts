import Anthropic from "@anthropic-ai/sdk";
import type { EditOp, ModelSummary } from "@/domain/dxf-model";
import { MODEL } from "./model";

/**
 * DXF edit copilot — Claude turns a natural-language instruction into a list of
 * structured edit operations against a drawing. The geometry stays on the caller; we
 * send a SUMMARY (layers, text labels, extents, and a spatially-tagged entity list) and
 * get back operations the caller applies deterministically. The copilot can ADD any
 * geometry (lines, polylines, arcs, circles, rectangles, text, dimensions) and REMOVE
 * anything (a layer, matching text, everything inside a region, or the whole drawing).
 */

export type { ModelSummary };

const APPLY_EDITS: Anthropic.Tool = {
  name: "apply_edits",
  description: "Apply a list of edit operations to the drawing and reply to the user. You can add ANY geometry and remove ANYTHING.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "One short sentence describing what you changed (or why you couldn't)." },
      operations: {
        type: "array",
        description: "The edits to apply, in order.",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "rename_layer", "set_layer_color", "hide_layer", "show_layer",
                "add_text", "add_rectangle", "add_line", "add_polyline", "add_circle", "add_arc", "add_dimension",
                "replace_text", "move", "scale",
                "delete_layer", "delete_text", "delete_region", "clear_all",
              ],
              description:
                "ADD: add_text, add_rectangle{x,y,w,h}, add_line{x,y,x2,y2}, add_polyline{points,closed?} (ANY shape), add_circle{x,y,r}, add_arc{x,y,r,a1,a2} (deg), add_dimension{x,y,x2,y2} (linear dim). REMOVE: delete_layer{layer}, delete_text{find}, delete_region{x,y,x2,y2} (everything inside a box), clear_all (wipe drawing). MODIFY: rename_layer, set_layer_color, hide_layer, show_layer, replace_text, move{dx,dy}, scale{factor}.",
            },
            from: { type: "string" },
            to: { type: "string" },
            layer: { type: "string" },
            color: { type: "string", description: "colour name (red, blue, green, cyan, yellow, magenta, white, gray) or ACI number" },
            find: { type: "string" },
            replace: { type: "string" },
            text: { type: "string" },
            x: { type: "number", description: "x of the start/insert/centre/first-corner point (drawing units)" },
            y: { type: "number", description: "y of the start/insert/centre/first-corner point" },
            x2: { type: "number", description: "second-point x (add_line / add_dimension / delete_region opposite corner)" },
            y2: { type: "number", description: "second-point y" },
            r: { type: "number", description: "radius for add_circle / add_arc" },
            a1: { type: "number", description: "arc start angle in degrees (add_arc)" },
            a2: { type: "number", description: "arc end angle in degrees (add_arc)" },
            points: {
              type: "array",
              description: "vertices for add_polyline (drawing units)",
              items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            },
            closed: { type: "boolean", description: "close the polyline (add_polyline)" },
            w: { type: "number" },
            h: { type: "number" },
            dx: { type: "number" },
            dy: { type: "number" },
            factor: { type: "number" },
          },
          required: ["op"],
        },
      },
    },
    required: ["reply", "operations"],
  },
};

/** Parse a `data:image/…;base64,…` URL into an Anthropic image content block. */
function imageBlock(dataUrl: string): Anthropic.ImageBlockParam | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/i);
  if (!m) return null;
  const mediaType = (m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase()) as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";
  return { type: "image", source: { type: "base64", media_type: mediaType, data: m[2] } };
}

export async function editDxf(
  summary: ModelSummary,
  instruction: string,
  attachments: string[] = [],
): Promise<{ reply: string; operations: EditOp[] }> {
  const client = new Anthropic();
  const unitNote = summary.insunits === 4 ? " (millimetres)" : summary.insunits === 6 ? " (metres)" : "";
  const ents = (summary.entities ?? [])
    .slice(0, 160)
    .map((e) => `- ${e.kind}${e.text ? ` "${e.text}"` : ""} on ${e.layer} @ (${e.cx.toFixed(1)}, ${e.cy.toFixed(1)}) size ${e.w.toFixed(1)}×${e.h.toFixed(1)}`)
    .join("\n");
  const system = `You are a professional CAD copilot editing a construction drawing. You can ADD anything and REMOVE anything. Apply the user's instruction by returning operations via apply_edits.

ADD geometry: add_line{x,y,x2,y2,layer?}, add_polyline{points:[{x,y}…],closed?,layer?} (draw ANY shape/outline), add_rectangle{x,y,w,h,layer?,text?}, add_circle{x,y,r,layer?}, add_arc{x,y,r,a1,a2,layer?} (angles in degrees), add_text{text,x,y,layer?}, add_dimension{x,y,x2,y2} (a real linear dimension between two points).
REMOVE: delete_region{x,y,x2,y2} removes EVERYTHING whose position falls inside that box (use it to erase a specific object — read its centre from the entity list below); delete_layer{layer} removes a whole category; delete_text{find} removes a label by its text; clear_all wipes the drawing to start over.
MODIFY: rename_layer{from,to}, set_layer_color{layer,color}, hide_layer{layer}, show_layer{layer}, replace_text{find,replace}, move{dx,dy} (whole drawing), scale{factor}.

Rules:
- To DELETE a whole named object/room (e.g. "remove the store", "delete the shed"): find its label in the entity list, then find the OUTLINE entity near it — the poly on A-AREA / A-WALL whose extent (centre ± size/2) SURROUNDS that label — and issue delete_region covering that FULL extent plus a small pad. This removes the outline, its walls AND its labels together. Deleting only the label (delete_text) leaves the outline behind — always size the region to the object's listed size, not to the label. If several objects share a name (e.g. "store 1"), pick the one whose label text matches most closely.
- To ADD an object, place it inside or just outside the drawing extents and SIZE it to match the drawing units. Prefer AIA layers: A-WALL structures/walls, A-DOOR doors/gates, A-GLAZ glazing, A-ANNO labels, A-DIMS dimensions, A-GRID grid.
- Batch a multi-part request into several operations in one call, in a sensible order.
- Coordinates are drawing units; extents X ${summary.bounds.minX.toFixed(1)}..${summary.bounds.maxX.toFixed(1)}, Y ${summary.bounds.minY.toFixed(1)}..${summary.bounds.maxY.toFixed(1)}${unitNote}.

Layers: ${summary.layers.join(", ") || "(none)"}.
Entities in the drawing (kind, label, layer, centre) — use these positions to target deletions/edits:
${ents || "(none listed)"}

If the instruction genuinely can't be done, return an empty operations array and explain why in reply.`;

  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: instruction }];
  for (const a of attachments) {
    const block = imageBlock(a);
    if (block) content.push(block);
  }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 3072,
    system,
    tools: [APPLY_EDITS],
    tool_choice: { type: "tool", name: "apply_edits" },
    messages: [{ role: "user", content }],
  });

  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (tu?.input ?? {}) as { reply?: string; operations?: unknown[] };
  const operations = (Array.isArray(input.operations) ? input.operations : []).map(normalizeOp).filter((o): o is EditOp => Boolean(o));
  return { reply: String(input.reply ?? "Done."), operations };
}

function normalizeOp(o: unknown): EditOp | null {
  const r = o as Record<string, unknown>;
  if (!r.op) return null;
  const str = (v: unknown) => (v == null ? undefined : String(v));
  const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const pts = Array.isArray(r.points)
    ? (r.points as unknown[])
        .map((p) => {
          const q = p as Record<string, unknown>;
          const x = Number(q?.x);
          const y = Number(q?.y);
          return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        })
        .filter((p): p is { x: number; y: number } => Boolean(p))
    : undefined;
  return {
    op: String(r.op),
    from: str(r.from),
    to: str(r.to),
    layer: str(r.layer),
    color: str(r.color),
    find: str(r.find),
    replace: str(r.replace),
    text: str(r.text),
    x: n(r.x),
    y: n(r.y),
    x2: n(r.x2),
    y2: n(r.y2),
    r: n(r.r),
    a1: n(r.a1),
    a2: n(r.a2),
    w: n(r.w),
    h: n(r.h),
    dx: n(r.dx),
    dy: n(r.dy),
    factor: n(r.factor),
    points: pts,
    closed: typeof r.closed === "boolean" ? r.closed : undefined,
  };
}

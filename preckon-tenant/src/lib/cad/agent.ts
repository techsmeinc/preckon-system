// The drawing assistant — a tool loop over the sheet that is open on screen.
//
// Three things it can do, and they are deliberately separate:
//
//   ask     — measure and count, answering from the drawing's own geometry
//   edit    — add or delete linework, returned as operations Core applies
//   explain — mark the canvas with what it measured, so the working is visible
//
// The third is the one that matters. An assistant that says "the floor is
// 84 m²" is asking to be believed; one that puts a dot on the outline it
// measured and labels it is showing you where to disagree. Every measurement
// the agent quotes can be pinned to the geometry it came from, and the reply
// is required to cite the layer.
//
// The worker holds the API key and has no database. Core sends the digest and
// receives back an answer plus operations — the same trust boundary the BIM
// assistant runs on.

import type { Digest } from "./measure";

export type CadOp =
  | { op: "add_line"; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { op: "add_rect"; layer: string; x: number; y: number; w: number; h: number }
  | { op: "add_poly"; layer: string; pts: Array<{ x: number; y: number }>; closed?: boolean }
  | { op: "add_text"; layer: string; text: string; x: number; y: number; h?: number }
  | { op: "delete_layer"; layer: string }
  | { op: "delete_region"; x1: number; y1: number; x2: number; y2: number };

/** What the canvas draws to show the working. */
export type CadMark =
  | { kind: "dot"; x: number; y: number; label?: string }
  | { kind: "edge"; x1: number; y1: number; x2: number; y2: number; label?: string }
  | { kind: "area"; pts: Array<{ x: number; y: number }>; label?: string };

export interface CadAgentResult {
  answer: string;
  ops: CadOp[];
  marks: CadMark[];
  steps: number;
}

const MAX_STEPS = 4;

const SYSTEM = `You are a quantity surveyor reading a CAD drawing that is open in front of the user.

WHAT YOU ARE LOOKING AT
You are given a digest of the drawing's real geometry: every layer with its entity counts and linework totals, the largest closed outlines, the longest straight runs, and the text on the sheet. Those numbers are measured, not estimated. You have no other source.

HOW TO ANSWER
- Quote the layer every figure came from. "412 m of linework on A-WALL" is useful; "412 m of walls" is a claim the drawing does not support.
- A drawing records a line on a layer. It does not record that the line is a wall. Say what the layer is called and let the estimator decide.
- Layer linework totals DOUBLE-COUNT a wall drawn as two faces. Say so when you quote one as a wall length.
- The SUM of closed outlines on a layer is almost never a floor area — overlapping outlines, hatch boundaries and furniture all land in it. Use the LARGEST outline for a floor, and say which one.
- If the drawing does not declare its units, give figures in drawing units and say they cannot be converted.
- If the drawing cannot answer the question, say that plainly. Never estimate a number that is not in the digest.
- Be brief. Two or three sentences and a short list.

SHOWING YOUR WORKING
Whenever you quote a measurement, mark it on the canvas with the same tool call, so the user can see what you measured:
  {"kind":"area","pts":[...],"label":"Slab 84.05 m²"}       an outline you measured
  {"kind":"edge","x1":..,"y1":..,"x2":..,"y2":..,"label":"12.4 m"}  a run you measured
  {"kind":"dot","x":..,"y":..,"label":"Door ×7"}            something you counted
Use the coordinates given in the digest. Never invent geometry to mark.

EDITING
When the user asks you to add or remove something, emit operations:
  {"op":"add_line","layer":"A-WALL","x1":0,"y1":0,"x2":5000,"y2":0}
  {"op":"add_rect","layer":"A-FLOOR","x":0,"y":0,"w":5000,"h":4000}
  {"op":"add_poly","layer":"A-WALL","pts":[{"x":0,"y":0},{"x":5000,"y":0}],"closed":false}
  {"op":"add_text","layer":"NOTES","text":"REVISED","x":0,"y":0}
  {"op":"delete_layer","layer":"OLD-GRID"}
  {"op":"delete_region","x1":..,"y1":..,"x2":..,"y2":..}
Coordinates are DRAWING UNITS, in the drawing's own coordinate system — read the extents in the digest and place new work inside them. A wall drawn at the origin of a sheet whose linework sits at x=180000 is invisible.
Deleting is destructive and the user cannot see what will go until it has gone: name what you are about to delete in your answer, and never delete a layer you were not asked about.

SAYING IT IS NOT DOING IT
If your answer claims you added, copied, moved or removed anything, the matching operations MUST be in "ops" in the same call. An answer that describes an edit with an empty "ops" is a false report: the drawing is unchanged and the user has been told otherwise. If you cannot work out the coordinates, say so and emit nothing rather than describing work you did not do.

To copy something that already exists, ask for the layer's geometry with "need" first, read the real coordinates, then emit add_poly or add_rect with them. Do not estimate the position of a module you have not read.

Always call the tool exactly once. Put the prose in "answer".
NEVER write the tool call, its parameters or any JSON as ordinary text. If for any reason you cannot call the tool, reply in plain sentences with no markup and no coordinates.`;

const TOOL = {
  name: "respond",
  description: "Answer the question, mark the canvas with the working, and emit any edits.",
  input_schema: {
    type: "object",
    properties: {
      answer: { type: "string", description: "The reply, citing the layer behind every figure." },
      marks: {
        type: "array",
        description: "What to draw on the canvas to show the working.",
        items: { type: "object" },
      },
      ops: {
        type: "array",
        description: "Edits to apply to the drawing. Empty unless the user asked for a change.",
        items: { type: "object" },
      },
      need: {
        type: "string",
        description: "Set only when the digest cannot answer and you want the full geometry of one layer. Give the layer name.",
      },
    },
    required: ["answer"],
  },
} as const;

const KNOWN_OPS = new Set(["add_line", "add_rect", "add_poly", "add_text", "delete_layer", "delete_region"]);
const KNOWN_MARKS = new Set(["dot", "edge", "area"]);

/** Keep only what the model is allowed to emit, and only onto layers that make
 *  sense. An unrecognised op is dropped rather than half-applied. */
function sanitise(raw: any, digest: Digest): { ops: CadOp[]; marks: CadMark[] } {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ops: CadOp[] = [];
  for (const o of Array.isArray(raw?.ops) ? raw.ops : []) {
    if (!KNOWN_OPS.has(o?.op)) continue;
    const layer = typeof o.layer === "string" && o.layer.trim() ? o.layer.trim().slice(0, 64) : "MARKUP";
    if (o.op === "add_line" && [o.x1, o.y1, o.x2, o.y2].every((v: unknown) => num(v) !== null)) {
      ops.push({ op: "add_line", layer, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 });
    } else if (o.op === "add_rect" && [o.x, o.y, o.w, o.h].every((v: unknown) => num(v) !== null) && o.w !== 0 && o.h !== 0) {
      ops.push({ op: "add_rect", layer, x: o.x, y: o.y, w: o.w, h: o.h });
    } else if (o.op === "add_poly" && Array.isArray(o.pts) && o.pts.length >= 2) {
      const pts = o.pts.filter((p: any) => num(p?.x) !== null && num(p?.y) !== null).slice(0, 400);
      if (pts.length >= 2) ops.push({ op: "add_poly", layer, pts, closed: !!o.closed });
    } else if (o.op === "add_text" && typeof o.text === "string" && num(o.x) !== null && num(o.y) !== null) {
      ops.push({ op: "add_text", layer, text: o.text.slice(0, 200), x: o.x, y: o.y, h: num(o.h) ?? undefined });
    } else if (o.op === "delete_layer" && digest.layers.some((l) => l.layer === o.layer)) {
      ops.push({ op: "delete_layer", layer: o.layer });
    } else if (o.op === "delete_region" && [o.x1, o.y1, o.x2, o.y2].every((v: unknown) => num(v) !== null)) {
      ops.push({ op: "delete_region", x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 });
    }
  }

  const marks: CadMark[] = [];
  for (const m of Array.isArray(raw?.marks) ? raw.marks : []) {
    if (!KNOWN_MARKS.has(m?.kind)) continue;
    const label = typeof m.label === "string" ? m.label.slice(0, 80) : undefined;
    if (m.kind === "dot" && num(m.x) !== null && num(m.y) !== null) marks.push({ kind: "dot", x: m.x, y: m.y, label });
    else if (m.kind === "edge" && [m.x1, m.y1, m.x2, m.y2].every((v: unknown) => num(v) !== null)) {
      marks.push({ kind: "edge", x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, label });
    } else if (m.kind === "area" && Array.isArray(m.pts) && m.pts.length >= 3) {
      marks.push({ kind: "area", pts: m.pts.filter((p: any) => num(p?.x) !== null && num(p?.y) !== null).slice(0, 400), label });
    }
  }
  return { ops: ops.slice(0, 200), marks: marks.slice(0, 60) };
}


/**
 * Recover an answer from a model that wrote its tool call as prose.
 *
 * It happens: instead of a tool_use block the reply arrives as text containing
 * `<parameter name="marks">[{...}]</parameter>`, or a bare JSON object. Passing
 * that through put a wall of coordinates in front of the estimator where a
 * sentence should have been. So the text path salvages what it can — the
 * answer, and any marks or ops that came with it — and refuses to display the
 * scaffolding either way.
 */
export function recoverFromText(text: string): { answer: string; raw: any } {
  if (!text) return { answer: "", raw: null };
  let raw: any = null;

  // The whole reply as one JSON object.
  const whole = text.trim();
  if (whole.startsWith("{")) {
    try { raw = JSON.parse(whole); } catch { /* not clean JSON */ }
  }

  // XML-shaped tool syntax: pull each named parameter out, then delete it.
  let prose = text;
  if (!raw) {
    const params: Record<string, any> = {};
    const re = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?:<\/parameter>|$)/g;
    for (const m of text.matchAll(re)) {
      const body = m[2].trim();
      try { params[m[1]] = JSON.parse(body); } catch { params[m[1]] = body; }
    }
    if (Object.keys(params).length) raw = params;
    prose = text.replace(re, " ");
  }

  let answer = typeof raw?.answer === "string" ? raw.answer : prose;
  answer = answer
    .replace(/<\/?(?:function_calls|invoke|parameter|antml:[a-z_]+)[^>]*>/gi, " ")
    // A leading or trailing JSON blob is scaffolding, not an answer.
    .replace(/^\s*[[{][\s\S]*?[\]}]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { answer, raw };
}

export interface CadAgentArgs {
  question: string;
  digest: Digest;
  describe: string;
  /** Geometry of one layer, fetched when the agent asks for it. */
  layerGeometry: (layer: string) => string;
  model: string;
  callAnthropic: (req: { model: string; system: string; messages: any[]; tools: any[]; maxTokens: number }) => Promise<any>;
}

export async function runCadAgent({
  question, digest, describe, layerGeometry, model, callAnthropic,
}: CadAgentArgs): Promise<CadAgentResult> {
  const messages: any[] = [{
    role: "user",
    content: `QUESTION: ${question}\n\nTHE DRAWING AS MEASURED:\n${describe}`,
  }];

  let answer = "";
  let ops: CadOp[] = [];
  let marks: CadMark[] = [];
  let step = 0;

  for (; step < MAX_STEPS; step++) {
    const res = await callAnthropic({ model, system: SYSTEM, messages, tools: [TOOL as any], maxTokens: 3000 });
    const use = (res.content ?? []).find((c: any) => c.type === "tool_use");
    const text = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();

    // No tool block: the model wrote the call as prose. Salvage the answer and
    // any marks it meant to send, and never show the scaffolding.
    if (!use) {
      const rec = recoverFromText(text);
      if (rec.answer) answer = rec.answer;
      if (rec.raw) {
        const clean = sanitise(rec.raw, digest);
        if (clean.ops.length) ops = clean.ops;
        if (clean.marks.length) marks = clean.marks;
      }
      break;
    }

    const input = use.input ?? {};
    if (typeof input.answer === "string" && input.answer.trim()) {
      // Even inside the tool call, `answer` occasionally arrives with the
      // marks JSON appended. Strip it rather than print it.
      answer = recoverFromText(input.answer).answer || input.answer.trim();
    }
    const clean = sanitise(input, digest);
    ops = clean.ops;
    marks = clean.marks;

    // One escape hatch: the digest is a summary, and a question about a
    // particular layer sometimes needs the lines themselves. Granted once,
    // then it must answer.
    const need = typeof input.need === "string" ? input.need.trim() : "";
    if (need && step < MAX_STEPS - 1) {
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: use.id,
          content: `GEOMETRY ON ${need}:\n${layerGeometry(need)}\n\nNow answer the question. Do not ask for another layer.`,
        }],
      });
      continue;
    }
    break;
  }

  if (!answer) answer = "I could not read anything from this drawing that answers that.";
  return { answer, ops, marks, steps: step + 1 };
}

/* ── applying the edits ──────────────────────────────────────────────────── */

import type { DxfModel, Entity } from "./model";
import { modelBounds, newId } from "./model";

/** Apply the agent's operations to the model the editor is holding. */
export function applyCadOps(m: DxfModel, ops: CadOp[]): { model: DxfModel; added: number; removed: number } {
  let entities = [...m.entities];
  const layers = [...m.layers];
  const ensure = (name: string, aci = 1) => {
    if (!layers.some((l) => l.name === name)) layers.push({ name, aci, visible: true });
  };
  let added = 0, removed = 0;
  const push = (e: Entity) => { entities.push({ ...e, id: newId() }); added++; };

  for (const o of ops) {
    switch (o.op) {
      case "add_line":
        ensure(o.layer); push({ kind: "line", layer: o.layer, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 });
        break;
      case "add_rect":
        ensure(o.layer);
        push({ kind: "poly", layer: o.layer, closed: true, pts: [
          { x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h },
        ] });
        break;
      case "add_poly":
        ensure(o.layer); push({ kind: "poly", layer: o.layer, closed: !!o.closed, pts: o.pts });
        break;
      case "add_text": {
        ensure(o.layer, 2);
        // A default of one drawing unit is invisible on a millimetre sheet and
        // enormous on one drawn in metres. Size it against the drawing itself.
        const b = modelBounds(m);
        const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
        push({ kind: "text", layer: o.layer, text: o.text, x: o.x, y: o.y, h: o.h ?? span * 0.012 });
        break;
      }
      case "delete_layer": {
        const before = entities.length;
        entities = entities.filter((e) => e.layer !== o.layer);
        removed += before - entities.length;
        break;
      }
      case "delete_region": {
        // By centre, not by overlap: a box round a door should take the door,
        // not the wall it happens to cross.
        const x1 = Math.min(o.x1, o.x2), x2 = Math.max(o.x1, o.x2);
        const y1 = Math.min(o.y1, o.y2), y2 = Math.max(o.y1, o.y2);
        const centre = (e: Entity): [number, number] => {
          if (e.kind === "line") return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2];
          if (e.kind === "poly") {
            const xs = e.pts.map((p) => p.x), ys = e.pts.map((p) => p.y);
            return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
          }
          return [e.x, e.y];
        };
        const before = entities.length;
        entities = entities.filter((e) => {
          const [cx, cy] = centre(e);
          return !(cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2);
        });
        removed += before - entities.length;
        break;
      }
    }
  }
  return { model: { ...m, layers, entities }, added, removed };
}

import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { runBimAgent2, sharedRules } from "@/lib/bim/agent2";
import { ToolRegistry } from "@/lib/bim/registry";
import { applyCadOps, type CadOp } from "@/lib/cad/agent";
import { CAD_TOOLS } from "@/lib/cad/tools";
import { nativeUnit, type DxfModel } from "@/lib/cad/model";

// POST /projects/{pid}/cad/assistant — do something to the drawing that is open.
//
// The sibling /cad/agent ANSWERS questions about a sheet, with canvas marks
// showing its working. This one CHANGES the sheet, through the same registry
// the BIM assistant uses: discover a tool, read before writing, act.
//
// They are kept apart deliberately. Measuring wants a digest and marks;
// editing wants tools and a trace, and folding one into the other would make
// both worse.
//
// The geometry arrives from the browser rather than the database, for the same
// reason it does next door: the question is about the sheet as it stands on
// screen, including markup added two minutes ago and not yet saved. Ops go back
// for the client to apply — the original file is never overwritten, and saving
// is a separate act that writes a revision.

const Pt = z.object({ x: z.number(), y: z.number() });
const Entity = z.union([
  z.object({ kind: z.literal("line"), layer: z.string(), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), id: z.string().optional() }),
  z.object({ kind: z.literal("poly"), layer: z.string(), pts: z.array(Pt).max(2000), closed: z.boolean(), id: z.string().optional() }),
  z.object({ kind: z.literal("text"), layer: z.string(), text: z.string(), x: z.number(), y: z.number(), h: z.number(), id: z.string().optional() }),
]);

const Body = z.object({
  instruction: z.string().min(2).max(2000),
  filename: z.string().max(255).optional(),
  /** The user already saw the count and said go ahead. */
  preapproved: z.boolean().optional(),
  model: z.object({
    insunits: z.number(),
    layers: z.array(z.object({ name: z.string(), aci: z.number(), visible: z.boolean() })).max(2000),
    entities: z.array(Entity).max(60000),
  }),
});

const WORKER = process.env.WORKER_URL ?? "http://localhost:4000";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";
const MODEL = process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-8";

/**
 * What the assistant is told the drawing is.
 *
 * Layers and counts, not entities: a sheet runs to tens of thousands, and the
 * whole point of the read tools is that it fetches the handful it needs rather
 * than being handed everything. The units line matters more than it looks — an
 * offset of "1" means a millimetre on one sheet and a metre on another, and a
 * drawing that never declared its units says so here rather than being guessed
 * at silently.
 */
function summariseDrawing(m: DxfModel): string {
  const counts: Record<string, number> = {};
  for (const e of m.entities) counts[e.layer] = (counts[e.layer] ?? 0) + 1;
  const layers = m.layers
    .map((l) => `  ${l.name}${l.visible ? "" : " (hidden)"} — ${counts[l.name] ?? 0}`)
    .join("\n");
  const units = m.insunits === 0 ? "NOT DECLARED by the file — do not assume" : nativeUnit(m.insunits);
  return [
    `${m.entities.length} entities on ${m.layers.length} layers. Units: ${units}.`,
    "Layers (name — entity count):",
    layers || "  (none)",
    "",
    "Use the read tools to find anything specific. Do not guess coordinates.",
  ].join("\n");
}

const PERSONA = sharedRules(
  "an issued construction drawing",
  "the drawing's own units — check the units line above before choosing any distance. " +
    "Markup belongs on a markup layer, never on the sheet's issued layers.",
);

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  // Editing the open sheet is a markup, and markup is an edit.
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const body = Body.parse(await req.json());
  let drawing = body.model as DxfModel;
  if (!drawing.entities.length) throw errBadRequest("There is no geometry in this drawing to work on.");

  // Markup tools and drafting tools, registered together but kept as separate
  // catalogues: the first set reads and annotates an issued sheet, the second
  // draws on it, and a deployment may reasonably want one without the other.
  const registry = new ToolRegistry<DxfModel, CadOp>().register(...CAD_TOOLS, ...DRAFTING_TOOLS);

  const callAnthropic = async (r: any) => {
    const res = await fetch(`${WORKER}/claude`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(r),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // Nearly always a worker with no API key. Say that, rather than handing a
      // bare 503 to somebody in the middle of marking up a drawing.
      throw errBadRequest(json?.error ?? `The drawing assistant is unavailable (${res.status}).`);
    }
    return json;
  };

  // Every op the loop applies, kept so the browser can replay them onto the
  // canvas exactly once. The loop mutates only this server-side copy.
  const ops: CadOp[] = [];

  const outcome = await runBimAgent2<DxfModel, CadOp>({
    instruction: body.instruction,
    doc: drawing,
    registry,
    userId: ctx.user.id,
    model: MODEL,
    callAnthropic,
    summarise: summariseDrawing,
    persona: PERSONA,
    noun: "DRAWING",
    // The gate stays ON here, unlike the BIM route. There is no proposal step
    // between the assistant and the canvas — ops are applied when they come
    // back — so this is the only place a large deletion gets questioned.
    preapproved: body.preapproved ?? false,
    apply: async (cmds) => {
      ops.push(...cmds);
      const r = applyCadOps(drawing, cmds);
      drawing = r.model;
      return { doc: drawing, applied: cmds.length };
    },
  });

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    audit({
      action: "cad.assistant",
      targetKind: "file",
      targetId: pid,
      projectId: pid,
      summary: {
        instruction: body.instruction.slice(0, 300),
        filename: body.filename ?? null,
        status: outcome.status,
        entities: body.model.entities.length,
        ops: ops.length,
        tools: outcome.trace.map((t) => t.tool),
      },
    });
  });

  if (outcome.status === "needs_input") {
    return ok({ status: outcome.status, question: outcome.reply, reply: outcome.reply, ops: [], trace: outcome.trace, assumptions: [] });
  }

  if (outcome.status === "needs_confirmation") {
    // Nothing is sent back to the canvas yet. The client re-asks with
    // preapproved once the person has seen the number and agreed.
    return ok({
      status: outcome.status,
      reply: outcome.reply,
      pending: { tool: outcome.pending.tool, label: outcome.pending.label, affected: outcome.pending.affected, assumptions: outcome.pending.assumptions },
      ops: [],
      trace: outcome.trace,
      assumptions: outcome.pending.assumptions,
    });
  }

  return ok({
    status: outcome.status,
    reply: outcome.reply,
    ops,
    applied: outcome.applied,
    assumptions: outcome.assumptions,
    trace: outcome.trace,
  });
});

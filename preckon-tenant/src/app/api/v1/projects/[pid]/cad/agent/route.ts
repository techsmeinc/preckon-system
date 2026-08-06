import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { runCadAgent } from "@/lib/cad/agent";
import { digest as buildDigest, describeDigest } from "@/lib/cad/measure";
import type { DxfModel } from "@/lib/cad/model";

// POST /projects/{pid}/cad/agent — ask about the drawing that is open.
//
// The geometry comes from the browser rather than the database, because the
// question is about the sheet as it stands on screen — including the markup
// added in the last two minutes and not yet saved. Asking about a stored file
// would answer a different question from the one on screen.
//
// The digest is computed HERE, not in the browser. The measurements are the
// part that has to be trustworthy, and a figure a client could shape before the
// model reads it is a figure nobody can rely on. The client sends geometry; the
// server does the arithmetic.
//
// The API key stays in the worker: Core calls its /claude proxy (§5.1).

const Pt = z.object({ x: z.number(), y: z.number() });
const Entity = z.union([
  z.object({ kind: z.literal("line"), layer: z.string(), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), id: z.string().optional() }),
  z.object({ kind: z.literal("poly"), layer: z.string(), pts: z.array(Pt).max(2000), closed: z.boolean(), id: z.string().optional() }),
  z.object({ kind: z.literal("text"), layer: z.string(), text: z.string(), x: z.number(), y: z.number(), h: z.number(), id: z.string().optional() }),
]);

const Body = z.object({
  question: z.string().min(2).max(2000),
  filename: z.string().max(255).optional(),
  model: z.object({
    insunits: z.number(),
    layers: z.array(z.object({ name: z.string(), aci: z.number(), visible: z.boolean() })).max(2000),
    // A sheet set runs to tens of thousands of entities; past this the digest
    // is built from what arrived and the answer says so, rather than the
    // request failing at the door.
    entities: z.array(Entity).max(60000),
  }),
});

const WORKER = process.env.WORKER_URL ?? "http://localhost:4000";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";
const MODEL = process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-8";

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const body = Body.parse(await req.json());
  const model = body.model as DxfModel;
  if (!model.entities.length) throw errBadRequest("There is no geometry in this drawing to read.");

  const d = buildDigest(model);
  const described = describeDigest(d);

  /** One layer's actual lines, for when the summary genuinely is not enough. */
  const layerGeometry = (layer: string): string => {
    const on = model.entities.filter((e) => e.layer === layer).slice(0, 400);
    if (!on.length) return `No entities on a layer called "${layer}".`;
    const lines = on.map((e) => {
      if (e.kind === "line") return `line (${e.x1.toFixed(0)},${e.y1.toFixed(0)})-(${e.x2.toFixed(0)},${e.y2.toFixed(0)})`;
      if (e.kind === "poly") return `poly ${e.closed ? "closed" : "open"} ${e.pts.length}pts first (${e.pts[0].x.toFixed(0)},${e.pts[0].y.toFixed(0)})`;
      return `text "${e.text}" at (${e.x.toFixed(0)},${e.y.toFixed(0)})`;
    });
    const more = model.entities.filter((e) => e.layer === layer).length - on.length;
    return lines.join("\n") + (more > 0 ? `\n… and ${more} more on this layer` : "");
  };

  const callAnthropic = async (r: any) => {
    const res = await fetch(`${WORKER}/claude`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(r),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // Nearly always a worker with no API key. Say that, rather than handing
      // a bare 503 to somebody in the middle of measuring a drawing.
      throw errBadRequest(json?.error ?? `The drawing assistant is unavailable (${res.status}).`);
    }
    return json;
  };

  const result = await runCadAgent({
    question: body.question,
    digest: d,
    describe: described,
    layerGeometry,
    model: MODEL,
    callAnthropic,
  });

  // Audited like any other agent action — including the edits it proposed, so
  // a drawing that changed can be traced to the instruction that changed it.
  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    audit({
      action: "cad.agent",
      targetKind: "file",
      targetId: pid,
      projectId: pid,
      summary: {
        question: body.question.slice(0, 300),
        filename: body.filename ?? null,
        entities: model.entities.length,
        layers: d.layers.length,
        ops: result.ops.length,
        marks: result.marks.length,
      },
    });
  });

  return ok({
    answer: result.answer,
    ops: result.ops,
    marks: result.marks,
    units: d.units,
    layers: d.layers.length,
    entities: model.entities.length,
  });
});

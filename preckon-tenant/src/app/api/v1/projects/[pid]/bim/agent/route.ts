import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { runBimAgent } from "@/lib/bim/agent";
import { applyCommands } from "@/lib/bim/commands";
import { CATALOG, defaultLevel, describe, emptyDocument, type BimDocument } from "@/lib/bim/model";
import { diffDocuments, saveProposal } from "@/lib/bim/proposal";

// POST /projects/{pid}/bim/agent — draw by instruction, and STOP.
//
// The loop lives here because Core owns the document: after each step the agent
// is handed the REAL updated model, which is what lets it host a door on a wall
// it created a moment ago. The API key stays in the worker - Core calls its
// /claude proxy and never sees the key.
//
// WHAT CHANGED, AND WHY
//
// This route used to write the assistant's result straight into bim_document.
// The estimator saw the model change and had undo, which is not the same as
// having agreed to it - and it is the pattern both blueprints forbid in as many
// words: "Never let an LLM directly mutate production model state."
//
// So the result is now a PROPOSAL. The agent still draws into a real document,
// because that is what makes it able to host a door on a wall it just made; but
// the document it produces is held to one side with a plain-language diff, and
// a human applies it. Nothing about the drawing gets worse. What changes is
// that "the AI added four walls" becomes something somebody decided rather than
// something they discovered.

const Body = z.object({
  instruction: z.string().min(3).max(2000),
  specialist: z.enum(["all", "architectural", "structural", "civil", "electrical", "mechanical", "plumbing", "fire"]).default("all"),
});

const WORKER = process.env.WORKER_URL ?? "http://localhost:4000";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";
const MODEL = process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-8";

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Body.parse(await req.json());

  const row = await queryOne<{ doc: BimDocument; version: number }>(
    "SELECT doc, version FROM bim_document WHERE tenant_id = ? AND project_id = ?",
    [ctx.tenantId, pid]
  );
  let doc: BimDocument = row?.doc ?? emptyDocument();
  const startVersion = row?.version ?? 0;

  const callAnthropic = async (r: any) => {
    const res = await fetch(`${WORKER}/claude`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(r),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // The commonest cause by far is a worker with no API key — say so plainly
      // rather than surfacing a bare 503 to someone drawing a building.
      throw errBadRequest(json?.error ?? `The drawing assistant is unavailable (${res.status}).`);
    }
    return json;
  };

  const result = await runBimAgent({
    instruction: body.instruction,
    specialist: body.specialist,
    summary: describe(doc),
    levelId: defaultLevel(doc),
    catalog: Object.values(CATALOG),
    elements: doc.elements,
    model: MODEL,
    callAnthropic,
    // Applied in memory across the loop; persisted once at the end, so a failed
    // mid-loop step can't leave a half-built model saved.
    apply: async (cmds) => {
      doc = applyCommands(doc, cmds);
      return { summary: describe(doc), applied: cmds.length, elements: doc.elements };
    },
  });

  // Nothing is saved to bim_document here. The proposal is, and applying it is
  // a separate act by a person.
  const before: BimDocument = row?.doc ?? emptyDocument();
  const diff = diffDocuments(before, doc);

  if (!diff.added.length && !diff.changed.length && !diff.removed.length) {
    // A proposal that changes nothing is not worth a decision. Say what the
    // assistant said and leave the model alone.
    return ok({ ...result, proposal: null, diff, doc: null });
  }

  const proposalId = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const id = await saveProposal({
      tenantId: ctx.tenantId, projectId: pid, userId: ctx.user.id,
      baseVersion: startVersion, instruction: body.instruction,
      specialist: body.specialist, doc, diff, reply: result.reply ?? "",
    });
    // Audited as a PROPOSAL, distinct from the commit that may follow. The two
    // are different events and the trail should not blur them: one is a model
    // suggesting, the other is a person deciding.
    audit({
      action: "bim.agent.proposed",
      targetKind: "bim_proposal",
      targetId: id,
      projectId: pid,
      summary: {
        specialist: body.specialist, applied: result.applied, dropped: result.dropped,
        change: diff.summary, instruction: body.instruction.slice(0, 200),
      },
    });
    return id;
  });

  return ok({ ...result, proposal: proposalId, diff, baseVersion: startVersion, doc });
});

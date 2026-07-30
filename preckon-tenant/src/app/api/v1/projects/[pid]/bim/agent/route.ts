import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { runBimAgent } from "@/lib/bim/agent";
import { applyCommands } from "@/lib/bim/commands";
import { CATALOG, defaultLevel, describe, emptyDocument, type BimDocument } from "@/lib/bim/model";

// POST /projects/{pid}/bim/agent — draw by instruction.
//
// The loop lives here because Core owns the document: after each step the agent
// is handed the REAL updated model, which is what lets it host a door on a wall
// it created a moment ago. The API key stays in the worker — Core calls its
// /claude proxy and never sees the key.

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

  const version = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const cur = await queryOne<{ version: number }>(
      "SELECT version FROM bim_document WHERE tenant_id = ? AND project_id = ? FOR UPDATE",
      [ctx.tenantId, pid]
    );
    if (cur && cur.version !== startVersion) {
      throw errBadRequest("The model changed while the assistant was drawing. Reload and try again.");
    }
    const next = (cur?.version ?? 0) + 1;
    const json = JSON.stringify(doc);
    if (cur) {
      await query("UPDATE bim_document SET doc = ?, version = ?, updated_by = ? WHERE tenant_id = ? AND project_id = ?",
        [json, next, ctx.user.id, ctx.tenantId, pid]);
    } else {
      await query("INSERT INTO bim_document (project_id, tenant_id, doc, version, updated_by) VALUES (?,?,?,?,?)",
        [pid, ctx.tenantId, json, next, ctx.user.id]);
    }
    audit({
      action: "bim.agent",
      targetKind: "bim_document",
      targetId: pid,
      projectId: pid,
      summary: { specialist: body.specialist, applied: result.applied, dropped: result.dropped, instruction: body.instruction.slice(0, 200) },
    });
    return next;
  });

  return ok({ ...result, version, doc });
});

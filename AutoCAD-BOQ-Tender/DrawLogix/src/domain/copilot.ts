import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import DxfParser from "dxf-parser";
import { db, schema, type ScheduleRow } from "@/db/client";
import { isAiConfigured, runArchitectAgent } from "@/ai/agent";
import { editDxf } from "@/ai/dxf-copilot";
import { withTenant } from "@/db/tenant";
import { applyOp, buildSummary, parseToModel } from "./dxf-model";
import { saveConcept, saveDrawingGeometry } from "./persist";

/**
 * AI copilot turn: store the user message, run the Claude assistant against the
 * project's current drawing, persist its edits (re-rendering plan/DXF from the result),
 * and store the assistant reply. Routes by drawing kind — a room-based concept plan is
 * edited via the architect agent (room programme); a freeform sketch is edited via the
 * DXF edit copilot. Prompts may carry image/PDF-page attachments (data-URLs) so a user
 * can mark up a reference and say "make it like this".
 */
export async function sendCopilotMessage(
  orgId: string,
  projectId: string,
  content: string,
  attachments: string[] = [],
) {
  const text = content.trim();
  if (!text && attachments.length === 0) throw new Error("Type a message");

  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.drawingMessages).values({ id: randomUUID(), orgId, projectId, role: "user", content: text || "(image attached)" });
  });

  let reply: string;
  if (!isAiConfigured()) {
    reply = "The AI copilot isn't configured (no ANTHROPIC_API_KEY). Add it to .env.local to enable conversational design.";
  } else {
    try {
      const drawing = await loadDrawing(orgId, projectId);
      if (drawing?.dxf) {
        // Full geometry copilot on the actual drawing — can ADD any geometry and REMOVE
        // anything, on BOTH floor plans and site plans.
        reply = await editDrawingGeometry(orgId, projectId, drawing.dxf, text, attachments);
      } else {
        // No drawing yet — treat the message as a design brief.
        const { schedule, reply: agentReply } = await runArchitectAgent(drawing?.schedule ?? [], text, attachments);
        await saveConcept(orgId, projectId, schedule);
        reply = agentReply;
      }
    } catch (e) {
      reply = `The copilot hit an error: ${(e as Error).message}`;
    }
  }

  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.drawingMessages).values({ id: randomUUID(), orgId, projectId, role: "assistant", content: reply });
  });
  return { reply };
}

/** Edit ANY drawing's geometry: parse stored DXF → summary → AI edit ops → apply → save. */
async function editDrawingGeometry(
  orgId: string,
  projectId: string,
  dxf: string,
  instruction: string,
  attachments: string[],
): Promise<string> {
  const model = parseToModel(new DxfParser().parseSync(dxf));
  const { reply, operations } = await editDxf(buildSummary(model), instruction || "Update the drawing to match the attached reference.", attachments);
  let next = model;
  for (const op of operations) next = applyOp(next, op);
  await saveDrawingGeometry(orgId, projectId, next);
  return reply;
}

/** Design a whole building from a natural-language brief, in one shot. */
export async function designFromBrief(orgId: string, projectId: string, brief: string) {
  const text = brief.trim();
  if (!text) throw new Error("Describe the building you want");
  if (!isAiConfigured()) throw new Error("AI copilot isn't configured (no ANTHROPIC_API_KEY).");

  const drawing = await loadDrawing(orgId, projectId);
  const { schedule, reply } = await runArchitectAgent(drawing?.schedule ?? [], `Design this from scratch: ${text}`);
  await saveConcept(orgId, projectId, schedule);

  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.drawingMessages).values({ id: randomUUID(), orgId, projectId, role: "user", content: `Design: ${text}` });
    await tx.insert(schema.drawingMessages).values({ id: randomUUID(), orgId, projectId, role: "assistant", content: reply });
  });
  return { reply };
}

/** Load the project's latest drawing (kind + schedule + dxf) for the copilot to edit. */
async function loadDrawing(
  orgId: string,
  projectId: string,
): Promise<{ kind: string; schedule: ScheduleRow[]; dxf: string | null } | null> {
  const drawing = (
    await db
      .select({ kind: schema.drawings.kind, schedule: schema.drawings.schedule, dxf: schema.drawings.dxf })
      .from(schema.drawings)
      .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId), isNull(schema.drawings.archivedAt)))
      .orderBy(desc(schema.drawings.createdAt))
      .limit(1)
  )[0];
  if (!drawing) return null;
  return { kind: drawing.kind, schedule: (drawing.schedule as ScheduleRow[] | null) ?? [], dxf: drawing.dxf ?? null };
}

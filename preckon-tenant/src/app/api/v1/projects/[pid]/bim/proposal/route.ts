import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errBadRequest } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { decideProposal, getProposal, openProposal } from "@/lib/bim/proposal";

// The human half of the drawing assistant.
//
// GET  — is there a proposal waiting? (survives a reload; two cannot pile up)
// POST — apply it, or throw it away.
//
// This route is the "human approval" the whole architecture claims. Everything
// upstream is careful about not letting a model write to the database; that
// care is worth nothing unless somebody actually gets to say no, and this is
// where they say it.

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  return ok({ proposal: await openProposal(ctx.tenantId, pid) });
});

const Body = z.object({
  id: z.string().min(1),
  decision: z.enum(["apply", "discard"]),
});

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  // Applying is an edit to the model, so it needs the permission an edit needs.
  // Reading a proposal does not; deciding on one does.
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Body.parse(await req.json());

  const proposal = await getProposal(ctx.tenantId, pid, body.id);

  if (body.decision === "discard") {
    await useCase(actorFromCtx(ctx), async (_conn, audit) => {
      await decideProposal(ctx.tenantId, body.id, "DISCARDED");
      // Recorded. A rejected proposal is evidence about the assistant, and
      // throwing away the fact that somebody said no loses the only signal
      // there is about how often it is wrong.
      audit({
        action: "bim.agent.discarded", targetKind: "bim_proposal", targetId: body.id,
        projectId: pid, summary: { change: proposal.diff.summary },
      });
    });
    return ok({ applied: false, discarded: true });
  }

  const version = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const cur = await queryOne<{ version: number }>(
      "SELECT version FROM bim_document WHERE tenant_id = ? AND project_id = ? FOR UPDATE",
      [ctx.tenantId, pid]
    );
    // The model may have moved while the proposal sat unanswered — somebody
    // else drawing, or this person drawing by hand. Applying anyway would throw
    // that work away silently, which is precisely the harm the proposal exists
    // to prevent.
    if ((cur?.version ?? 0) !== proposal.base_version) {
      throw errBadRequest(
        `The model has changed since the assistant drew this (it is now at version ${cur?.version ?? 0}, the proposal was drawn against ${proposal.base_version}). Ask again so it can work from the current model.`
      );
    }

    const next = (cur?.version ?? 0) + 1;
    const json = JSON.stringify(proposal.doc);
    if (cur) {
      await query("UPDATE bim_document SET doc = ?, version = ?, updated_by = ? WHERE tenant_id = ? AND project_id = ?",
        [json, next, ctx.user.id, ctx.tenantId, pid]);
    } else {
      await query("INSERT INTO bim_document (project_id, tenant_id, doc, version, updated_by) VALUES (?,?,?,?,?)",
        [pid, ctx.tenantId, json, next, ctx.user.id]);
    }
    await decideProposal(ctx.tenantId, body.id, "APPLIED");

    audit({
      action: "bim.agent.applied",
      targetKind: "bim_document",
      targetId: pid,
      projectId: pid,
      // Both ids, so the trail reads: this person applied that proposal. The
      // model's suggestion and the human's decision stay distinguishable.
      summary: { proposalId: body.id, change: proposal.diff.summary, version: next },
    });
    return next;
  });

  return ok({ applied: true, version, doc: proposal.doc });
});

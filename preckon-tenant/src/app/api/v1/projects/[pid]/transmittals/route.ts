import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { listTransmittals, createTransmittal } from "@/lib/doc/transmittal-store";

// Transmittals — the record of what was formally issued, to whom, and when.
//
// Created as a draft. Sending is a separate call, because sending freezes both
// the transmittal and every revision on it, and that is not something to do as
// a side effect of assembling the list.

const NewTransmittal = z.object({
  purpose: z.string().min(1).max(255),
  subject: z.string().max(500).nullish(),
  instructions: z.string().max(4000).nullish(),
  sender_party: z.string().max(255).nullish(),
  required_response_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  // Revision ids, never document ids. A transmittal that pointed at documents
  // would silently rewrite its own history the next time a revision was issued.
  revision_ids: z.array(z.string().max(64)).min(1),
  recipients: z.array(z.object({
    party: z.string().min(1).max(255),
    kind: z.enum(["to", "cc"]).default("to"),
    email: z.string().email().max(320).nullish(),
  })).min(1),
});

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  return ok({ transmittals: await listTransmittals(ctx.tenantId, pid) });
});

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const b = NewTransmittal.parse(await req.json());

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const created = await createTransmittal(ctx.tenantId, pid, {
      purpose: b.purpose,
      subject: b.subject ?? null,
      instructions: b.instructions ?? null,
      senderParty: b.sender_party ?? null,
      requiredResponseAt: b.required_response_at ?? null,
      revisionIds: b.revision_ids,
      recipients: b.recipients,
      userId: ctx.user.id,
    });

    audit({
      action: "transmittal.create",
      targetKind: "transmittal",
      targetId: created.id,
      projectId: pid,
      summary: { number: created.number, items: b.revision_ids.length, recipients: b.recipients.length },
    });

    return created;
  });

  return ok({ id: result.id, transmittal_number: result.number }, 201);
});

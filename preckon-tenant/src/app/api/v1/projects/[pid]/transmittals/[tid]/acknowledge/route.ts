import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { acknowledgeTransmittal, recallTransmittal } from "@/lib/doc/transmittal-store";

// Acknowledgement and recall.
//
// The acknowledgement is the half of the record that proves receipt. Without it
// a transmittal shows only that something was sent, which settles nothing when
// the question is whether the consultant had the drawing.
//
// Recall never deletes. The recipient received it; marking the issue withdrawn
// keeps both facts visible, which is the point of the record.

const Ack = z.object({
  party: z.string().min(1).max(255),
  ack: z.enum(["acknowledged", "declined"]).default("acknowledged"),
  note: z.string().max(500).nullish(),
});

const Recall = z.object({
  reason: z.string().min(1).max(500),
});

export const POST = route<{ pid: string; tid: string }>(async (req, ctx, { pid, tid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const b = Ack.parse(await req.json());

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const out = await acknowledgeTransmittal(ctx.tenantId, tid, b.party, b.ack, b.note ?? null);
    audit({
      action: "transmittal.acknowledge",
      targetKind: "transmittal",
      targetId: tid,
      projectId: pid,
      summary: { party: b.party, ack: b.ack, status: out.status },
    });
    return out;
  });

  return ok(result);
});

export const DELETE = route<{ pid: string; tid: string }>(async (req, ctx, { pid, tid }) => {
  requirePermission(ctx, "artifact.confirm");
  await requireProject(ctx, pid);
  const b = Recall.parse(await req.json().catch(() => ({ reason: "Recalled" })));

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const out = await recallTransmittal(ctx.tenantId, tid, b.reason);
    audit({
      action: "transmittal.recall",
      targetKind: "transmittal",
      targetId: tid,
      projectId: pid,
      summary: { number: out.number, reason: b.reason },
    });
    return out;
  });

  return ok(result);
});

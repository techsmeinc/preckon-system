import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { sendTransmittal, loadTransmittal } from "@/lib/doc/transmittal-store";
import { validateForSending } from "@/lib/doc/transmittal";

// Send a transmittal.
//
// This is the irreversible one. It freezes the transmittal and every revision on
// it, because from this moment somebody outside the organisation holds a copy,
// and a register that can still be edited to disagree with what is on their desk
// is worse than no register.
//
// Requires artifact.confirm: issuing documents to another party is an approval.

export const GET = route<{ pid: string; tid: string }>(async (_req, ctx, { pid, tid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const t = await loadTransmittal(ctx.tenantId, tid);
  if (!t) return ok({ error: "not_found" }, 404);

  // A dry run, so the document controller sees every blocker at once rather
  // than discovering the fourth after fixing the third.
  return ok({ transmittal: t, issues: validateForSending(t) });
});

export const POST = route<{ pid: string; tid: string }>(async (_req, ctx, { pid, tid }) => {
  requirePermission(ctx, "artifact.confirm");
  await requireProject(ctx, pid);

  try {
    const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
      const sent = await sendTransmittal(ctx.tenantId, tid);
      audit({
        action: "transmittal.send",
        targetKind: "transmittal",
        targetId: tid,
        projectId: pid,
        summary: { number: sent.number, items: sent.items, recipients: sent.recipients },
      });
      return sent;
    });
    return ok(result);
  } catch (err) {
    const issues = (err as Error & { issues?: unknown }).issues;
    if (issues) return ok({ error: "not_ready_to_send", issues }, 422);
    throw err;
  }
});

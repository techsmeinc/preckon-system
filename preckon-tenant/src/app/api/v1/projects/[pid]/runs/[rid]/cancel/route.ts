import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { cancelRun } from "@/lib/runtime";

// §4.6 POST /projects/{pid}/runs/{rid}/cancel — → cancelled; audit.
export const POST = route<{ pid: string; rid: string }>(async (_req, ctx, { pid, rid }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  await cancelRun(actorFromCtx(ctx), ctx.tenantId, rid);
  return ok({ ok: true });
});

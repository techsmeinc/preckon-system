import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { rerunStale } from "@/lib/runtime";

// §4.6 POST /projects/{pid}/runs/{rid}/rerun-stale — partial re-run of stale-producing steps.
export const POST = route<{ pid: string; rid: string }>(async (_req, ctx, { pid, rid }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  const count = await rerunStale(actorFromCtx(ctx), ctx.tenantId, rid);
  return ok({ rerun: count });
});

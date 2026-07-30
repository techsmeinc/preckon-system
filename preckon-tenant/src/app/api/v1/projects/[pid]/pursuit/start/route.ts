import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { startAutopilot } from "@/lib/pursuit";

// POST /projects/{pid}/pursuit/start — run the whole pursuit automatically:
// every licensed workflow, in dependency order, auto-accepting all proposals and
// advancing the lifecycle. Needs workflow.run (starting workflows) + artifact.confirm
// (autopilot stands in for the human confirm).
export const POST = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.run");
  requirePermission(ctx, "artifact.confirm");
  await requireProject(ctx, pid);
  const res = await startAutopilot(actorFromCtx(ctx), ctx.tenantId, pid, ctx.user.id);
  return ok(res, 202);
});

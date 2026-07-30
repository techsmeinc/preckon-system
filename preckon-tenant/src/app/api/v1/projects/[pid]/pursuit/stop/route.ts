import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { stopAutopilot } from "@/lib/pursuit";

// POST /projects/{pid}/pursuit/stop — turn autopilot off (an in-flight run finishes).
export const POST = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  await stopAutopilot(actorFromCtx(ctx), ctx.tenantId, pid);
  return ok({ autopilot: false });
});

import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { pursuitStatus } from "@/lib/pursuit";

// GET /projects/{pid}/pursuit — autopilot flag, current stage, per-workflow plan.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  return ok(await pursuitStatus(ctx.tenantId, pid));
});

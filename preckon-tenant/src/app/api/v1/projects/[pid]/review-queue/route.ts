import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { reviewQueue } from "@/lib/store";

// §2.6 GET /projects/{pid}/review-queue — pending proposals (the review_queue view).
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  return ok(await reviewQueue(ctx.tenantId, pid));
});

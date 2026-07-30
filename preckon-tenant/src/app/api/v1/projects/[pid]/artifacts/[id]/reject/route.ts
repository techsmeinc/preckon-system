import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { rejectArtifact } from "@/lib/store";

// §2.6 POST /projects/{pid}/artifacts/{id}/reject — pending → rejected; audit.
export const POST = route<{ pid: string; id: string }>(async (_req, ctx, { pid, id }) => {
  requirePermission(ctx, "artifact.confirm");
  await requireProject(ctx, pid);
  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await rejectArtifact(ctx.tenantId, id, ctx.user.id, audit);
  });
  return ok({ id, status: "rejected" });
});

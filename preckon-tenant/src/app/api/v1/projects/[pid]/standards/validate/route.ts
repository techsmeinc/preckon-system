import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { validateStandards } from "@/lib/standards";

// §4 POST /projects/{pid}/standards/validate — run the mandatory rules against
// the project's confirmed artifacts and emit standard_violation proposals (no LLM).
export const POST = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) =>
    validateStandards(ctx.tenantId, pid, audit)
  );
  return ok(result);
});

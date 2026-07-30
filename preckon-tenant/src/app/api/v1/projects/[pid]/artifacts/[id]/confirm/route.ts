import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { confirmArtifact, type Artifact } from "@/lib/store";
import { advanceLifecycle } from "@/lib/lifecycle";
import { resumeGates } from "@/lib/runtime";

// §2.6 POST /projects/{pid}/artifacts/{id}/confirm — pending → confirmed; audit;
// then resume any paused gate (§4.3) and advance the pursuit lifecycle (§1.6).
export const POST = route<{ pid: string; id: string }>(async (_req, ctx, { pid, id }) => {
  requirePermission(ctx, "artifact.confirm");
  const project = await requireProject(ctx, pid);

  const confirmed = await useCase<Artifact>(actorFromCtx(ctx), async (_conn, audit) => {
    const a = await confirmArtifact(ctx.tenantId, id, ctx.user.id, audit);
    // §1.6 propose-vs-dispose at the lifecycle level: a human confirm advances state.
    await advanceLifecycle(ctx.tenantId, project, a, ctx.permissions, audit);
    return a;
  });

  // §4.3 step 4 — confirming the last gated artifact resumes the run.
  if (confirmed.source_run_id) await resumeGates(ctx.tenantId, confirmed.source_run_id);

  return ok({ id, status: "confirmed" });
});

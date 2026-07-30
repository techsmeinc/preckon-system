import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound, errBadRequest } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { getSnapshot } from "@/lib/entitlements";
import { errEntitlement } from "@/lib/errors";

// §6.3 POST /projects/{pid}/deviations/{id}/approve — the DETERMINISTIC runtime
// applies the deviation on approval (never the supervisor). Humans dispose.
export const POST = route<{ pid: string; id: string }>(async (_req, ctx, { pid, id }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);

  const dev = await queryOne<any>(
    "SELECT * FROM run_deviation WHERE id = ? AND tenant_id = ? AND project_id = ?",
    [id, ctx.tenantId, pid]
  );
  if (!dev) throw errNotFound("Deviation");
  if (dev.status !== "proposed") throw errBadRequest("Deviation is not in a proposed state");

  // §8.3 an edition may forbid certain deviation kinds.
  const snap = await getSnapshot(ctx.tenantId);
  if (snap?.forbidden_deviations?.includes(dev.kind))
    throw errEntitlement(`Deviation kind '${dev.kind}' is forbidden by this edition`);

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      "UPDATE run_deviation SET status = 'applied', decided_by = ?, decided_at = NOW(3), applied_at = NOW(3) WHERE id = ?",
      [ctx.user.id, id]
    );
    // Apply effect for the kinds we act on (the runtime, not the supervisor).
    if (dev.kind === "rerun_step" && dev.target_step_id) {
      await query(
        "UPDATE workflow_run_step SET status = 'pending', job_id = NULL WHERE id = ? AND tenant_id = ?",
        [dev.target_step_id, ctx.tenantId]
      );
    }
    audit({ action: "deviation.approve", targetKind: "deviation", targetId: id, projectId: pid, summary: { kind: dev.kind } });
  });

  // Re-advance the run (re-dispatches any re-pended step).
  if (dev.kind === "rerun_step") {
    const { advanceRun } = await import("@/lib/runtime");
    await advanceRun(ctx.tenantId, dev.run_id);
  }
  return ok({ ok: true });
});

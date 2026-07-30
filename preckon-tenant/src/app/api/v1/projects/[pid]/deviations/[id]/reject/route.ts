import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";

// §6.3 POST /projects/{pid}/deviations/{id}/reject — proposed → rejected; audit.
export const POST = route<{ pid: string; id: string }>(async (_req, ctx, { pid, id }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  const dev = await queryOne<any>("SELECT id FROM run_deviation WHERE id = ? AND tenant_id = ? AND project_id = ?", [id, ctx.tenantId, pid]);
  if (!dev) throw errNotFound("Deviation");
  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query("UPDATE run_deviation SET status = 'rejected', decided_by = ?, decided_at = NOW(3) WHERE id = ?", [ctx.user.id, id]);
    audit({ action: "deviation.reject", targetKind: "deviation", targetId: id, projectId: pid, summary: {} });
  });
  return ok({ ok: true });
});

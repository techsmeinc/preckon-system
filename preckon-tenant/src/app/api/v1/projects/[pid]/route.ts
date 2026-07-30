import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";

// §1.7 GET /projects/{pid} — project detail.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "project.read");
  await requireProject(ctx, pid);
  const project = await queryOne(
    "SELECT id, name, code, client_name, status, lifecycle_key, lifecycle_state, lifecycle_state_at, created_at FROM project WHERE id = ? AND tenant_id = ?",
    [pid, ctx.tenantId]
  );
  return ok(project);
});

// §1.7 DELETE /projects/{pid} — archive the project (soft delete; reversible). The
// audit trail is append-only by design, so a project is retired, not purged — this
// removes it from the working list while its history stays intact.
export const DELETE = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "project.archive");
  await requireProject(ctx, pid);
  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      "UPDATE project SET status = 'archived', updated_at = NOW(3) WHERE id = ? AND tenant_id = ?",
      [pid, ctx.tenantId]
    );
    audit({ action: "project.archive", targetKind: "project", targetId: pid, projectId: pid, summary: {} });
  });
  return ok({ id: pid, status: "archived" });
});

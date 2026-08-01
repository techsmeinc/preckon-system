import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errNotFound, errStale } from "@/lib/errors";

// DELETE /projects/{pid}/programme/{aid} — take an activity out of the programme.
//
// Supersede rather than reject. Rejection is a verdict on a proposal and is only
// legal while it is pending, so routing a delete through it fails the moment the
// activity has been accepted — which is exactly when a planner is most likely to
// restructure. Superseding works at any status, keeps the row queryable, and
// leaves anything derived from it traceable.

export const DELETE = route<{ pid: string; aid: string }>(async (_req, ctx, { pid, aid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const a = await queryOne<{ id: string; status: string; type_key: string; payload: any }>(
    "SELECT id, status, type_key, payload FROM artifact WHERE tenant_id = ? AND project_id = ? AND id = ?",
    [ctx.tenantId, pid, aid]
  );
  if (!a) throw errNotFound("Activity");
  if (a.type_key.split(".").pop() !== "schedule_activity") {
    throw errStale("That record is not a programme activity");
  }
  if (a.status === "superseded") throw errStale("That activity has already been replaced");

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      "UPDATE artifact SET status = 'superseded', updated_at = NOW(3) WHERE tenant_id = ? AND id = ?",
      [ctx.tenantId, aid]
    );
    const payload = typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload;
    audit({
      action: "programme.activity.remove",
      targetKind: "artifact",
      targetId: aid,
      projectId: pid,
      summary: { activity: payload?.activity ?? null, was: a.status },
    });
  });

  return ok({ id: aid, status: "superseded" });
});

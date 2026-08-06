import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { emitArtifact, listArtifacts } from "@/lib/store";
import { takeoff } from "@/lib/bim/takeoff";
import type { BimDocument } from "@/lib/bim/model";

// POST /projects/{pid}/bim/takeoff — measure the BIM model into the chain.
//
// Emits one `drawing_measurement` per measured item. These are emitted as
// source "human": the geometry was drawn by a person and the quantity is
// arithmetic on it, so there is no proposal to review — unlike an agent's
// reading of a PDF, which is a guess and must be confirmed.
//
// Re-running supersedes the previous BIM-derived measurements rather than
// duplicating them, so the model stays the single source of truth for its own
// quantities however many times you remeasure.

export const POST = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const row = await queryOne<{ doc: BimDocument }>(
    "SELECT doc FROM bim_document WHERE tenant_id = ? AND project_id = ?",
    [ctx.tenantId, pid]
  );
  if (!row) throw errBadRequest("Nothing modelled yet — add elements in BIM Studio first.");

  const measurements = takeoff(row.doc);
  if (measurements.length === 0) {
    throw errBadRequest("The model has no measurable elements yet.");
  }

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    // Retire the previous run's measurements. Superseding rather than deleting
    // keeps the audit chain intact and leaves anything already derived from them
    // traceable — Core marks those downstream records stale on its own.
    const existing = await listArtifacts({ tenantId: ctx.tenantId, projectId: pid, typeKey: "drawing_measurement" });
    const priorBim = existing.filter(
      (a) => a.status !== "superseded" && typeof a.payload?.method === "string" && a.payload.method.includes("BIM model")
    );
    if (priorBim.length) {
      await query(
        `UPDATE artifact SET status = 'superseded', updated_at = NOW(3)
          WHERE tenant_id = ? AND id IN (${priorBim.map(() => "?").join(",")})`,
        [ctx.tenantId, ...priorBim.map((a) => a.id)]
      );
    }

    let emitted = 0;
    for (const m of measurements) {
      await emitArtifact(
        {
          tenantId: ctx.tenantId,
          projectId: pid,
          typeKey: "drawing_measurement",
          payload: m,
          source: "human",
          createdBy: ctx.user.id,
        } as any,
        audit
      );
      emitted++;
    }

    audit({
      action: "bim.takeoff",
      targetKind: "bim_document",
      targetId: pid,
      projectId: pid,
      summary: { emitted, superseded: priorBim.length },
    });
    return { emitted, superseded: priorBim.length };
  });

  return ok(result, 201);
});


// DELETE /projects/{pid}/bim/takeoff — take the measurements back out.
//
// Measuring a model is one click and produces a hundred records; until now
// there was no click that undid it. Somebody trying the button to see what it
// did was left with a register full of quantities they did not want and no way
// to clear it.
//
// Superseded, not deleted, for the same reason the re-run supersedes: the audit
// chain is append-only, and anything already derived from these measurements
// stays traceable to what produced it. They leave the register; they do not
// leave the record.
export const DELETE = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const removed = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const existing = await listArtifacts({ tenantId: ctx.tenantId, projectId: pid, typeKey: "drawing_measurement" });
    // Only what the model produced. A measurement an agent read off a PDF, or
    // one somebody typed, is not this button's business.
    const mine = existing.filter(
      (a) => a.status !== "superseded" && typeof a.payload?.method === "string" && a.payload.method.includes("BIM model")
    );
    if (!mine.length) return 0;

    await query(
      `UPDATE artifact SET status = 'superseded', updated_at = NOW(3)
        WHERE tenant_id = ? AND id IN (${mine.map(() => "?").join(",")})`,
      [ctx.tenantId, ...mine.map((a) => a.id)]
    );
    audit({
      action: "bim.takeoff.clear",
      targetKind: "bim_document",
      targetId: pid,
      projectId: pid,
      summary: { superseded: mine.length },
    });
    return mine.length;
  });

  return ok({ superseded: removed });
});

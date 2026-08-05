import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";

// §1.7 GET /projects/{pid} — project detail.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "project.read");
  await requireProject(ctx, pid);
  const project = await queryOne(
    "SELECT id, name, code, client_name, location, submitted_to, ref_no, status, lifecycle_key, lifecycle_state, lifecycle_state_at, created_at FROM project WHERE id = ? AND tenant_id = ?",
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

// PATCH /projects/{pid} — the submission cover details.
//
// These appear on the header block of every exported bill and programme. Before
// they had a home the exports rendered them blank and an estimator retyped them
// in Excel after each download — so the next download lost them again.
const Cover = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(64).nullable().optional(),
  client_name: z.string().max(255).nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  submitted_to: z.string().max(255).nullable().optional(),
  ref_no: z.string().max(64).nullable().optional(),
  // Restoring an archived project is the same write as any other field on it,
  // so it goes through the same door rather than growing an endpoint.
  status: z.enum(["active", "archived"]).optional(),
});

export const PATCH = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "project.update");
  await requireProject(ctx, pid);
  const body = Cover.parse(await req.json());
  // Restoring is an archive decision, not a cover-detail edit — whoever may
  // archive is who may bring one back.
  if (body.status !== undefined) requirePermission(ctx, "project.archive");
  const cols = Object.keys(body) as Array<keyof typeof body>;
  if (!cols.length) return ok({ id: pid });

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      `UPDATE project SET ${cols.map((c) => "`" + c + "` = ?").join(", ")}, updated_at = NOW(3)
        WHERE id = ? AND tenant_id = ?`,
      [...cols.map((c) => body[c] ?? null), pid, ctx.tenantId]
    );
    audit({ action: "project.update", targetKind: "project", targetId: pid, projectId: pid, summary: body });
  });
  const project = await queryOne(
    "SELECT id, name, code, client_name, location, submitted_to, ref_no FROM project WHERE id = ? AND tenant_id = ?",
    [pid, ctx.tenantId]
  );
  return ok(project);
});

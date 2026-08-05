import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { getLifecycle } from "@/lib/lifecycle";

// §1.7 GET /projects — member projects, or all with project.read_all.
//
// `?archived=1` returns the archived ones instead. Archiving used to be a
// one-way door in the interface: the project left the list and there was no
// screen anywhere that showed it again, so "history is kept" was true of the
// database and false of anything a person could reach.
export const GET = route(async (req, ctx) => {
  requirePermission(ctx, "project.read");
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  const test = archived ? "= 'archived'" : "<> 'archived'";
  const rows = ctx.permissions.has("project.read_all")
    ? await query(
        `SELECT id, name, code, client_name, status, lifecycle_key, lifecycle_state, created_at, updated_at
           FROM project WHERE tenant_id = ? AND status ${test} ORDER BY created_at DESC`,
        [ctx.tenantId]
      )
    : await query(
        `SELECT p.id, p.name, p.code, p.client_name, p.status, p.lifecycle_key, p.lifecycle_state, p.created_at, p.updated_at
           FROM project p JOIN project_member m ON m.project_id = p.id
          WHERE p.tenant_id = ? AND m.user_id = ? AND p.status ${test} ORDER BY p.created_at DESC`,
        [ctx.tenantId, ctx.user.id]
      );
  return ok(rows);
});

const CreateProject = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  client_name: z.string().optional(),
  lifecycle_key: z.string().optional(),
});

// §1.7 POST /projects — create project + creator as member; audit.
export const POST = route(async (req, ctx) => {
  requirePermission(ctx, "project.create");
  const body = CreateProject.parse(await req.json());
  const id = newId();
  // Start state comes from the PACK's lifecycle (domain-neutral) — never hardcoded
  // per domain. No lifecycle → 'start' placeholder (the project still accretes artifacts).
  const startState = body.lifecycle_key
    ? (await getLifecycle(ctx.tenantId, body.lifecycle_key))?.start ?? "start"
    : "start";
  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      `INSERT INTO project (id, tenant_id, name, code, client_name, status, lifecycle_key, lifecycle_state, created_by)
       VALUES (?,?,?,?,?, 'active', ?, ?, ?)`,
      [id, ctx.tenantId, body.name, body.code ?? null, body.client_name ?? null, body.lifecycle_key ?? null, startState, ctx.user.id]
    );
    await query("INSERT INTO project_member (tenant_id, project_id, user_id) VALUES (?,?,?)", [
      ctx.tenantId,
      id,
      ctx.user.id,
    ]);
    audit({ action: "project.create", targetKind: "project", targetId: id, projectId: id, summary: { name: body.name } });
  });
  return ok({ id }, 201);
});

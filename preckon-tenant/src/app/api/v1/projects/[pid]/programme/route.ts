import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { emitArtifact } from "@/lib/store";

// The programme's own state and the rows a person adds to it by hand.
//
// Activities the agent proposed are artifacts under review like anything else.
// Rows a planner adds are also artifacts, but emitted as source "human": there
// is no proposal to confirm when a person types the activity themselves.

const Settings = z.object({
  // ISO date, or null to go back to relative "day N" mode.
  commencement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const NewActivity = z.object({
  activity: z.string().min(1).max(300),
  kind: z.enum(["section", "activity"]).default("activity"),
  parent: z.string().max(300).nullable().optional(),
  phase: z.string().max(120).optional(),
  duration_days: z.number().min(0).max(3650).default(1),
  start_offset_days: z.number().int().min(0).default(0),
  is_milestone: z.boolean().default(false),
  seq: z.number().int().optional(),
});

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const settings = await queryOne<{ commencement_date: string | null }>(
    "SELECT DATE_FORMAT(commencement_date, '%Y-%m-%d') AS commencement_date FROM project_programme WHERE tenant_id = ? AND project_id = ?",
    [ctx.tenantId, pid]
  );
  // Who work can be assigned to. A programme that can only name people with a
  // login can't represent a subcontractor, so the UI also accepts free text —
  // this is the convenience list, not a constraint.
  const members = await query<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email
       FROM project_member m JOIN app_user u ON u.id = m.user_id
      WHERE m.tenant_id = ? AND m.project_id = ? AND u.status = 'active'
      ORDER BY u.name`,
    [ctx.tenantId, pid]
  );
  return ok({ commencement_date: settings?.commencement_date ?? null, members });
});

export const PUT = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Settings.parse(await req.json());

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      `INSERT INTO project_programme (project_id, tenant_id, commencement_date, updated_by)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE commencement_date = VALUES(commencement_date), updated_by = VALUES(updated_by)`,
      [pid, ctx.tenantId, body.commencement_date, ctx.user.id]
    );
    audit({
      action: "programme.settings",
      targetKind: "project",
      targetId: pid,
      projectId: pid,
      summary: { commencement_date: body.commencement_date },
    });
  });
  return ok({ commencement_date: body.commencement_date });
});

// POST — add a row by hand: a section, an activity, or a milestone.
export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const b = NewActivity.parse(await req.json());

  const id = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const emitted = await emitArtifact(
      {
        tenantId: ctx.tenantId,
        projectId: pid,
        typeKey: "schedule_activity",
        payload: {
          activity: b.activity,
          kind: b.kind,
          ...(b.parent ? { parent: b.parent } : {}),
          ...(b.phase ? { phase: b.phase } : {}),
          // A section's dates are rolled up from its children, and a milestone
          // is an instant — neither carries a duration of its own.
          duration_days: b.kind === "section" || b.is_milestone ? 0 : b.duration_days,
          start_offset_days: b.start_offset_days,
          is_milestone: b.is_milestone,
          predecessors: [],
          depends_on: [],
          ...(b.seq != null ? { seq: b.seq } : {}),
        },
        // Typed by a planner, so there is nothing for anyone to confirm.
        source: "human",
        createdBy: ctx.user.id,
      } as any,
      audit
    );
    audit({
      action: "programme.activity.add",
      targetKind: "artifact",
      targetId: emitted.id,
      projectId: pid,
      summary: { activity: b.activity, kind: b.kind },
    });
    return emitted.id;
  });

  return ok({ id }, 201);
});

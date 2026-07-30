import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { actorFromCtx } from "@/lib/usecase";
import { assertWorkflowLicensed } from "@/lib/entitlements";
import { startRun } from "@/lib/runtime";

// §4.6 GET /projects/{pid}/runs — runs on the project.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const runs = await query(
    "SELECT id, workflow_key, workflow_version, status, started_at, ended_at FROM workflow_run WHERE tenant_id = ? AND project_id = ? ORDER BY started_at DESC",
    [ctx.tenantId, pid]
  );
  return ok(runs);
});

const StartRun = z.object({ workflow_key: z.string().min(1) });

// §4.6 POST /projects/{pid}/runs — resolve + start a run; dispatch ready steps; audit.
export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  const body = StartRun.parse(await req.json());
  await assertWorkflowLicensed(ctx.tenantId, body.workflow_key); // §8.3 entitlement check

  const runId = await startRun(actorFromCtx(ctx), {
    tenantId: ctx.tenantId,
    projectId: pid,
    userId: ctx.user.id,
    workflowKey: body.workflow_key,
  });
  return ok({ id: runId }, 201);
});

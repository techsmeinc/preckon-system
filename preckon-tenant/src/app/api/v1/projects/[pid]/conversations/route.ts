import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";

// §6.3 GET /projects/{pid}/conversations — list Copilot/persona threads.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const rows = await query(
    "SELECT id, run_id, supervisor_key, title, created_at FROM orchestrator_conversation WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC",
    [ctx.tenantId, pid]
  );
  return ok(rows);
});

const Create = z.object({
  run_id: z.string().optional(),
  supervisor_key: z.string().optional(),
  title: z.string().optional(),
});

// §6.3 POST /projects/{pid}/conversations — start a thread (project- or run-scoped).
export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "workflow.read");
  await requireProject(ctx, pid);
  const body = Create.parse(await req.json().catch(() => ({})));
  const id = newId();
  await query(
    "INSERT INTO orchestrator_conversation (id, tenant_id, project_id, run_id, supervisor_key, title, created_by) VALUES (?,?,?,?,?,?,?)",
    [id, ctx.tenantId, pid, body.run_id ?? null, body.supervisor_key ?? null, body.title ?? "Conversation", ctx.user.id]
  );
  return ok({ id }, 201);
});

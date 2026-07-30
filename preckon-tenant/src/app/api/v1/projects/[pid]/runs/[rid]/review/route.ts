import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { reviewRun } from "@/lib/persona";

// §6.3 POST /projects/{pid}/runs/{rid}/review — enqueue a proactive Copilot sweep.
const Body = z.object({ supervisor_key: z.string().optional() }).optional();

export const POST = route<{ pid: string; rid: string }>(async (req, ctx, { pid, rid }) => {
  requirePermission(ctx, "workflow.run");
  await requireProject(ctx, pid);
  const body = Body.parse(await req.json().catch(() => ({})));
  const jobId = await reviewRun({
    tenantId: ctx.tenantId,
    projectId: pid,
    runId: rid,
    supervisorKey: body?.supervisor_key,
  });
  return ok({ jobId }, 202);
});

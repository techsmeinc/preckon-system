import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { listArtifacts } from "@/lib/store";

// GET /projects/{pid}/standards/violations — the standard_violation findings.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const rows = await listArtifacts({ tenantId: ctx.tenantId, projectId: pid, typeKey: "standard_violation" });
  return ok(rows.filter((r) => r.status !== "superseded"));
});

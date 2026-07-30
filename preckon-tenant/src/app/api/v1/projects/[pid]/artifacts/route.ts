import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { listArtifacts, type ArtifactStatus } from "@/lib/store";

// §2.6 GET /projects/{pid}/artifacts?type=&status= — the project's graph.
export const GET = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const url = new URL(req.url);
  const rows = await listArtifacts({
    tenantId: ctx.tenantId,
    projectId: pid,
    typeKey: url.searchParams.get("type") ?? undefined,
    status: (url.searchParams.get("status") as ArtifactStatus) ?? undefined,
  });
  return ok(rows);
});

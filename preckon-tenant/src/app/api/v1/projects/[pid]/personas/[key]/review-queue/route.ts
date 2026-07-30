import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";

// §6.4.5 GET /projects/{pid}/personas/{key}/review-queue — the persona's scoped
// lens: review_queue ∩ the persona's scope.artifact_types.
export const GET = route<{ pid: string; key: string }>(async (_req, ctx, { pid, key }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const profile = await queryOne<{ scope: any }>(
    "SELECT scope FROM supervisor_profile WHERE agent_key = ?",
    [key]
  );
  if (!profile) throw errNotFound("Persona");
  const types: string[] = profile.scope?.artifact_types ?? [];
  const all = await query<any>(
    "SELECT id, type_key, source_agent_key, confidence, created_at FROM review_queue WHERE tenant_id = ? AND project_id = ?",
    [ctx.tenantId, pid]
  );
  const lens = types.length ? all.filter((r) => types.some((t) => r.type_key.endsWith(t))) : all;
  return ok(lens);
});

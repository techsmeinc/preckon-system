import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { getArtifact, editArtifact } from "@/lib/store";
import { errNotFound } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";

// §2.6 GET /projects/{pid}/artifacts/{id} — artifact detail.
export const GET = route<{ pid: string; id: string }>(async (_req, ctx, { pid, id }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const a = await getArtifact(ctx.tenantId, id);
  if (!a || a.project_id !== pid) throw errNotFound("Artifact");
  return ok(a);
});

const Patch = z.object({ payload: z.record(z.unknown()) });

// §2.6 PATCH /projects/{pid}/artifacts/{id} — new version supersedes current;
// markDownstreamStale; audit. This is the re-plan trigger (§2.4).
export const PATCH = route<{ pid: string; id: string }>(async (req, ctx, { pid, id }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Patch.parse(await req.json());
  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) =>
    editArtifact(ctx.tenantId, id, body.payload, ctx.user.id, audit)
  );
  return ok({ id: result.newId, superseded: id, staleCount: result.staleIds.length });
});

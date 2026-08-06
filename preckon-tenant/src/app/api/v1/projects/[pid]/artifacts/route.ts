import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { emitArtifact } from "@/lib/store";
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

// POST /projects/{pid}/artifacts — write a record by hand.
//
// The chain assumes an agent produced everything, and mostly one has. But a
// stage that read nothing useful left the estimator with a screen of zeroes and
// no way forward: TenderLogix finds no mandatory requirements, and there is no
// button anywhere that says "there is one, here it is". A bid does not wait for
// the software to catch up.
//
// What is written here is marked `human`, so it is a confirmed record from the
// moment it exists rather than a proposal nobody proposed — and the audit chain
// records who wrote it. It goes through the same schema validation as anything
// an agent emits, so a hand-written record cannot be shaped differently from a
// derived one.
const Create = z.object({
  type_key: z.string().min(3).max(120),
  payload: z.record(z.unknown()),
});

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Create.parse(await req.json());

  const created = await useCase(actorFromCtx(ctx), async (_conn, audit) =>
    emitArtifact(
      {
        tenantId: ctx.tenantId,
        projectId: pid,
        typeKey: body.type_key,
        payload: body.payload,
        source: "human",
        createdBy: ctx.user.id,
      },
      audit
    )
  );

  return ok({ id: created.id, type_key: body.type_key, status: created.status });
});

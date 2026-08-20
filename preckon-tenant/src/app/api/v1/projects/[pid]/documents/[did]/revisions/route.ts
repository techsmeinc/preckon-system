import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { listRevisions, addRevision } from "@/lib/doc/store";
import { SUITABILITY } from "@/lib/doc/revision";

// Formal revisions of one controlled document.
//
// Creating a revision leaves it a draft by default. Issuing is a separate act,
// usually by a different person, and it is the point at which supersession
// happens and the previous revision becomes the historical record.

const NewRevision = z.object({
  revision_code: z.string().max(16).optional(),
  scheme: z.enum(["alpha", "numeric", "iso19650"]).optional(),
  suitability: z.string().max(8).nullish(),
  description: z.string().max(500).nullish(),
  file_id: z.string().max(64).nullish(),
  /** Issue straight away rather than leaving a draft. */
  issue: z.boolean().default(false),
});

export const GET = route<{ pid: string; did: string }>(async (_req, ctx, { pid, did }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const revisions = await listRevisions(ctx.tenantId, did);

  return ok({
    revisions,
    // The suitability list travels with the response so the issue form does not
    // have to keep its own copy of ISO 19650 in the client.
    suitability: Object.entries(SUITABILITY).map(([code, v]) => ({
      code, label: v.label, published: v.published,
    })),
  });
});

export const POST = route<{ pid: string; did: string }>(async (req, ctx, { pid, did }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const b = NewRevision.parse(await req.json());

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const created = await addRevision(ctx.tenantId, pid, did, {
      revisionCode: b.revision_code,
      scheme: b.scheme,
      suitability: b.suitability ?? null,
      description: b.description ?? null,
      fileId: b.file_id ?? null,
      issue: b.issue,
      userId: ctx.user.id,
    });

    audit({
      action: b.issue ? "document.revision.issue" : "document.revision.create",
      targetKind: "document_revision",
      targetId: created.id,
      projectId: pid,
      summary: { document_id: did, revision: created.revisionCode, why: created.why },
    });

    return created;
  });

  return ok({ id: result.id, revision_code: result.revisionCode, why: result.why }, 201);
});

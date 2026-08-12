import { uuidv7 } from "uuidv7";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errBadRequest } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";
import {
  bimDocumentToObjects, commitChangeSet, openChangeSet, recomputeQuantities, stageOps, type DraftOp,
} from "@/lib/pcm/store";

// POST /projects/{pid}/pcm/publish — BIM Studio's model becomes PCM objects.
//
// Until now the studio held one JSON document per project. Its walls were
// entries in a blob: they could be drawn and they could be exported, and that
// was the end of them. Nothing downstream could point at one, so a bill line
// could never say which wall it came from.
//
// Publishing gives every element a stable identity, a type, a measurement and a
// place in the graph. The same wall is now something a quantity, a bill line, a
// purchase order and an inspection can all reference — which is the entire
// premise of the platform, and the first time it is actually true.
//
// Everything goes through a ChangeSet. There is no shortcut path into the model
// for a bulk import, because the moment there is one, the guarantee that every
// change is previewable and audited stops being a guarantee.

export const POST = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const row = await queryOne<{ doc: any }>(
    "SELECT doc FROM bim_document WHERE tenant_id = ? AND project_id = ?",
    [ctx.tenantId, pid]
  );
  const doc = typeof row?.doc === "string" ? JSON.parse(row.doc) : row?.doc;
  if (!doc?.order?.length) {
    throw errBadRequest("There is nothing in BIM Studio to publish yet — model something first.");
  }

  const { objects, skipped } = bimDocumentToObjects(doc);
  if (!objects.length) throw errBadRequest("Nothing in this model could be mapped to a construction object.");

  const scope = { tenantId: ctx.tenantId, projectId: pid, userId: ctx.user.id };

  const result = await useCase(actorFromCtx(ctx), async (conn, audit) => {
    const cs = await openChangeSet(scope, {
      changeType: "IMPORT",
      title: `Publish BIM Studio model (${objects.length} objects)`,
      description: "Studio elements mapped to PCM construction objects.",
    });

    // Studio ids are local to the document; PCM ids are permanent. The map
    // carries hosting across the boundary — a door knows its wall by studio id,
    // and the HOSTED_BY edge has to be written with the PCM ids.
    const pcmIdFor = new Map<string, string>();
    for (const o of objects) pcmIdFor.set(o.studioId, uuidv7());

    const ops: DraftOp[] = objects.map((o) => ({
      operation: "CREATE",
      entityType: "pcm_object",
      entityId: pcmIdFor.get(o.studioId)!,
      after: o,
    }));

    for (const o of objects) {
      if (!o.hostId) continue;
      const host = pcmIdFor.get(o.hostId);
      // A door whose wall was not published cannot be hosted. Dropped rather
      // than pointed at nothing: a dangling edge would make the wall's
      // deduction silently wrong later.
      if (!host) continue;
      ops.push({
        operation: "RELATE",
        entityType: "pcm_relationship",
        entityId: uuidv7(),
        after: {
          sourceEntityId: pcmIdFor.get(o.studioId),
          relationshipType: "HOSTED_BY",
          targetEntityId: host,
          sourceMethod: "IMPORT",
        },
      });
    }

    await stageOps(scope, cs.id, ops);
    const committed = await commitChangeSet(conn, scope, cs.id);

    audit({
      action: "pcm.published",
      targetKind: "pcm_change_set",
      targetId: cs.id,
      summary: { objects: objects.length, revision: committed.revision, skipped },
    });

    return { changeSetId: cs.id, ...committed };
  });

  // Measured after the commit, not inside it: a commit must be atomic and fast,
  // and measuring a thousand walls is neither. Until this finishes the
  // quantities are DIRTY, which the UI shows rather than hides.
  const measured = await recomputeQuantities(scope);

  return ok({
    objects: objects.length,
    skipped,
    revision: result.revision,
    quantities: measured.measured,
    changeSetId: result.changeSetId,
  }, 201);
});

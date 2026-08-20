import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { issueRevision } from "@/lib/doc/store";
import { issueBlocked } from "@/lib/doc/review-store";

// Issue a draft revision.
//
// Separate from creating it because the person who uploads a drawing is rarely
// the person with the authority to issue it, and because issuing is the moment
// supersession happens — the previous current revision becomes the record of
// what was issued before, and stops being editable.
//
// Requires artifact.confirm rather than artifact.edit: issuing is an approval,
// not an edit.

export const POST = route<{ pid: string; did: string; rid: string }>(
  async (_req, ctx, { pid, did, rid }) => {
    requirePermission(ctx, "artifact.confirm");
    await requireProject(ctx, pid);

    /* The review gate.
       A revision with review cycles open, or settled at an outcome that does
       not permit issue, cannot be issued. Where no review was ever asked for,
       nothing blocks — the gate enforces the reviews a project configured, it
       does not invent a requirement the project never set. The refusal carries
       the reason, because "blocked by review" without saying which one gets
       worked around rather than resolved. */
    const blocked = await issueBlocked(ctx.tenantId, rid);
    if (blocked) {
      return ok({ error: "review_incomplete", message: blocked }, 409);
    }

    const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
      const issued = await issueRevision(ctx.tenantId, did, rid);
      audit({
        action: "document.revision.issue",
        targetKind: "document_revision",
        targetId: rid,
        projectId: pid,
        summary: { document_id: did, why: issued.why },
      });
      return issued;
    });

    return ok(result);
  },
);

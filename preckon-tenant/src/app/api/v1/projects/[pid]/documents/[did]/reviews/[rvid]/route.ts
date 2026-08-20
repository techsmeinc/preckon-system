import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { decide, addComment } from "@/lib/doc/review-store";

// One party's decision on a review cycle, and comments against it.
//
// The decision and the cycle's outcome are recorded in the same call: the
// moment the last approval lands is the moment the document becomes issuable,
// and any gap between those two facts is a gap in which somebody issues
// something that is not yet approved.

const Decide = z.object({
  party: z.string().min(1).max(255),
  decision: z.enum(["approved", "approved_with_comments", "revise_and_resubmit", "rejected"]),
  note: z.string().max(1000).nullish(),
});

const Comment = z.object({
  revision_id: z.string().max(64),
  body: z.string().min(1).max(4000),
  /** A blocking comment stops issue even where the decision would allow it. */
  blocking: z.boolean().default(false),
  party: z.string().max(255).nullish(),
  region_id: z.string().max(64).nullish(),
});

export const POST = route<{ pid: string; did: string; rvid: string }>(
  async (req, ctx, { pid, rvid }) => {
    requirePermission(ctx, "artifact.edit");
    await requireProject(ctx, pid);
    const body = await req.json();

    // Two shapes on one route: a decision, or a comment. Kept together because
    // "I approve with comments" is one action to the person doing it.
    if (body?.body != null) {
      const c = Comment.parse(body);
      const id = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
        const commentId = await addComment({
          tenantId: ctx.tenantId, projectId: pid, revisionId: c.revision_id,
          reviewId: rvid, body: c.body, blocking: c.blocking,
          authorId: ctx.user.id, authorParty: c.party ?? null, regionId: c.region_id ?? null,
        });
        audit({
          action: "document.review.comment", targetKind: "document_review", targetId: rvid,
          projectId: pid, summary: { blocking: c.blocking },
        });
        return commentId;
      });
      return ok({ id }, 201);
    }

    const d = Decide.parse(body);
    const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
      const r = await decide({
        tenantId: ctx.tenantId, reviewId: rvid, party: d.party,
        decision: d.decision, note: d.note ?? null, userId: ctx.user.id,
      });
      if (r.ok) {
        audit({
          action: "document.review.decide", targetKind: "document_review", targetId: rvid,
          projectId: pid, summary: { party: d.party, decision: d.decision, outcome: r.outcome },
        });
      }
      return r;
    });

    if (!result.ok) return ok({ error: "not_permitted", message: result.reason }, 409);
    return ok({ status: result.status, outcome: result.outcome });
  },
);

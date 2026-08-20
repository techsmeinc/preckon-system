import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { listRevisions } from "@/lib/doc/store";
import { openReview, cyclesFor, openReviews } from "@/lib/doc/review-store";
import { reviewState, describeReview } from "@/lib/doc/review";
import { DEFAULT_WORKFLOW, planStages, totalDurationDays } from "@/lib/doc/workflow";

// Review cycles on a revision.
//
// review.ts and workflow.ts already held the rules; until this route existed
// neither could be reached from outside the process, so "an unapproved drawing
// cannot be issued" was true only in a unit test.

const Open = z.object({
  revision_id: z.string().max(64),
  stage: z.string().max(64).default("internal"),
  /** 0 means every assignee must approve. */
  min_approvals: z.number().int().min(0).max(20).default(0),
  due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  parties: z.array(z.string().min(1).max(255)).min(1),
});

export const GET = route<{ pid: string; did: string }>(async (req, ctx, { pid, did }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const url = new URL(req.url);
  // ?all=true answers the workspace question - everything open on this project -
  // rather than the document one. Same handler because they are the same rows.
  if (url.searchParams.get("all") === "true") {
    return ok({ reviews: await openReviews(ctx.tenantId, pid) });
  }

  const revisions = await listRevisions(ctx.tenantId, did);
  const out = [];
  for (const rev of revisions) {
    const cycles = await cyclesFor(ctx.tenantId, rev.id);
    if (!cycles.length) continue;
    out.push({
      revision_id: rev.id,
      revision_code: rev.revisionCode ?? rev.revision_code,
      cycles: cycles.map((c) => ({
        id: c.id,
        status: c.status,
        state: reviewState(c),
        description: describeReview(c),
        assignees: c.assignees,
      })),
    });
  }

  // The plan is returned alongside so a submitter can see what review will cost
  // them in days before they ask for it.
  const plan = planStages(DEFAULT_WORKFLOW, {});
  return ok({ reviews: out, workflow: { key: DEFAULT_WORKFLOW.key, name: DEFAULT_WORKFLOW.name, stages: plan, days: totalDurationDays(plan) } });
});

export const POST = route<{ pid: string; did: string }>(async (req, ctx, { pid, did }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const b = Open.parse(await req.json());

  const revisions = await listRevisions(ctx.tenantId, did);
  if (!revisions.some((r) => r.id === b.revision_id)) {
    return ok({ error: "unknown_revision", message: "That revision does not belong to this document." }, 404);
  }

  const id = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const reviewId = await openReview({
      tenantId: ctx.tenantId,
      projectId: pid,
      revisionId: b.revision_id,
      stage: b.stage,
      minApprovals: b.min_approvals,
      dueAt: b.due_at ? `${b.due_at} 17:00:00` : null,
      assignees: b.parties.map((party) => ({ party })),
      openedBy: ctx.user.id,
    });
    audit({
      action: "document.review.open",
      targetKind: "document_review",
      targetId: reviewId,
      projectId: pid,
      summary: { revision_id: b.revision_id, stage: b.stage, parties: b.parties },
    });
    return reviewId;
  });

  return ok({ id }, 201);
});

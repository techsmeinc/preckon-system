// Review cycles, persisted.
//
// review.ts already decided what a review MEANS — who has to approve, what
// outcome a set of decisions produces, whether that outcome permits issue. It
// had no way to store any of it, so the rule "an unapproved drawing cannot be
// issued" existed in a pure function nobody could reach.
//
// This is that seam. It deliberately keeps the reasoning in review.ts: nothing
// here decides an outcome, it loads the rows, hands them to reviewState(), and
// writes back what came out. Two places deciding whether a document is approved
// is how a document ends up approved in one screen and not in another.

import { query, queryOne } from "../db";
import { newId } from "../ids";
import {
  reviewState, canIssue, issueBlockedReason,
  type Decision, type ReviewCycle,
} from "./review";

export interface OpenReviewInput {
  tenantId: string;
  projectId: string;
  revisionId: string;
  stage?: string;
  /** How many approvals this stage needs. 0 means "everyone assigned". */
  minApprovals?: number;
  dueAt?: string | null;
  assignees: { party: string; userId?: string | null }[];
  openedBy?: string | null;
}

export async function openReview(input: OpenReviewInput): Promise<string> {
  const id = newId();
  await query(
    `INSERT INTO document_review
       (id, tenant_id, project_id, revision_id, stage, status, min_approvals, due_at, opened_by)
     VALUES (?,?,?,?,?, 'open', ?,?,?)`,
    [id, input.tenantId, input.projectId, input.revisionId, input.stage ?? "internal",
     input.minApprovals ?? 0, input.dueAt ?? null, input.openedBy ?? null],
  );
  for (const a of input.assignees) {
    await query(
      `INSERT INTO document_review_assignee (id, tenant_id, review_id, party, user_id, decision)
       VALUES (?,?,?,?,?, 'pending')`,
      [newId(), input.tenantId, id, a.party, a.userId ?? null],
    );
  }
  return id;
}

/** Load cycles in the shape review.ts expects. */
export async function cyclesFor(tenantId: string, revisionId: string): Promise<ReviewCycle[]> {
  const rows = await query<any>(
    `SELECT id, stage, status, min_approvals, due_at, outcome
       FROM document_review WHERE tenant_id = ? AND revision_id = ? ORDER BY opened_at`,
    [tenantId, revisionId],
  );
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const assignees = await query<any>(
    `SELECT review_id, party, decision, decided_at, note
       FROM document_review_assignee WHERE tenant_id = ? AND review_id IN (${ids.map(() => "?").join(",")})`,
    [tenantId, ...ids],
  );
  const comments = await query<any>(
    `SELECT review_id, id, body, status, is_blocking, author_party
       FROM document_comment WHERE tenant_id = ? AND review_id IN (${ids.map(() => "?").join(",")})`,
    [tenantId, ...ids],
  );

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    minApprovals: Number(r.min_approvals ?? 0),
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : undefined,
    outcome: r.outcome ?? undefined,
    assignees: assignees
      .filter((a) => a.review_id === r.id)
      .map((a) => ({
        party: a.party,
        decision: a.decision as Decision,
        decidedAt: a.decided_at ? new Date(a.decided_at).toISOString() : undefined,
      })),
    comments: comments
      .filter((c) => c.review_id === r.id)
      .map((c) => ({ id: c.id, status: c.status, isBlocking: !!c.is_blocking })),
  })) as ReviewCycle[];
}

export interface DecideInput {
  tenantId: string;
  reviewId: string;
  party: string;
  decision: Exclude<Decision, "pending">;
  note?: string | null;
  userId?: string | null;
}

export interface DecideResult {
  ok: boolean;
  reason?: string;
  /** The cycle's outcome once this decision landed, or null while still open. */
  outcome: string | null;
  status: string;
}

/**
 * Record one party's decision, then let review.ts say what it means.
 *
 * The cycle is closed here rather than by a later job because the moment the
 * last approval lands is the moment the document becomes issuable, and a gap
 * between those two facts is a gap in which somebody issues something that is
 * not yet approved.
 */
export async function decide(input: DecideInput): Promise<DecideResult> {
  const review = await queryOne<any>(
    `SELECT id, revision_id, status FROM document_review WHERE tenant_id = ? AND id = ?`,
    [input.tenantId, input.reviewId],
  );
  if (!review) return { ok: false, reason: "No such review.", outcome: null, status: "unknown" };
  if (review.status !== "open") {
    return { ok: false, reason: `This review is ${review.status}.`, outcome: null, status: review.status };
  }

  const updated = await query<any>(
    `UPDATE document_review_assignee
        SET decision = ?, note = ?, decided_at = NOW(3), user_id = COALESCE(?, user_id)
      WHERE tenant_id = ? AND review_id = ? AND party = ?`,
    [input.decision, input.note ?? null, input.userId ?? null, input.tenantId, input.reviewId, input.party],
  );
  if (!(updated as any)?.affectedRows) {
    return { ok: false, reason: `${input.party} is not a reviewer on this cycle.`, outcome: null, status: "open" };
  }

  const cycles = await cyclesFor(input.tenantId, review.revision_id);
  const cycle = cycles.find((c) => c.id === input.reviewId)!;
  const state = reviewState(cycle);

  /* review.ts is the judge of whether the cycle can close: `canComplete` means
     enough people have answered and no blocking comment is outstanding. A
     cycle is never closed here on a count of decisions, because "everyone
     approved but one blocking comment is unresolved" is exactly the case that
     must NOT close. */
  const settled = state.canComplete && state.outcome != null;
  if (settled) {
    await query(
      `UPDATE document_review SET status = 'completed', outcome = ?, closed_at = NOW(3)
        WHERE tenant_id = ? AND id = ?`,
      [state.outcome, input.tenantId, input.reviewId],
    );
  }
  return {
    ok: true,
    outcome: settled ? state.outcome : null,
    status: settled ? "completed" : "open",
  };
}

export async function addComment(input: {
  tenantId: string; projectId: string; revisionId: string; reviewId?: string | null;
  body: string; blocking?: boolean; authorId?: string | null; authorParty?: string | null;
  regionId?: string | null;
}): Promise<string> {
  const id = newId();
  await query(
    `INSERT INTO document_comment
       (id, tenant_id, project_id, revision_id, review_id, region_id, body, is_blocking, author_id, author_party)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.tenantId, input.projectId, input.revisionId, input.reviewId ?? null,
     input.regionId ?? null, input.body, input.blocking ? 1 : 0,
     input.authorId ?? null, input.authorParty ?? null],
  );
  return id;
}

/**
 * The gate.
 *
 * Asked by the issue route before it issues anything. Returns null when issue
 * is permitted and a sentence when it is not — the sentence goes straight to
 * the user, because "blocked by review" without saying which review and why is
 * the kind of error that gets worked around rather than resolved.
 */
export async function issueBlocked(tenantId: string, revisionId: string): Promise<string | null> {
  const cycles = await cyclesFor(tenantId, revisionId);
  if (!cycles.length) return null;          // nothing was asked for; nothing blocks
  return canIssue(cycles) ? null : issueBlockedReason(cycles);
}

/** Open reviews across a project, for the review workspace. */
export async function openReviews(tenantId: string, projectId: string) {
  return query<any>(
    `SELECT rv.id, rv.stage, rv.status, rv.due_at, rv.min_approvals,
            r.revision_code, r.suitability, d.document_number, d.title, r.id AS revision_id,
            (SELECT COUNT(*) FROM document_review_assignee a
              WHERE a.review_id = rv.id AND a.decision = 'pending') AS pending,
            (SELECT COUNT(*) FROM document_review_assignee a WHERE a.review_id = rv.id) AS reviewers
       FROM document_review rv
       JOIN document_revision r ON r.id = rv.revision_id
       JOIN document_register d ON d.id = r.document_id
      WHERE rv.tenant_id = ? AND rv.project_id = ? AND rv.status = 'open'
      ORDER BY rv.due_at IS NULL, rv.due_at`,
    [tenantId, projectId],
  );
}

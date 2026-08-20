/**
 * Document review — the part of a project that silently absorbs float.
 *
 * A review with no due date is a request nobody can be late for. A review whose
 * outcome is somebody's summary of the comments is a review that can be argued
 * about later. Both are ordinary, and both are why drawings sit unapproved while
 * the programme assumes they were issued weeks ago.
 *
 * So: a cycle has a date, reviewers give contractual response codes rather than
 * opinions, and the outcome is DERIVED from those codes rather than typed by
 * whoever closed it.
 *
 * ── RESPONSE CODES ARE OBLIGATIONS ───────────────────────────────────────────
 *
 * "Revise and resubmit" is not a strong opinion — it obliges the originator to
 * produce another revision, and it means the current one must not be built from.
 * Treating it as a variant of "approved with comments" is how unapproved design
 * reaches site, so the two are kept apart and the harsher one always wins.
 */

export type Decision =
  | "pending"
  | "approved"
  | "approved_with_comments"
  | "revise_and_resubmit"
  | "rejected";

export type Outcome = Exclude<Decision, "pending">;

export interface Assignee {
  party: string;
  decision: Decision;
  decidedAt?: string | null;
}

export interface Comment {
  id: string;
  status: "open" | "resolved" | "withdrawn";
  /** A comment that obliges a change before this revision can be issued. */
  isBlocking: boolean;
}

export interface ReviewCycle {
  id: string;
  status: "open" | "completed" | "cancelled";
  /** How many approvals are needed. 0 means every assignee must respond. */
  minApprovals: number;
  dueAt?: string | null;
  assignees: Assignee[];
  comments?: Comment[];
}

/**
 * Severity order. The harshest response reached by anyone decides the outcome.
 *
 * One reviewer approving does not soften another reviewer's rejection, and a
 * system that averages responses produces an outcome nobody actually gave.
 */
const SEVERITY: Record<Outcome, number> = {
  approved: 0,
  approved_with_comments: 1,
  revise_and_resubmit: 2,
  rejected: 3,
};

/** Whether this response permits the revision to be issued and built from. */
export function permitsIssue(d: Decision): boolean {
  return d === "approved" || d === "approved_with_comments";
}

export interface ReviewState {
  responded: number;
  outstanding: string[];
  approvals: number;
  /** The outcome this cycle would close with, or null while undecided. */
  outcome: Outcome | null;
  canComplete: boolean;
  blockingComments: number;
  why: string;
}

/**
 * What the cycle currently amounts to.
 *
 * Derived on every read rather than stored, so the state cannot drift from the
 * responses that justify it — a completed review whose assignees never answered
 * is exactly the kind of thing nobody notices until it is quoted in a claim.
 */
export function reviewState(cycle: ReviewCycle): ReviewState {
  const assignees = cycle.assignees ?? [];
  const decided = assignees.filter((a) => a.decision !== "pending");
  const outstanding = assignees.filter((a) => a.decision === "pending").map((a) => a.party);
  const approvals = assignees.filter((a) => permitsIssue(a.decision)).length;

  const blockingComments = (cycle.comments ?? [])
    .filter((c) => c.isBlocking && c.status === "open").length;

  const outcome = decided.length
    ? (decided
        .map((a) => a.decision as Outcome)
        .reduce((worst, d) => (SEVERITY[d] > SEVERITY[worst] ? d : worst)))
    : null;

  // Either the required number of approvals exists, or — when none was set —
  // everybody assigned has answered.
  const quorum = cycle.minApprovals > 0
    ? approvals >= cycle.minApprovals
    : assignees.length > 0 && outstanding.length === 0;

  // An open blocking comment stops completion whatever the votes say. Somebody
  // has asserted the revision cannot be issued as it stands, and closing the
  // review would bury that.
  const canComplete = cycle.status === "open" && quorum && blockingComments === 0;

  const why = cycle.status !== "open"
    ? `This review is ${cycle.status}.`
    : blockingComments > 0
      ? `${blockingComments} unresolved blocking comment${blockingComments === 1 ? "" : "s"} — resolve or withdraw ${blockingComments === 1 ? "it" : "them"} before closing.`
      : !quorum
        ? cycle.minApprovals > 0
          ? `${approvals} of ${cycle.minApprovals} required approvals.`
          : `Waiting on ${outstanding.length}: ${outstanding.join(", ")}.`
        : `Ready to close as ${outcome ?? "approved"}.`;

  return { responded: decided.length, outstanding, approvals, outcome, canComplete, blockingComments, why };
}

/** Whether the review is past its date with responses still outstanding. */
export function isOverdue(cycle: ReviewCycle, now = new Date()): boolean {
  if (cycle.status !== "open" || !cycle.dueAt) return false;
  const due = new Date(cycle.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime() && reviewState(cycle).outstanding.length > 0;
}

/** Days late, or 0. For the register column a document controller sorts on. */
export function daysOverdue(cycle: ReviewCycle, now = new Date()): number {
  if (!isOverdue(cycle, now)) return 0;
  const due = new Date(cycle.dueAt!).getTime();
  return Math.floor((now.getTime() - due) / 86_400_000);
}

/**
 * Why this revision may not be issued yet, or null if it may.
 *
 * The gate between review and issue. Without it a review is decoration: the
 * comments exist, and the drawing goes out regardless.
 */
export function issueBlockedReason(cycles: ReviewCycle[]): string | null {
  const open = cycles.filter((c) => c.status === "open");
  if (open.length) {
    return `${open.length} review${open.length === 1 ? " is" : "s are"} still open. Close ${open.length === 1 ? "it" : "them"} before issuing.`;
  }

  const completed = cycles.filter((c) => c.status === "completed");
  for (const c of completed) {
    const { outcome } = reviewState(c);
    if (outcome && !permitsIssue(outcome)) {
      return outcome === "rejected"
        ? "The last review rejected this revision. Issue a new revision instead."
        : "The last review returned revise and resubmit. Issue a new revision instead.";
    }
  }

  const blocking = cycles.flatMap((c) => c.comments ?? [])
    .filter((c) => c.isBlocking && c.status === "open").length;
  if (blocking) {
    return `${blocking} unresolved blocking comment${blocking === 1 ? "" : "s"}.`;
  }

  return null;
}

export function canIssue(cycles: ReviewCycle[]): boolean {
  return issueBlockedReason(cycles) === null;
}

/** One line for the register. */
export function describeReview(cycle: ReviewCycle, now = new Date()): string {
  const s = reviewState(cycle);
  if (cycle.status === "completed") return `Completed — ${s.outcome ?? "approved"}.`;
  if (cycle.status === "cancelled") return "Cancelled.";
  const late = daysOverdue(cycle, now);
  return late > 0 ? `${s.why} ${late} day${late === 1 ? "" : "s"} overdue.` : s.why;
}

// Review cycles and retention.
//
// Two places where getting the precedence wrong has consequences outside the
// software: unapproved design reaching site, and evidence destroyed during a
// dispute. Both are decided in one place with these tests on them rather than
// left to whoever writes the next query.

import { describe, it, expect } from "vitest";
import {
  reviewState, isOverdue, daysOverdue, issueBlockedReason, canIssue,
  permitsIssue, describeReview, type ReviewCycle,
} from "@/lib/doc/review";
import {
  canDelete, retentionExpiry, eligibleForDeletion, placeHold, liftHold,
  RETENTION_CATEGORIES, type RetainableRecord,
} from "@/lib/doc/retention";

// ── Review ───────────────────────────────────────────────────────────────────

const cycle = (over: Partial<ReviewCycle> = {}): ReviewCycle => ({
  id: "r1",
  status: "open",
  minApprovals: 0,
  assignees: [{ party: "Architect", decision: "pending" }],
  ...over,
});

describe("response codes are obligations", () => {
  it("lets an approval permit issue", () => {
    expect(permitsIssue("approved")).toBe(true);
    expect(permitsIssue("approved_with_comments")).toBe(true);
  });

  it("does not let revise-and-resubmit permit issue", () => {
    /* Treating it as a variant of "approved with comments" is how unapproved
       design reaches site. It obliges another revision. */
    expect(permitsIssue("revise_and_resubmit")).toBe(false);
    expect(permitsIssue("rejected")).toBe(false);
    expect(permitsIssue("pending")).toBe(false);
  });
});

describe("the outcome is derived, not typed", () => {
  it("takes the harshest response anyone gave", () => {
    /* One reviewer approving does not soften another's rejection, and averaging
       produces an outcome nobody actually gave. */
    const c = cycle({
      assignees: [
        { party: "A", decision: "approved" },
        { party: "B", decision: "rejected" },
      ],
    });
    expect(reviewState(c).outcome).toBe("rejected");
  });

  it("ranks revise-and-resubmit above approved-with-comments", () => {
    const c = cycle({
      assignees: [
        { party: "A", decision: "approved_with_comments" },
        { party: "B", decision: "revise_and_resubmit" },
      ],
    });
    expect(reviewState(c).outcome).toBe("revise_and_resubmit");
  });

  it("is null while nobody has responded", () => {
    expect(reviewState(cycle()).outcome).toBeNull();
  });
});

describe("when a cycle can close", () => {
  it("waits for everybody when no quorum is set", () => {
    const c = cycle({
      assignees: [
        { party: "A", decision: "approved" },
        { party: "B", decision: "pending" },
      ],
    });
    const s = reviewState(c);
    expect(s.canComplete).toBe(false);
    expect(s.outstanding).toEqual(["B"]);
    expect(s.why).toMatch(/waiting on 1: B/i);
  });

  it("closes once the required approvals exist", () => {
    const c = cycle({
      minApprovals: 1,
      assignees: [
        { party: "A", decision: "approved" },
        { party: "B", decision: "pending" },
      ],
    });
    expect(reviewState(c).canComplete).toBe(true);
  });

  it("reports progress towards the quorum", () => {
    const c = cycle({
      minApprovals: 2,
      assignees: [{ party: "A", decision: "approved" }, { party: "B", decision: "pending" }],
    });
    expect(reviewState(c).why).toMatch(/1 of 2 required approvals/i);
  });

  it("cannot close with an unresolved blocking comment, whatever the votes say", () => {
    /* Somebody has asserted the revision cannot be issued as it stands. Closing
       the review would bury that. */
    const c = cycle({
      assignees: [{ party: "A", decision: "approved" }],
      comments: [{ id: "c1", status: "open", isBlocking: true }],
    });
    const s = reviewState(c);
    expect(s.canComplete).toBe(false);
    expect(s.why).toMatch(/blocking comment/i);
  });

  it("ignores a resolved or withdrawn blocking comment", () => {
    const c = cycle({
      assignees: [{ party: "A", decision: "approved" }],
      comments: [
        { id: "c1", status: "resolved", isBlocking: true },
        { id: "c2", status: "withdrawn", isBlocking: true },
      ],
    });
    expect(reviewState(c).canComplete).toBe(true);
  });

  it("ignores a non-blocking open comment", () => {
    const c = cycle({
      assignees: [{ party: "A", decision: "approved" }],
      comments: [{ id: "c1", status: "open", isBlocking: false }],
    });
    expect(reviewState(c).canComplete).toBe(true);
  });

  it("cannot close a cycle that is already closed", () => {
    expect(reviewState(cycle({ status: "completed" })).canComplete).toBe(false);
  });
});

describe("overdue", () => {
  const past = "2020-01-01T00:00:00Z";
  const future = "2999-01-01T00:00:00Z";

  it("is overdue past the date with responses outstanding", () => {
    expect(isOverdue(cycle({ dueAt: past }))).toBe(true);
  });

  it("is not overdue once everybody has responded", () => {
    const c = cycle({ dueAt: past, assignees: [{ party: "A", decision: "approved" }] });
    expect(isOverdue(c)).toBe(false);
  });

  it("is not overdue before the date", () => {
    expect(isOverdue(cycle({ dueAt: future }))).toBe(false);
  });

  it("is not overdue with no date set", () => {
    expect(isOverdue(cycle())).toBe(false);
  });

  it("survives an unparseable date", () => {
    expect(isOverdue(cycle({ dueAt: "whenever" }))).toBe(false);
  });

  it("counts the days", () => {
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(daysOverdue(cycle({ dueAt: due }))).toBe(3);
  });
});

describe("the gate between review and issue", () => {
  it("blocks while a review is open", () => {
    // Without this a review is decoration: the comments exist and the drawing
    // goes out regardless.
    expect(canIssue([cycle()])).toBe(false);
    expect(issueBlockedReason([cycle()])).toMatch(/still open/i);
  });

  it("blocks after revise-and-resubmit", () => {
    const c = cycle({ status: "completed", assignees: [{ party: "A", decision: "revise_and_resubmit" }] });
    expect(issueBlockedReason([c])).toMatch(/new revision/i);
  });

  it("blocks after rejection", () => {
    const c = cycle({ status: "completed", assignees: [{ party: "A", decision: "rejected" }] });
    expect(issueBlockedReason([c])).toMatch(/rejected/i);
  });

  it("allows issue after approval", () => {
    const c = cycle({ status: "completed", assignees: [{ party: "A", decision: "approved" }] });
    expect(canIssue([c])).toBe(true);
  });

  it("allows issue after approval with comments", () => {
    const c = cycle({ status: "completed", assignees: [{ party: "A", decision: "approved_with_comments" }] });
    expect(canIssue([c])).toBe(true);
  });

  it("blocks on an unresolved blocking comment even after approval", () => {
    const c = cycle({
      status: "completed",
      assignees: [{ party: "A", decision: "approved" }],
      comments: [{ id: "c1", status: "open", isBlocking: true }],
    });
    expect(canIssue([c])).toBe(false);
  });

  it("allows issue with no reviews at all", () => {
    // Not every document is reviewed. Absence of review is not a block.
    expect(canIssue([])).toBe(true);
  });

  it("describes the state in one line", () => {
    expect(describeReview(cycle({ status: "completed", assignees: [{ party: "A", decision: "approved" }] })))
      .toMatch(/completed/i);
  });
});

// ── Retention ────────────────────────────────────────────────────────────────

const rec = (over: Partial<RetainableRecord> = {}): RetainableRecord => ({
  id: "d1",
  retentionFrom: "2010-01-01",
  retentionYears: 10,
  ...over,
});

describe("a legal hold outranks everything", () => {
  it("blocks deletion even when retention has expired", () => {
    /* This is the whole point of a hold, and getting the precedence backwards
       destroys evidence in a live dispute. */
    const d = canDelete(rec({ legalHold: true }), new Date("2030-01-01"));
    expect(d.mayDelete).toBe(false);
    expect(d.verdict).toBe("on_hold");
  });

  it("says why, when a reason was given", () => {
    const d = canDelete(rec({ legalHold: true, legalHoldReason: "Claim 2026-04" }), new Date("2030-01-01"));
    expect(d.why).toMatch(/Claim 2026-04/);
    expect(d.why).toMatch(/outranks retention/i);
  });
});

describe("ordinary retention", () => {
  it("blocks deletion before expiry", () => {
    const d = canDelete(rec(), new Date("2015-01-01"));
    expect(d.verdict).toBe("retained");
    expect(d.why).toMatch(/retained until 2020-01-01/i);
  });

  it("permits deletion after expiry", () => {
    const d = canDelete(rec(), new Date("2021-01-01"));
    expect(d.verdict).toBe("may_delete");
    expect(d.mayDelete).toBe(true);
  });

  it("computes the expiry date", () => {
    expect(retentionExpiry(rec())?.toISOString().slice(0, 10)).toBe("2020-01-01");
  });

  it("treats a missing policy as undecided, not as permission", () => {
    /* Silence is not consent. A record nobody wrote a rule for stays. */
    const d = canDelete(rec({ retentionYears: null }), new Date("2030-01-01"));
    expect(d.verdict).toBe("undecided");
    expect(d.mayDelete).toBe(false);
  });

  it("treats a missing start date as undecided", () => {
    expect(canDelete(rec({ retentionFrom: null }), new Date("2030-01-01")).verdict).toBe("undecided");
  });

  it("survives an unparseable start date", () => {
    expect(canDelete(rec({ retentionFrom: "sometime" })).verdict).toBe("undecided");
  });
});

describe("live references", () => {
  it("block deletion even after retention expires", () => {
    // Deleting something still cited leaves a dangling claim in the record that
    // cites it.
    const d = canDelete(rec({ referencedBy: ["TR-0004", "RFI-118"] }), new Date("2030-01-01"));
    expect(d.mayDelete).toBe(false);
    expect(d.verdict).toBe("referenced");
    expect(d.why).toMatch(/TR-0004/);
  });

  it("rank below a legal hold, which is reported first", () => {
    const d = canDelete(rec({ legalHold: true, referencedBy: ["TR-0004"] }), new Date("2030-01-01"));
    expect(d.verdict).toBe("on_hold");
  });
});

describe("selecting what an archiving job may touch", () => {
  it("returns only what every rule permits", () => {
    const now = new Date("2030-01-01");
    const records = [
      rec({ id: "expired" }),
      rec({ id: "held", legalHold: true }),
      rec({ id: "cited", referencedBy: ["X"] }),
      rec({ id: "nopolicy", retentionYears: null }),
      rec({ id: "current", retentionYears: 100 }),
    ];
    expect(eligibleForDeletion(records, now).map((r) => r.id)).toEqual(["expired"]);
  });
});

describe("placing and lifting a hold", () => {
  it("requires a reason", () => {
    // A hold with no stated basis cannot be reviewed or lifted by anyone else.
    expect(placeHold(rec(), "  ").applied).toBe(false);
  });

  it("applies with a reason", () => {
    const r = placeHold(rec(), "Arbitration ARB-9");
    expect(r.applied).toBe(true);
    expect(r.why).toMatch(/ARB-9/);
  });

  it("refuses to double-apply", () => {
    expect(placeHold(rec({ legalHold: true }), "again").applied).toBe(false);
  });

  it("lifting falls back to ordinary retention, and says what that is", () => {
    /* Lifting removes the hold. It never deletes and never implies deletion. */
    const r = liftHold(rec({ legalHold: true }), new Date("2015-01-01"));
    expect(r.applied).toBe(true);
    expect(r.why).toMatch(/retained until/i);
  });

  it("refuses to lift a hold that is not there", () => {
    expect(liftHold(rec()).applied).toBe(false);
  });
});

describe("retention categories", () => {
  it("keeps safety records longest", () => {
    const safety = RETENTION_CATEGORIES.find((c) => c.key === "safety")!;
    for (const c of RETENTION_CATEGORIES) expect(safety.years).toBeGreaterThanOrEqual(c.years);
  });

  it("gives every category a positive term", () => {
    for (const c of RETENTION_CATEGORIES) expect(c.years).toBeGreaterThan(0);
  });
});

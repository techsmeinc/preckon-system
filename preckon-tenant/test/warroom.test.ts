// The tender war room.
//
// The premise being tested: ranking by jeopardy beats ranking by date. With
// eight tenders live, the one in trouble looks exactly like the seven that are
// fine until about seventy-two hours before submission — so a board that sorts
// by deadline shows the finished Friday bid above the three-weeks-out one whose
// steel package has no price.

import { describe, it, expect } from "vitest";
import { jeopardyOf, warRoom, type LiveBid } from "@/lib/tender/warroom";

const bid = (over: Partial<LiveBid> = {}): LiveBid => ({
  id: "b1", projectName: "Cedarstone Phase 2", client: "Cedarstone Estates",
  valueMinor: 10_000_000, stage: "pricing", daysToSubmit: 20,
  owner: "Priya", approvalBooked: true, ...over,
});

describe("time is read against stage, not on its own", () => {
  it("treats a bid still being estimated close to the deadline as behind", () => {
    // The raw date cannot tell "estimating, 5 days out" from "approval, 5 days
    // out", and those are completely different situations.
    const j = jeopardyOf(bid({ stage: "estimating", daysToSubmit: 5 }));
    expect(j.reasons.some((r) => /9 day\(s\) behind where it should be/.test(r))).toBe(true);
    expect(j.jeopardy).not.toBe("on_track");
  });

  it("leaves a bid in approval near its deadline alone", () => {
    expect(jeopardyOf(bid({ stage: "approval", daysToSubmit: 5 })).jeopardy).toBe("on_track");
  });

  it("offers withdrawal as a real option for a bid too far behind", () => {
    const j = jeopardyOf(bid({ stage: "estimating", daysToSubmit: 3 }));
    expect(j.nextAction).toMatch(/resource this properly or withdraw/);
  });

  it("treats an overdue unsubmitted bid as the register lying", () => {
    const j = jeopardyOf(bid({ daysToSubmit: -4 }));
    expect(j.jeopardy).toBe("critical");
    expect(j.nextAction).toMatch(/bid register lying/);
  });

  it("stops chasing a submitted bid", () => {
    const j = jeopardyOf(bid({ stage: "submitted", daysToSubmit: -2 }));
    expect(j.jeopardy).toBe("closed");
    expect(j.score).toBe(0);
    expect(j.nextAction).toBeNull();
  });
});

describe("clarifications", () => {
  it("escalates once the client's window has closed", () => {
    /* After the clarification deadline an open question is not a question any
       more — it is an assumption, whether or not anyone decided to make it. */
    const j = jeopardyOf(bid({ openClarifications: 4, daysToClarificationDeadline: -2 }));
    expect(j.reasons.some((r) => /priced as an assumption or qualified out/.test(r))).toBe(true);
    expect(j.nextAction).toMatch(/priced assumption or a written qualification/);
  });

  it("warns while the window is closing", () => {
    const j = jeopardyOf(bid({ openClarifications: 3, daysToClarificationDeadline: 2 }));
    expect(j.nextAction).toMatch(/Chase these today/);
  });

  it("counts open clarifications more mildly when there is time", () => {
    const near = jeopardyOf(bid({ openClarifications: 3, daysToClarificationDeadline: -1 }));
    const far = jeopardyOf(bid({ openClarifications: 3, daysToClarificationDeadline: 20 }));
    expect(near.score).toBeGreaterThan(far.score);
  });
});

describe("unpriced packages", () => {
  it("calls an allowance what it is when the deadline is close", () => {
    const j = jeopardyOf(bid({ packagesTotal: 10, packagesPriced: 6, daysToSubmit: 5 }));
    expect(j.reasons.some((r) => /guesses with numbers on them/.test(r))).toBe(true);
    expect(j.nextAction).toMatch(/decide now what allowance goes in/);
  });

  it("scales with how much of the bill is unpriced", () => {
    const bad = jeopardyOf(bid({ packagesTotal: 10, packagesPriced: 2 }));
    const mild = jeopardyOf(bid({ packagesTotal: 10, packagesPriced: 9 }));
    expect(bad.score).toBeGreaterThan(mild.score);
  });

  it("says nothing when every package is priced", () => {
    const j = jeopardyOf(bid({ packagesTotal: 10, packagesPriced: 10 }));
    expect(j.jeopardy).toBe("on_track");
  });
});

describe("the constraints the bid team does not control", () => {
  it("flags an unbooked approval near the deadline", () => {
    // A finished bid that cannot be signed off does not get submitted.
    const j = jeopardyOf(bid({ approvalBooked: false, daysToSubmit: 6 }));
    expect(j.reasons.some((r) => /cannot be signed off does not get submitted/.test(r))).toBe(true);
    expect(j.nextAction).toMatch(/does not control/);
  });

  it("does not chase an approval slot months out", () => {
    expect(jeopardyOf(bid({ approvalBooked: false, daysToSubmit: 40 })).jeopardy).toBe("on_track");
  });

  it("flags a bid with no owner", () => {
    const j = jeopardyOf(bid({ owner: null }));
    expect(j.reasons.some((r) => /belongs to everybody belongs to nobody/.test(r))).toBe(true);
  });
});

describe("the board", () => {
  const bids = [
    bid({ id: "finished", projectName: "Done Friday", stage: "approval", daysToSubmit: 4 }),
    bid({
      id: "trouble", projectName: "Steel Job", stage: "estimating", daysToSubmit: 20,
      packagesTotal: 8, packagesPriced: 2, approvalBooked: false,
      openClarifications: 5, daysToClarificationDeadline: -3,
    }),
  ];

  it("ranks by jeopardy, not by deadline", () => {
    /* The whole point. Sorted by date, the finished Friday bid comes first and
       the one actually in trouble is three rows down. */
    const r = warRoom(bids);
    expect(r.bids[0].id).toBe("trouble");
    // At risk rather than critical: with 20 days left there is still time to
    // fix it, which is exactly why it is worth surfacing now.
    expect(r.atRisk.map((b) => b.id)).toEqual(["trouble"]);
    expect(r.bids.find((b) => b.id === "finished")!.jeopardy).toBe("on_track");
  });

  it("reports how much value is in trouble, not just how many bids", () => {
    const r = warRoom(bids);
    expect(r.atRiskValueMinor).toBe(10_000_000);
    expect(r.summary).toMatch(/50% of live bid value is in trouble/);
  });

  it("says so when everything is on track", () => {
    expect(warRoom([bid()]).summary).toBe("1 live bid(s), all on track.");
  });

  it("excludes submitted bids from the live value", () => {
    const r = warRoom([bid(), bid({ id: "s", stage: "submitted" })]);
    expect(r.liveValueMinor).toBe(10_000_000);
  });

  it("handles an empty board", () => {
    expect(warRoom([]).summary).toBe("No live bids.");
  });
});

describe("collisions and overload", () => {
  it("treats two submissions in one week as one resourcing decision", () => {
    const r = warRoom([
      bid({ id: "a", projectName: "A", daysToSubmit: 9 }),
      bid({ id: "b", projectName: "B", daysToSubmit: 11 }),
    ]);
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0].bids).toEqual(["A", "B"]);
    expect(r.collisions[0].note).toMatch(/one resourcing decision, not 2 separate deadlines/);
  });

  it("does not manufacture a collision from a single deadline", () => {
    expect(warRoom([bid({ daysToSubmit: 9 })]).collisions).toEqual([]);
  });

  it("names an owner carrying too many at once", () => {
    const r = warRoom([
      bid({ id: "a", projectName: "A", owner: "Priya" }),
      bid({ id: "b", projectName: "B", owner: "Priya", daysToSubmit: 30 }),
      bid({ id: "c", projectName: "C", owner: "Priya", daysToSubmit: 45 }),
    ]);
    expect(r.overloadedOwners).toHaveLength(1);
    expect(r.overloadedOwners[0].note).toMatch(/will get the last two days/);
  });

  it("does not count submitted bids against an owner's load", () => {
    const r = warRoom([
      bid({ id: "a", owner: "Priya" }),
      bid({ id: "b", owner: "Priya", stage: "submitted" }),
      bid({ id: "c", owner: "Priya", stage: "withdrawn" }),
    ]);
    expect(r.overloadedOwners).toEqual([]);
  });
});

// Delivery tracking.
//
// The whole point is the ORDER-BY date, not the delivery date. Missing it is
// silent — nothing fails on the day, and the consequence arrives weeks later as
// an activity that cannot start. So the tests are about whether the report
// raises its hand early enough to be useful, and whether approval time is
// counted as the commitment it is.

import { describe, it, expect } from "vitest";
import { statusOf, deliveries, procurementSchedule, type DeliveryItem } from "@/lib/procure/delivery";

const item = (over: Partial<DeliveryItem> = {}): DeliveryItem => ({
  id: "d1", package: "Structural steel", description: "Primary frame",
  leadTimeDays: 98, requiredDay: 120, state: "not_ordered", ...over,
});

describe("the order-by date", () => {
  it("counts backwards from when it is needed", () => {
    // Needed day 120, 98-day lead: order by day 22.
    expect(statusOf(item(), 0).orderByDay).toBe(22);
  });

  it("counts approval time as part of the commitment", () => {
    /* A 98-day steel lead with a 21-day approval cycle is a 119-day commitment.
       Treating approval as free is how a procurement schedule that looks
       comfortable turns out not to be — here it moves the deadline from day 22
       to day 1. */
    const s = statusOf(item({ approvalDays: 21 }), 0);
    expect(s.totalLeadDays).toBe(119);
    expect(s.orderByDay).toBe(1);
  });

  it("raises its hand a week before the deadline, not on it", () => {
    const s = statusOf(item(), 16);
    expect(s.urgency).toBe("due_now");
    expect(s.action).toMatch(/this week/);
  });

  it("stays quiet while there is real room", () => {
    const s = statusOf(item(), 5);
    expect(s.urgency).toBe("on_track");
    expect(s.why).toMatch(/17 day\(s\) of room/);
  });
});

describe("past the order-by date", () => {
  it("says how late, and what it now costs", () => {
    // Day 40 against an order-by of 22: ordering today lands day 138, 18 late.
    const s = statusOf(item(), 40);
    expect(s.urgency).toBe("late_to_order");
    expect(s.expectedDay).toBe(138);
    expect(s.slipDays).toBe(18);
    expect(s.criticalSlipDays).toBe(18);
  });

  it("offers the remedies rather than only the diagnosis", () => {
    const s = statusOf(item(), 40);
    expect(s.action).toMatch(/expedited supply, an alternative supplier, or a partial delivery/);
  });

  it("nets the delay against float before calling it a programme impact", () => {
    // 18 days late against 20 days of float is not a programme problem.
    const s = statusOf(item({ activityKey: "STL-10", activityFloat: 20 }), 40);
    expect(s.slipDays).toBe(18);
    expect(s.criticalSlipDays).toBe(0);
    expect(s.action).toMatch(/float absorbs the delay/);
  });

  it("measures an unordered item from today, not from its deadline", () => {
    /* Measuring from the order-by date would show an unordered item as
       perfectly on time right up until the day it becomes impossible — which is
       exactly the silence this module exists to break. */
    expect(statusOf(item(), 60).expectedDay).toBe(158);
    expect(statusOf(item(), 80).expectedDay).toBe(178);
  });
});

describe("once ordered", () => {
  it("trusts the supplier's promise over the average lead time", () => {
    // A promise is information about this order; the lead time is an average
    // across all of them.
    const s = statusOf(item({ state: "ordered", orderedDay: 10, promisedDay: 130 }), 40);
    expect(s.expectedDay).toBe(130);
    expect(s.slipDays).toBe(10);
    expect(s.why).toMatch(/Supplier promises day 130/);
  });

  it("computes arrival from the order date where there is no promise", () => {
    const s = statusOf(item({ state: "in_production", orderedDay: 30 }), 40);
    expect(s.expectedDay).toBe(128);
    expect(s.urgency).toBe("will_be_late");
  });

  it("reports an order placed in time as on track", () => {
    const s = statusOf(item({ state: "ordered", orderedDay: 20 }), 40);
    expect(s.urgency).toBe("on_track");
    expect(s.slipDays).toBe(-2);
  });

  it("names approval as the thing on the critical path when it is", () => {
    const s = statusOf(item({ state: "awaiting_approval", approvalDays: 21 }), 40);
    expect(s.why).toMatch(/approval cycle is already inside/);
    expect(s.action).toMatch(/critical path/);
  });

  it("treats an item awaiting approval as not yet committed", () => {
    /* Nothing is being made during a submittal review, so the full lead time
       still lies ahead and the order-by date still governs. Counting it as
       ordered is how a long-lead item sits in an approval queue for six weeks
       looking comfortable. */
    const s = statusOf(item({ state: "awaiting_approval", approvalDays: 21 }), 40);
    expect(s.urgency).toBe("late_to_order");
    expect(s.expectedDay).toBe(159);   // measured from today, not from nowhere
    expect(s.why).not.toMatch(/undefined/);
  });

  it("still gives an approval in hand its remaining room", () => {
    const s = statusOf(item({ state: "awaiting_approval", approvalDays: 21 }), 0);
    expect(s.urgency).toBe("due_now");
    expect(s.action).toMatch(/approval back this week/);
  });
});

describe("delivered and cancelled", () => {
  it("records whether a delivered item was actually on time", () => {
    const s = statusOf(item({ state: "delivered", deliveredDay: 125 }), 130);
    expect(s.urgency).toBe("delivered");
    expect(s.slipDays).toBe(5);
    expect(s.criticalSlipDays).toBe(0);   // it has arrived; nothing left to fix
    expect(s.why).toMatch(/5 day\(s\) after it was needed/);
  });

  it("does not chase a cancelled item", () => {
    const s = statusOf(item({ state: "cancelled" }), 200);
    expect(s.urgency).toBe("cancelled");
    expect(s.action).toBeNull();
  });
});

describe("the report", () => {
  const list = [
    item({ id: "a", description: "Steel frame", requiredDay: 120 }),                        // order by 22
    item({ id: "b", description: "Curtain wall", leadTimeDays: 60, requiredDay: 200 }),      // order by 140
    item({ id: "c", description: "Lifts", leadTimeDays: 140, requiredDay: 150 }),            // order by 10
    item({ id: "d", description: "Blocks", leadTimeDays: 5, requiredDay: 30, state: "delivered", deliveredDay: 28 }),
  ];

  it("puts the worst programme impact first among the overdue", () => {
    const r = deliveries(list, 40);
    expect(r.lateToOrder.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("orders this week's actions by deadline", () => {
    const r = deliveries([item({ id: "x", requiredDay: 125 }), item({ id: "y", requiredDay: 122 })], 21);
    expect(r.orderNow.map((x) => x.id)).toEqual(["y", "x"]);
  });

  it("counts what has actually arrived", () => {
    const r = deliveries(list, 40);
    expect(r.deliveredCount).toBe(1);
    expect(r.totalCount).toBe(4);
  });

  it("leads with what has to be done, not with a list of everything", () => {
    expect(deliveries(list, 40).summary).toMatch(/^2 item\(s\) past their order-by date/);
  });

  it("says so when everything is on track", () => {
    expect(deliveries([item({ requiredDay: 400 })], 10).summary).toMatch(/on track/);
  });

  it("flags an item whose lead time was never achievable", () => {
    // Order-by before day zero: no order date could have met it. That is a
    // planning failure, not a procurement one, and it needs saying differently.
    const r = deliveries([item({ leadTimeDays: 200, requiredDay: 150 })], 10);
    expect(r.warnings.some((w) => /the programme, not the procurement, is what has to move/.test(w))).toBe(true);
  });

  it("says when it assumed no float rather than silently assuming the worst", () => {
    const r = deliveries([item({ activityKey: "STL-10" })], 40);
    expect(r.warnings.some((w) => /may overstate the impact/.test(w))).toBe(true);
  });

  it("handles an empty list", () => {
    expect(deliveries([], 10).summary).toBe("Nothing to track.");
  });
});

describe("working backwards from the programme", () => {
  it("gives approve-by and order-by dates, soonest first", () => {
    const s = procurementSchedule([
      item({ id: "a", requiredDay: 120, leadTimeDays: 98, approvalDays: 21 }),
      item({ id: "b", requiredDay: 60, leadTimeDays: 10 }),
    ]);
    expect(s.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s[0]).toMatchObject({ orderBy: 1, approveBy: 22, totalLeadDays: 119 });
  });

  it("puts the approval deadline after the order date, not before it", () => {
    // Approval runs first and fabrication follows, so the approval must COMPLETE
    // by the point manufacture has to start — order day 1, approved by day 22.
    const [s] = procurementSchedule([item({ requiredDay: 120, leadTimeDays: 98, approvalDays: 21 })]);
    expect(s.approveBy).toBeGreaterThan(s.orderBy);
    expect(s.approveBy - s.orderBy).toBe(21);
  });
});

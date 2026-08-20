// Resource demand and conflicts.
//
// The point of the histogram is the physically-impossible programme: logic that
// permits four slabs at once, dates that are arithmetically correct, and one
// gang. These pin that a conflict is reported as a period rather than as four
// separate days, and that a role nobody stated availability for is treated as
// an unstated assumption rather than as infinite supply.

import { describe, it, expect } from "vitest";
import { resources, smoothness, type Assignment, type Availability } from "@/lib/programme/resources";

const a = (
  activityKey: string, role: string, units: number, startDay: number, finishDay: number,
): Assignment => ({ activityKey, activityName: activityKey, role, units, startDay, finishDay });

describe("resource histogram", () => {
  it("adds concurrent demand for the same role", () => {
    const r = resources(
      [a("Slab 1", "concretor", 4, 1, 3), a("Slab 2", "concretor", 4, 2, 4)],
      [{ role: "concretor", units: 6 }],
    );
    const h = r.histograms[0];
    expect(h.points.find((p) => p.day === 1)!.demand).toBe(4);
    expect(h.points.find((p) => p.day === 2)!.demand).toBe(8);   // both running
    expect(h.peakDemand).toBe(8);
    expect(h.peakDay).toBe(2);
  });

  it("reports an over-allocation as one period, not one row per day", () => {
    const r = resources(
      [a("Slab 1", "concretor", 4, 1, 4), a("Slab 2", "concretor", 4, 1, 4)],
      [{ role: "concretor", units: 6 }],
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ fromDay: 1, toDay: 4, demand: 8, available: 6, shortfall: 2 });
    expect(r.conflicts[0].message).toMatch(/day 1–4/);
  });

  it("splits non-consecutive over-allocations into separate conflicts", () => {
    const r = resources(
      [a("X", "crane", 2, 1, 1), a("Y", "crane", 2, 5, 5)],
      [{ role: "crane", units: 1 }],
    );
    expect(r.conflicts).toHaveLength(2);
  });

  it("treats a role with no stated availability as an assumption, not as infinite", () => {
    const r = resources([a("X", "surveyor", 2, 1, 3)], []);
    expect(r.unresourced).toEqual(["surveyor"]);
    expect(r.feasible).toBe(false);
    expect(r.summary).toMatch(/assumes they are unlimited/);
  });

  it("honours a window where availability differs", () => {
    const avail: Availability[] = [{ role: "bricklayer", units: 10, windows: [{ fromDay: 3, toDay: 5, units: 2 }] }];
    const r = resources([a("Wall", "bricklayer", 6, 1, 6)], avail);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].fromDay).toBe(3);
    expect(r.conflicts[0].toDay).toBe(5);
  });

  it("is feasible when everything fits", () => {
    const r = resources([a("X", "joiner", 2, 1, 5)], [{ role: "joiner", units: 4 }]);
    expect(r.feasible).toBe(true);
    expect(r.summary).toMatch(/fits within its stated availability/);
  });

  it("reports the worst conflict first", () => {
    const r = resources(
      [a("A", "crane", 5, 1, 2), a("B", "joiner", 3, 1, 2)],
      [{ role: "crane", units: 1 }, { role: "joiner", units: 2 }],
    );
    expect(r.conflicts[0].role).toBe("crane");   // short 4 beats short 1
  });

  it("counts labour content as unit-days", () => {
    const r = resources([a("X", "joiner", 3, 1, 4)], [{ role: "joiner", units: 3 }]);
    expect(r.histograms[0].unitDays).toBe(12);   // 3 for 4 days
  });

  it("scores a spiky curve lower than a flat one", () => {
    const flat = resources([a("X", "joiner", 2, 1, 6)], [{ role: "joiner", units: 2 }]).histograms[0];
    const spiky = resources(
      [a("X", "joiner", 1, 1, 6), a("Y", "joiner", 9, 3, 3)],
      [{ role: "joiner", units: 10 }],
    ).histograms[0];
    expect(smoothness(flat)).toBe(1);
    expect(smoothness(spiky)).toBeLessThan(1);
  });
});

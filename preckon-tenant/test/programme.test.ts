// Calendars, baselines, progress and schedule health.
//
// The calendar tests use the Gulf working week on purpose: a Friday-Saturday
// weekend is the case a western-default implementation gets silently wrong, and
// "silently" is the problem — the dates still look like dates.

import { describe, it, expect } from "vitest";
import {
  effective, isWorkingDay, nextWorkingDay, addWorkingDays, workingDaysBetween,
  schedule, GULF_WEEK, WESTERN_WEEK, type Calendar,
} from "@/lib/programme/calendars";
import { capture, rebaseline, variance, type BaselineActivity } from "@/lib/programme/baselines";
import { progress, forecastRemainingDays, type ProgressActivity } from "@/lib/programme/progress";
import { health } from "@/lib/programme/health";
import type { CpmNode } from "@/lib/cpm";

const gulf: Calendar = { id: "g", name: "Gulf", workdays: GULF_WEEK, holidays: [] };

describe("calendars", () => {
  it("treats Friday and Saturday as the weekend", () => {
    expect(isWorkingDay(gulf, "2026-03-05")).toBe(true);   // Thursday
    expect(isWorkingDay(gulf, "2026-03-06")).toBe(false);  // Friday
    expect(isWorkingDay(gulf, "2026-03-07")).toBe(false);  // Saturday
    expect(isWorkingDay(gulf, "2026-03-08")).toBe(true);   // Sunday
  });

  it("counts a one-day activity as finishing the day it starts", () => {
    expect(addWorkingDays(gulf, "2026-03-08", 1)).toBe("2026-03-08");
  });

  it("steps over the weekend when adding duration", () => {
    // Thursday + 2 working days lands on Sunday, not Friday.
    expect(addWorkingDays(gulf, "2026-03-05", 2)).toBe("2026-03-08");
  });

  it("skips a holiday whatever the weekday", () => {
    const withEid: Calendar = { ...gulf, holidays: ["2026-03-08", "2026-03-09"] };
    expect(nextWorkingDay(withEid, "2026-03-08")).toBe("2026-03-10");
  });

  it("lets a child calendar remove working time but never add it back", () => {
    const global: Calendar = { id: "g", name: "Global", workdays: GULF_WEEK, holidays: ["2026-03-10"] };
    // The project tries to work a Friday AND reinstate the global holiday.
    const project: Calendar = {
      id: "p", name: "Project", parentId: "g",
      workdays: [...GULF_WEEK, 5] as Calendar["workdays"], holidays: [],
    };
    const eff = effective(project, [global, project]);
    expect(eff.workdays).not.toContain(5);          // Friday stays closed
    expect(eff.holidays).toContain("2026-03-10");   // holiday survives
  });

  it("counts working days between two dates inclusively", () => {
    expect(workingDaysBetween(gulf, "2026-03-08", "2026-03-12")).toBe(5);
    expect(workingDaysBetween(gulf, "2026-03-05", "2026-03-08")).toBe(2);
  });

  it("lays CPM offsets onto real dates, so 10 working days is not 10 calendar days", () => {
    const dated = schedule(gulf, "2026-03-08", [
      { key: "a", name: "Piling", es: 0, ef: 10, dur: 10, float: 0, critical: true },
    ]);
    expect(dated[0].startDate).toBe("2026-03-08");
    expect(dated[0].finishDate).toBe("2026-03-19");   // 10 working days, two weekends
  });

  it("uses the western week when a project is on one", () => {
    const west: Calendar = { id: "w", name: "West", workdays: WESTERN_WEEK, holidays: [] };
    expect(isWorkingDay(west, "2026-03-08")).toBe(false);  // Sunday
    expect(isWorkingDay(west, "2026-03-06")).toBe(true);   // Friday
  });
});

describe("baselines", () => {
  const planned: BaselineActivity[] = [
    { key: "a", name: "Piling", startDate: "2026-03-08", finishDate: "2026-03-19", durationDays: 10 },
    { key: "b", name: "Slab", startDate: "2026-03-22", finishDate: "2026-04-02", durationDays: 10 },
  ];

  it("refuses an unexplained re-baseline", () => {
    const bl = capture(0, "Contract", planned, "2026-03-01");
    const r = rebaseline(bl, planned, "2026-05-01", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/stated reason/i);
  });

  it("stores a new version rather than editing the old one", () => {
    const bl = capture(0, "Contract", planned, "2026-03-01");
    const r = rebaseline(bl, [{ ...planned[0], finishDate: "2026-04-30", durationDays: 30 }],
      "2026-05-01", "client-instructed redesign of the piling layout");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.version).toBe(1);
      expect(bl.activities[0].finishDate).toBe("2026-03-19");   // original untouched
      expect(r.value.frozen).toBe(true);
    }
  });

  it("measures slippage against the named baseline", () => {
    const bl = capture(0, "Contract", planned, "2026-03-01");
    const live: BaselineActivity[] = [
      { ...planned[0], startDate: "2026-03-08", finishDate: "2026-03-26", durationDays: 15 },
      { ...planned[1], startDate: "2026-03-29", finishDate: "2026-04-09" },
    ];
    const v = variance(bl, live);
    expect(v.activities.find((a) => a.key === "a")!.finishVarianceDays).toBe(7);
    expect(v.projectFinishVarianceDays).toBe(7);
    expect(v.summary).toMatch(/later by 7 day/);
  });

  it("reports added and removed scope rather than silently ignoring it", () => {
    const bl = capture(0, "Contract", planned, "2026-03-01");
    const live: BaselineActivity[] = [
      planned[0],
      { key: "c", name: "Cladding", startDate: "2026-04-05", finishDate: "2026-04-20", durationDays: 12 },
    ];
    const v = variance(bl, live);
    expect(v.removed).toBe(1);
    expect(v.added).toBe(1);
  });
});

describe("progress", () => {
  const acts: ProgressActivity[] = [
    { key: "a", name: "Piling", plannedStart: "2026-03-01", plannedFinish: "2026-03-31",
      plannedDurationDays: 30, weight: 60, actualStart: "2026-03-01", physicalPercent: 40 },
    { key: "b", name: "Slab", plannedStart: "2026-03-15", plannedFinish: "2026-04-15",
      plannedDurationDays: 30, weight: 40 },
  ];

  it("does not let elapsed time stand in for physical progress", () => {
    const r = progress(acts, "2026-03-31");
    const a = r.activities.find((x) => x.key === "a")!;
    expect(a.planPercent).toBe(100);     // the plan says finished
    expect(a.physicalPercent).toBe(40);  // site says 40
    expect(a.variancePercent).toBe(-60);
  });

  it("flags an activity that should have started and has not", () => {
    const r = progress(acts, "2026-03-31");
    expect(r.notStartedButDue.map((x) => x.key)).toEqual(["b"]);
    expect(r.activities.find((x) => x.key === "b")!.status).toBe("should_have_started");
  });

  it("weights earned progress by value, not by activity count", () => {
    const r = progress(acts, "2026-03-31");
    // 40% of the 60-weight item, nothing of the 40-weight item.
    expect(r.earnedPercent).toBe(24);
    expect(r.scheduleVariancePercent).toBeLessThan(0);
    expect(r.summary).toMatch(/behind/);
  });

  it("forecasts pessimistically from achieved rate when no estimate is given", () => {
    // 40% in 30 days -> 1.33%/day -> 45 more days for the remaining 60%.
    const days = forecastRemainingDays(acts[0], "2026-03-31");
    expect(days).toBeGreaterThan(acts[0].plannedDurationDays / 2);
  });

  it("prefers the planner's own remaining duration when there is one", () => {
    expect(forecastRemainingDays({ ...acts[0], remainingDurationDays: 5 }, "2026-03-31")).toBe(5);
  });
});

describe("schedule health", () => {
  const node = (over: Partial<CpmNode> & Pick<CpmNode, "key">): CpmNode => ({
    a: {}, name: over.key, phase: "", dur: 10, milestone: false, links: [],
    es: 0, ef: 10, ls: 0, lf: 10, float: 0, critical: false,
    danglingRefs: [], flagged: false, ...over,
  } as CpmNode);

  it("calls negative float unsubmittable however good the rest is", () => {
    const nodes = [
      node({ key: "a", links: [{ activity: "b", type: "FS", lag_days: 0 }] }),
      node({ key: "b", float: -5, critical: true }),
    ];
    const h = health(nodes);
    expect(h.checks.find((c) => c.key === "negative_float")!.passed).toBe(false);
    expect(h.grade).toBe("unsubmittable");
  });

  it("rejects leads outright and names the offenders", () => {
    const nodes = [
      node({ key: "a", links: [{ activity: "b", type: "FS", lag_days: -3 }] }),
      node({ key: "b", critical: true }),
    ];
    const h = health(nodes);
    const leads = h.checks.find((c) => c.key === "leads")!;
    expect(leads.passed).toBe(false);
    expect(leads.offenders).toContain("a");
  });

  it("treats a network with no critical path as broken, not as perfect", () => {
    const nodes = [node({ key: "a", float: 50 }), node({ key: "b", float: 50 })];
    const h = health(nodes);
    const share = h.checks.find((c) => c.key === "critical_path_share")!;
    expect(share.passed).toBe(false);
    expect(share.note).toMatch(/not connected/);
  });

  it("passes a sound little network", () => {
    // Two of four critical: a real path exists, and there is still float
    // elsewhere. Three of four would fail the share check, which is the point
    // of having it — a programme where everything is critical has no plan in it.
    const nodes = [
      node({ key: "a", critical: true, links: [{ activity: "b", type: "FS", lag_days: 0 }] }),
      node({ key: "b", critical: true, links: [{ activity: "c", type: "FS", lag_days: 0 }] }),
      node({ key: "c", critical: false, float: 5, links: [{ activity: "d", type: "FS", lag_days: 0 }] }),
      node({ key: "d", critical: false, float: 5 }),
    ];
    const h = health(nodes);
    expect(h.checks.find((c) => c.key === "critical_path_share")!.passed).toBe(true);
    expect(h.grade).toBe("sound");
    expect(h.headline).toMatch(/all structural checks pass/i);
  });
});

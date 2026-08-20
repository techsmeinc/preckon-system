// Look-ahead, what-if, and reconciliation.
//
// The three tests that carry this file: an activity whose dates say Monday but
// whose permit does not arrive until Friday is BLOCKED, not ready; crashing an
// activity with float costs money and recovers nothing; and a programme that
// imported cleanly while dropping an activity is not trustworthy however good
// the rest looks.

import { describe, it, expect } from "vitest";
import { lookahead, percentPlanComplete, type LookaheadActivity } from "@/lib/programme/lookahead";
import { runScenario, compareScenarios, type Row, type Scenario } from "@/lib/programme/whatif";
import { reconcile, type ReconActivity } from "@/lib/programme/reconcile";

const act = (over: Partial<LookaheadActivity> = {}): LookaheadActivity => ({
  key: "a1", name: "Blockwork L1", plannedStart: "2026-06-08", plannedFinish: "2026-06-19",
  float: 0, constraints: [], ...over,
});

describe("work readiness", () => {
  it("calls an activity blocked when a constraint clears after it starts", () => {
    const a = act({
      constraints: [{ id: "c1", kind: "permit", description: "Hot works permit", expectedAt: "2026-06-12", owner: "HSE" }],
    });
    const r = lookahead([a], "2026-06-01");
    expect(r.activities[0].readiness).toBe("blocked");
    expect(r.activities[0].reason).toMatch(/will not clear before/);
  });

  it("calls it at risk when the constraint should clear in time", () => {
    const a = act({
      constraints: [{ id: "c1", kind: "materials", description: "Blocks to site", expectedAt: "2026-06-05" }],
    });
    expect(lookahead([a], "2026-06-01").activities[0].readiness).toBe("at_risk");
  });

  it("is ready only when everything is cleared", () => {
    const a = act({ constraints: [{ id: "c1", kind: "design", description: "IFC drawing", clearedAt: "2026-05-20" }] });
    const r = lookahead([a], "2026-06-01");
    expect(r.activities[0].readiness).toBe("ready");
    expect(r.ready).toBe(1);
  });

  it("separates constraints nobody is chasing", () => {
    const a = act({ constraints: [{ id: "c1", kind: "information", description: "RFI 12 unanswered" }] });
    const r = lookahead([a], "2026-06-01");
    expect(r.activities[0].unchased).toHaveLength(1);
    expect(r.activities[0].reason).toMatch(/no date/);
  });

  it("highlights blocked work on the critical path", () => {
    const critical = act({ key: "c", float: 0, constraints: [{ id: "x", kind: "access", description: "Area handover" }] });
    const slack = act({ key: "s", float: 12, constraints: [{ id: "y", kind: "access", description: "Area handover" }] });
    const r = lookahead([critical, slack], "2026-06-01");
    expect(r.criticalBlocked.map((a) => a.key)).toEqual(["c"]);
    expect(r.summary).toMatch(/on the critical path/);
  });

  it("groups open constraints by who owns them, for the meeting", () => {
    const a = act({ constraints: [{ id: "c1", kind: "permit", description: "Permit", owner: "HSE" }] });
    const b = act({ key: "b", name: "Screed", constraints: [{ id: "c2", kind: "permit", description: "Permit", owner: "HSE" }] });
    const r = lookahead([a, b], "2026-06-01");
    expect(r.byOwner[0]).toMatchObject({ owner: "HSE", open: 2 });
    expect(r.byOwner[0].blocking).toHaveLength(2);
  });

  it("leaves work beyond the window out of the counts", () => {
    const far = act({ plannedStart: "2026-09-01" });
    const r = lookahead([far], "2026-06-01", 3);
    expect(r.activities[0].readiness).toBe("not_due");
    expect(r.ready + r.atRisk + r.blocked).toBe(0);
  });

  it("gives no partial credit in PPC", () => {
    // A programme where everything is 90% done is one where nothing finished.
    const r = percentPlanComplete([{ key: "a", completed: true }, { key: "b", completed: false }]);
    expect(r.ppc).toBe(50);
    expect(r.summary).toMatch(/not being believed/);
  });
});

/* ── what-if ──────────────────────────────────────────────────────────────── */

// The real artifact shape cpm.ts reads: everything under `payload`, links in
// `depends_on`. Written out rather than flattened, because a fixture in a
// flatter shape produces a network with no links at all and every scenario
// then "recovers" exactly the difference in one activity's duration.
const row = (activity: string, duration_days: number, depends_on: { activity: string; type?: string; lag_days?: number }[] = []): Row =>
  ({ payload: { activity, duration_days, depends_on } });

const rows: Row[] = [
  row("A", 20),
  row("B", 30, [{ activity: "A", type: "FS", lag_days: 0 }]),
  row("C", 10, [{ activity: "A", type: "FS", lag_days: 0 }]),
  row("D", 15, [{ activity: "B", type: "FS", lag_days: 0 }]),
];

describe("what-if", () => {
  it("recovers time by crashing a critical activity", () => {
    const s: Scenario = { id: "s1", name: "Crash the frame", changes: [{ kind: "crash", activity: "B", days: 10, costMinor: 500_000 }] };
    const r = runScenario(rows, s);
    expect(r.recoveredDays).toBe(10);
    expect(r.costPerDayMinor).toBe(50_000);
    expect(r.wasted).toHaveLength(0);
  });

  it("reports money spent crashing an activity with float as wasted", () => {
    // Landscaping has slack. Shortening it moves the finish date not one day,
    // and this is the most common wasted spend in delay recovery.
    const s: Scenario = { id: "s2", name: "Crash landscaping", changes: [{ kind: "crash", activity: "C", days: 5, costMinor: 200_000 }] };
    const r = runScenario(rows, s);
    expect(r.recoveredDays).toBe(0);
    expect(r.wasted[0].why).toMatch(/not on the critical path/);
    expect(r.summary).toMatch(/recovers nothing/);
  });

  it("fast-tracks by turning a finish-to-start into an overlap", () => {
    const s: Scenario = { id: "s3", name: "Overlap fit-out", changes: [{ kind: "overlap", activity: "D", predecessor: "B", days: 5, costMinor: 100_000 }] };
    expect(runScenario(rows, s).recoveredDays).toBeGreaterThan(0);
  });

  it("never mutates the live programme", () => {
    const before = JSON.stringify(rows);
    runScenario(rows, { id: "s", name: "x", changes: [{ kind: "crash", activity: "B", days: 10 }] });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("warns rather than throwing when a change names an activity that is not there", () => {
    const r = runScenario(rows, { id: "s", name: "x", changes: [{ kind: "crash", activity: "ZZ", days: 5 }] });
    expect(r.warnings.join(" ")).toMatch(/not in the programme/);
  });

  it("ranks options by cost per day recovered, not by days", () => {
    const cheap: Scenario = { id: "1", name: "Cheap", changes: [{ kind: "crash", activity: "B", days: 5, costMinor: 100_000 }] };
    const big: Scenario = { id: "2", name: "Expensive", changes: [{ kind: "crash", activity: "B", days: 10, costMinor: 900_000 }] };
    const c = compareScenarios(rows, [big, cheap]);
    expect(c.best!.name).toBe("Cheap");
    expect(c.summary).toMatch(/Best value: Cheap/);
  });

  it("says plainly when nothing recovers time", () => {
    const c = compareScenarios(rows, [{ id: "1", name: "Landscaping", changes: [{ kind: "crash", activity: "C", days: 5 }] }]);
    expect(c.best).toBeNull();
    expect(c.summary).toMatch(/finish date has to move/);
  });
});

/* ── reconciliation ───────────────────────────────────────────────────────── */

const src: ReconActivity[] = [
  { key: "A", name: "Substructure", durationDays: 20, calendarId: "5day",
    predecessors: [], constraintType: "start_no_earlier", constraintDate: "2026-06-01" },
  { key: "B", name: "Frame", durationDays: 30, calendarId: "5day",
    predecessors: [{ activity: "A", type: "FS", lagDays: 0 }] },
];

describe("reconciliation", () => {
  it("refuses to call an import trustworthy when an activity did not arrive", () => {
    const r = reconcile(src, [src[0]]);
    expect(r.sourceOnly).toEqual(["B"]);
    expect(r.trustworthy).toBe(false);
    expect(r.summary).toMatch(/did not arrive at all/);
  });

  it("treats a rename as cosmetic and keeps confidence high", () => {
    const renamed = [{ ...src[0], name: "Substructure works" }, src[1]];
    const r = reconcile(src, renamed);
    expect(r.confidence).toBe(100);
    expect(r.diffs[0].material).toBe(false);
  });

  it("treats a substituted calendar as material, because it moves dates silently", () => {
    const swapped = [{ ...src[0], calendarId: "7day" }, src[1]];
    const r = reconcile(src, swapped);
    expect(r.diffs[0].material).toBe(true);
    expect(r.diffs[0].detail[0]).toMatch(/moves every date/);
    expect(r.confidence).toBeLessThan(100);
  });

  it("catches lost logic", () => {
    const noLink = [src[0], { ...src[1], predecessors: [] }];
    const r = reconcile(src, noLink);
    expect(r.diffs.some((d) => d.differences.includes("logic"))).toBe(true);
  });

  it("catches a dropped constraint", () => {
    const noConstraint = [{ ...src[0], constraintType: null, constraintDate: null }, src[1]];
    expect(reconcile(src, noConstraint).diffs[0].differences).toContain("constraint");
  });

  it("ranks the difference types by how much damage they do", () => {
    const mangled = [
      { ...src[0], calendarId: "7day", name: "Renamed" },
      { ...src[1], predecessors: [] },
    ];
    const r = reconcile(src, mangled);
    expect(["logic", "calendar"]).toContain(r.byDifference[0].difference);
  });
});

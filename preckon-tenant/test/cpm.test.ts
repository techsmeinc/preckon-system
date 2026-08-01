import { describe, it, expect } from "vitest";
import { computeCpm, uncoveredBoq } from "@/lib/cpm";

const act = (activity: string, duration_days: number, depends_on: any[] = [], extra: any = {}) => ({
  id: activity, status: "confirmed",
  payload: { activity, duration_days, depends_on, ...extra },
});

describe("CPM", () => {
  it("chains finish-to-start and finds the critical path", () => {
    const r = computeCpm([
      act("A", 5),
      act("B", 3, [{ activity: "A", type: "FS", lag_days: 0 }]),
      act("C", 10, [{ activity: "A", type: "FS", lag_days: 0 }]),
      act("D", 2, [{ activity: "B", type: "FS", lag_days: 0 }, { activity: "C", type: "FS", lag_days: 0 }]),
    ]);
    expect(r.total).toBe(17);                       // 5 + 10 + 2
    const by = Object.fromEntries(r.nodes.map((n) => [n.name, n]));
    expect(by.C.es).toBe(5);
    expect(by.D.es).toBe(15);                        // waits for C, not B
    expect(by.B.float).toBe(7);                      // 10 - 3
    expect(r.criticalPath.map((n) => n.name).sort()).toEqual(["A", "C", "D"]);
  });

  it("honours lag as a wait", () => {
    const r = computeCpm([
      act("Pour slab", 2),
      act("Strike formwork", 1, [{ activity: "Pour slab", type: "FS", lag_days: 7 }]),
    ]);
    expect(r.nodes.find((n) => n.name === "Strike formwork")!.es).toBe(9); // 2 + 7 cure
    expect(r.total).toBe(10);
  });

  it("honours negative lag as an overlap", () => {
    const r = computeCpm([
      act("First fix", 10),
      act("Second fix", 6, [{ activity: "First fix", type: "FS", lag_days: -4 }]),
    ]);
    expect(r.nodes.find((n) => n.name === "Second fix")!.es).toBe(6);
    expect(r.total).toBe(12);
  });

  it("starts SS activities together, offset by lag", () => {
    const r = computeCpm([
      act("Blockwork L1", 8),
      act("Blockwork L2", 8, [{ activity: "Blockwork L1", type: "SS", lag_days: 3 }]),
    ]);
    expect(r.nodes.find((n) => n.name === "Blockwork L2")!.es).toBe(3);
    expect(r.total).toBe(11);
  });

  it("aligns FF activities on their finish", () => {
    const r = computeCpm([
      act("Wall build", 10),
      act("Services in wall", 4, [{ activity: "Wall build", type: "FF", lag_days: 0 }]),
    ]);
    // Must FINISH with the wall at day 10, so it starts at 6.
    expect(r.nodes.find((n) => n.name === "Services in wall")!.es).toBe(6);
    expect(r.total).toBe(10);
  });

  it("positions by the network, not a stated offset that contradicts it", () => {
    const r = computeCpm([
      act("A", 5),
      // The agent claims day 0, but it depends on A. The link wins.
      act("B", 3, [{ activity: "A", type: "FS", lag_days: 0 }], { start_offset_days: 0 }),
    ]);
    expect(r.nodes.find((n) => n.name === "B")!.es).toBe(5);
  });

  it("treats milestones as zero-duration and keeps them on the path", () => {
    const r = computeCpm([
      act("Commencement", 0, [], { is_milestone: true }),
      act("Works", 20, [{ activity: "Commencement", type: "FS", lag_days: 0 }]),
      act("Handover", 0, [{ activity: "Works", type: "FS", lag_days: 0 }], { is_milestone: true }),
    ]);
    expect(r.total).toBe(20);
    expect(r.nodes.find((n) => n.name === "Handover")!.es).toBe(20);
    expect(r.criticalPath).toHaveLength(3);
  });

  it("reports dangling references instead of silently dropping them", () => {
    const r = computeCpm([act("A", 5, [{ activity: "Does not exist", type: "FS", lag_days: 0 }])]);
    expect(r.nodes[0].danglingRefs).toEqual(["Does not exist"]);
    expect(r.warnings.join(" ")).toMatch(/isn't in the programme/);
  });

  it("does not hang on a cyclic network", () => {
    const r = computeCpm([
      act("A", 3, [{ activity: "B", type: "FS", lag_days: 0 }]),
      act("B", 3, [{ activity: "A", type: "FS", lag_days: 0 }]),
    ]);
    expect(r.warnings.join(" ")).toMatch(/cycle/);
  });

  it("falls back to bare predecessor names as FS", () => {
    const r = computeCpm([
      { id: "1", status: "confirmed", payload: { activity: "A", duration_days: 4 } },
      { id: "2", status: "confirmed", payload: { activity: "B", duration_days: 2, predecessors: ["A"] } },
    ]);
    expect(r.nodes.find((n) => n.name === "B")!.es).toBe(4);
  });

  it("flags priced scope no activity delivers", () => {
    const acts = [act("Concrete works", 5, [], { boq_refs: ["3.1"] })];
    const boq = [
      { payload: { code: "3.1", description: "Slab" } },
      { payload: { code: "9.1", description: "Light fittings" } },
    ];
    expect(uncoveredBoq(acts, boq).map((b) => b.payload.code)).toEqual(["9.1"]);
  });
});

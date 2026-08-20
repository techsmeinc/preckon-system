// Measurement rules, BOQ deltas, and staleness.
//
// The three tests worth reading first: openings under the threshold are NOT
// deducted, a quantity that moved without its drawing moving is a remeasure
// rather than a variation, and a bill is only as fresh as its least fresh
// quantity. Each is a place where being quietly wrong costs money nobody can
// later attribute.

import { describe, it, expect } from "vitest";
import { measure, validateRuleSet, NRM2_MASONRY, type RuleSet } from "@/lib/boq/rules";
import { boqDelta, baseline, type BoqLine } from "@/lib/boq/delta";
import {
  propagate, propagateDerived, remeasureQueue, confidence,
  type Quantity, type SourceChange,
} from "@/lib/boq/dirty";

describe("measurement rules", () => {
  it("does not deduct an opening below the standard's threshold", () => {
    // A door is deducted; a small window is not. Deducting everything is the
    // error that makes Preckon's quantity disagree with the contract's.
    const q = measure(
      { gross: 100, unit: "m2", openings: [{ area: 2.1 }, { area: 0.8 }] },
      NRM2_MASONRY,
    );
    expect(q.net).toBe(97.9);
    expect(q.steps[0].note).toMatch(/deducted 1 opening/);
  });

  it("shows its working, so a QS does not have to remeasure to check it", () => {
    const q = measure({ gross: 100, unit: "m2", openings: [{ area: 2 }] }, NRM2_MASONRY);
    expect(q.working).toMatch(/100 m2 gross/);
    expect(q.working).toMatch(/98 m2 net/);
    expect(q.steps[0].reference).toBe("NRM2 14.2");
  });

  it("applies rules in the set's own order, because standards disagree about it", () => {
    const wasteFirst: RuleSet = {
      key: "a", name: "A", standard: "custom", version: 1,
      rules: [
        { key: "w", kind: "waste_factor", label: "Waste", value: 10, reference: "x" },
        { key: "o", kind: "deduct_openings", label: "Openings", threshold: 0, reference: "x" },
      ],
    };
    const openingsFirst: RuleSet = { ...wasteFirst, rules: [wasteFirst.rules[1], wasteFirst.rules[0]] };
    const raw = { gross: 100, unit: "m2", openings: [{ area: 10 }] };
    expect(measure(raw, wasteFirst).net).toBe(100);      // 110 - 10
    expect(measure(raw, openingsFirst).net).toBe(99);    // 90 * 1.1
  });

  it("bills a small area at the minimum rather than as measured", () => {
    const q = measure({ gross: 0.2, unit: "m2" }, NRM2_MASONRY);
    expect(q.net).toBe(0.5);
    expect(q.steps.some((s) => /minimum/.test(s.note))).toBe(true);
  });

  it("skips a unit conversion with no thickness instead of silently producing zero", () => {
    // A zero quantity reads as "there is none of this" rather than "nobody said
    // how thick it is", and the bill loses a line without anyone noticing.
    const set: RuleSet = {
      key: "c", name: "C", standard: "custom", version: 1,
      rules: [{ key: "conv", kind: "convert_unit", label: "m2 -> m3", reference: "x" }],
    };
    const q = measure({ gross: 50, unit: "m2" }, set);
    expect(q.net).toBe(50);
    expect(q.steps[0].note).toMatch(/SKIPPED/);
  });

  it("flags a rule that cannot be cited in a dispute", () => {
    const issues = validateRuleSet({
      key: "x", name: "X", standard: "custom", version: 1,
      rules: [{ key: "r", kind: "waste_factor", label: "Waste", value: 5 }],
    });
    expect(issues[0].message).toMatch(/cannot be cited/);
  });
});

describe("BOQ delta", () => {
  const from: BoqLine[] = [
    { id: "1", code: "A10", description: "Blockwork", unit: "m2", qty: 100, rateMinor: 5000, sourceRevision: "A" },
    { id: "2", code: "A20", description: "Plaster", unit: "m2", qty: 200, rateMinor: 1500, sourceRevision: "A" },
    { id: "3", code: "A30", description: "Skirting", unit: "m", qty: 50, rateMinor: 800, sourceRevision: "A" },
  ];

  it("separates a design change from a remeasure, because only one is chargeable", () => {
    const to: BoqLine[] = [
      // Drawing moved A -> B: chargeable.
      { ...from[0], qty: 130, sourceRevision: "B" },
      // Same drawing, different number: our own remeasure, nobody to bill.
      { ...from[1], qty: 240 },
      from[2],
    ];
    const d = boqDelta(from, to);
    const design = d.lines.find((l) => l.code === "A10")!;
    const remeasure = d.lines.find((l) => l.code === "A20")!;
    expect(design.cause).toBe("design_change");
    expect(design.note).toMatch(/chargeable as a design change/);
    expect(remeasure.cause).toBe("remeasure");
    expect(remeasure.note).toMatch(/not a variation/);
    expect(d.designChangeMinor).toBe(150_000);
    expect(d.remeasureMinor).toBe(60_000);
  });

  it("matches on code, so renaming a description is not a replaced bill", () => {
    const to: BoqLine[] = [{ ...from[0], description: "Blockwork, 200mm (revised wording)" }, from[1], from[2]];
    const d = boqDelta(from, to);
    expect(d.lines).toEqual([]);
    expect(d.deltaMinor).toBe(0);
  });

  it("reports a rate-only change as repricing", () => {
    const to: BoqLine[] = [{ ...from[0], rateMinor: 5500 }, from[1], from[2]];
    const d = boqDelta(from, to);
    expect(d.lines[0].cause).toBe("repricing");
    expect(d.repricingMinor).toBe(50_000);
  });

  it("counts added and removed scope separately from changed quantities", () => {
    const to: BoqLine[] = [
      from[0], from[1],
      { id: "4", code: "A40", description: "Coving", unit: "m", qty: 20, rateMinor: 1000 },
    ];
    const d = boqDelta(from, to);
    expect(d.lines.find((l) => l.code === "A40")!.kind).toBe("added");
    expect(d.lines.find((l) => l.code === "A30")!.kind).toBe("removed");
  });

  it("freezes a baseline instead of holding a reference to the live bill", () => {
    const live = [...from];
    const b = baseline(live, "Tender", "2026-03-01");
    live[0].qty = 999;
    expect(b.lines[0].qty).toBe(100);       // unmoved
    expect(boqDelta(b.lines, live).lines[0].toQty).toBe(999);
  });
});

describe("staleness", () => {
  const quantities: Quantity[] = [
    { id: "q1", sourceId: "wall-1", measuredAgainst: "A", value: 100, unit: "m2", valueMinor: 900_000, freshness: "current" },
    { id: "q2", sourceId: "wall-2", measuredAgainst: "A", value: 50, unit: "m2", valueMinor: 10_000, freshness: "current" },
    { id: "q3", sourceId: "slab-1", measuredAgainst: "A", value: 20, unit: "m3", valueMinor: 5_000, freshness: "current" },
  ];

  it("marks quantities measured against a superseded revision", () => {
    const changes: SourceChange[] = [{ sourceId: "wall-1", revision: "B", at: "2026-04-01" }];
    const r = propagate(quantities, changes);
    expect(r.markedStale).toEqual(["q1"]);
    expect(r.quantities.find((q) => q.id === "q1")!.freshness).toBe("stale");
    expect(r.unaffected).toBe(2);
  });

  it("does not re-stale a quantity already measured against the new revision", () => {
    const already = [{ ...quantities[0], measuredAgainst: "B" }];
    const r = propagate(already, [{ sourceId: "wall-1", revision: "B", at: "2026-04-01" }]);
    expect(r.markedStale).toEqual([]);
  });

  it("supersedes rather than stales when the object is gone, so the queue can be cleared", () => {
    const r = propagate(quantities, [{ sourceId: "slab-1", revision: "B", kind: "deleted", at: "2026-04-01" }]);
    expect(r.markedSuperseded).toEqual(["q3"]);
    expect(remeasureQueue(r.quantities)[0].reason).toMatch(/no longer exists/);
  });

  it("carries staleness into anything derived from it", () => {
    const stale = propagate(quantities, [{ sourceId: "wall-1", revision: "B", at: "x" }]).quantities;
    const lines = [{ id: "L1", fromQuantityIds: ["q1", "q2"], freshness: "current" as const }];
    expect(propagateDerived(lines, stale)[0].freshness).toBe("stale");
  });

  it("reports confidence by value, not by count", () => {
    // One stale quantity out of three sounds like 67%. By value it is 2%,
    // because the stale one is the superstructure.
    const stale = propagate(quantities, [{ sourceId: "wall-1", revision: "B", at: "x" }]).quantities;
    const c = confidence(stale);
    expect(c.valueConfidence).toBeCloseTo(0.016, 2);
    expect(c.safeToPrice).toBe(false);
    expect(c.summary).toMatch(/Remeasure before pricing/);
  });

  it("orders the remeasure queue by exposure", () => {
    const stale = propagate(quantities, [
      { sourceId: "wall-1", revision: "B", at: "x" },
      { sourceId: "wall-2", revision: "B", at: "x" },
    ]).quantities;
    expect(remeasureQueue(stale).map((q) => q.quantityId)).toEqual(["q1", "q2"]);
  });
});

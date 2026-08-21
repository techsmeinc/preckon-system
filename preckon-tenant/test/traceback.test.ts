// Tracing a billed quantity back to its measurements.
//
// The point of these tests is that the traceback must be a CHECK, not a tour.
// Linking a bill line to its sources and lighting them up is easy and half
// worthless; the value is in noticing that the cited measurements do not
// actually add up to the billed figure, and saying so.

import { describe, it, expect } from "vitest";
import { trace, traceAll, type BoqQuantity, type MeasurementSource } from "@/lib/boq/traceback";

const m = (
  artifactId: string, sheetNo: string, quantity: number, unit = "m2",
  over: Partial<MeasurementSource> = {},
): MeasurementSource => ({
  artifactId, sheetNo, item: "Blockwork", quantity, unit,
  sourceLayers: ["A-WALL"], fileId: "f1", pageNo: 3, ...over,
});

const line = (over: Partial<BoqQuantity> = {}): BoqQuantity => ({
  artifactId: "b1", code: "2.3.1", description: "140mm blockwork",
  quantity: 100, unit: "m2", provenance: ["m1", "m2"], ...over,
});

describe("when the numbers tie back", () => {
  const sources = [m("m1", "A-201", 60), m("m2", "A-202", 40)];

  it("reconciles exactly", () => {
    const t = trace(line(), sources);
    expect(t.sourceQuantity).toBe(100);
    expect(t.differenceQuantity).toBe(0);
    expect(t.reconciliation).toBe("exact");
    expect(t.needsReview).toBe(false);
  });

  it("gives the drawing view one target per sheet", () => {
    const t = trace(line(), sources);
    expect(t.targets.map((x) => x.sheetNo)).toEqual(["A-201", "A-202"]);
    expect(t.targets[0]).toMatchObject({ fileId: "f1", pageNo: 3, subtotal: 60 });
    expect(t.targets[0].layers).toEqual(["A-WALL"]);
  });

  it("shows each sheet's contribution, so the sum can be checked by eye", () => {
    const t = trace(line(), sources);
    expect(t.targets.map((x) => x.subtotal)).toEqual([60, 40]);
  });

  it("treats a difference inside rounding as rounding", () => {
    const t = trace(line({ quantity: 100.3 }), sources);
    expect(t.reconciliation).toBe("rounded");
    expect(t.needsReview).toBe(false);
  });
});

describe("when the bill exceeds what was measured", () => {
  const sources = [m("m1", "A-201", 60), m("m2", "A-202", 35)];

  it("reports the difference rather than presenting the link and implying agreement", () => {
    const t = trace(line({ quantity: 100 }), sources);
    expect(t.sourceQuantity).toBe(95);
    expect(t.differenceQuantity).toBe(5);
    expect(t.reconciliation).toBe("bill_exceeds_sources");
    expect(t.needsReview).toBe(true);
  });

  it("names a likely waste allowance as a possibility, not a conclusion", () => {
    // 5.3% is in allowance territory. Suggesting it helps; asserting it would
    // be guessing with authority at somebody better placed to know.
    const t = trace(line({ quantity: 100 }), sources);
    expect(t.explanation).toMatch(/often a waste, lap or cutting allowance/);
    expect(t.explanation).not.toMatch(/this is a waste allowance/i);
  });

  it("suggests a different cause when the gap is too big to be an allowance", () => {
    const t = trace(line({ quantity: 300 }), sources);
    expect(t.explanation).toMatch(/used but not cited/);
  });
});

describe("when more was measured than billed", () => {
  it("says work may have been left out of the bill", () => {
    // The direction that loses money quietly: measured, not billed, not paid.
    const t = trace(line({ quantity: 80 }), [m("m1", "A-201", 60), m("m2", "A-202", 40)]);
    expect(t.reconciliation).toBe("sources_exceed_bill");
    expect(t.differenceQuantity).toBe(-20);
    expect(t.explanation).toMatch(/left out of the bill/);
  });
});

describe("units are compared, never converted", () => {
  it("refuses to convert a mismatched unit into the total", () => {
    /* A measurement in mm against a bill in m is a thousand-fold error waiting
       to happen. Dividing by 1000 would fix the arithmetic and hide the mistake
       that produced it. */
    const t = trace(line({ provenance: ["m1"] }), [m("m1", "A-201", 100000, "mm")]);
    expect(t.reconciliation).toBe("unit_mismatch");
    expect(t.sourceQuantity).toBe(0);
    expect(t.explanation).toMatch(/converting it would hide the error/);
    expect(t.needsReview).toBe(true);
  });

  it("excludes a mismatched source from the total and says it did", () => {
    const t = trace(line({ quantity: 60, provenance: ["m1", "m2"] }), [
      m("m1", "A-201", 60),
      m("m2", "A-202", 12, "m3"),
    ]);
    expect(t.sourceQuantity).toBe(60);
    expect(t.reconciliation).toBe("exact");
    expect(t.explanation).toMatch(/excluded from the total rather than converted/);
    // Still worth a look, even though the arithmetic ties.
    expect(t.unitMismatches).toHaveLength(1);
  });

  it("treats known unit synonyms as the same measure", () => {
    // lm and m are the same thing written differently; flagging that as a
    // mismatch would be noise people learn to dismiss.
    const t = trace(line({ unit: "m", quantity: 60, provenance: ["m1"] }), [m("m1", "A-201", 60, "lm")]);
    expect(t.reconciliation).toBe("exact");
  });
});

describe("when there is nothing behind the number", () => {
  it("says so plainly", () => {
    const t = trace(line({ provenance: [] }), []);
    expect(t.reconciliation).toBe("no_sources");
    expect(t.explanation).toMatch(/nothing behind the number/);
    expect(t.needsReview).toBe(true);
  });

  it("reports provenance that resolves to nothing", () => {
    const t = trace(line({ provenance: ["m1", "ghost"] }), [m("m1", "A-201", 100)]);
    expect(t.danglingSources).toEqual(["ghost"]);
    expect(t.needsReview).toBe(true);
    expect(t.explanation).toMatch(/could not be found at all/);
  });

  it("carries an unverified citation through to the review flag", () => {
    // The arithmetic ties, but the citation audit could not match the line to a
    // parsed drawing — which is a different problem and still needs a look.
    const t = trace(
      line({ unverifiedCitation: "No layer matching A-WALL in the parsed drawings." }),
      [m("m1", "A-201", 60), m("m2", "A-202", 40)],
    );
    expect(t.reconciliation).toBe("exact");
    expect(t.needsReview).toBe(true);
    expect(t.explanation).toMatch(/could not match this line to a parsed drawing/);
  });
});

describe("tracing a whole bill", () => {
  const sources = [m("m1", "A-201", 60), m("m2", "A-202", 40), m("m3", "A-203", 20)];

  it("puts the worst discrepancy first", () => {
    const r = traceAll([
      line({ artifactId: "a", code: "1", quantity: 100 }),
      line({ artifactId: "b", code: "2", quantity: 130 }),
      line({ artifactId: "c", code: "3", quantity: 20, provenance: ["m3"] }),
    ], sources);
    // Line 2 is 30% out; line 1 and line 3 both tie exactly.
    expect(r.needingReview.map((t) => t.code)).toEqual(["2"]);
  });

  it("reports the count that matters before signing", () => {
    const r = traceAll([
      line({ code: "1", quantity: 100 }),
      line({ code: "2", quantity: 130 }),
    ], sources);
    expect(r.summary).toBe("1 of 2 line(s) do not tie back to their measurements.");
  });

  it("calls out lines with no traceable source at all", () => {
    const r = traceAll([line({ code: "1", provenance: [] })], sources);
    expect(r.summary).toMatch(/no traceable source at all/);
  });

  it("says so when everything ties", () => {
    const r = traceAll([line({ quantity: 100 })], sources);
    expect(r.needingReview).toEqual([]);
    expect(r.summary).toBe("All 1 line(s) tie back to their measurements.");
  });

  it("handles an empty bill", () => {
    expect(traceAll([], sources).summary).toBe("No bill lines to trace.");
  });
});

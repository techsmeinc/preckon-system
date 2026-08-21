// Rate build-ups.
//
// Two conventions in here are invertible, plausible either way round, and wrong
// by a factor if flipped — output (divide) and waste (multiply). Both get a
// test with numbers checkable by hand, because a rate that is wrong by the
// reciprocal looks completely reasonable in a bill.

import { describe, it, expect } from "vitest";
import { assemble, sensitivity, outputBreakeven, type Assembly } from "@/lib/cost/assemblies";

/** Blockwork: a gang of 2 at 4 m²/hour, blocks at 10/m² with 5% waste. */
const blockwork: Assembly = {
  key: "block-140",
  description: "140mm blockwork",
  unit: "m2",
  resources: [
    { id: "l1", kind: "labour", description: "Bricklayer", unit: "hour", rateMinor: 3000, outputPerHour: 4, gangSize: 2 },
    { id: "m1", kind: "material", description: "140mm blocks", unit: "nr", rateMinor: 150, usagePerUnit: 10, wastePct: 0.05 },
  ],
};

describe("labour: output divides", () => {
  it("turns gang units-per-hour into labour-hours-per-unit", () => {
    /* Output is the GANG's, per the estimating convention. A gang of 2 doing
       4 m²/hour needs 0.25 gang-hours per m², and each of the 2 is paid, so
       0.5 labour-hours per m² — 1500 at 3000/hour. Inverting the division
       would give 12,000 and still look like a rate. */
    const r = assemble({ ...blockwork, resources: [blockwork.resources[0]] });
    expect(r.lines[0].quantityPerUnit).toBe(0.5);
    expect(r.lines[0].costMinor).toBe(1500);
  });

  it("charges every member of the gang", () => {
    // Halve the gang and the same output costs half as much labour — the men
    // are paid individually even though the output is stated collectively.
    const solo = assemble({
      ...blockwork,
      resources: [{ ...blockwork.resources[0], gangSize: 1 }],
    });
    expect(solo.lines[0].costMinor).toBe(750);
  });

  it("refuses to price a line with no output, and says the rate is too low", () => {
    // Silently dropping the labour produces a materials-only rate that looks
    // like a rate.
    const r = assemble({
      ...blockwork,
      resources: [{ ...blockwork.resources[0], outputPerHour: 0 }],
    });
    expect(r.lines).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/too low/);
  });
});

describe("material: waste multiplies", () => {
  it("buys more than it places", () => {
    // 10 blocks/m² + 5% waste = 10.5 bought, at 150 = 1575.
    // Applying waste as a reduction, or as 1/(1-w), both give a wrong number
    // that looks fine.
    const r = assemble({ ...blockwork, resources: [blockwork.resources[1]] });
    expect(r.lines[0].quantityPerUnit).toBe(10.5);
    expect(r.lines[0].costMinor).toBe(1575);
  });

  it("flags a zero waste allowance as a likely omission", () => {
    const r = assemble({
      ...blockwork,
      resources: [{ ...blockwork.resources[1], wastePct: 0 }],
    });
    expect(r.warnings.some((w) => /usually an omission/.test(w))).toBe(true);
  });
});

describe("the assembled rate", () => {
  it("adds the resources", () => {
    expect(assemble(blockwork).netMinor).toBe(1500 + 1575);
  });

  it("shows what the rate is made of", () => {
    const r = assemble(blockwork);
    const labour = r.byKind.find((k) => k.kind === "labour")!;
    expect(labour.costMinor).toBe(1500);
    expect(labour.sharePct).toBe(48.8);
  });

  it("earns profit on prelims, not just on net cost", () => {
    /* Order matters and is a commercial decision. Net 3075, prelims at 10% =
       308, oncost at 15% on 3383 = 507. Applying oncost to the net alone would
       give 461 and price the job below the intended margin. */
    const r = assemble({ ...blockwork, prelimsPct: 0.1, oncostPct: 0.15 });
    expect(r.prelimsMinor).toBe(308);
    expect(r.oncostMinor).toBe(507);
    expect(r.rateMinor).toBe(3075 + 308 + 507);
  });

  it("prices a subcontract line as quoted, with no build-up", () => {
    const r = assemble({
      key: "sc", description: "Piling", unit: "nr",
      resources: [{ id: "s1", kind: "subcontract", description: "Piling s/c", unit: "nr", rateMinor: 0, perUnitMinor: 45000 }],
    });
    expect(r.rateMinor).toBe(45000);
    expect(r.lines[0].why).toMatch(/no build-up/);
  });

  it("says so rather than returning a confident zero", () => {
    const r = assemble({ key: "x", description: "Empty", unit: "m2", resources: [] });
    expect(r.rateMinor).toBe(0);
    expect(r.warnings.some((w) => /priced to nothing/.test(w))).toBe(true);
  });
});

describe("sensitivity", () => {
  it("answers what a 15% material rise does to the rate", () => {
    // The question a bid review asks and a quoted rate cannot answer.
    const [s] = sensitivity(blockwork, [{ kind: "material", pct: 0.15 }]);
    expect(s.change).toBe("material +15%");
    expect(s.deltaMinor).toBe(Math.round(1575 * 0.15));
  });

  it("leaves other kinds alone", () => {
    const [s] = sensitivity(blockwork, [{ kind: "labour", pct: 0.1 }]);
    expect(s.deltaMinor).toBe(150);   // 10% of the 1500 labour, nothing else
  });

  it("handles a fall as well as a rise", () => {
    const [s] = sensitivity(blockwork, [{ kind: "material", pct: -0.1 }]);
    expect(s.deltaMinor).toBeLessThan(0);
    expect(s.change).toBe("material -10%");
  });
});

describe("how far output can slip", () => {
  it("computes the drop that takes the item to cost", () => {
    /* Net 3075, sold at 3575, so headroom is 500 and labour is 1500.
       d = 500 / (500 + 1500) = 25%. Checkable by hand: at output × 0.75 the
       labour costs 1500/0.75 = 2000, which is exactly the headroom gone. */
    const r = outputBreakeven(blockwork, 3575);
    expect(r.headroomMinor).toBe(500);
    expect(r.maxOutputDropPct).toBe(25);
  });

  it("says plainly when the item is already below cost", () => {
    const r = outputBreakeven(blockwork, 2500);
    expect(r.maxOutputDropPct).toBe(0);
    expect(r.why).toMatch(/Already below cost/);
  });

  it("reports that output cannot erode a rate with no time in it", () => {
    const r = outputBreakeven({ ...blockwork, resources: [blockwork.resources[1]] }, 3000);
    expect(r.maxOutputDropPct).toBeNull();
    expect(r.why).toMatch(/cannot be eroded|cannot erode/);
  });
});

describe("the build-up explains itself", () => {
  it("states the output assumption in words", () => {
    // The assumption that decides whether the job makes money, and the one a
    // quoted rate does not record at all.
    expect(assemble(blockwork).lines[0].why).toMatch(/Gang of 2 at 4 m2\/hour → 0\.5 hour/);
  });

  it("states the waste allowance in words", () => {
    expect(assemble(blockwork).lines[1].why).toMatch(/plus 5% waste/);
  });
});

// Commercial arithmetic.
//
// The markup/margin tests are the point of this file. Every other bug here
// costs a report; that one costs the job, quietly, and only shows up at final
// account.

import { describe, it, expect } from "vitest";
import {
  waterfall, markupToMargin, marginToMarkup, priceForMargin, marginAtPrice,
  STANDARD_STAGES, type Stage,
} from "@/lib/cost/waterfall";
import { lookupRate, libraryCoverage, indexRate, type Rate } from "@/lib/cost/rates";
import { priceScenario, compareScenarios, type EstimateLine, type Scenario } from "@/lib/cost/scenarios";
import { cashflow, spread, sCurveFraction, type Activity } from "@/lib/cost/cashflow";

describe("markup is not margin", () => {
  it("converts both ways", () => {
    expect(markupToMargin(10)).toBeCloseTo(9.0909, 3);
    expect(marginToMarkup(9.0909)).toBeCloseTo(10, 3);
    expect(markupToMargin(100)).toBeCloseTo(50, 6);
  });

  it("solves a margin on price instead of adding it to cost", () => {
    // 10% margin on 100 cost is 111.11, not 110. Adding 10% of cost would leave
    // 9.09% on the sell price - the error this exists to prevent.
    const w = waterfall(10_000, [{ key: "p", label: "Profit", basis: "margin_on_price", percent: 10 }]);
    expect(w.sellMinor).toBe(11_111);
    expect(w.marginPct).toBeCloseTo(10, 2);
    expect(w.markupPct).toBeCloseTo(11.11, 2);
  });

  it("adds a markup to cost when that is what was asked for", () => {
    const w = waterfall(10_000, [{ key: "p", label: "Profit", basis: "markup_on_cost", percent: 10 }]);
    expect(w.sellMinor).toBe(11_000);
    expect(w.marginPct).toBeCloseTo(9.09, 2);
  });

  it("refuses a margin of 100% or more, which has no solution", () => {
    expect(() => waterfall(10_000, [{ key: "p", label: "P", basis: "margin_on_price", percent: 100 }])).toThrow(RangeError);
    expect(() => marginToMarkup(100)).toThrow(RangeError);
  });
});

describe("the waterfall compounds in order", () => {
  it("stages add up to the sell price exactly", () => {
    const w = waterfall(1_000_000, STANDARD_STAGES);
    const added = w.stages.reduce((a, s) => a + s.addedMinor, 0);
    expect(w.netCostMinor + added).toBe(w.sellMinor);
    expect(w.stages.at(-1)!.runningMinor).toBe(w.sellMinor);
  });

  it("gives a different answer when the order changes, and says so honestly", () => {
    const a: Stage[] = [
      { key: "o", label: "OH", basis: "markup_on_cost", percent: 10 },
      { key: "p", label: "Profit", basis: "markup_on_cost", percent: 10 },
    ];
    const b: Stage[] = [a[1], a[0]];
    // Same percentages, same cost, same total here (commutative for markups)...
    expect(waterfall(100_000, a).sellMinor).toBe(waterfall(100_000, b).sellMinor);
    // ...but not once a margin-on-price stage is in the stack.
    const withMargin: Stage[] = [
      { key: "o", label: "OH", basis: "markup_on_cost", percent: 10 },
      { key: "p", label: "Profit", basis: "margin_on_price", percent: 10 },
    ];
    const reversed: Stage[] = [withMargin[1], withMargin[0]];
    expect(waterfall(100_000, withMargin).sellMinor).not.toBe(waterfall(100_000, reversed).sellMinor);
  });

  it("keeps a stage out of the base when asked", () => {
    const stages: Stage[] = [
      { key: "bond", label: "Bond", basis: "fixed", amountMinor: 5_000, excludeFromBase: true },
      { key: "p", label: "Profit", basis: "markup_on_cost", percent: 10 },
    ];
    const w = waterfall(100_000, stages);
    // Profit is 10% of 100,000 - not of 105,000.
    expect(w.stages[1].addedMinor).toBe(10_000);
    expect(w.sellMinor).toBe(115_000);
  });

  it("prices a target margin, and reports what a cut leaves", () => {
    const price = priceForMargin(1_000_000, 12);
    expect(marginAtPrice(1_000_000, price)).toBeCloseTo(12, 6);
    expect(marginAtPrice(1_000_000, 950_000)).toBeLessThan(0);   // under water, not clamped
  });
});

describe("the rate library keeps its evidence", () => {
  const rates: Rate[] = [
    { id: "r1", itemKey: "block.200", description: "Blockwork 200mm", unit: "m2", rateMinor: 5200,
      currency: "AED", source: "estimate", capturedAt: "2026-01-01", region: "AE-DXB" },
    { id: "r2", itemKey: "block.200", description: "Blockwork 200mm", unit: "m2", rateMinor: 5600,
      currency: "AED", source: "subcontract", capturedAt: "2025-06-01", region: "AE-DXB" },
    { id: "r3", itemKey: "block.200", description: "Blockwork 200mm", unit: "m2", rateMinor: 4900,
      currency: "AED", source: "published", capturedAt: "2026-02-01", region: "AE-AUH" },
  ];

  it("prefers the strongest source over the cheapest number", () => {
    const hit = lookupRate(rates, "block.200", { at: "2026-06-01", region: "AE-DXB" })!;
    expect(hit.rate.id).toBe("r2");             // signed subcontract, not the cheaper guess
    expect(hit.why).toMatch(/subcontract/);
  });

  it("prefers a rate captured on this project above everything else", () => {
    const withProject: Rate[] = [
      ...rates,
      { id: "r4", itemKey: "block.200", description: "Blockwork", unit: "m2", rateMinor: 5100,
        currency: "AED", source: "quotation", capturedAt: "2026-03-01", projectId: "p1" },
    ];
    const hit = lookupRate(withProject, "block.200", { at: "2026-06-01", projectId: "p1", region: "AE-DXB" })!;
    expect(hit.rate.id).toBe("r4");
  });

  it("flags a stale rate rather than quietly indexing it into looking current", () => {
    const hit = lookupRate(rates, "block.200", { at: "2027-06-01", region: "AE-DXB", staleAfterMonths: 18 })!;
    expect(hit.stale).toBe(true);
    expect(hit.why).toMatch(/STALE/);
    expect(hit.rateMinor).toBe(5600);           // as captured, untouched
  });

  it("reports an indexed figure separately from the captured one", () => {
    const hit = lookupRate(rates, "block.200", { at: "2026-06-01", region: "AE-DXB", indexationPctPerYear: 6 })!;
    expect(hit.rateMinor).toBe(5600);
    expect(hit.indexedMinor).toBeGreaterThan(hit.rateMinor);
    expect(indexRate(10_000, 12, 6)).toBe(10_600);
  });

  it("says what the library cannot price before anyone starts", () => {
    const c = libraryCoverage(rates, ["block.200", "roof.membrane"], { at: "2026-06-01" });
    expect(c.coverage).toBe(0.5);
    expect(c.unpriced).toEqual(["roof.membrane"]);
  });
});

describe("scenarios", () => {
  const base: EstimateLine[] = [
    { id: "l1", description: "Blockwork", qty: 100, unit: "m2", rateMinor: 5000 },
    { id: "l2", description: "Finishes", qty: 100, unit: "m2", rateMinor: 2000 },
    { id: "l3", description: "Landscaping", qty: 1, unit: "item", rateMinor: 150_000 },
  ];
  const baseScenario: Scenario = { id: "s0", kind: "base", label: "Base", adjustments: [] };

  it("separates value given away by sharpening from value given away by removing scope", () => {
    const bafo: Scenario = {
      id: "s1", kind: "bafo", label: "BAFO",
      adjustments: [
        { lineId: "l1", kind: "rate", to: 4600, reason: "subcontractor held rate" },
        { lineId: "l3", kind: "remove", to: 0, reason: "landscaping moved to client scope" },
      ],
    };
    const d = compareScenarios(base, baseScenario, bafo);
    expect(d.summary).toMatch(/repricing/);
    expect(d.summary).toMatch(/withdrawing 1 item\(s\) of scope/);
    // The reason travels with the line, so "why is BAFO lower" is answerable.
    expect(d.lines.find((l) => l.lineId === "l3")!.reason).toMatch(/client scope/);
  });

  it("prices a scenario without mutating the base", () => {
    const target: Scenario = {
      id: "s2", kind: "target", label: "Target",
      adjustments: [{ lineId: "l2", kind: "quantity", to: 80, reason: "remeasured" }],
    };
    const priced = priceScenario(base, target);
    expect(priced.totalMinor).toBe(500_000 + 160_000 + 150_000);
    expect(base[1].qty).toBe(100);                       // untouched
  });

  it("counts withdrawn scope at what it was worth in the base", () => {
    const cut: Scenario = {
      id: "s3", kind: "bafo", label: "Cut",
      adjustments: [{ lineId: "l3", kind: "remove", to: 0, reason: "descoped" }],
    };
    const priced = priceScenario(base, cut);
    expect(priced.removedCount).toBe(1);
    expect(priced.removedValueMinor).toBe(150_000);
  });
});

describe("cash flow", () => {
  const activities: Activity[] = [
    { id: "a1", name: "Substructure", startMonth: 0, durationMonths: 4, costMinor: 4_000_000 },
    { id: "a2", name: "Superstructure", startMonth: 3, durationMonths: 6, costMinor: 9_000_000 },
  ];

  it("spreads an activity on an S-curve that totals its exact cost", () => {
    const s = spread(activities[0]);
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(4_000_000);
    // Ramp-up: the first month is lighter than the middle.
    expect(s.get(0)!).toBeLessThan(s.get(1)!);
    expect(sCurveFraction(0.5)).toBeCloseTo(0.5, 6);
  });

  it("shows the funding gap that a profitable job still has", () => {
    const c = cashflow(activities, { marginPct: 10, retentionPct: 5, paymentLagMonths: 2 });
    expect(c.totalCostMinor).toBe(13_000_000);
    expect(c.totalIncomeMinor).toBeLessThan(Math.round(13_000_000 * 1.1));  // retention still held
    expect(c.peakFundingMinor).toBeGreaterThan(0);
    expect(c.retentionHeldMinor).toBeGreaterThan(0);
  });

  it("returns retention when it is released, and stops reporting it as held", () => {
    const held = cashflow(activities, { marginPct: 10, retentionPct: 5, paymentLagMonths: 1 });
    const released = cashflow(activities, { marginPct: 10, retentionPct: 5, paymentLagMonths: 1, retentionReleaseMonth: 14 });
    expect(released.totalIncomeMinor).toBeGreaterThan(held.totalIncomeMinor);
    expect(released.retentionHeldMinor).toBe(0);
  });

  it("puts the peak funding requirement before the money starts arriving", () => {
    const c = cashflow(activities, { marginPct: 10, paymentLagMonths: 3 });
    expect(c.peakFundingMonth).toBeGreaterThan(0);
    expect(c.months[0].netMinor).toBeLessThan(0);   // paying out before being paid
  });
});

// Budget and forecast.
//
// The tests worth having are about the things a cost report gets wrong in a way
// that looks fine:
//
//   Commitment is money gone. A report showing only actuals says a package is
//   40% spent when it is 100% ordered.
//   Approved variations move the budget. Charging them against the original
//   makes a well-run job look like a failing one.
//   Where forecast methods disagree, the disagreement IS the information — a
//   blended number hides exactly the lines worth arguing about.

import { describe, it, expect } from "vitest";
import { forecast, movement, type BudgetLine } from "@/lib/cost/budget";

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  key: "L1", description: "Groundworks", package: "Substructure",
  budgetMinor: 100_000, committedMinor: 0, actualMinor: 0,
  ...over,
});

describe("commitment is money already gone", () => {
  it("shows a fully committed line as fully spent, whatever the actuals say", () => {
    // 100k ordered, 5k paid. A report keyed on actuals calls this 5% spent.
    const r = forecast([line({ committedMinor: 100_000, actualMinor: 5_000 })]);
    expect(r.lines[0].forecastMinor).toBe(100_000);
    expect(r.lines[0].uncommittedMinor).toBe(0);
    expect(r.lines[0].accruedMinor).toBe(95_000);
  });

  it("flags a line committed past its budget as contractual, not projected", () => {
    const r = forecast([line({ committedMinor: 120_000 })]);
    expect(r.lines[0].overcommitted).toBe(true);
    expect(r.lines[0].forecastMinor).toBe(120_000);
    expect(r.lines[0].why).toMatch(/contractual, not a projection/);
    expect(r.warnings.some((w) => /committed beyond budget/.test(w))).toBe(true);
  });

  it("never forecasts below what is already committed", () => {
    // Once ordered the money is gone; a lower forecast is arithmetic that
    // ignores a contract.
    const r = forecast([line({ budgetMinor: 80_000, committedMinor: 120_000 })]);
    expect(r.lines[0].forecastMinor).toBeGreaterThanOrEqual(120_000);
  });

  it("reports what is still controllable", () => {
    const r = forecast([line({ committedMinor: 60_000 })]);
    expect(r.uncommittedMinor).toBe(40_000);
  });
});

describe("approved variations move the budget", () => {
  it("does not report a scope change as an overrun", () => {
    /* 100k budget, 30k approved variation, 130k committed. That is a job
       running exactly to plan. Charging the variation against the original
       budget would report a 30% overrun on a line that has none. */
    const r = forecast([line({ variationMinor: 30_000, committedMinor: 130_000 })]);
    expect(r.lines[0].budgetMinor).toBe(130_000);
    expect(r.lines[0].varianceMinor).toBe(0);
    expect(r.lines[0].overcommitted).toBe(false);
  });
});

describe("forecasting methods", () => {
  const overspending = line({
    committedMinor: 50_000, actualMinor: 60_000, percentComplete: 0.5,
  });

  it("extrapolates the overrun so far under the performance method", () => {
    // 50% complete = 50k earned, 60k spent → CPI 0.833 → final 120k.
    const r = forecast([overspending], { method: "performance" });
    expect(r.lines[0].method).toBe("performance");
    expect(r.lines[0].forecastMinor).toBe(120_000);
  });

  it("keeps every method's answer so the choice can be argued with", () => {
    const r = forecast([overspending], { method: "performance" });
    const methods = r.lines[0].candidates.map((c) => c.method);
    expect(methods).toContain("committed");
    expect(methods).toContain("performance");
  });

  it("flags a line where the methods disagree materially", () => {
    // Committed says 100k, performance says 120k. That 20% gap is the whole
    // conversation, and a blended figure would hide it.
    const r = forecast([overspending], { method: "performance" });
    expect(r.lines[0].contested).toBe(true);
    expect(r.lines[0].why).toMatch(/a position, not a fact/);
  });

  it("does not compute a performance forecast without progress", () => {
    // CPI is undefined without progress; producing one anyway would be a guess
    // wearing a formula.
    const r = forecast([line({ actualMinor: 60_000 })], { method: "performance" });
    expect(r.lines[0].candidates.some((c) => c.method === "performance")).toBe(false);
    expect(r.lines[0].method).toBe("committed");
  });

  it("warns when nothing in the report carries progress", () => {
    const r = forecast([line({ committedMinor: 40_000 })]);
    expect(r.warnings.some((w) => /assumes the committed cost is the final cost/.test(w))).toBe(true);
  });

  it("uses an estimator's own figure when asked, and labels its risk", () => {
    const r = forecast([line({ manualForecastMinor: 90_000 })], { method: "manual" });
    expect(r.lines[0].forecastMinor).toBe(90_000);
    expect(r.lines[0].candidates.find((c) => c.method === "manual")!.why)
      .toMatch(/can be optimistic/);
  });

  it("falls back rather than failing when the preferred method has no inputs", () => {
    const r = forecast([line({ committedMinor: 40_000 })], { method: "manual" });
    expect(r.lines[0].method).toBe("committed");
  });
});

describe("the report as a whole", () => {
  const job = [
    line({ key: "A", description: "Groundworks", budgetMinor: 100_000, committedMinor: 130_000 }),
    line({ key: "B", description: "Frame", package: "Superstructure", budgetMinor: 200_000, committedMinor: 190_000 }),
  ];

  it("totals budget, commitment and forecast", () => {
    const r = forecast(job);
    expect(r.budgetMinor).toBe(300_000);
    expect(r.committedMinor).toBe(320_000);
    expect(r.forecastMinor).toBe(130_000 + 200_000);
  });

  it("puts the worst variances first in the exceptions", () => {
    const r = forecast(job);
    expect(r.exceptions[0].key).toBe("A");
    expect(r.exceptions[0].varianceMinor).toBe(30_000);
  });

  it("leaves lines within tolerance out of the exceptions", () => {
    // B forecasts on budget; only A is worth a conversation.
    expect(forecast(job).exceptions.map((e) => e.key)).toEqual(["A"]);
  });

  it("rolls up by package", () => {
    const r = forecast(job);
    expect(r.byPackage).toEqual([
      { package: "Substructure", budgetMinor: 100_000, forecastMinor: 130_000, varianceMinor: 30_000 },
      { package: "Superstructure", budgetMinor: 200_000, forecastMinor: 200_000, varianceMinor: 0 },
    ]);
  });

  it("states the position in one sentence", () => {
    expect(forecast(job).summary).toMatch(/30000 over \(10%\)/);
  });

  it("handles an empty report without inventing a position", () => {
    const r = forecast([]);
    expect(r.summary).toBe("No budget lines.");
    expect(r.exceptions).toEqual([]);
  });
});

describe("what moved since last month", () => {
  const before = forecast([line({ key: "A", committedMinor: 100_000 })]);

  it("attributes a move to an approved variation rather than an overrun", () => {
    const after = forecast([line({ key: "A", variationMinor: 30_000, committedMinor: 130_000 })]);
    const m = movement(before, after);
    expect(m.totalMinor).toBe(30_000);
    expect(m.byLine[0].reason).toMatch(/approved variation, not an overrun/);
  });

  it("attributes a move to procurement when the order came in above the allowance", () => {
    const after = forecast([line({ key: "A", committedMinor: 115_000 })]);
    expect(movement(before, after).byLine[0].reason).toMatch(/orders placed at a different figure/);
  });

  it("notices a method change rather than calling it performance", () => {
    const after = forecast(
      [line({ key: "A", committedMinor: 100_000, actualMinor: 60_000, percentComplete: 0.5 })],
      { method: "performance" },
    );
    expect(movement(before, after).byLine[0].reason).toMatch(/method changed from committed to performance/);
  });

  it("reports a new line as new", () => {
    const after = forecast([line({ key: "A", committedMinor: 100_000 }), line({ key: "B" })]);
    const m = movement(before, after);
    expect(m.newLines).toEqual(["B"]);
    expect(m.byLine.find((l) => l.key === "B")!.reason).toMatch(/New line/);
  });

  it("says plainly when nothing moved", () => {
    expect(movement(before, before).summary).toMatch(/has not moved/);
  });

  it("names the largest single mover", () => {
    const after = forecast([line({ key: "A", committedMinor: 180_000 })]);
    expect(movement(before, after).summary).toMatch(/largest single mover Groundworks/);
  });
});

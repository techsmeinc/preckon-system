// Earned value and variations.
//
// Two tests here matter more than the rest. EV must come from physical progress
// and never from spend, because earning value at the rate you spend it makes
// CPI exactly 1.00 forever and the whole exercise decorative. And a variation
// account must separate agreed money from hoped-for money, because a single
// total invites the board to add it to the forecast whole.

import { describe, it, expect } from "vitest";
import { evm, rollUp, worstPerformers, type WorkPackage } from "@/lib/cost/evm";
import {
  notify, quote, instruct, agree, register, priceChange,
  type Variation, type ContractTerms,
} from "@/lib/cost/variations";

describe("earned value", () => {
  it("tells a late job apart from an expensive one", () => {
    // Same spend, same budget. One has done the work, the other has not.
    const late = evm({ budgetMinor: 1_000_000, plannedValueMinor: 500_000, earnedValueMinor: 350_000, actualCostMinor: 350_000 });
    const expensive = evm({ budgetMinor: 1_000_000, plannedValueMinor: 500_000, earnedValueMinor: 500_000, actualCostMinor: 650_000 });

    expect(late.health).toBe("behind");
    expect(late.spi).toBeLessThan(1);
    expect(late.cpi).toBe(1);                    // cost is fine; the programme is not

    expect(expensive.health).toBe("over_cost");
    expect(expensive.spi).toBe(1);               // on programme
    expect(expensive.cpi).toBeLessThan(1);
  });

  it("forecasts on the efficiency achieved so far, not on hope", () => {
    // Spent 650k to earn 500k: CPI 0.77. Finishing the remaining half at
    // budget rate would be a forecast nobody should sign.
    const e = evm({ budgetMinor: 1_000_000, plannedValueMinor: 500_000, earnedValueMinor: 500_000, actualCostMinor: 650_000 });
    expect(e.eacMinor).toBe(1_300_000);
    expect(e.vacMinor).toBe(-300_000);
    expect(e.summary).toMatch(/forecast overrun/);
  });

  it("says when the recovery required is implausible", () => {
    const e = evm({ budgetMinor: 1_000_000, plannedValueMinor: 800_000, earnedValueMinor: 400_000, actualCostMinor: 700_000 });
    expect(e.tcpi).toBeGreaterThan(1.1);
    expect(e.summary).toMatch(/almost never happens/);
  });

  it("does not divide by zero before anything has been spent", () => {
    const e = evm({ budgetMinor: 1_000_000, plannedValueMinor: 0, earnedValueMinor: 0, actualCostMinor: 0 });
    expect(e.cpi).toBe(1);
    expect(e.eacMinor).toBe(1_000_000);
    expect(Number.isFinite(e.spi)).toBe(true);
  });

  it("earns value from physical progress, never from spend", () => {
    // The package has burned its whole budget having built a third of the work.
    // EV must reflect the third, or CPI would report 1.00 and hide it.
    const packages: WorkPackage[] = [
      { id: "p1", name: "Substructure", budgetMinor: 600_000, percentComplete: 33,
        plannedPercentComplete: 100, actualCostMinor: 600_000 },
      { id: "p2", name: "Frame", budgetMinor: 400_000, percentComplete: 50,
        plannedPercentComplete: 50, actualCostMinor: 180_000 },
    ];
    const r = rollUp(packages);
    expect(r.evMinor).toBe(198_000 + 200_000);
    expect(r.cpi).toBeLessThan(1);
    expect(r.health).toBe("behind_and_over");
  });

  it("names the packages doing the damage", () => {
    const packages: WorkPackage[] = [
      { id: "p1", name: "Substructure", budgetMinor: 600_000, percentComplete: 33, plannedPercentComplete: 100, actualCostMinor: 600_000 },
      { id: "p2", name: "Frame", budgetMinor: 400_000, percentComplete: 50, plannedPercentComplete: 50, actualCostMinor: 180_000 },
    ];
    const worst = worstPerformers(rollUp(packages));
    expect(worst[0].id).toBe("p1");
    expect(worst[0].overspendMinor).toBe(402_000);
    expect(worst).toHaveLength(1);            // p2 is under, not over
  });
});

/* ── variations ───────────────────────────────────────────────────────────── */

const terms: ContractTerms = { noticeWindowDays: 14, instructionThresholdMinor: 500_000 };

const v = (over: Partial<Variation> = {}): Variation => ({
  id: "v1", ref: "VO-001", title: "Additional drainage", status: "identified",
  basis: "boq_rates", valueMinor: 120_000, identifiedAt: "2026-05-01", ...over,
});

const ok = <T,>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe("variations", () => {
  it("refuses a late notice and says why it matters", () => {
    const r = notify(v(), "2026-05-20", terms);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/time-barred/);
  });

  it("accepts notice inside the window", () => {
    expect(ok(notify(v(), "2026-05-10", terms)).status).toBe("notified");
  });

  it("will not record an unattributed instruction", () => {
    const notified = ok(notify(v(), "2026-05-05", terms));
    const r = instruct(notified, "2026-05-06", "  ", terms);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/who instructed/);
  });

  it("requires a quote before instructing above the threshold", () => {
    const big = ok(notify(v({ valueMinor: 900_000 }), "2026-05-05", terms));
    expect(instruct(big, "2026-05-06", "Client PM", terms).ok).toBe(false);
    const quoted = ok(quote(big, "2026-05-06", 900_000, "star_rate"));
    expect(ok(instruct(quoted, "2026-05-07", "Client PM", terms)).status).toBe("instructed");
  });

  it("separates agreed money from hoped-for money", () => {
    const agreed = ok(agree(ok(instruct(ok(notify(v(), "2026-05-02", terms)), "2026-05-03", "Client PM", terms)), "2026-05-10"));
    const instructed = ok(instruct(ok(notify(v({ id: "v2", ref: "VO-002", valueMinor: 80_000 }), "2026-05-02", terms)), "2026-05-03", "Client PM", terms));
    const onlyNotified = ok(notify(v({ id: "v3", ref: "VO-003", valueMinor: 40_000 }), "2026-05-02", terms));

    const r = register([agreed, instructed, onlyNotified]);
    expect(r.agreedMinor).toBe(120_000);
    expect(r.instructedMinor).toBe(80_000);
    expect(r.atRiskMinor).toBe(40_000);
    expect(r.summary).toMatch(/agreed/);
  });

  it("flags work started without an instruction as the dangerous number", () => {
    const risky = v({ ref: "VO-009", valueMinor: 250_000, status: "notified", workStarted: true });
    const r = register([risky]);
    expect(r.unauthorisedMinor).toBe(250_000);
    expect(r.risks[0].why).toMatch(/nothing obliging the client to pay/);
    expect(r.risks[0].exposure).toBe("at_risk");
  });

  it("prices at the contract rate when comparable work exists", () => {
    const p = priceChange(40, { code: "D10", description: "Drainage 150mm", rateMinor: 3000 });
    expect(p.valueMinor).toBe(120_000);
    expect(p.basis).toBe("boq_rates");
    expect(p.note).toMatch(/already agreed, not negotiable/);
  });

  it("falls back to a star rate and warns it will be challenged", () => {
    const p = priceChange(40, null, 4200);
    expect(p.basis).toBe("star_rate");
    expect(p.note).toMatch(/expect it to be challenged/);
  });

  it("carries a change with no basis as provisional rather than as zero cost", () => {
    const p = priceChange(40, null);
    expect(p.basis).toBe("provisional");
    expect(p.note).toMatch(/until it is priced/);
  });
});

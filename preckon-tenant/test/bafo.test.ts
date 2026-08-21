// Best and Final Offer.
//
// This module exists to be uncomfortable at the right moments. A BAFO tool that
// computed the new total and stopped would help produce exactly the submission
// it should be preventing: three points of margin given away under time
// pressure, nothing received, contingency quietly stripped to make the number
// work.

import { describe, it, expect } from "vitest";
import { assess, asksFor, type BafoInput, type Concession } from "@/lib/tender/bafo";

const c = (over: Partial<Concession> = {}): Concession => ({
  id: "c1", description: "Reduce preliminaries", source: "margin",
  amountMinor: 200_000, inReturn: "Payment terms cut from 60 to 30 days.", ...over,
});

const input = (over: Partial<BafoInput> = {}): BafoInput => ({
  originalPriceMinor: 10_600_000,
  netCostMinor: 10_000_000,
  floorMarginPct: 0.03,
  contingencyMinor: 300_000,
  concessions: [c()],
  ...over,
});

describe("the arithmetic", () => {
  it("reduces the price by the concessions", () => {
    const a = assess(input());
    expect(a.reductionMinor).toBe(200_000);
    expect(a.revisedPriceMinor).toBe(10_400_000);
    expect(a.reductionPct).toBe(1.9);
  });

  it("shows what the margin was and what it becomes", () => {
    const a = assess(input());
    expect(a.originalMarginPct).toBe(0.06);
    expect(a.revisedMarginPct).toBe(0.04);
  });
});

describe("nothing given without something received", () => {
  it("flags a concession with nothing against it", () => {
    const a = assess(input({ concessions: [c({ inReturn: null })] }));
    expect(a.unreciprocated).toHaveLength(1);
    expect(a.warnings.some((w) => /give something away for nothing/.test(w))).toBe(true);
  });

  it("treats whitespace as nothing, because it is", () => {
    const a = assess(input({ concessions: [c({ inReturn: "   " })] }));
    expect(a.unreciprocated).toHaveLength(1);
  });

  it("says what every bidder is being asked, so asking back is normal", () => {
    const a = assess(input({ concessions: [c({ inReturn: null })] }));
    expect(a.warnings.find((w) => /nothing/.test(w))).toMatch(/the ones who ask get something back/);
  });

  it("accepts a concession that bought something", () => {
    const a = assess(input());
    expect(a.unreciprocated).toEqual([]);
    expect(a.recommendation).toBe("submit");
  });
});

describe("where the reduction comes from", () => {
  it("says a contingency reduction is risk absorbed, not cost removed", () => {
    /* The dangerous one: it looks like margin on the page and behaves like a
       liability on site. The price is lower and the job is not cheaper. */
    const a = assess(input({
      concessions: [c({ source: "contingency", amountMinor: 200_000 })],
    }));
    expect(a.contingencyGivenMinor).toBe(200_000);
    expect(a.concessions[0].verdict).toMatch(/same exposure at a lower price/);
  });

  it("escalates the wording when most of the contingency has gone", () => {
    const a = assess(input({
      contingencyMinor: 300_000,
      concessions: [c({ source: "contingency", amountMinor: 250_000 })],
    }));
    expect(a.contingencyStrippedPct).toBe(83.3);
    expect(a.warnings.some((w) => /nothing on the submitted page says so/.test(w))).toBe(true);
    expect(a.recommendation).toBe("submit_with_caution");
  });

  it("points out that a scope reduction is not a price reduction", () => {
    const a = assess(input({ concessions: [c({ source: "scope", amountMinor: 200_000 })] }));
    expect(a.concessions[0].verdict).toMatch(/less work for less money/);
    expect(a.warnings.some((w) => /reads as a saving we did not offer/.test(w))).toBe(true);
  });

  it("makes a supply-chain reduction conditional on the supplier holding it", () => {
    const a = assess(input({ concessions: [c({ source: "supply_chain" })] }));
    expect(a.concessions[0].verdict).toMatch(/in writing before it is offered/);
  });

  it("makes an efficiency saving somebody's job rather than an assumption", () => {
    const a = assess(input({ concessions: [c({ source: "efficiency" })] }));
    expect(a.concessions[0].verdict).toMatch(/someone owns delivering it/);
  });

  it("shows each concession's share of the total", () => {
    const a = assess(input({
      concessions: [c({ id: "a", amountMinor: 150_000 }), c({ id: "b", amountMinor: 50_000 })],
    }));
    expect(a.concessions.map((x) => x.sharePct)).toEqual([75, 25]);
  });
});

describe("the lines that must not be crossed", () => {
  it("refuses an offer below the margin floor", () => {
    const a = assess(input({ floorMarginPct: 0.05 }));
    expect(a.belowFloor).toBe(true);
    expect(a.recommendation).toBe("do_not_submit");
    expect(a.warnings.some((w) => /above the bid team, not inside it/.test(w))).toBe(true);
  });

  it("refuses an offer below net cost, and says the loss grows", () => {
    const a = assess(input({ concessions: [c({ amountMinor: 800_000 })] }));
    expect(a.recommendation).toBe("do_not_submit");
    expect(a.warnings.some((w) => /loses money on day one/.test(w))).toBe(true);
  });
});

describe("against a client's stated target", () => {
  it("confirms when the offer reaches it", () => {
    const a = assess(input({ clientTargetMinor: 10_400_000 }));
    expect(a.meetsTarget).toBe(true);
  });

  it("advises explaining a shortfall rather than submitting silently short", () => {
    // Submitting short of a named target without explanation reads as
    // unwillingness rather than inability.
    const a = assess(input({ clientTargetMinor: 10_000_000 }));
    expect(a.meetsTarget).toBe(false);
    expect(a.warnings.some((w) => /unwillingness rather than inability/.test(w))).toBe(true);
  });

  it("reports null where the client named no figure", () => {
    expect(assess(input()).meetsTarget).toBeNull();
  });
});

describe("what to ask for in return", () => {
  it("always asks for payment terms, which cost the client least", () => {
    const asks = asksFor(assess(input()));
    expect(asks[0]).toMatch(/Payment terms shortened/);
  });

  it("asks for the stripped risk back when contingency funded the offer", () => {
    // If we are no longer pricing it, we should not be carrying it.
    const asks = asksFor(assess(input({ concessions: [c({ source: "contingency" })] })));
    expect(asks.some((a) => /transferred back or capped/.test(a))).toBe(true);
  });

  it("asks for a position, not just a place, on a large reduction", () => {
    const asks = asksFor(assess(input({ concessions: [c({ amountMinor: 500_000 })] })));
    expect(asks.some((a) => /Exclusivity, or a commitment on the follow-on/.test(a))).toBe(true);
  });

  it("asks for confirmation that this is the final round", () => {
    // Saying so now is what makes refusing a second BAFO possible later.
    expect(asksFor(assess(input())).some((a) => /final round/.test(a))).toBe(true);
  });

  it("asks for nothing when nothing is being given", () => {
    expect(asksFor(assess(input({ concessions: [] })))).toEqual([]);
  });
});

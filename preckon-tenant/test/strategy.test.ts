// Bid strategy.
//
// The decisions this has to get right are the ones that cost real money:
// refusing to bid work we cannot deliver, refusing to price below the floor,
// and — the one every bid team gets wrong — noticing that a run of WIDE price
// losses means the work is not for us at our rates, rather than that the pencil
// needs sharpening again.

import { describe, it, expect } from "vitest";
import { assess, priceOptions, competitors, type BidContext } from "@/lib/tender/strategy";
import { analyse, type BidOutcome } from "@/lib/tender/outcome";

const ctx = (over: Partial<BidContext> = {}): BidContext => ({
  client: "Cedarstone Estates", valueMinor: 10_000_000,
  capacityAvailable: true, relevantExperience: true, ...over,
});

const bid = (over: Partial<BidOutcome> = {}): BidOutcome => ({
  id: "b1", projectId: "p1", client: "Cedarstone Estates",
  ourPriceMinor: 10_000_000, outcome: "lost", reason: "price",
  winningPriceMinor: 9_000_000, ...over,
});

describe("things that end the discussion", () => {
  it("refuses work we cannot resource, whatever the score", () => {
    // Winning work you cannot build costs more than losing it: the damages and
    // the lost client outlast the turnover.
    const a = assess(ctx({ capacityAvailable: false, bidderCount: 2, daysToSubmit: 60 }));
    expect(a.recommendation).toBe("no_bid");
    expect(a.blockers[0]).toMatch(/cannot be resourced/);
    expect(a.why).toMatch(/not fixed by winning/);
  });

  it("carries a red flag straight to a no-bid", () => {
    const a = assess(ctx({ redFlags: ["Unlimited liability for consequential loss."] }));
    expect(a.recommendation).toBe("no_bid");
    expect(a.blockers).toContain("Unlimited liability for consequential loss.");
  });

  it("makes unconfirmed capacity a condition rather than an assumption", () => {
    const a = assess(ctx({ capacityAvailable: undefined }));
    expect(a.conditions.some((c) => /Confirm delivery capacity/.test(c))).toBe(true);
  });
});

describe("reading the loss history", () => {
  const wideLosses = analyse(Array.from({ length: 6 }, (_, i) =>
    bid({ id: `b${i}`, reason: "price", winningPriceMinor: 8_000_000 })));

  it("treats a run of wide price losses as a cost position, not a pricing error", () => {
    /* The judgement that matters. Six losses at a 25% gap does not mean price
       harder — it means this work is not for us at these rates, and sharpening
       the pencil again is how a contractor bids itself into a loss-making job. */
    const a = assess(ctx({ relevantExperience: true }), wideLosses);
    const pattern = a.factors.find((f) => f.key === "loss_pattern")!;
    expect(pattern.score).toBe(-2);
    expect(pattern.evidence).toMatch(/structural cost position/);
  });

  it("treats narrow price losses as something small being wrong", () => {
    const narrow = analyse(Array.from({ length: 4 }, (_, i) =>
      bid({ id: `n${i}`, reason: "price", ourPriceMinor: 10_200_000, winningPriceMinor: 10_000_000 })));
    const a = assess(ctx(), narrow);
    const pattern = a.factors.find((f) => f.key === "loss_pattern");
    expect(pattern?.score).toBe(0);
    expect(pattern?.evidence).toMatch(/something small is wrong rather than the rates/);
  });

  it("turns repeated compliance losses into a process condition", () => {
    // Losing on a formality is the most annoying loss there is and the easiest
    // to stop, so it becomes an instruction rather than a score.
    const compliance = analyse([
      bid({ id: "c1", reason: "compliance" }),
      bid({ id: "c2", reason: "compliance" }),
      bid({ id: "c3", reason: "price" }),
    ]);
    const a = assess(ctx(), compliance);
    expect(a.conditions.some((c) => /outside the bid team check the submission/.test(c))).toBe(true);
  });

  it("judges client hit rate against our own average, not an industry figure", () => {
    /* 20% is poor on a framework and excellent in open competition, and only
       this contractor's own numbers know which this is. */
    const mixed = analyse([
      ...Array.from({ length: 4 }, (_, i) => bid({ id: `w${i}`, client: "Cedarstone Estates", outcome: "won", reason: null })),
      ...Array.from({ length: 20 }, (_, i) => bid({ id: `l${i}`, client: "Other plc", reason: "price" })),
    ]);
    const f = assess(ctx(), mixed).factors.find((x) => x.key === "client_history")!;
    expect(f.score).toBe(2);
    expect(f.evidence).toMatch(/against an overall/);
  });

  it("says plainly when a client has never been bid", () => {
    const a = assess(ctx({ client: "Someone New" }), analyse([bid()]));
    const f = a.factors.find((x) => x.key === "client_history")!;
    expect(f.evidence).toMatch(/Never bid this client/);
    expect(f.score).toBe(-1);
  });

  it("refuses to read anything into one or two bids", () => {
    const thin = analyse([bid({ id: "t1" }), bid({ id: "t2" })]);
    const f = assess(ctx(), thin).factors.find((x) => x.key === "client_history")!;
    expect(f.evidence).toMatch(/too few to read anything into/);
    expect(f.score).toBe(0);
  });
});

describe("the shape of the opportunity", () => {
  it("counts a crowded field against bidding", () => {
    const a = assess(ctx({ bidderCount: 12 }));
    const f = a.factors.find((x) => x.key === "field")!;
    expect(f.score).toBe(-2);
    expect(f.evidence).toMatch(/8% share on names alone/);
  });

  it("counts a short list in favour", () => {
    expect(assess(ctx({ bidderCount: 3 })).factors.find((x) => x.key === "field")!.score).toBe(2);
  });

  it("notes that quality effort is wasted on a price-dominated award", () => {
    const f = assess(ctx({ priceWeighting: 0.9 })).factors.find((x) => x.key === "award_criteria")!;
    expect(f.evidence).toMatch(/quality effort is largely wasted/);
  });

  it("favours a quality-weighted award where we have the experience", () => {
    const f = assess(ctx({ priceWeighting: 0.3, relevantExperience: true }))
      .factors.find((x) => x.key === "award_criteria")!;
    expect(f.score).toBe(2);
  });

  it("makes a short deadline a condition, not just a score", () => {
    const a = assess(ctx({ daysToSubmit: 8 }));
    expect(a.conditions.some((c) => /resource it properly now or decline/.test(c))).toBe(true);
  });

  it("weighs the bid cost against the prize", () => {
    const a = assess(ctx({ bidCostMinor: 250_000, valueMinor: 10_000_000 }));
    expect(a.bidCostPct).toBe(2.5);
    expect(a.factors.find((x) => x.key === "bid_cost")!.score).toBe(-2);
  });
});

describe("the recommendation", () => {
  it("recommends bidding a strong opportunity", () => {
    const a = assess(ctx({ bidderCount: 3, daysToSubmit: 45, priceWeighting: 0.3, bidCostMinor: 10_000 }));
    expect(a.recommendation).toBe("bid");
    expect(a.score).toBeGreaterThan(40);
  });

  it("names the marginal band as the one that gets decided by default", () => {
    // The real failure mode: nobody decides, estimating starts, and three weeks
    // later walking away feels like waste.
    const a = assess(ctx({ relevantExperience: undefined, capacityAvailable: true, bidderCount: 6 }));
    expect(a.recommendation).toBe("marginal");
    expect(a.why).toMatch(/never formally decided/);
  });

  it("attaches conditions to a conditional bid", () => {
    const a = assess(ctx({ bidderCount: 3, daysToSubmit: 10, priceWeighting: 0.3 }));
    expect(a.recommendation).toBe("bid_with_conditions");
    expect(a.conditions.length).toBeGreaterThan(0);
  });

  it("names what is dragging it down", () => {
    const a = assess(ctx({ relevantExperience: false, bidderCount: 10 }));
    expect(a.against[0].label).toBeTruthy();
    expect(a.why).toMatch(/Against:/);
  });
});

describe("pricing options", () => {
  const history = analyse(Array.from({ length: 5 }, (_, i) =>
    bid({ id: `p${i}`, ourPriceMinor: 10_500_000, winningPriceMinor: 10_000_000 })));

  it("never suggests a price below the floor", () => {
    /* A tool that priced below the floor would be doing the arguing a
       commercial director is paid to do, and buying turnover below cost is the
       classic way for a busy contractor to fail. */
    const r = priceOptions({
      netCostMinor: 9_000_000, targetMarginPct: 0.06, floorMarginPct: 0.04,
      history: analyse(Array.from({ length: 4 }, (_, i) =>
        bid({ id: `g${i}`, ourPriceMinor: 13_000_000, winningPriceMinor: 10_000_000 }))),
    });
    const competitive = r.options.find((o) => o.label.startsWith("Competitive"))!;
    expect(competitive.marginPct).toBe(0.04);
    expect(competitive.label).toBe("Competitive (floored)");
    expect(competitive.rationale).toMatch(/below the 4% floor/);
  });

  it("says plainly when the floored price still will not win", () => {
    const r = priceOptions({
      netCostMinor: 9_000_000, targetMarginPct: 0.06, floorMarginPct: 0.04,
      history: analyse(Array.from({ length: 4 }, (_, i) =>
        bid({ id: `g${i}`, ourPriceMinor: 13_000_000, winningPriceMinor: 10_000_000 }))),
    });
    const competitive = r.options.find((o) => o.label.startsWith("Competitive"))!;
    expect(competitive.risk).toMatch(/still expected to lose on price/);
    expect(competitive.risk).toMatch(/worth taking deliberately/);
  });

  it("offers a competitive option only where price is demonstrably the problem", () => {
    // Without a disclosed winning price there is nothing to close a gap
    // against, and offering the option anyway invites margin to be given away
    // to a competitor nobody has evidence of.
    const r = priceOptions({
      netCostMinor: 9_000_000, targetMarginPct: 0.06, floorMarginPct: 0.04,
      history: analyse([bid({ winningPriceMinor: null })]),
    });
    expect(r.options.map((o) => o.label)).toEqual(["Target"]);
    expect(r.note).toMatch(/Recording winning prices on future losses/);
  });

  it("offers a premium only on a genuinely short list", () => {
    const short = priceOptions({ netCostMinor: 9_000_000, targetMarginPct: 0.06, floorMarginPct: 0.04, bidderCount: 2 });
    expect(short.options.some((o) => o.label === "Premium")).toBe(true);
    const crowded = priceOptions({ netCostMinor: 9_000_000, targetMarginPct: 0.06, floorMarginPct: 0.04, bidderCount: 9 });
    expect(crowded.options.some((o) => o.label === "Premium")).toBe(false);
  });

  it("states what each price is betting on and what it costs if wrong", () => {
    const r = priceOptions({
      netCostMinor: 9_000_000, targetMarginPct: 0.06, floorMarginPct: 0.02, history,
    });
    for (const o of r.options) {
      expect(o.rationale).toBeTruthy();
      expect(o.risk).toBeTruthy();
    }
  });

  it("prices from cost and margin, checkably", () => {
    const r = priceOptions({ netCostMinor: 10_000_000, targetMarginPct: 0.05, floorMarginPct: 0.02 });
    expect(r.options[0].priceMinor).toBe(10_500_000);
  });
});

describe("competitors", () => {
  const bids = [
    bid({ id: "x1", winner: "Harlow Build", outcome: "lost" }),
    bid({ id: "x2", winner: "Harlow Build", outcome: "lost" }),
    bid({ id: "x3", outcome: "won", reason: null, winner: null }),
  ];

  it("reports a repeat winner as something to understand, not just count", () => {
    const [c] = competitors(["Harlow Build"], bids);
    expect(c.theyWon).toBe(2);
    expect(c.note).toMatch(/what they price differently/);
  });

  it("says plainly when a named competitor is an unknown", () => {
    // A name with no history is not a benchmark, and treating it as one is how
    // a tender board talks itself into a number.
    const [c] = competitors(["Nobody We Know"], bids);
    expect(c.metThem).toBe(0);
    expect(c.ourWinRate).toBeNull();
    expect(c.note).toMatch(/unknown rather than as a benchmark/);
  });
});

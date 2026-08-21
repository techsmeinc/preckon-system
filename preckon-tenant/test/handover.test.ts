// Bid-to-delivery handover.
//
// The value of this module is entirely in what it says is MISSING. A pack that
// renders cleanly with three assumptions absent is worse than no pack — it
// persuades a site team they have the full picture. So the tests are about
// whether gaps stay visible, and whether the three things that always get lost
// (unaccepted qualifications, keen rates, unrecorded risk) are carried across.

import { describe, it, expect } from "vitest";
import { pack, questionsForBidTeam, type HandoverInput, type HandoverItem } from "@/lib/tender/handover";

const item = (over: Partial<HandoverItem> = {}): HandoverItem => ({
  id: "i1", area: "commercial", title: "Preliminaries basis",
  detail: "Priced on a 62-week programme with a shared welfare facility.",
  material: true, ...over,
});

/** A pack with every area covered, so a test can knock out one thing at a time. */
const full = (over: Partial<HandoverInput> = {}): HandoverInput => ({
  projectId: "p1",
  contractValueMinor: 10_000_000,
  items: [
    item({ id: "a", area: "commercial" }),
    item({ id: "b", area: "programme" }),
    item({ id: "c", area: "technical" }),
    item({ id: "d", area: "risk" }),
    item({ id: "e", area: "procurement" }),
    item({ id: "f", area: "client" }),
  ],
  qualifications: [],
  keenRates: [],
  risksPriced: [{ id: "r1", title: "Ground conditions", allowanceMinor: 120_000 }],
  ...over,
});

describe("a complete pack", () => {
  it("is ready to hand over", () => {
    const p = pack(full());
    expect(p.ready).toBe(true);
    expect(p.completenessPct).toBe(100);
    expect(p.materialGaps).toEqual([]);
  });

  it("reports coverage per area", () => {
    const p = pack(full());
    expect(p.coverage.every((c) => c.complete)).toBe(true);
    expect(p.emptyAreas).toEqual([]);
  });
});

describe("gaps stay visible", () => {
  it("names an item recorded as material with no detail", () => {
    const p = pack(full({
      items: [...full().items.slice(1), item({ id: "a", area: "commercial", detail: "" })],
    }));
    expect(p.materialGaps.map((g) => g.id)).toEqual(["a"]);
    expect(p.ready).toBe(false);
  });

  it("weighs a material gap more heavily than an untidy one", () => {
    const base = full().items.slice(1);
    const material = pack(full({ items: [...base, item({ id: "x", detail: "", material: true })] }));
    const minor = pack(full({ items: [...base, item({ id: "x", detail: "", material: false })] }));
    expect(material.completenessPct).toBeLessThan(minor.completenessPct);
  });

  it("does not call an empty section complete just because it has no failures", () => {
    // An area nobody filled in is absence, not perfection.
    const p = pack(full({ items: full().items.filter((i) => i.area !== "risk") }));
    expect(p.emptyAreas).toEqual(["risk"]);
    expect(p.completenessPct).toBeLessThan(100);
    expect(p.ready).toBe(false);
  });

  it("says an empty section rarely means there was nothing to say", () => {
    const p = pack(full({ items: full().items.filter((i) => i.area !== "procurement") }));
    expect(p.warnings.some((w) => /almost never what it means/.test(w))).toBe(true);
  });
});

describe("qualifications the client never accepted", () => {
  it("distinguishes rejected from unanswered, because they fail differently", () => {
    const p = pack(full({
      qualifications: [
        { id: "q1", text: "Excludes asbestos removal", clientAccepted: false, exposureMinor: 80_000 },
        { id: "q2", text: "Assumes free site access from week 3", clientAccepted: null, exposureMinor: 40_000 },
        { id: "q3", text: "Excludes statutory fees", clientAccepted: true },
      ],
    }));
    expect(p.unacceptedQualifications.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(p.unacceptedQualifications[0].verdict).toMatch(/work somebody has to do and nobody has paid for/);
    expect(p.unacceptedQualifications[1].verdict).toMatch(/Unanswered is not accepted/);
  });

  it("totals the exposure being carried", () => {
    const p = pack(full({
      qualifications: [
        { id: "q1", text: "A", clientAccepted: false, exposureMinor: 80_000 },
        { id: "q2", text: "B", clientAccepted: null, exposureMinor: 40_000 },
      ],
    }));
    expect(p.qualificationExposureMinor).toBe(120_000);
  });

  it("warns that a site team without this does the work anyway", () => {
    const p = pack(full({
      qualifications: [{ id: "q1", text: "A", clientAccepted: false }],
    }));
    expect(p.warnings.some((w) => /performs the work anyway/.test(w))).toBe(true);
  });
});

describe("rates the site team must not treat as comfortable", () => {
  const keen = full({
    keenRates: [
      { code: "2.3.1", description: "Blockwork", rateMinor: 3000, sharpenedByPct: 0.18 },
      { code: "3.1.0", description: "Roofing", rateMinor: 8000, sharpenedByPct: 0.06 },
    ],
  });

  it("puts the sharpest first", () => {
    expect(pack(keen).keenRates.map((r) => r.code)).toEqual(["2.3.1", "3.1.0"]);
  });

  it("says plainly when a rate has no recovery left in it", () => {
    expect(pack(keen).keenRates[0].warning).toMatch(/no recovery in this rate/);
  });

  it("warns that keen rates get spent first when nobody flags them", () => {
    expect(pack(keen).warnings.some((w) => /finds out at the second valuation/.test(w))).toBe(true);
  });
});

describe("risk", () => {
  it("carries deliberately excluded risks across as positions", () => {
    // A risk consciously excluded is a commercial position; a risk nobody
    // mentioned is a surprise. The difference is only whether it was recorded.
    const p = pack(full({
      risksExcluded: [{ id: "r9", title: "Contaminated ground", why: "Excluded — no site investigation was provided at tender." }],
    }));
    expect(p.excludedRisks).toHaveLength(1);
  });

  it("says so when no risk position was recorded at all", () => {
    const p = pack(full({ risksPriced: [], risksExcluded: [] }));
    expect(p.warnings.some((w) => /now a surprise rather than a decision/.test(w))).toBe(true);
  });
});

describe("the summary", () => {
  it("leads with not-ready and what is missing", () => {
    const p = pack(full({ items: full().items.filter((i) => i.area !== "risk") }));
    expect(p.summary).toMatch(/^Not ready to hand over/);
    expect(p.summary).toMatch(/1 section\(s\) empty/);
  });

  it("still names what a ready pack is carrying", () => {
    const p = pack(full({
      qualifications: [{ id: "q1", text: "A", clientAccepted: null }],
      keenRates: [{ code: "1", description: "X", rateMinor: 100, sharpenedByPct: 0.2 }],
    }));
    expect(p.ready).toBe(true);
    expect(p.summary).toMatch(/carrying 1 unaccepted qualification\(s\) and 1 sharpened rate\(s\)/);
  });
});

describe("questions for the bid team", () => {
  it("asks about each material gap specifically, not from a standing agenda", () => {
    const p = pack(full({
      items: [...full().items.slice(1), item({ id: "a", title: "Crane strategy", detail: "", owner: "Site manager" })],
    }));
    const qs = questionsForBidTeam(p);
    expect(qs[0].question).toMatch(/Crane strategy — what did the bid assume here\?/);
    expect(qs[0].why).toMatch(/Site manager needs it/);
  });

  it("asks what a rejected qualification costs if it does not hold", () => {
    const p = pack(full({ qualifications: [{ id: "q1", text: "Excludes asbestos", clientAccepted: false }] }));
    const qs = questionsForBidTeam(p);
    expect(qs.some((q) => /what was priced on the assumption it held/.test(q.question))).toBe(true);
  });

  it("asks whether an empty section was empty or just unwritten", () => {
    // The two look identical afterwards and only one of them is safe.
    const p = pack(full({ items: full().items.filter((i) => i.area !== "client") }));
    const qs = questionsForBidTeam(p);
    expect(qs.some((q) => /genuinely nothing, or did it not get written down/.test(q.question))).toBe(true);
  });

  it("asks what has to go right for the sharpest rate to hold", () => {
    const p = pack(full({ keenRates: [{ code: "2.3.1", description: "Blockwork", rateMinor: 3000, sharpenedByPct: 0.18 }] }));
    const qs = questionsForBidTeam(p);
    expect(qs.some((q) => /what has to go right for it to hold/.test(q.question))).toBe(true);
  });

  it("asks nothing of a complete pack with nothing carried", () => {
    expect(questionsForBidTeam(pack(full()))).toEqual([]);
  });
});

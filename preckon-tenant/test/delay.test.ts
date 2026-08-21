// Delay analysis.
//
// The tests that matter are the ones where a plausible implementation gets it
// wrong IN THE CONTRACTOR'S FAVOUR, because that is the direction the mistakes
// run and the direction nobody catches until adjudication:
//
//   Concurrency must defeat the money claim while preserving the time claim.
//   Float must be consumed by whoever needs it first, not saved for the party
//   the analysis was run for.
//   Overlapping delays must not be added together.

import { describe, it, expect } from "vitest";
import { analyse, type DelayEvent } from "@/lib/programme/delay";

const ev = (
  id: string, owner: DelayEvent["owner"], startDay: number, days: number,
  activityKey = "a", activityFloat = 0, evidence: string[] = ["doc-1"],
): DelayEvent => ({ id, title: id, owner, startDay, days, activityKey, activityFloat, evidence });

describe("float absorbs delay before it reaches completion", () => {
  it("reports a fully absorbed delay as no effect on completion", () => {
    const r = analyse([ev("E1", "employer", 0, 3, "a", 5)]);
    expect(r.impacts[0].absorbedByFloat).toBe(3);
    expect(r.impacts[0].criticalDays).toBe(0);
    expect(r.eotDays).toBe(0);
    expect(r.summary).toMatch(/No delay to completion/);
    // Worth saying, not just worth computing: the buffer is gone, and the next
    // event on that activity lands straight on the completion date.
    expect(r.summary).toMatch(/float is now spent/);
  });

  it("splits a partly absorbed delay", () => {
    const r = analyse([ev("E1", "employer", 0, 8, "a", 5)]);
    expect(r.impacts[0].absorbedByFloat).toBe(5);
    expect(r.impacts[0].criticalDays).toBe(3);
    expect(r.eotDays).toBe(3);
  });

  it("lets an early contractor delay eat the float a later employer delay needed", () => {
    /* The effect that decides real claims. Float belongs to the project, not to
       a party: the contractor's own earlier delay consumes it, and the employer
       event that would have been absorbed becomes critical. An analysis that
       reserved float for the employer event would understate the contractor's
       entitlement and look generous while being wrong. */
    const r = analyse([
      ev("C1", "contractor", 0, 5, "a", 5),
      ev("E1", "employer", 6, 4, "a", 5),
    ]);
    expect(r.impacts.find((i) => i.id === "C1")!.absorbedByFloat).toBe(5);
    expect(r.impacts.find((i) => i.id === "E1")!.absorbedByFloat).toBe(0);
    expect(r.impacts.find((i) => i.id === "E1")!.criticalDays).toBe(4);
  });
});

describe("who carries what", () => {
  it("gives an employer event time and money", () => {
    const r = analyse([ev("E1", "employer", 0, 6)]);
    expect(r.eotDays).toBe(6);
    expect(r.compensableDays).toBe(6);
    expect(r.contractorDays).toBe(0);
  });

  it("gives a neutral event time but not money", () => {
    // Weather relieves damages; it does not pay for the delay. Treating a
    // neutral event as compensable is the single most common overstatement in
    // a contractor's claim.
    const r = analyse([ev("N1", "neutral", 0, 6)]);
    expect(r.eotDays).toBe(6);
    expect(r.compensableDays).toBe(0);
    expect(r.impacts[0].why).toMatch(/relieves damages, it does not compensate/);
  });

  it("gives a contractor event neither, and flags the damages exposure", () => {
    const r = analyse([ev("C1", "contractor", 0, 6)]);
    expect(r.eotDays).toBe(0);
    expect(r.contractorDays).toBe(6);
    expect(r.impacts[0].why).toMatch(/liquidated damages/);
  });
});

describe("concurrency under Malmaison", () => {
  const concurrent = () => analyse([
    ev("E1", "employer", 0, 10),
    ev("C1", "contractor", 0, 10, "b"),
  ]);

  it("grants the time", () => {
    expect(concurrent().eotDays).toBe(10);
  });

  it("refuses the money", () => {
    // Time but not money is the whole of Malmaison, and the line most often
    // got wrong in the contractor's favour.
    const r = concurrent();
    expect(r.compensableDays).toBe(0);
    expect(r.impacts.find((i) => i.id === "E1")!.compensable).toBe(false);
  });

  it("marks the period contested rather than settled", () => {
    const r = concurrent();
    expect(r.impacts.find((i) => i.id === "E1")!.contested).toBe(true);
    expect(r.concurrent).toHaveLength(1);
    expect(r.concurrent[0].compensable).toBe(false);
  });

  it("leaves nothing at the contractor's risk when the whole period is concurrent", () => {
    expect(concurrent().contractorDays).toBe(0);
  });

  it("separates the compensable part from the concurrent part", () => {
    // Employer delay days 0–9, contractor delay days 5–9. The first five days
    // are the employer's alone and carry money; the last five do not.
    const r = analyse([
      ev("E1", "employer", 0, 10),
      ev("C1", "contractor", 5, 5, "b"),
    ]);
    expect(r.concurrent[0].fromDay).toBe(5);
    expect(r.concurrent[0].days).toBe(5);
    const e1 = r.impacts.find((i) => i.id === "E1")!;
    expect(e1.eotDays).toBe(10);
    // Concurrency on any part of the event defeats compensability for it, which
    // is conservative and is the point.
    expect(e1.compensable).toBe(false);
    expect(e1.why).toMatch(/5 day\(s\) concurrent/);
  });
});

describe("other concurrency rules", () => {
  const both = [
    ev("E1", "employer", 0, 10),
    ev("C1", "contractor", 0, 10, "b"),
  ];

  it("splits the period under apportionment", () => {
    const r = analyse(both, { rule: "apportion" });
    expect(r.eotDays).toBe(5);
    expect(r.concurrent[0].contractorDays).toBe(5);
  });

  it("warns that apportionment departs from the prevailing approach", () => {
    const r = analyse(both, { rule: "apportion" });
    expect(r.warnings.some((w) => /different answer from the prevailing Malmaison/.test(w))).toBe(true);
  });

  it("refuses to pick a winner when no cause dominates", () => {
    // One employer event against one contractor event is not a dominant cause.
    // Splitting it and SAYING it is contested beats inventing a decision.
    const r = analyse(both, { rule: "dominant" });
    expect(r.concurrent[0].why).toMatch(/genuinely contested/);
  });

  it("does not warn when the default rule is used", () => {
    expect(analyse(both).warnings.some((w) => /different answer/.test(w))).toBe(false);
  });
});

describe("overlapping delay is not additive", () => {
  it("does not double-count two employer events over the same days", () => {
    // Ten days of overlapping delay is ten days late, not twenty. Summing event
    // durations is the error that produces claims nobody believes.
    const r = analyse([
      ev("E1", "employer", 0, 10),
      ev("E2", "employer", 0, 10, "b"),
    ]);
    expect(r.contractorDays).toBe(0);
    expect(r.concurrent).toEqual([]);
  });

  it("merges consecutive concurrent days into one arguable period", () => {
    const r = analyse([
      ev("E1", "employer", 0, 8),
      ev("C1", "contractor", 0, 8, "b"),
    ]);
    expect(r.concurrent).toHaveLength(1);
    expect(r.concurrent[0]).toMatchObject({ fromDay: 0, toDay: 7, days: 8 });
  });
});

describe("evidence", () => {
  it("flags a critical claim with nothing behind it", () => {
    const r = analyse([{ ...ev("E1", "employer", 0, 5), evidence: [] }]);
    expect(r.warnings.some((w) => /no evidence referenced/.test(w))).toBe(true);
  });

  it("does not demand evidence for delay that never reached completion", () => {
    const r = analyse([{ ...ev("E1", "employer", 0, 2, "a", 10), evidence: [] }]);
    expect(r.warnings.some((w) => /no evidence referenced/.test(w))).toBe(false);
  });
});

describe("the analysis states its own basis", () => {
  it("reports which rule produced the answer", () => {
    expect(analyse([ev("E1", "employer", 0, 3)]).rule).toBe("malmaison");
    expect(analyse([ev("E1", "employer", 0, 3)], { rule: "apportion" }).rule).toBe("apportion");
  });

  it("says plainly when none of the extension is compensable", () => {
    expect(analyse([ev("N1", "neutral", 0, 4)]).summary).toMatch(/none of it compensable/);
  });

  it("handles an empty analysis without inventing a conclusion", () => {
    const r = analyse([]);
    expect(r.eotDays).toBe(0);
    expect(r.concurrent).toEqual([]);
    expect(r.summary).toBe("No delay to completion.");
  });
});

// Where the quantities disagree, and by how much.
//
// The same item arrives three ways — measured off a drawing, taken off a model,
// typed in by an estimator. They will not agree. The tempting design is a
// precedence rule that takes the top one and moves on, which produces a bill
// that is internally consistent and hides its own disagreements. That is worse
// than one that argues with itself in front of you: a 12% gap is a modelling
// error, an unapplied revision, or a scope difference, and all three deserve a
// minute before the number goes into a tender.
//
// So these pin the same rule from both sides: precedence decides what is USED,
// and the disagreement is reported either way.

import { describe, it, expect } from "vitest";
import { gap, reconcileAll, reconcileItem, type QuantityClaim } from "@/lib/boq/reconcile";

const modelled = (q: number, unit = "m3"): QuantityClaim => ({ source: "modelled", quantity: q, unit });
const measured = (q: number, unit = "m3"): QuantityClaim => ({ source: "measured", quantity: q, unit });
const manual = (q: number, unit = "m3", reason = "site instruction"): QuantityClaim =>
  ({ source: "manual", quantity: q, unit, reason });

describe("the gap between two figures", () => {
  it("is measured against the larger, so order does not change it", () => {
    // Otherwise the same pair reports two different percentages depending on
    // which column happened to be read first.
    expect(gap(100, 101)).toBeCloseTo(gap(101, 100), 10);
  });

  it("is zero for identical figures, including two zeros", () => {
    expect(gap(5, 5)).toBe(0);
    expect(gap(0, 0)).toBe(0);
  });

  it("reports a full gap against zero", () => {
    expect(gap(0, 10)).toBe(1);
  });
});

describe("sources that agree", () => {
  it("reports agreement and uses the highest-precedence figure", () => {
    const r = reconcileItem("Concrete", [modelled(100), measured(101)]);
    expect(r.verdict).toBe("agreed");
    expect(r.source).toBe("measured");
    expect(r.quantity).toBe(101);
  });

  it("tolerates a trivial absolute difference on a small quantity", () => {
    /* A proportional test alone makes small quantities impossible to agree on:
       0.01 against 0.02 is 50% and means nothing. */
    const r = reconcileItem("Grout", [modelled(0.01), measured(0.02)]);
    expect(r.verdict).toBe("agreed");
  });

  it("still records what it did not use", () => {
    const r = reconcileItem("Concrete", [modelled(100), measured(101)]);
    expect(r.overrode).toEqual([{ source: "modelled", quantity: 100, differenceBy: 1 }]);
  });
});

describe("sources that disagree", () => {
  it("reports the dispute rather than quietly taking the winner", () => {
    /* The failure this exists to stop: a bill that reads cleanly while the model
       and the drawing are 12% apart. */
    const r = reconcileItem("Blockwork", [modelled(100), measured(112)]);
    expect(r.verdict).toBe("disputed");
    expect(r.spread).toBeCloseTo(0.1071, 3);
  });

  it("still yields a usable figure, because a bill has to have a number", () => {
    const r = reconcileItem("Blockwork", [modelled(100), measured(112)]);
    expect(r.quantity).toBe(112);
    expect(r.source).toBe("measured");
  });

  it("says how far apart, in the sentence a reviewer reads", () => {
    const r = reconcileItem("Blockwork", [modelled(100), measured(112)]);
    expect(r.why).toMatch(/10\.7%/);
    expect(r.why).toMatch(/worth checking/i);
  });

  it("takes the widest gap when three sources disagree", () => {
    // Not the adjacent pairs: the reviewer needs the worst case.
    const r = reconcileItem("Rebar", [modelled(100), measured(110), manual(140)]);
    expect(r.spread).toBeCloseTo(gap(100, 140), 6);
  });
});

describe("an estimator override", () => {
  it("wins, because they know things the drawings do not", () => {
    const r = reconcileItem("Excavation", [modelled(500), measured(520), manual(600)]);
    expect(r.source).toBe("manual");
    expect(r.quantity).toBe(600);
  });

  it("records everything it superseded, with the difference", () => {
    /* An override that leaves no trace is indistinguishable from a measurement,
       and six weeks later nobody can say why the bill says 600. */
    const r = reconcileItem("Excavation", [modelled(500), measured(520), manual(600)]);
    expect(r.overrode).toEqual([
      { source: "modelled", quantity: 500, differenceBy: 100 },
      { source: "measured", quantity: 520, differenceBy: 80 },
    ]);
  });

  it("does not suppress the dispute by existing", () => {
    // An override is a decision, not an answer to whether the sources agreed.
    const r = reconcileItem("Excavation", [modelled(500), measured(520), manual(600)]);
    expect(r.verdict).toBe("disputed");
  });

  it("lets a later override supersede an earlier one", () => {
    const r = reconcileItem("Excavation", [manual(600), manual(650)]);
    expect(r.quantity).toBe(650);
  });
});

describe("a single source", () => {
  it("is unconfirmed rather than agreed", () => {
    /* One source agreeing with itself is not agreement, and calling it that
       would put a tick beside a number nothing has checked. */
    const r = reconcileItem("Screed", [measured(80)]);
    expect(r.verdict).toBe("unconfirmed");
    expect(r.quantity).toBe(80);
  });

  it("says what is missing", () => {
    expect(reconcileItem("Screed", [measured(80)]).why).toMatch(/nothing cross-checks it/i);
  });

  it("handles no claims at all without throwing", () => {
    const r = reconcileItem("Ghost", []);
    expect(r.verdict).toBe("unconfirmed");
    expect(r.quantity).toBe(0);
  });
});

describe("units that do not match", () => {
  it("refuses to express a category error as a percentage", () => {
    /* m² against m³ is not a 30% variance — the two are answering different
       questions, and a percentage invites somebody to split the difference. */
    const r = reconcileItem("Blinding", [modelled(120, "m2"), measured(18, "m3")]);
    expect(r.verdict).toBe("incomparable");
    expect(r.spread).toBeNull();
  });

  it("says which units are in conflict", () => {
    const r = reconcileItem("Blinding", [modelled(120, "m2"), measured(18, "m3")]);
    expect(r.why).toMatch(/m2/);
    expect(r.why).toMatch(/m3/);
    expect(r.why).toMatch(/Resolve the unit first/i);
  });

  it("ignores case and padding, which are not real disagreements", () => {
    const r = reconcileItem("Concrete", [modelled(100, "M3"), measured(101, " m3 ")]);
    expect(r.verdict).toBe("agreed");
  });
});

describe("a whole bill", () => {
  const bill = () =>
    reconcileAll({
      Concrete: [modelled(100), measured(101)],
      Blockwork: [modelled(100), measured(112)],
      Screed: [measured(80)],
      Blinding: [modelled(120, "m2"), measured(18, "m3")],
      Rebar: [modelled(10), measured(30)],
    });

  it("counts each verdict", () => {
    const r = bill();
    expect(r.agreed).toBe(1);
    expect(r.disputed).toBe(2);
    expect(r.unconfirmed).toBe(1);
    expect(r.incomparable).toBe(1);
  });

  it("puts the unit conflict above the percentages", () => {
    /* A unit disagreement is a harder error than a percentage one and cannot be
       ranked among them at all, so it goes first regardless of spread. */
    expect(bill().needsAttention[0].item).toBe("Blinding");
  });

  it("then ranks the disputes worst-first", () => {
    const attention = bill().needsAttention;
    expect(attention[1].item).toBe("Rebar");      // 67%
    expect(attention[2].item).toBe("Blockwork");  // 11%
  });

  it("leaves agreed and unconfirmed lines out of the attention list", () => {
    const items = bill().needsAttention.map((l) => l.item);
    expect(items).not.toContain("Concrete");
    expect(items).not.toContain("Screed");
  });

  it("summarises for the top of the screen", () => {
    expect(bill().summary).toMatch(/2 disputed/);
    expect(bill().summary).toMatch(/1 incomparable/);
  });

  it("says so plainly when there is nothing to reconcile", () => {
    expect(reconcileAll({}).summary).toBe("nothing to reconcile");
  });
});

describe("tolerance is configurable", () => {
  it("can be tightened where a trade demands it", () => {
    const claims = [modelled(100), measured(101)];
    expect(reconcileItem("Concrete", claims).verdict).toBe("agreed");
    expect(reconcileItem("Concrete", claims, { tolerance: 0.005 }).verdict).toBe("disputed");
  });
});

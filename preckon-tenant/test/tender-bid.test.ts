// Requirements, compliance, addenda, risk positions, readiness and outcomes.
//
// These are the places a bid is lost for reasons that have nothing to do with
// the price: an unacknowledged addendum, a compliance claim with nothing to
// point at, a qualification that never reached the submitted document, a
// readiness figure that averaged a missing bond away.

import { describe, it, expect } from "vitest";
import {
  complianceMatrix, validateRequirement, outstanding,
  type Requirement, type Response,
} from "@/lib/tender/requirements";
import { assess as assessAddendum, acknowledge, position as addendaPosition, type Addendum } from "@/lib/tender/addenda";
import { assess as assessRisk, register, statement, band, type Risk, type CommercialPosition } from "@/lib/tender/positions";
import { readiness, manifest, type ItemRule } from "@/lib/tender/readiness";
import { record, analyse, gapPercent, type BidOutcome } from "@/lib/tender/outcome";
import type { SubmissionPack } from "@/lib/submission";

const req = (over: Partial<Requirement> = {}): Requirement => ({
  id: "r1", ref: "4.2.1", statement: "Provide a performance bond of 10%",
  obligation: "mandatory",
  citation: { document: "ITT", clause: "4.2.1", page: 22, quote: "The Contractor shall provide a performance bond..." },
  ...over,
});

describe("requirements must be checkable", () => {
  it("rejects one with no clause or no quote", () => {
    expect(validateRequirement(req({ citation: { document: "ITT", clause: "", quote: "x" } }))).toHaveLength(1);
    const noQuote = validateRequirement(req({ citation: { document: "ITT", clause: "4.2", quote: "" } }));
    expect(noQuote[0]).toMatch(/paraphrased requirement drifts/);
  });
});

describe("compliance matrix", () => {
  it("treats an unanswered mandatory requirement as disqualifying", () => {
    const m = complianceMatrix([req()], []);
    expect(m.submittable).toBe(false);
    expect(m.disqualifying[0].message).toMatch(/no response at all/);
  });

  it("flags a compliance claim the evaluator cannot verify", () => {
    const responses: Response[] = [{ requirementId: "r1", state: "comply" }];
    const m = complianceMatrix([req()], responses);
    expect(m.issues[0].message).toMatch(/no evidence reference/);
  });

  it("flags a deviation that does not say what is offered instead", () => {
    const m = complianceMatrix([req()], [{ requirementId: "r1", state: "deviate", evidenceRef: "S3.1" }]);
    expect(m.issues[0].message).toMatch(/reads as a refusal/);
  });

  it("passes a properly evidenced compliance", () => {
    const m = complianceMatrix([req()], [{ requirementId: "r1", state: "comply", evidenceRef: "Vol 2 p.14" }]);
    expect(m.submittable).toBe(true);
    expect(m.complianceRate).toBe(1);
  });

  it("ignores a requirement an addendum withdrew", () => {
    const m = complianceMatrix([req({ supersededBy: "ADD-2" })], []);
    expect(m.total).toBe(0);
    expect(m.submittable).toBe(true);
  });

  it("orders the matrix by the client's own reference, numerically", () => {
    const rs = [req({ id: "a", ref: "4.10" }), req({ id: "b", ref: "4.2" })];
    const m = complianceMatrix(rs, []);
    expect(m.rows.map((r) => r.ref)).toEqual(["4.2", "4.10"]);
  });

  it("puts mandatory unanswered requirements at the top of the working list", () => {
    const rs = [req({ id: "a", obligation: "desirable" }), req({ id: "b", obligation: "mandatory" })];
    expect(outstanding(rs, []).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

/* ── addenda ──────────────────────────────────────────────────────────────── */

const add = (over: Partial<Addendum> = {}): Addendum => ({
  id: "a1", number: 2, issuedAt: "2026-06-01", receivedAt: "2026-06-01",
  acknowledgementRequired: true,
  items: [
    { id: "i1", ref: "2.1", kind: "quantity_change", description: "Blockwork quantities revised", affects: ["A10"] },
    { id: "i2", ref: "2.2", kind: "deadline_change", description: "Deadline extended", affects: [], newDeadline: "2026-07-15" },
  ],
  ...over,
});

describe("addenda", () => {
  it("calls out an unacknowledged addendum as bid-losing on its own", () => {
    const a = assessAddendum(add(), "2026-06-10");
    expect(a.acknowledgementOverdue).toBe(true);
    expect(a.summary).toMatch(/grounds for rejecting the bid/);
  });

  it("clears once acknowledged, and records who", () => {
    const r = acknowledge(add(), "2026-06-02", "Bid Manager");
    expect(r.ok).toBe(true);
    if (r.ok) expect(assessAddendum(r.value, "2026-06-10").acknowledgementOverdue).toBe(false);
  });

  it("refuses an unattributed acknowledgement", () => {
    expect(acknowledge(add(), "2026-06-02", " ").ok).toBe(false);
  });

  it("marks a quantity change as requiring repricing, worst impact first", () => {
    const a = assessAddendum(add(), "2026-06-10");
    expect(a.requiresRepricing).toBe(true);
    expect(a.impacted[0].impact).toBe("critical");
    expect(a.impacted[0].action).toMatch(/Remeasure and reprice/);
    expect(a.deadlineMoved).toBe("2026-07-15");
  });

  it("still lists an item that maps to nothing, rather than dropping it", () => {
    const a = assessAddendum(add({ items: [{ id: "x", ref: "2.9", kind: "requirement_new", description: "New", affects: [] }] }), "2026-06-02");
    expect(a.impacted[0].ref).toBe("(unmapped)");
  });

  it("reads all addenda together, since a later one changes an earlier one", () => {
    const p = addendaPosition([add({ number: 1, acknowledgedAt: "2026-06-02" }), add({ number: 2 })], "2026-06-10");
    expect(p.unacknowledged).toEqual([2]);
    expect(p.clearToSubmit).toBe(false);
    expect(p.latestDeadline).toBe("2026-07-15");
  });
});

/* ── risk and positions ───────────────────────────────────────────────────── */

const risk = (over: Partial<Risk> = {}): Risk => ({
  id: "k1", ref: "R-01", title: "Ground conditions", likelihood: 4, impact: 5,
  treatment: "untreated", ...over,
});

describe("risk and commercial positions", () => {
  it("scores and bands", () => {
    expect(band(risk())).toBe("extreme");
    expect(band(risk({ likelihood: 1, impact: 2 }))).toBe("low");
  });

  it("reports a risk that is neither priced nor qualified", () => {
    const a = assessRisk([risk()], []);
    expect(a.issues[0].message).toMatch(/neither priced nor qualified/);
    expect(a.uncovered).toHaveLength(1);
  });

  it("catches a risk both priced and excluded", () => {
    // Charging for something we have told the client we do not carry.
    const pos: CommercialPosition = { id: "p1", ref: "E-01", kind: "exclusion", statement: "Rock excavation excluded", inSubmission: true };
    const a = assessRisk([risk({ treatment: "priced", allowanceMinor: 50_000, positionId: "p1" })], [pos]);
    expect(a.doubleCounted).toHaveLength(1);
    expect(a.issues[0].message).toMatch(/priced AND excluded/);
  });

  it("catches a qualification that never reached the submission", () => {
    const pos: CommercialPosition = { id: "p1", ref: "Q-01", kind: "qualification", statement: "Access assumed", inSubmission: false };
    const a = assessRisk([risk({ treatment: "qualified", positionId: "p1" })], [pos]);
    expect(a.issues.some((i) => /contract will not know about it/.test(i.message))).toBe(true);
  });

  it("groups the statement with exclusions first", () => {
    const positions: CommercialPosition[] = [
      { id: "1", ref: "A-01", kind: "assumption", statement: "Free access", inSubmission: true },
      { id: "2", ref: "E-01", kind: "exclusion", statement: "No asbestos removal", inSubmission: true },
    ];
    expect(statement(positions)[0].kind).toBe("exclusion");
  });

  it("orders the register worst first", () => {
    const rs = [risk({ id: "a", likelihood: 1, impact: 1 }), risk({ id: "b", likelihood: 5, impact: 5 })];
    expect(register(rs)[0].id).toBe("b");
  });
});

/* ── readiness and manifest ───────────────────────────────────────────────── */

const pack = (over: Partial<SubmissionPack> = {}): SubmissionPack => ({
  items: [
    { id: "bond", label: "Bid bond", group: "commercial", state: "pending" },
    { id: "form", label: "Form of tender", group: "commercial", state: "ready" },
    { id: "chart", label: "Organisation chart", group: "company", state: "ready" },
    { id: "cvs", label: "Key staff CVs", group: "company", state: "ready" },
  ],
  method: "portal",
  ...over,
});

const rules: ItemRule[] = [
  { id: "bond", consequence: "disqualifying", order: 1, format: "sealed separately" },
  { id: "form", consequence: "disqualifying", order: 2 },
  { id: "chart", consequence: "supporting", order: 3 },
  { id: "cvs", consequence: "scored", order: 4 },
];

describe("readiness", () => {
  it("does not let three easy items average away a missing bond", () => {
    const r = readiness(pack(), rules);
    expect(r.simplePercent).toBe(75);        // the naive figure
    expect(r.score).toBeLessThan(r.simplePercent);
    expect(r.submittable).toBe(false);
    expect(r.blockers[0].reason).toMatch(/rejected unopened/);
  });

  it("becomes submittable once the disqualifying item is in", () => {
    const p = pack();
    p.items[0].state = "ready";
    const r = readiness(p, rules, { now: "2026-06-01T09:00:00Z", deadline: "2026-06-10T12:00:00Z" });
    expect(r.submittable).toBe(true);
    expect(r.hoursRemaining).toBeGreaterThan(0);
  });

  it("is not submittable after the deadline, however complete", () => {
    const p = pack();
    p.items.forEach((i) => { i.state = "ready"; });
    const r = readiness(p, rules, { now: "2026-06-11T09:00:00Z", deadline: "2026-06-10T12:00:00Z" });
    expect(r.score).toBe(100);
    expect(r.submittable).toBe(false);
    expect(r.summary).toMatch(/deadline has passed/);
  });

  it("lists missing items in the manifest rather than omitting them", () => {
    const m = manifest(pack(), rules);
    expect(m.complete).toBe(false);
    expect(m.render).toMatch(/NOT INCLUDED/);
    expect(m.render).toMatch(/sealed separately/);
    expect(m.entries[0].id).toBe("bond");    // client's order, not ours
  });
});

/* ── outcomes ─────────────────────────────────────────────────────────────── */

const bid = (over: Partial<BidOutcome> = {}): BidOutcome => ({
  id: "b1", projectId: "p1", client: "Cedarstone", ourPriceMinor: 10_000_000,
  outcome: "pending", ...over,
});

describe("win/loss", () => {
  it("refuses to record a loss with no reason", () => {
    const r = record(bid(), "lost", "2026-07-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/only time anybody still knows why/);
  });

  it("computes the gap against the winner", () => {
    const b = { ...bid(), winningPriceMinor: 9_500_000 };
    expect(gapPercent(b)).toBeCloseTo(5.26, 1);
    expect(gapPercent(bid())).toBeNull();     // undisclosed stays unknown
  });

  it("separates a pricing problem from a strategy problem", () => {
    const narrow = [
      { ...bid({ id: "1" }), outcome: "lost" as const, reason: "price" as const, winningPriceMinor: 9_800_000 },
      { ...bid({ id: "2" }), outcome: "lost" as const, reason: "price" as const, winningPriceMinor: 9_900_000 },
    ];
    const a = analyse(narrow);
    expect(a.narrowLosses).toBe(2);
    expect(a.insights[0]).toMatch(/pricing problem, not a positioning one/);

    const wide = [{ ...bid({ id: "3" }), outcome: "lost" as const, reason: "price" as const, winningPriceMinor: 7_000_000 }];
    expect(analyse(wide).insights[0]).toMatch(/different cost base/);
  });

  it("calls out work lost to formalities rather than to price", () => {
    const bids = [{ ...bid({ id: "1" }), outcome: "lost" as const, reason: "compliance" as const }];
    expect(analyse(bids).insights.join(" ")).toMatch(/lost to formalities/);
  });

  it("says when the analysis is built on a partial picture", () => {
    const bids = [
      { ...bid({ id: "1" }), outcome: "lost" as const, reason: "unknown" as const },
      { ...bid({ id: "2" }), outcome: "lost" as const, reason: "unknown" as const },
      { ...bid({ id: "3" }), outcome: "lost" as const, reason: "price" as const },
    ];
    expect(analyse(bids).insights.join(" ")).toMatch(/no recorded reason/);
  });

  it("reports hit rate by value as well as by count", () => {
    const bids = [
      { ...bid({ id: "1", ourPriceMinor: 1_000_000 }), outcome: "won" as const },
      { ...bid({ id: "2", ourPriceMinor: 9_000_000 }), outcome: "lost" as const, reason: "price" as const },
    ];
    const a = analyse(bids);
    expect(a.hitRate).toBe(0.5);
    expect(a.valueHitRate).toBeCloseTo(0.1, 5);
  });
});

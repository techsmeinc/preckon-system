// Scope gaps and clarifications.
//
// Both files exist to surface absences: work nobody priced, and answers nobody
// acted on. Absences are what tests are for — the happy path is visible on
// screen, and the missing row is not.

import { describe, it, expect } from "vitest";
import { analyseScope, breakdown, type Requirement, type ScopeItem } from "@/lib/tender/scope";
import {
  submit, answer, incorporate, closeUnanswered, assess,
  type Clarification, type Deadlines,
} from "@/lib/tender/clarifications";

const reqs: Requirement[] = [
  { id: "r1", source: "spec", reference: "A.12.3", text: "Waterproofing to all below-grade walls", mandatory: true },
  { id: "r2", source: "spec", reference: "A.14.1", text: "Fire stopping at all service penetrations", mandatory: true },
  { id: "r3", source: "drawing", reference: "SK-104", text: "External landscaping", mandatory: false },
];

describe("scope gaps", () => {
  it("finds the requirement nothing prices — the expensive absence", () => {
    const scope: ScopeItem[] = [
      { id: "s1", description: "Tanking", requirementIds: ["r1"], packageId: "p1", discipline: "waterproofing" },
    ];
    const r = analyseScope(reqs, scope);
    const gaps = r.findings.filter((f) => f.kind === "gap");
    expect(gaps.map((g) => g.requirementId).sort()).toEqual(["r2", "r3"]);
    // Mandatory gaps outrank optional ones.
    expect(gaps[0].severity).toBe("critical");
    expect(gaps[0].requirementId).toBe("r2");
    expect(r.coverage).toBeCloseTo(1 / 3, 5);
  });

  it("spots the same discipline priced in two packages", () => {
    const scope: ScopeItem[] = [
      { id: "s1", description: "Tanking (main)", requirementIds: ["r1"], packageId: "p1", discipline: "waterproofing", valueMinor: 400_000 },
      { id: "s2", description: "Tanking (basement sub)", requirementIds: ["r1"], packageId: "p2", discipline: "waterproofing", valueMinor: 350_000 },
    ];
    const r = analyseScope(reqs, scope);
    const overlap = r.findings.find((f) => f.kind === "overlap")!;
    expect(overlap.scopeItemIds.sort()).toEqual(["s1", "s2"]);
    expect(r.overlapValueMinor).toBe(750_000);
  });

  it("does not call two trades on one requirement an overlap", () => {
    const scope: ScopeItem[] = [
      { id: "s1", description: "Fire stopping - mechanical", requirementIds: ["r2"], packageId: "p1", discipline: "mechanical" },
      { id: "s2", description: "Fire stopping - electrical", requirementIds: ["r2"], packageId: "p2", discipline: "electrical" },
    ];
    const r = analyseScope(reqs, scope);
    expect(r.findings.some((f) => f.kind === "overlap")).toBe(false);
  });

  it("flags priced work that belongs to no package", () => {
    const scope: ScopeItem[] = [
      { id: "s1", description: "Temporary works", requirementIds: ["r1"], valueMinor: 90_000 },
    ];
    const r = analyseScope(reqs, scope);
    const orphan = r.findings.find((f) => f.kind === "unassigned")!;
    expect(orphan.message).toMatch(/nobody is nominated/);
    expect(r.unassignedValueMinor).toBe(90_000);
  });

  it("treats a requirement covered only by excluded scope as unmet, not covered", () => {
    const scope: ScopeItem[] = [
      { id: "s1", description: "Landscaping", requirementIds: ["r1"], packageId: "p1", delivery: "excluded" },
    ];
    const r = analyseScope(reqs, scope);
    expect(r.findings.some((f) => f.kind === "excluded_mandatory")).toBe(true);
    expect(r.covered).toBe(0);
  });

  it("rolls the same scope up three ways without them disagreeing", () => {
    const scope: ScopeItem[] = [
      { id: "s1", description: "A", requirementIds: [], packageId: "p1", discipline: "civil", valueMinor: 600_000, delivery: "subcontract" },
      { id: "s2", description: "B", requirementIds: [], packageId: "p2", discipline: "civil", valueMinor: 400_000, delivery: "self" },
    ];
    const total = (rows: { valueMinor: number }[]) => rows.reduce((s, r) => s + r.valueMinor, 0);
    expect(total(breakdown(scope, "packageId"))).toBe(1_000_000);
    expect(total(breakdown(scope, "discipline"))).toBe(1_000_000);
    expect(total(breakdown(scope, "delivery"))).toBe(1_000_000);
    expect(breakdown(scope, "discipline")[0].share).toBe(1);
  });
});

/* ── clarifications ───────────────────────────────────────────────────────── */

const deadlines: Deadlines = {
  questionsCloseAt: "2026-04-10T17:00:00.000Z",
  submissionAt: "2026-04-24T17:00:00.000Z",
};

const clar = (over: Partial<Clarification> = {}): Clarification => ({
  id: "c1", ref: "CL-001", question: "Is the basement tanked or drained?",
  raisedAt: "2026-04-01T09:00:00.000Z", status: "draft",
  impacts: ["price", "scope"], affects: ["r1"], ...over,
});

const ok = <T,>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe("clarifications", () => {
  it("refuses to send a question after the questions deadline, and says what to do instead", () => {
    const r = submit(clar(), "2026-04-12T09:00:00.000Z", deadlines);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/record the assumption/i);
  });

  it("keeps 'answered' and 'carried into the bid' as different states", () => {
    const sent = ok(submit(clar(), "2026-04-02T09:00:00.000Z", deadlines));
    const answered = ok(answer(sent, "2026-04-05T09:00:00.000Z", "Tanked."));
    expect(answered.status).toBe("answered");
    const done = ok(incorporate(answered, "2026-04-06T09:00:00.000Z", "u1"));
    expect(done.status).toBe("incorporated");
  });

  it("ranks an unread answer above an unanswered question", () => {
    const answered = ok(answer(ok(submit(clar(), "2026-04-02T09:00:00.000Z", deadlines)), "2026-04-05T09:00:00.000Z", "Tanked."));
    const never = { ...clar({ id: "c2", ref: "CL-002" }), status: "unanswered" as const, assumption: "assumed drained" };
    const r = assess([never, answered], "2026-04-20T09:00:00.000Z", deadlines);
    expect(r.risks[0].ref).toBe("CL-001");        // the answer nobody acted on
    expect(r.risks[0].level).toBe("critical");
    expect(r.clearToSubmit).toBe(false);
  });

  it("softens an unanswered question that has a stated assumption", () => {
    const withAssumption = { ...clar(), status: "unanswered" as const, assumption: "priced as drained cavity" };
    const without = { ...clar({ id: "c2", ref: "CL-002" }), status: "unanswered" as const };
    const r = assess([withAssumption, without], "2026-04-20T09:00:00.000Z", deadlines);
    expect(r.risks.find((x) => x.ref === "CL-001")!.level).toBe("medium");
    expect(r.risks.find((x) => x.ref === "CL-002")!.level).toBe("critical");
  });

  it("closes out questions the client never answered once the window shuts", () => {
    const sent = ok(submit(clar(), "2026-04-02T09:00:00.000Z", deadlines));
    const [closed] = closeUnanswered([sent], "2026-04-11T09:00:00.000Z", deadlines);
    expect(closed.status).toBe("unanswered");
  });

  it("clears the bid when everything outstanding is accounted for", () => {
    const done = ok(incorporate(
      ok(answer(ok(submit(clar(), "2026-04-02T09:00:00.000Z", deadlines)), "2026-04-05T09:00:00.000Z", "Tanked.")),
      "2026-04-06T09:00:00.000Z", "u1",
    ));
    const r = assess([done], "2026-04-20T09:00:00.000Z", deadlines);
    expect(r.clearToSubmit).toBe(true);
    expect(r.summary).toMatch(/no blocking/i);
  });
});

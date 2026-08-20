// Configurable review workflow.
//
// The rules that matter here are about not wasting people's time and not
// letting a document past a gate the project actually set: a rejection stops
// the chain, a stage nobody is assigned to is a permanent block, and a stage
// requiring more approvals than it has reviewers can never be satisfied.

import { describe, it, expect } from "vitest";
import {
  validateWorkflow, stageApplies, planStages, nextStages, totalDurationDays,
  DEFAULT_WORKFLOW, type DocumentWorkflow,
} from "@/lib/doc/workflow";

const wf = (over: Partial<DocumentWorkflow> = {}): DocumentWorkflow => ({
  key: "w", name: "Test", gatesIssue: true,
  stages: [
    { key: "internal", label: "Internal check", parties: ["Checker"], minApprovals: 1, durationDays: 2 },
    { key: "lead", label: "Discipline lead", parties: ["Lead"], minApprovals: 1, durationDays: 3 },
    { key: "client", label: "Client adviser", parties: ["Adviser"], minApprovals: 1, durationDays: 5,
      appliesTo: { confidentiality: ["internal", "public"] } },
  ],
  ...over,
});

describe("validation catches workflows that can never complete", () => {
  it("rejects a stage with nobody assigned", () => {
    const issues = validateWorkflow(wf({
      stages: [{ key: "x", label: "X", parties: [] }],
    }));
    expect(issues[0].message).toMatch(/every document would stop here forever/i);
  });

  it("rejects more approvals than there are reviewers", () => {
    const issues = validateWorkflow(wf({
      stages: [{ key: "x", label: "X", parties: ["A", "B"], minApprovals: 3 }],
    }));
    expect(issues[0].message).toMatch(/can never be satisfied/i);
  });

  it("rejects a first stage marked parallel with the previous one", () => {
    const issues = validateWorkflow(wf({
      stages: [{ key: "x", label: "X", parties: ["A"], parallelWithPrevious: true }],
    }));
    expect(issues.some((i) => /nothing to run in parallel/i.test(i.message))).toBe(true);
  });

  it("passes the default workflow", () => {
    expect(validateWorkflow(DEFAULT_WORKFLOW)).toEqual([]);
  });
});

describe("planning what a document has to pass", () => {
  it("skips a stage that does not apply to this document", () => {
    const plan = planStages(wf(), { confidentiality: "restricted" });
    expect(plan.map((s) => s.key)).toEqual(["internal", "lead"]);
  });

  it("includes it when it does apply, and totals the days", () => {
    const plan = planStages(wf(), { confidentiality: "internal" });
    expect(plan.map((s) => s.key)).toEqual(["internal", "lead", "client"]);
    expect(totalDurationDays(plan)).toBe(10);
  });

  it("counts parallel stages once, not twice, in the duration", () => {
    const parallel = wf({
      stages: [
        { key: "a", label: "A", parties: ["A"], durationDays: 3 },
        { key: "b", label: "B", parties: ["B"], durationDays: 5, parallelWithPrevious: true },
      ],
    });
    const plan = planStages(parallel, {});
    expect(plan.every((s) => s.order === 1)).toBe(true);
    expect(totalDurationDays(plan)).toBe(5);      // the longer of the two, not 8
  });

  it("defaults minApprovals to everyone on the stage", () => {
    const plan = planStages(wf({
      stages: [{ key: "a", label: "A", parties: ["X", "Y", "Z"] }],
    }), {});
    expect(plan[0].minApprovals).toBe(3);
  });
});

describe("what runs next", () => {
  const plan = planStages(wf(), { confidentiality: "internal" });

  it("opens the first stage when nothing has settled", () => {
    expect(nextStages(plan, []).map((s) => s.key)).toEqual(["internal"]);
  });

  it("moves on once the previous stage approves", () => {
    const next = nextStages(plan, [{ key: "internal", outcome: "approved" }]);
    expect(next.map((s) => s.key)).toEqual(["lead"]);
  });

  it("stops the chain on a rejection instead of asking the next reviewer", () => {
    // Sending a rejected drawing down the chain asks people to comment on
    // something that is about to be withdrawn.
    expect(nextStages(plan, [{ key: "internal", outcome: "rejected" }])).toEqual([]);
    expect(nextStages(plan, [{ key: "internal", outcome: "revise_and_resubmit" }])).toEqual([]);
  });

  it("returns nothing once every stage has settled", () => {
    const settled = plan.map((s) => ({ key: s.key, outcome: "approved" as const }));
    expect(nextStages(plan, settled)).toEqual([]);
  });

  it("opens both halves of a parallel pair at once", () => {
    const p = planStages(wf({
      stages: [
        { key: "a", label: "A", parties: ["A"] },
        { key: "b", label: "B", parties: ["B"], parallelWithPrevious: true },
      ],
    }), {});
    expect(nextStages(p, []).map((s) => s.key)).toEqual(["a", "b"]);
  });
});

describe("stageApplies", () => {
  it("treats an absent filter as always applicable", () => {
    expect(stageApplies({ key: "a", label: "A", parties: ["X"] }, {})).toBe(true);
  });

  it("matches on discipline as well as type", () => {
    const stage = { key: "a", label: "A", parties: ["X"], appliesTo: { disciplines: ["structural"] } };
    expect(stageApplies(stage, { discipline: "structural" })).toBe(true);
    expect(stageApplies(stage, { discipline: "architecture" })).toBe(false);
  });
});

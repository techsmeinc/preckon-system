// The dispatch gate.
//
// policy.ts, registry.ts and budget.ts were each already tested in isolation and
// each already correct — and none of them was imported by anything, so none of
// them constrained a single request. These tests are about the seam: that the
// decision is actually taken, that it is taken in the right ORDER, and that it
// fails in the safe direction when the tables it depends on are not there.

import { describe, it, expect } from "vitest";
import { decideDispatch, type DispatchInput } from "@/lib/ai/govern";
import { defaultPolicy, type TenantPolicy } from "@/lib/ai/policy";
import type { ModelEntry } from "@/lib/ai/registry";

const external: ModelEntry = {
  alias: "preckon-reasoning",
  provider: "anthropic",
  providerModel: "claude-sonnet-5",
  boundary: "external",
  capabilities: ["construction_reasoning"],
  contextLimit: 1_000_000,
  rateCard: { inputPerMillionMinor: 300, outputPerMillionMinor: 1500 },
  status: "approved",
};

const local: ModelEntry = { ...external, alias: "preckon-local", boundary: "local" };
const frontier: ModelEntry = { ...external, alias: "frontier-reasoning", boundary: "local", frontier: true };

const base = (over: Partial<DispatchInput> = {}): DispatchInput => ({
  alias: "preckon-reasoning",
  registry: [external, local, frontier],
  policy: defaultPolicy("saas"),
  policyVersion: 3,
  estimatedInputTokens: 1000,
  spend: { todayMinor: 0, projectMonthMinor: 0 },
  fallbackModel: "claude-sonnet-5",
  enforce: true,
  ...over,
});

describe("boundary rules reach the dispatch path", () => {
  it("refuses an external model for unclassified (= confidential) data", () => {
    // The default sensitivity is the whole point: data nobody classified is the
    // data you would least like to hand to a third party.
    const d = decideDispatch(base());
    expect(d.permitted).toBe(false);
    expect(d.reasons).toContain("boundary_not_permitted");
    expect(d.blocked).toBe(true);
    expect(d.why).toMatch(/confidential/);
  });

  it("permits the same model once the data is classified internal", () => {
    const d = decideDispatch(base({ sensitivity: "internal" }));
    expect(d.permitted).toBe(true);
    expect(d.model).toBe("claude-sonnet-5");
    expect(d.executionClass).toBe("external");
  });

  it("permits a local model for confidential data", () => {
    const d = decideDispatch(base({ alias: "preckon-local" }));
    expect(d.permitted).toBe(true);
    expect(d.executionClass).toBe("local");
  });

  it("never lets a tenant widen what its deployment mode allows", () => {
    // A sovereign install that could configure itself back into calling a third
    // party would not be sovereign in any sense a customer would accept.
    const permissive: TenantPolicy = {
      ...defaultPolicy("sovereign"),
      sensitivity: { confidential: { allow: ["local", "preckon", "external"] } },
    };
    const d = decideDispatch(base({ policy: permissive }));
    expect(d.permitted).toBe(false);
    expect(d.reasons).toContain("boundary_not_permitted");
  });
});

describe("order of reasons", () => {
  it("reports a forbidden boundary rather than the budget", () => {
    // If a policy refusal were reported as a budget problem, the operator would
    // raise the budget — and appear to fix it.
    const broke: TenantPolicy = {
      ...defaultPolicy("saas"),
      budgets: { dailyUsdMinor: 1 },
    };
    const d = decideDispatch(base({ policy: broke, estimatedInputTokens: 10_000_000 }));
    expect(d.reasons).toContain("boundary_not_permitted");
    expect(d.reasons).not.toContain("budget_exceeded");
  });

  it("stops an eligible model once the tenant's budget is spent", () => {
    const capped: TenantPolicy = {
      ...defaultPolicy("saas"),
      budgets: { dailyUsdMinor: 500 },
    };
    const d = decideDispatch(base({
      policy: capped,
      sensitivity: "internal",
      spend: { todayMinor: 499, projectMonthMinor: 499 },
      estimatedInputTokens: 5_000_000,
    }));
    expect(d.permitted).toBe(false);
    expect(d.reasons).toEqual(["budget_exceeded"]);
  });
});

describe("failing in the safe direction", () => {
  it("falls back to the configured model when the registry is empty", () => {
    // A fresh install, or a registry table that has not been seeded yet. A
    // governance layer whose first act is to break the product gets reverted.
    const d = decideDispatch(base({ registry: [], enforce: true }));
    expect(d.permitted).toBe(true);
    expect(d.blocked).toBe(false);
    expect(d.model).toBe("claude-sonnet-5");
    expect(d.reasons).toContain("model_not_registered");
  });

  it("records the refusal but does not block when enforcement is off", () => {
    const d = decideDispatch(base({ enforce: false }));
    expect(d.permitted).toBe(false);   // the decision is still taken...
    expect(d.blocked).toBe(false);     // ...and deliberately not binding yet
  });

  it("refuses a model that is registered but not approved", () => {
    const candidate = { ...external, status: "candidate" as const };
    const d = decideDispatch(base({ registry: [candidate], sensitivity: "internal" }));
    expect(d.permitted).toBe(false);
    expect(d.reasons).toContain("model_not_approved");
  });
});

describe("what the ledger will record", () => {
  it("carries the policy version and sensitivity of the decision", () => {
    const d = decideDispatch(base({ sensitivity: "internal", policyVersion: 7 }));
    expect(d.policyVersion).toBe(7);
    expect(d.sensitivity).toBe("internal");
    expect(d.estimatedCostMinor).toBeGreaterThan(0);
  });

  it("prices the estimate off the registry's rate card", () => {
    // 1M input tokens at 300 minor/M = 300 minor.
    const d = decideDispatch(base({ sensitivity: "internal", estimatedInputTokens: 1_000_000 }));
    expect(d.estimatedCostMinor).toBe(300);
  });
});

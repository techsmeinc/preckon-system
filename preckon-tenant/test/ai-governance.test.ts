// Tenant AI policy, data sensitivity and budgets.
//
// This is the gate that makes Private AI and Sovereign AI sellable rather than
// slides. These pin the two properties everything else rests on: eligibility is
// decided before quality is considered, and a tenant can only ever narrow what
// its deployment mode permits.

import { describe, it, expect } from "vitest";
import {
  SENSITIVITY_ORDER, DEFAULT_SENSITIVITY, MODE_DEFAULTS,
  normaliseSensitivity, effectiveSensitivity, atLeastAsRestricted,
  allowedBoundaries, eligibleModels, providerLoggingAllowed,
  defaultPolicy, validatePolicy,
  type TenantPolicy, type ModelCandidate,
} from "@/lib/ai/policy";
import {
  costMinor, estimateCostMinor, checkBudget, checkLimits, clampToLimits,
  TASK_BUDGETS, type RateCard, type Budget,
} from "@/lib/ai/budget";

const models: ModelCandidate[] = [
  { alias: "preckon-small", boundary: "local" },
  { alias: "preckon-reasoning", boundary: "preckon" },
  { alias: "frontier-reasoning", boundary: "external", frontier: true },
];

// ── Sensitivity ──────────────────────────────────────────────────────────────

describe("classification", () => {
  it("treats anything unclassified as confidential, not public", () => {
    /* On a construction project the unclassified thing is usually the tender
       pricing somebody uploaded without thinking. The cost of being wrong is
       asymmetric. */
    expect(DEFAULT_SENSITIVITY).toBe("confidential");
    expect(normaliseSensitivity(undefined)).toBe("confidential");
    expect(normaliseSensitivity("")).toBe("confidential");
    expect(normaliseSensitivity("nonsense")).toBe("confidential");
  });

  it("accepts the known classifications, case-insensitively", () => {
    expect(normaliseSensitivity("PUBLIC")).toBe("public");
    expect(normaliseSensitivity(" restricted ")).toBe("restricted");
  });

  it("orders least to most restricted", () => {
    expect(SENSITIVITY_ORDER).toEqual(["public", "internal", "confidential", "restricted"]);
    expect(atLeastAsRestricted("restricted", "public")).toBe(true);
    expect(atLeastAsRestricted("public", "restricted")).toBe(false);
    expect(atLeastAsRestricted("internal", "internal")).toBe(true);
  });

  it("takes the most restricted item in a request, not the average", () => {
    /* A request carrying one restricted document and forty public ones is a
       restricted request. Averaging permits exactly the leak classification
       exists to prevent. */
    expect(effectiveSensitivity(["public", "public", "restricted", "public"])).toBe("restricted");
  });

  it("defaults an empty request to confidential", () => {
    expect(effectiveSensitivity([])).toBe("confidential");
  });
});

// ── Boundaries ───────────────────────────────────────────────────────────────

describe("deployment modes", () => {
  it("lets SaaS send public and internal data outside", () => {
    expect(MODE_DEFAULTS.saas.internal).toContain("external");
  });

  it("never lets SaaS send restricted data anywhere but local", () => {
    expect(MODE_DEFAULTS.saas.restricted).toEqual(["local"]);
  });

  it("keeps confidential data inside the customer boundary on private", () => {
    expect(MODE_DEFAULTS.private.confidential).toEqual(["local"]);
  });

  it("denies external at every classification on sovereign, including public", () => {
    /* The promise is "no mandatory external AI or data egress". A mode that
       leaked public data to a third party would not be sovereign in any sense a
       customer would accept. */
    for (const s of SENSITIVITY_ORDER) {
      expect(MODE_DEFAULTS.sovereign[s]).not.toContain("external");
    }
  });
});

describe("a tenant can narrow but never widen", () => {
  it("applies a tenant rule that restricts further", () => {
    const policy: TenantPolicy = {
      deploymentMode: "saas",
      sensitivity: { internal: { allow: ["local"] } },
    };
    expect(allowedBoundaries(policy, "internal")).toEqual(["local"]);
  });

  it("ignores a tenant rule that tries to widen", () => {
    /* Otherwise a sovereign install could configure itself back into calling a
       third party, and the mode would mean nothing. */
    const policy: TenantPolicy = {
      deploymentMode: "sovereign",
      sensitivity: { public: { allow: ["local", "external"] } },
    };
    expect(allowedBoundaries(policy, "public")).toEqual(["local"]);
  });

  it("reports the attempt rather than silently ignoring it", () => {
    // An administrator who thinks they enabled external access must be told.
    const policy: TenantPolicy = {
      deploymentMode: "sovereign",
      sensitivity: { public: { allow: ["external"] } },
    };
    const issues = validatePolicy(policy);
    expect(issues.some((i) => /cannot widen/i.test(i.message))).toBe(true);
  });

  it("falls back to the mode default when the tenant sets no rule", () => {
    expect(allowedBoundaries({ deploymentMode: "saas" }, "public")).toContain("external");
  });
});

// ── Eligibility ──────────────────────────────────────────────────────────────

describe("eligibility is decided before quality", () => {
  it("excludes an external model for confidential data on SaaS", () => {
    const e = eligibleModels({ deploymentMode: "saas" }, models, { sensitivity: "confidential" });
    expect(e.eligible.map((m) => m.alias)).not.toContain("frontier-reasoning");
  });

  it("leaves only local models for restricted data", () => {
    const e = eligibleModels({ deploymentMode: "saas" }, models, { sensitivity: "restricted" });
    expect(e.eligible.map((m) => m.alias)).toEqual(["preckon-small"]);
  });

  it("says why each model was rejected", () => {
    /* "The good model was not used" is a question somebody asks, and "policy"
       is not an answer. */
    const e = eligibleModels({ deploymentMode: "saas" }, models, { sensitivity: "restricted" });
    const reason = e.rejected.find((r) => r.alias === "frontier-reasoning")?.reason;
    expect(reason).toMatch(/restricted data may not go to a external model/i);
  });

  it("honours a model allowlist", () => {
    const policy: TenantPolicy = { deploymentMode: "saas", modelAllowlist: ["preckon-small"] };
    const e = eligibleModels(policy, models, { sensitivity: "public" });
    expect(e.eligible.map((m) => m.alias)).toEqual(["preckon-small"]);
    expect(e.rejected.some((r) => /allowlist/i.test(r.reason))).toBe(true);
  });

  it("denies frontier escalation per module", () => {
    const policy: TenantPolicy = { deploymentMode: "saas", denyFrontierModules: ["tenderlogix"] };
    const e = eligibleModels(policy, models, { sensitivity: "public", module: "tenderlogix" });
    expect(e.eligible.map((m) => m.alias)).not.toContain("frontier-reasoning");
    expect(e.rejected.some((r) => /frontier escalation is denied/i.test(r.reason))).toBe(true);
  });

  it("allows frontier for a module that is not denied", () => {
    const policy: TenantPolicy = { deploymentMode: "saas", denyFrontierModules: ["tenderlogix"] };
    const e = eligibleModels(policy, models, { sensitivity: "public", module: "narrativelogix" });
    expect(e.eligible.map((m) => m.alias)).toContain("frontier-reasoning");
  });

  it("says plainly when nothing may run the request", () => {
    const e = eligibleModels({ deploymentMode: "sovereign" },
      [{ alias: "frontier-reasoning", boundary: "external", frontier: true }],
      { sensitivity: "public" });
    expect(e.eligible).toHaveLength(0);
    expect(e.why).toMatch(/cannot run as asked/i);
  });
});

describe("provider logging", () => {
  it("is denied unless explicitly allowed", () => {
    /* A customer can accept a request reaching an external model while refusing
       that operator to retain the content. Different promises. */
    expect(providerLoggingAllowed({ deploymentMode: "saas" })).toBe(false);
    expect(providerLoggingAllowed(defaultPolicy())).toBe(false);
    expect(providerLoggingAllowed({ deploymentMode: "saas", allowProviderLogging: true })).toBe(true);
  });
});

describe("policy validation", () => {
  it("accepts the default policy", () => {
    expect(validatePolicy(defaultPolicy())).toEqual([]);
  });

  it("rejects an unknown deployment mode", () => {
    expect(validatePolicy({ deploymentMode: "hybrid" as any })[0].field).toBe("deploymentMode");
  });

  it("rejects a negative budget", () => {
    const issues = validatePolicy({ deploymentMode: "saas", budgets: { dailyUsdMinor: -1 } });
    expect(issues.some((i) => /cannot be negative/i.test(i.message))).toBe(true);
  });
});

// ── Cost and budgets ─────────────────────────────────────────────────────────

const card: RateCard = {
  inputPerMillionMinor: 300,
  outputPerMillionMinor: 1500,
  cachedInputPerMillionMinor: 30,
};

describe("cost", () => {
  it("charges input and output at their own rates", () => {
    expect(costMinor({ inputTokens: 1_000_000, outputTokens: 0 }, card)).toBe(300);
    expect(costMinor({ inputTokens: 0, outputTokens: 1_000_000 }, card)).toBe(1500);
  });

  it("charges cached input at the discounted rate", () => {
    const c = costMinor({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 }, card);
    expect(c).toBe(30);
  });

  it("splits fresh and cached input", () => {
    const c = costMinor({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 }, card);
    expect(c).toBe(Math.ceil(150 + 15));
  });

  it("rounds up, so the error never favours looking cheap", () => {
    expect(costMinor({ inputTokens: 1, outputTokens: 0 }, card)).toBe(1);
  });

  it("never charges for negative usage", () => {
    expect(costMinor({ inputTokens: -100, outputTokens: -100 }, card)).toBe(0);
  });

  it("assumes the full output budget when estimating", () => {
    /* A model that stops early costs less than predicted; one that runs long is
       exactly what the ceiling is for. */
    const est = estimateCostMinor(1_000_000, { maxOutputTokens: 1_000_000 }, card);
    expect(est).toBe(1800);
  });
});

describe("budget checks", () => {
  const budget: Budget = { maxInputTokens: 10_000, maxOutputTokens: 1_000, maxCostMinor: 50, maxLatencyMs: 30_000 };

  it("passes a request that fits", () => {
    expect(checkBudget(1_000, budget, card).withinBudget).toBe(true);
  });

  it("catches too much input", () => {
    const c = checkBudget(50_000, budget, card);
    expect(c.exceeded).toContain("input_tokens");
  });

  it("catches too much cost", () => {
    const expensive: RateCard = { inputPerMillionMinor: 1_000_000, outputPerMillionMinor: 1_000_000 };
    expect(checkBudget(10_000, budget, expensive).exceeded).toContain("cost");
  });

  it("catches too much latency when it is known", () => {
    expect(checkBudget(100, budget, card, 60_000).exceeded).toContain("latency");
  });

  it("does not treat unknown latency as a breach", () => {
    // Guessing would reject work that would have completed comfortably.
    expect(checkBudget(100, budget, card, undefined).exceeded).not.toContain("latency");
  });

  it("offers remedies in the order the blueprint recommends", () => {
    /* Section 21 lists reduce, re-route, split, cache, batch, authorise — and
       failing outright is the last of those, not the first. */
    const c = checkBudget(50_000, budget, card);
    expect(c.remedies[0]).toBe("serve_from_cache");
    expect(c.remedies[c.remedies.length - 1]).toBe("reject");
  });

  it("offers no remedies when nothing is wrong", () => {
    expect(checkBudget(100, budget, card).remedies).toEqual([]);
  });
});

describe("tenant limits", () => {
  const limits = { dailyUsdMinor: 1000, projectMonthlyUsdMinor: 5000, singleRequestUsdMinor: 100 };

  it("allows a request inside every limit", () => {
    expect(checkLimits(50, { todayMinor: 100, projectMonthMinor: 500 }, limits).allowed).toBe(true);
  });

  it("blocks a single request that is too expensive", () => {
    const c = checkLimits(500, { todayMinor: 0, projectMonthMinor: 0 }, limits);
    expect(c.breached).toContain("single_request");
  });

  it("blocks when today's spend would pass the daily ceiling", () => {
    const c = checkLimits(50, { todayMinor: 980, projectMonthMinor: 0 }, limits);
    expect(c.breached).toContain("daily");
    expect(c.why).toMatch(/daily ceiling/i);
  });

  it("blocks when the project's month would pass its ceiling", () => {
    const c = checkLimits(50, { todayMinor: 0, projectMonthMinor: 4990 }, limits);
    expect(c.breached).toContain("project_monthly");
  });

  it("allows anything when no limits are set", () => {
    expect(checkLimits(999_999, { todayMinor: 0, projectMonthMinor: 0 }, {}).allowed).toBe(true);
  });
});

describe("clamping a requested budget", () => {
  it("silently reduces a module asking for more than the tenant permits", () => {
    /* Refusing would turn a policy tightening into an outage across every
       module that asked for more. */
    const clamped = clampToLimits({ maxCostMinor: 5000 }, { singleRequestUsdMinor: 100 });
    expect(clamped.maxCostMinor).toBe(100);
  });

  it("leaves a smaller request alone", () => {
    expect(clampToLimits({ maxCostMinor: 20 }, { singleRequestUsdMinor: 100 }).maxCostMinor).toBe(20);
  });

  it("supplies the tenant ceiling when the caller asked for nothing", () => {
    expect(clampToLimits({}, { singleRequestUsdMinor: 100 }).maxCostMinor).toBe(100);
  });
});

describe("task budgets", () => {
  it("does not let classification escalate to a frontier model", () => {
    expect(TASK_BUDGETS.classification.allowFrontier).toBe(false);
  });

  it("gives every task an output ceiling", () => {
    for (const [name, b] of Object.entries(TASK_BUDGETS)) {
      expect(b.maxOutputTokens, name).toBeGreaterThan(0);
    }
  });
});

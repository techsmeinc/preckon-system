// Model registry and response cache.
//
// Two rules with teeth. Application code names aliases, never models — so a
// model can be replaced without a deploy. And a cached answer is reused only
// when every dimension that could change it matches, because confidently
// repeating what was true against Rev B after Rev C is issued is a liability,
// not a performance win.

import { describe, it, expect } from "vitest";
import {
  ModelRegistry, UnknownModelAlias, validateRegistry,
  PRECKON_ALIASES, TIER_ALIAS, isPreckonAlias, type ModelEntry,
} from "@/lib/ai/registry";
import {
  cacheKey, canReuse, INVALIDATION_TRIGGERS, scopeOf,
  type CacheDimensions, type CachedEntry,
} from "@/lib/ai/cache";

const entry = (over: Partial<ModelEntry> = {}): ModelEntry => ({
  alias: "preckon-small",
  provider: "local-vllm",
  providerModel: "qwen2.5-7b-instruct",
  boundary: "local",
  capabilities: ["classification", "extraction"],
  contextLimit: 32_000,
  rateCard: { inputPerMillionMinor: 10, outputPerMillionMinor: 20 },
  status: "approved",
  evaluationVersion: "eval-2026-08",
  ...over,
});

const reasoning = entry({
  alias: "preckon-reasoning", boundary: "preckon", providerModel: "sonnet-x",
  capabilities: ["construction_reasoning", "structured_output", "tool_calling"],
  rateCard: { inputPerMillionMinor: 300, outputPerMillionMinor: 1500 },
});

const frontier = entry({
  alias: "frontier-reasoning", boundary: "external", frontier: true, providerModel: "opus-x",
  capabilities: ["hard_reasoning", "construction_reasoning", "multimodal"],
  rateCard: { inputPerMillionMinor: 1500, outputPerMillionMinor: 7500 },
});

describe("aliases, not model names", () => {
  it("resolves an alias to its provider model", () => {
    const r = new ModelRegistry([entry()]);
    expect(r.resolve("preckon-small").providerModel).toBe("qwen2.5-7b-instruct");
  });

  it("lets the provider model change without touching the alias", () => {
    /* The whole point: replacing a model is configuration, not a deploy. */
    const r = new ModelRegistry([entry()]);
    r.register(entry({ providerModel: "qwen3-8b-instruct" }));
    expect(r.resolve("preckon-small").providerModel).toBe("qwen3-8b-instruct");
  });

  it("throws on an unknown alias rather than falling back", () => {
    /* A silent fallback means a typo routes production traffic to the wrong
       model and nothing says so until the bill. */
    const r = new ModelRegistry([entry()]);
    expect(() => r.resolve("preckon-huge")).toThrow(UnknownModelAlias);
    expect(() => r.resolve("preckon-huge")).toThrow(/known aliases/i);
  });

  it("still resolves a retired model, so old usage rows can be explained", () => {
    // A ledger entry naming a model nobody can look up is a hole in the audit.
    const r = new ModelRegistry([entry({ status: "retired" })]);
    expect(r.resolve("preckon-small").status).toBe("retired");
    expect(r.approved()).toHaveLength(0);
  });

  it("maps the existing tier vocabulary onto aliases", () => {
    for (const alias of Object.values(TIER_ALIAS)) expect(isPreckonAlias(alias)).toBe(true);
    expect(PRECKON_ALIASES).toContain("preckon-reasoning");
  });
});

describe("choosing a model", () => {
  const r = new ModelRegistry([entry(), reasoning, frontier]);

  it("lists what can do the work, cheapest first", () => {
    const capable = r.capableOf("construction_reasoning");
    expect(capable.map((e) => e.alias)).toEqual(["preckon-reasoning", "frontier-reasoning"]);
  });

  it("picks the cheapest that policy permits, not the best", () => {
    /* "Best" is how a platform spends frontier money on document
       classification. */
    const chosen = r.cheapestFor("construction_reasoning", ["local", "preckon", "external"]);
    expect(chosen?.alias).toBe("preckon-reasoning");
  });

  it("respects the permitted boundaries", () => {
    const chosen = r.cheapestFor("construction_reasoning", ["external"]);
    expect(chosen?.alias).toBe("frontier-reasoning");
  });

  it("returns null when nothing eligible can do the work", () => {
    expect(r.cheapestFor("hard_reasoning", ["local"])).toBeNull();
  });

  it("never offers a candidate or retired model", () => {
    const r2 = new ModelRegistry([entry({ alias: "x", status: "candidate", capabilities: ["classification"] })]);
    expect(r2.capableOf("classification")).toHaveLength(0);
  });
});

describe("registry validation", () => {
  it("accepts a well-formed entry", () => {
    expect(validateRegistry([entry()])).toEqual([]);
  });

  it("catches a duplicate alias", () => {
    expect(validateRegistry([entry(), entry()]).some((i) => /duplicate/i.test(i.message))).toBe(true);
  });

  it("refuses an approved model with no evaluation behind it", () => {
    /* Section 33: a model cannot become an approved production alias until it
       has passed a measured evaluation. Approved with no version means somebody
       promoted it on judgement. */
    const issues = validateRegistry([entry({ evaluationVersion: undefined })]);
    expect(issues.some((i) => /without an evaluation/i.test(i.message))).toBe(true);
  });

  it("allows a candidate with no evaluation yet", () => {
    expect(validateRegistry([entry({ status: "candidate", evaluationVersion: undefined })])).toEqual([]);
  });

  it("catches a negative rate", () => {
    const bad = entry({ rateCard: { inputPerMillionMinor: -1, outputPerMillionMinor: 10 } });
    expect(validateRegistry([bad]).some((i) => /cannot be negative/i.test(i.message))).toBe(true);
  });

  it("catches a model with no capabilities", () => {
    expect(validateRegistry([entry({ capabilities: [] })]).some((i) => /no capabilities/i.test(i.message))).toBe(true);
  });
});

// ── Cache ────────────────────────────────────────────────────────────────────

const dims = (over: Partial<CacheDimensions> = {}): CacheDimensions => ({
  tenantId: "t1",
  projectId: "p1",
  taskType: "spec_clause_extraction",
  input: "What is the fire rating of the corridor partitions?",
  revisionKeys: ["DOC-1:C01", "DOC-2:P03"],
  sensitivity: "confidential",
  policyVersion: 1,
  promptVersion: "v3",
  schemaVersion: "s1",
  ...over,
});

describe("the cache key carries everything that could change the answer", () => {
  it("is stable for identical dimensions", () => {
    expect(cacheKey(dims())).toBe(cacheKey(dims()));
  });

  it("ignores the order revisions arrived in", () => {
    /* Otherwise the hit rate depends on retrieval ordering, which nobody
       controls. */
    const a = cacheKey(dims({ revisionKeys: ["DOC-1:C01", "DOC-2:P03"] }));
    const b = cacheKey(dims({ revisionKeys: ["DOC-2:P03", "DOC-1:C01"] }));
    expect(a).toBe(b);
  });

  it("ignores whitespace and case in the question", () => {
    expect(cacheKey(dims({ input: "  WHAT IS the   fire rating of the corridor partitions?  " })))
      .toBe(cacheKey(dims()));
  });

  it("changes when the revisions change", () => {
    expect(cacheKey(dims({ revisionKeys: ["DOC-1:C02"] }))).not.toBe(cacheKey(dims()));
  });

  it("changes when the policy version changes", () => {
    expect(cacheKey(dims({ policyVersion: 2 }))).not.toBe(cacheKey(dims()));
  });

  it("changes when the prompt version changes", () => {
    expect(cacheKey(dims({ promptVersion: "v4" }))).not.toBe(cacheKey(dims()));
  });

  it("changes when the classification changes", () => {
    expect(cacheKey(dims({ sensitivity: "restricted" }))).not.toBe(cacheKey(dims()));
  });

  it("never collides across tenants", () => {
    expect(cacheKey(dims({ tenantId: "t2" }))).not.toBe(cacheKey(dims()));
  });
});

describe("reuse safety", () => {
  const stored = (over: Partial<CacheDimensions> = {}): CachedEntry => ({
    key: cacheKey(dims(over)),
    dimensions: dims(over),
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });

  it("permits reuse when everything matches", () => {
    expect(canReuse(stored(), dims()).safe).toBe(true);
  });

  it("refuses when the source revisions moved", () => {
    /* The dangerous case. An answer computed against Rev B, served after Rev C
       is issued, arrives with the same confidence as a fresh one. */
    const d = canReuse(stored(), dims({ revisionKeys: ["DOC-1:C02"] }));
    expect(d.safe).toBe(false);
    expect(d.why).toMatch(/no longer current/i);
  });

  it("refuses across tenants", () => {
    expect(canReuse(stored(), dims({ tenantId: "t2" })).reasons).toContain("tenant");
  });

  it("refuses when the classification differs", () => {
    expect(canReuse(stored(), dims({ sensitivity: "public" })).reasons).toContain("sensitivity");
  });

  it("refuses when the policy version moved", () => {
    expect(canReuse(stored(), dims({ policyVersion: 2 })).reasons).toContain("policy_version");
  });

  it("refuses when the output schema changed", () => {
    expect(canReuse(stored(), dims({ schemaVersion: "s2" })).reasons).toContain("schema_version");
  });

  it("reports every dimension that moved, not just the first", () => {
    const d = canReuse(stored(), dims({ tenantId: "t2", policyVersion: 9, promptVersion: "v9" }));
    expect(d.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("honours an age limit when one is given", () => {
    const d = canReuse(stored(), dims(), 1000, new Date("2026-08-02T00:00:00Z"));
    expect(d.reasons).toContain("expired");
  });

  it("does not expire when no age limit is set", () => {
    // TTL alone must never be what guarantees correctness - section 19.
    const d = canReuse(stored(), dims(), undefined, new Date("2030-01-01"));
    expect(d.safe).toBe(true);
  });
});

describe("invalidation", () => {
  it("scopes a document revision to the revision dimension", () => {
    /* Issuing one drawing must not discard every cached answer on the project,
       but it must discard the ones computed from that drawing. */
    expect(scopeOf("document_revision_issued")).toBe("revisionKeys");
  });

  it("scopes a policy change to the policy version", () => {
    expect(scopeOf("project_policy_changed")).toBe("policyVersion");
  });

  it("flushes everything for a manual or standards change", () => {
    expect(scopeOf("manual")).toBe("all");
    expect(scopeOf("standards_version_changed")).toBe("all");
  });

  it("gives every trigger a scope", () => {
    // A trigger with no handler should be a visible gap, not a silent one.
    for (const t of INVALIDATION_TRIGGERS) expect(scopeOf(t)).toBeTruthy();
  });
});

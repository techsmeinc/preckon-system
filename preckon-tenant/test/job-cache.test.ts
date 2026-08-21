// Cache dimensions at dispatch, and what gets written back at completion.
//
// The dimensions are the safety mechanism: everything that could change the
// answer goes into the key, so a mismatch cannot produce a hit at all. These
// tests pin the fields that are easy to leave out and expensive to leave out —
// the artifacts the answer was computed from, the policy in force, and the
// prompt version that produced it.

import { describe, it, expect } from "vitest";

import { cacheDimensionsFor, type EnqueueInput } from "@/lib/jobs";
import { cacheKey } from "@/lib/ai/cache";
import type { DispatchDecision } from "@/lib/ai/govern";

const input = (over: Partial<EnqueueInput> = {}): EnqueueInput => ({
  ctx: {
    tenantId: "t1", projectId: "p1", runId: "r1", stepId: "s1", agentKey: "agent.boq",
  } as any,
  agentKind: "worker",
  jobType: "boq.derive_lines",
  tier: "deep",
  promptRef: "boq.derive_lines@v1",
  inputArtifacts: [
    { id: "art-b", type: "spec_clause", payload: {} },
    { id: "art-a", type: "drawing_measurement", payload: {} },
  ],
  params: { section: "substructure" },
  ...over,
});

const decision = (over: Partial<DispatchDecision> = {}): DispatchDecision => ({
  permitted: true, blocked: false, reasons: [], why: "",
  alias: "deep", provider: "anthropic", model: "claude-opus-5",
  executionClass: "external", sensitivity: "confidential", policyVersion: 3,
  ...over,
} as DispatchDecision);

describe("what the answer depends on is in the key", () => {
  it("carries the artifacts as revision keys, so re-issuing one can invalidate it", () => {
    // This is what makes scoped invalidation possible: a new revision produces a
    // new artifact id, and every answer computed from the old one can be found.
    expect(cacheDimensionsFor(input(), decision(), "p@v1").revisionKeys)
      .toEqual(["art-b", "art-a"]);
  });

  it("changes the key when an input artifact changes", () => {
    const a = cacheDimensionsFor(input(), decision(), "p@v1");
    const b = cacheDimensionsFor(
      input({ inputArtifacts: [{ id: "art-c", type: "spec_clause", payload: {} }] }),
      decision(), "p@v1",
    );
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("changes the key when the params change", () => {
    const a = cacheDimensionsFor(input(), decision(), "p@v1");
    const b = cacheDimensionsFor(input({ params: { section: "superstructure" } }), decision(), "p@v1");
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("changes the key when the policy version moves", () => {
    const a = cacheDimensionsFor(input(), decision(), "p@v1");
    const b = cacheDimensionsFor(input(), decision({ policyVersion: 4 }), "p@v1");
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("changes the key when a new prompt version is approved", () => {
    const a = cacheDimensionsFor(input(), decision(), "boq.derive_lines@v1");
    const b = cacheDimensionsFor(input(), decision(), "boq.derive_lines@v2");
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("changes the key when the data is classified differently", () => {
    const a = cacheDimensionsFor(input(), decision(), "p@v1");
    const b = cacheDimensionsFor(input(), decision({ sensitivity: "internal" as any }), "p@v1");
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("keeps tenants apart", () => {
    const a = cacheDimensionsFor(input(), decision(), "p@v1");
    const b = cacheDimensionsFor(
      input({ ctx: { ...input().ctx, tenantId: "t2" } as any }), decision(), "p@v1",
    );
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("gives the same key for the same request twice", () => {
    // The whole premise: the same question asked twice gets the same answer.
    expect(cacheKey(cacheDimensionsFor(input(), decision(), "p@v1")))
      .toBe(cacheKey(cacheDimensionsFor(input(), decision(), "p@v1")));
  });

  it("ignores artifact payloads, which are addressed by id", () => {
    const a = cacheDimensionsFor(input(), decision(), "p@v1");
    const b = cacheDimensionsFor(input({
      inputArtifacts: [
        { id: "art-b", type: "spec_clause", payload: { huge: "blob" } },
        { id: "art-a", type: "drawing_measurement", payload: { other: 1 } },
      ],
    }), decision(), "p@v1");
    expect(cacheKey(a)).toBe(cacheKey(b));
  });
});

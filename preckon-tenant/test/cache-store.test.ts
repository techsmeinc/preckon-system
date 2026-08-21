// The response cache, against a fake database.
//
// What is worth pinning here is not the SQL — the integration suite covers that
// — but the two properties that make a cache safe to switch on:
//
//   It must refuse to serve an answer whose inputs have moved. A cache that
//   reuses a BOQ computed from Rev B after Rev C is issued produces a confident
//   statement the documents no longer support.
//
//   It must never be able to stop work happening. Every failure path returns
//   "call the model" rather than throwing, because the alternative is a cache
//   outage becoming a product outage.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));

import { query, queryOne } from "@/lib/db";
import { lookup, store, invalidate, stats } from "@/lib/ai/cache-store";
import { cacheKey, type CacheDimensions } from "@/lib/ai/cache";

const q = query as unknown as ReturnType<typeof vi.fn>;
const q1 = queryOne as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  q.mockReset().mockResolvedValue([]);
  q1.mockReset().mockResolvedValue(null);
});

const dims: CacheDimensions = {
  tenantId: "t1",
  projectId: "p1",
  taskType: "boq.derive_lines",
  input: "measure the substructure",
  revisionKeys: ["art-b", "art-a"],
  sensitivity: "confidential",
  policyVersion: 3,
  promptVersion: "boq.derive_lines@v2",
  modelAlias: "deep",
};

/** A stored row matching `dims`, with fields overridable per test. */
const row = (over: Record<string, unknown> = {}) => ({
  cache_key: cacheKey(dims),
  tenant_id: "t1",
  project_id: "p1",
  task_type: "boq.derive_lines",
  sensitivity: "confidential",
  policy_version: 3,
  prompt_version: "boq.derive_lines@v2",
  schema_version: null,
  model_alias: "deep",
  // Stored sorted, which is how invalidation can match one revision by string.
  revision_keys: "art-a,art-b",
  response_json: JSON.stringify({ outputs: [{ type: "boq_line" }] }),
  cost_minor: 4200,
  hits: 2,
  created_at: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

describe("serving a stored answer", () => {
  it("returns the response and what the original call cost", async () => {
    q1.mockResolvedValue(row());
    const hit = await lookup("t1", dims);
    expect(hit).not.toBeNull();
    expect(hit!.response).toEqual({ outputs: [{ type: "boq_line" }] });
    // The saving is the ORIGINAL cost, which is the only honest measure of what
    // reuse is worth.
    expect(hit!.costMinor).toBe(4200);
    expect(hit!.hits).toBe(3);
  });

  it("counts the hit, so an entry nobody ever serves is visible", async () => {
    q1.mockResolvedValue(row());
    await lookup("t1", dims);
    const update = q.mock.calls.find((c) => /UPDATE ai_response_cache/.test(c[0]));
    expect(update).toBeTruthy();
    expect(update![0]).toMatch(/hits = hits \+ 1/);
  });

  it("misses cleanly when nothing is stored", async () => {
    expect(await lookup("t1", dims)).toBeNull();
  });

  it("scopes the lookup by tenant as well as by key", async () => {
    await lookup("t1", dims);
    expect(q1.mock.calls[0][1]).toEqual(["t1", cacheKey(dims)]);
  });
});

describe("refusing to serve an answer whose inputs moved", () => {
  it("refuses when a source revision has changed", async () => {
    // The key alone would already have missed. This proves the second check
    // holds independently, which is what protects the day somebody widens the
    // lookup to something looser than an exact key match.
    q1.mockResolvedValue(row({ revision_keys: "art-a,art-c" }));
    expect(await lookup("t1", dims)).toBeNull();
  });

  it("refuses when the policy version has moved on", async () => {
    q1.mockResolvedValue(row({ policy_version: 2 }));
    expect(await lookup("t1", dims)).toBeNull();
  });

  it("refuses when a different prompt version produced it", async () => {
    q1.mockResolvedValue(row({ prompt_version: "boq.derive_lines@v1" }));
    expect(await lookup("t1", dims)).toBeNull();
  });

  it("refuses when the sensitivity classification differs", async () => {
    q1.mockResolvedValue(row({ sensitivity: "internal" }));
    expect(await lookup("t1", dims)).toBeNull();
  });

  it("refuses an entry older than the staleness ceiling", async () => {
    q1.mockResolvedValue(row({ created_at: new Date("2026-01-01T00:00:00Z") }));
    const hit = await lookup("t1", dims, 24 * 3600_000, new Date("2026-08-01T00:00:00Z"));
    expect(hit).toBeNull();
  });

  it("does not count a hit it refused to serve", async () => {
    q1.mockResolvedValue(row({ revision_keys: "art-a,art-c" }));
    await lookup("t1", dims);
    expect(q.mock.calls.some((c) => /UPDATE ai_response_cache/.test(c[0]))).toBe(false);
  });
});

describe("storing", () => {
  it("stores revision keys sorted, so one revision can be found by string", async () => {
    await store({ dims, response: { outputs: [] }, costMinor: 100 });
    const params = q.mock.calls[0][1] as unknown[];
    expect(params).toContain("art-a,art-b");   // sorted, not the ["art-b","art-a"] given
  });

  it("upserts, so a re-stored answer replaces rather than duplicates", async () => {
    await store({ dims, response: {} });
    expect(q.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
    // The hit count restarts because it counts reuse of THIS answer.
    expect(q.mock.calls[0][0]).toMatch(/hits\s+= 0/);
  });

  it("keys the row by the same function that looks it up", async () => {
    await store({ dims, response: {} });
    expect((q.mock.calls[0][1] as unknown[])[0]).toBe(cacheKey(dims));
  });
});

describe("invalidation", () => {
  it("deletes nothing when given no scope", async () => {
    // An invalidation that widens to "everything" because a caller passed an
    // undefined project id is a bug that only shows up as a bill.
    expect(await invalidate("t1", {})).toBe(0);
    expect(q).not.toHaveBeenCalled();
  });

  it("requires `all` to be explicit before clearing a tenant", async () => {
    q.mockResolvedValue({ affectedRows: 12 } as any);
    expect(await invalidate("t1", { all: true })).toBe(12);
    expect(q.mock.calls[0][0]).toMatch(/WHERE tenant_id = \?$/);
  });

  it("matches a revision key without matching a longer one that starts the same", async () => {
    q.mockResolvedValue({ affectedRows: 1 } as any);
    await invalidate("t1", { revisionKey: "rev-1" });
    // `,rev-1,` cannot match `,rev-12,`.
    expect(q.mock.calls[0][1]).toContain("%,rev-1,%");
  });

  it("scopes to a project when one is given", async () => {
    q.mockResolvedValue({ affectedRows: 3 } as any);
    await invalidate("t1", { projectId: "p1" });
    expect(q.mock.calls[0][0]).toMatch(/project_id = \?/);
    expect(q.mock.calls[0][1]).toEqual(["t1", "p1"]);
  });

  it("drops everything below a policy version when policy changes", async () => {
    q.mockResolvedValue({ affectedRows: 5 } as any);
    await invalidate("t1", { policyVersionBelow: 4 });
    expect(q.mock.calls[0][0]).toMatch(/policy_version < \?/);
  });
});

describe("a broken cache never breaks the product", () => {
  it("misses rather than throwing when the lookup query fails", async () => {
    q1.mockRejectedValue(new Error("table is gone"));
    await expect(lookup("t1", dims)).resolves.toBeNull();
  });

  it("swallows a failed store — the answer was still produced", async () => {
    q.mockRejectedValue(new Error("disk full"));
    await expect(store({ dims, response: {} })).resolves.toBeUndefined();
  });

  it("reports zero rather than throwing when invalidation fails", async () => {
    q.mockRejectedValue(new Error("deadlock"));
    await expect(invalidate("t1", { all: true })).resolves.toBe(0);
  });

  it("reports empty stats rather than breaking the screen that shows them", async () => {
    q1.mockRejectedValue(new Error("nope"));
    expect(await stats("t1")).toEqual({ entries: 0, hits: 0, savedMinor: 0, cold: 0 });
  });
});

describe("stats", () => {
  it("reports the saving as what the hits would have cost", async () => {
    q1.mockResolvedValue({ entries: 10, hits: 30, saved: 126000, cold: 4 });
    expect(await stats("t1")).toEqual({ entries: 10, hits: 30, savedMinor: 126000, cold: 4 });
  });
});

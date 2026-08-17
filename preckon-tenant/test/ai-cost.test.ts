// What the AI cost, and where it went.
//
// The plan asks for cost per project to become a product KPI. The arithmetic is
// simple; the judgements around it are not, and they are what these pin:
//
//   - a stub answered nothing and cost nothing, so it must not be averaged in
//     with real work and make a demo box look cheap to operate;
//   - a job that failed still cost money, so it counts;
//   - the window is on when work was REQUESTED, not when it finished, or the
//     months with the most failures quietly understate themselves.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { costByTenant, formatMinor, tenantsOverCeiling, tierMix } from "@/lib/ai-cost";

const q = query as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => q.mockReset());

/** One grouped row as MySQL returns it — numbers may arrive as strings. */
const row = (key: string, o: Partial<Record<string, number | string>> = {}) => ({
  key,
  jobs: o.jobs ?? 10,
  stub_jobs: o.stub_jobs ?? 0,
  failed: o.failed ?? 0,
  input_tokens: o.input_tokens ?? 1000,
  output_tokens: o.output_tokens ?? 200,
  cost_minor: o.cost_minor ?? 500,
});

describe("spend by group", () => {
  it("totals cost, tokens and jobs", async () => {
    q.mockResolvedValueOnce([row("p1", { cost_minor: 500 }), row("p2", { cost_minor: 250 })]);
    const s = await costByTenant("t1");
    expect(s.totalCostMinor).toBe(750);
    expect(s.totalJobs).toBe(20);
    expect(s.rows).toHaveLength(2);
  });

  it("copes with counts arriving as strings", async () => {
    // MySQL returns SUM() as a string often enough that treating it as a number
    // silently concatenates instead of adding.
    q.mockResolvedValueOnce([row("p1", { cost_minor: "500" as any, jobs: "10" as any })]);
    const s = await costByTenant("t1");
    expect(s.totalCostMinor).toBe(500);
    expect(s.totalJobs).toBe(10);
  });

  it("scopes to the tenant, always", async () => {
    q.mockResolvedValueOnce([]);
    await costByTenant("t1");
    expect(String(q.mock.calls[0][0])).toContain("tenant_id = ?");
    expect((q.mock.calls[0][1] as unknown[])[0]).toBe("t1");
  });

  it("groups by what was asked for", async () => {
    for (const [g, sql] of [["agent", "agent_key"], ["model", "model"], ["day", "DATE(queued_at)"]] as const) {
      q.mockReset();
      q.mockResolvedValueOnce([]);
      await costByTenant("t1", { groupBy: g as any });
      expect(String(q.mock.calls[0][0]), g).toContain(sql);
    }
  });

  it("windows on when work was requested, not when it finished", async () => {
    /* A job that never came back is still work somebody paid for. Windowing on
       ended_at would drop exactly those, understating the months with the most
       failures — the months worth looking at. */
    q.mockResolvedValueOnce([]);
    await costByTenant("t1", { since: new Date("2026-08-01") });
    expect(String(q.mock.calls[0][0])).toContain("queued_at >= ?");
    expect(String(q.mock.calls[0][0])).not.toContain("ended_at >= ?");
  });

  it("can narrow to one project", async () => {
    q.mockResolvedValueOnce([]);
    await costByTenant("t1", { projectId: "p9" });
    expect(String(q.mock.calls[0][0])).toContain("project_id = ?");
  });

  it("bounds the result set", async () => {
    // A tenant with a year of daily rows should not return an unbounded list to
    // a browser.
    q.mockResolvedValueOnce([]);
    await costByTenant("t1", { groupBy: "day" });
    expect(String(q.mock.calls[0][0])).toMatch(/LIMIT \d+/);
  });
});

describe("stub jobs are not real spend", () => {
  it("counts them separately", async () => {
    q.mockResolvedValueOnce([row("p1", { jobs: 10, stub_jobs: 6, cost_minor: 400 })]);
    const s = await costByTenant("t1");
    expect(s.stubJobs).toBe(6);
    expect(s.totalJobs).toBe(10);
  });

  it("excludes them from the per-job mean", async () => {
    /* Averaging over all ten would report 40 and make the deployment look four
       times cheaper to run than it is. Four jobs actually ran; they cost 400. */
    q.mockResolvedValueOnce([row("p1", { jobs: 10, stub_jobs: 6, cost_minor: 400 })]);
    const s = await costByTenant("t1");
    expect(s.meanCostMinorPerRealJob).toBe(100);
  });

  it("reports zero rather than dividing by zero on an all-stub deployment", async () => {
    q.mockResolvedValueOnce([row("p1", { jobs: 5, stub_jobs: 5, cost_minor: 0 })]);
    const s = await costByTenant("t1");
    expect(s.meanCostMinorPerRealJob).toBe(0);
  });

  it("identifies a stub by the model it reported, not by a zero cost", async () => {
    // A real job can legitimately cost zero — a cached or very short call — and
    // must not be reclassified as a stub because of it.
    q.mockResolvedValueOnce([]);
    await costByTenant("t1");
    expect(String(q.mock.calls[0][0])).toContain("stub:deterministic");
  });
});

describe("failed jobs still cost money", () => {
  it("counts them in the total", async () => {
    q.mockResolvedValueOnce([row("p1", { jobs: 10, failed: 3, cost_minor: 900 })]);
    const s = await costByTenant("t1");
    expect(s.failedJobs).toBe(3);
    expect(s.totalCostMinor).toBe(900);
  });

  it("does not filter the query to successes", async () => {
    q.mockResolvedValueOnce([]);
    await costByTenant("t1");
    expect(String(q.mock.calls[0][0])).not.toMatch(/status\s*=\s*'succeeded'/);
  });
});

describe("ceiling alert", () => {
  it("returns only tenants past the ceiling", async () => {
    q.mockResolvedValueOnce([{ tenant_id: "t9", cost_minor: 50_000, jobs: 400 }]);
    const over = await tenantsOverCeiling(10_000, new Date("2026-08-01"));
    expect(over).toEqual([{ tenantId: "t9", costMinor: 50_000, jobs: 400 }]);
    expect(String(q.mock.calls[0][0])).toContain("HAVING");
  });

  it("is cross-tenant on purpose, since that is what a platform ceiling means", async () => {
    q.mockResolvedValueOnce([]);
    await tenantsOverCeiling(1, new Date());
    expect(String(q.mock.calls[0][0])).toContain("GROUP BY tenant_id");
  });
});

describe("tier mix", () => {
  it("is the baseline the routing work will be judged against", async () => {
    // The plan's ladder — deterministic, cache, small model, large model — only
    // improves if the split is measured first.
    q.mockResolvedValueOnce([
      { tier: "deep", jobs: 40, cost_minor: 8000 },
      { tier: "standard", jobs: 100, cost_minor: 1000 },
    ]);
    const mix = await tierMix("t1", new Date("2026-08-01"));
    expect(mix[0]).toEqual({ tier: "deep", jobs: 40, costMinor: 8000 });
    // Deep is 29% of jobs and 89% of spend — the number worth watching.
    const totalCost = mix.reduce((n, m) => n + m.costMinor, 0);
    expect(mix[0].costMinor / totalCost).toBeGreaterThan(0.85);
  });
});

describe("formatting", () => {
  it("renders minor units as money", () => {
    expect(formatMinor(12_345)).toBe("$123.45");
  });

  it("follows the requested currency", () => {
    expect(formatMinor(10_000, "AED", "en")).toContain("100");
  });

  it("is presentation only — the maths stays in minor units", () => {
    // Money in floats is how a bill ends up a cent out and nobody can say why.
    expect(formatMinor(1)).toBe("$0.01");
  });
});

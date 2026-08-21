// The prompt registry.
//
// This exists to answer one question after the fact: which prompt produced this
// output. So the tests are mostly about the registry being unable to LIE about
// that — never reporting a version it did not resolve, never letting a draft
// look like what ran, and never taking dispatch down when it cannot answer.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));

import { query, queryOne } from "@/lib/db";
import {
  resolvePrompt, listApproved, parseRef, formatRef, prefixHash, prefixDrifted,
} from "@/lib/ai/prompt-store";

const q = query as unknown as ReturnType<typeof vi.fn>;
const q1 = queryOne as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  q.mockReset().mockResolvedValue([]);
  q1.mockReset().mockResolvedValue(null);
});

describe("references", () => {
  it("round-trips key and version", () => {
    expect(parseRef("boq.derive_lines@v4")).toEqual({ key: "boq.derive_lines", version: 4 });
    expect(formatRef("boq.derive_lines", 4)).toBe("boq.derive_lines@v4");
  });

  it("reports no version for a bare key rather than assuming v1", () => {
    // Assuming a version would put a number in the ledger that nothing chose.
    expect(parseRef("boq.derive_lines")).toEqual({ key: "boq.derive_lines", version: null });
  });

  it("takes the last @vN, so a key containing @v is not mis-split", () => {
    expect(parseRef("legacy@v2.migrated@v7")).toEqual({ key: "legacy@v2.migrated", version: 7 });
  });
});

describe("resolving", () => {
  it("returns the approved version and the ref that names it", async () => {
    q1.mockResolvedValue({
      prompt_key: "boq.derive_lines", version: 4,
      prompt_json: { system: "You are an estimator." },
      prefix_hash: null, eval_version: "evals-2026-06",
    });
    const p = await resolvePrompt("boq.derive_lines", "boq.derive_lines@v1");
    expect(p.version).toBe(4);
    expect(p.ref).toBe("boq.derive_lines@v4");
    expect(p.registered).toBe(true);
    expect(p.evalVersion).toBe("evals-2026-06");
  });

  it("asks only for approved versions, highest first", async () => {
    await resolvePrompt("boq.derive_lines", "x@v1");
    expect(q1.mock.calls[0][0]).toMatch(/status = 'approved'/);
    expect(q1.mock.calls[0][0]).toMatch(/ORDER BY version DESC/);
  });

  it("falls back to the caller's ref when nothing is registered", async () => {
    // An unregistered task must keep running exactly as it did before the
    // registry existed. The registry adds provenance; it does not add a new way
    // for dispatch to fail.
    const p = await resolvePrompt("intake.capture", "intake.capture@v1");
    expect(p.ref).toBe("intake.capture@v1");
    expect(p.registered).toBe(false);
  });

  it("marks a fallback as unregistered, so the ledger records no false provenance", async () => {
    const p = await resolvePrompt("stage.run", "stage.run@v1");
    // The caller writes prompt_key only when this is true; a fallback must not
    // claim a registry version it never had.
    expect(p.registered).toBe(false);
  });

  it("falls back rather than throwing when the registry is unreachable", async () => {
    q1.mockRejectedValue(new Error("no such table"));
    const p = await resolvePrompt("boq.derive_lines", "boq.derive_lines@v1");
    expect(p.ref).toBe("boq.derive_lines@v1");
    expect(p.registered).toBe(false);
  });

  it("parses prompt_json whether the driver hands back a string or an object", async () => {
    q1.mockResolvedValue({
      prompt_key: "k", version: 1, prompt_json: '{"system":"S"}', prefix_hash: null, eval_version: null,
    });
    expect((await resolvePrompt("k", "k@v1")).prompt).toEqual({ system: "S" });
  });
});

describe("prefix drift", () => {
  it("hashes the system prefix", () => {
    expect(prefixHash({ system: "A" })).toBe(prefixHash({ system: "A" }));
    expect(prefixHash({ system: "A" })).not.toBe(prefixHash({ system: "A " }));
  });

  it("spots a prefix edited in place rather than versioned", () => {
    // Providers cache on an exact prefix match, so an in-place edit silently
    // discards the cache and multiplies the input cost of every call.
    const stored = prefixHash({ system: "original" });
    expect(prefixDrifted({
      key: "k", version: 1, ref: "k@v1", prompt: { system: "edited" },
      prefixHash: stored, evalVersion: null, registered: true,
    })).toBe(true);
  });

  it("does not cry drift over an unregistered prompt or a missing hash", () => {
    const base = { key: "k", version: 1, ref: "k@v1", prompt: { system: "x" }, evalVersion: null };
    expect(prefixDrifted({ ...base, prefixHash: null, registered: true })).toBe(false);
    expect(prefixDrifted({ ...base, prefixHash: "abc", registered: false })).toBe(false);
  });
});

describe("listing", () => {
  it("returns one row per task — the newest approved version", async () => {
    q.mockResolvedValue([
      { prompt_key: "a", version: 2, prompt_json: {}, prefix_hash: null, eval_version: null },
      { prompt_key: "b", version: 1, prompt_json: {}, prefix_hash: null, eval_version: null },
    ]);
    const all = await listApproved();
    expect(all.map((p) => p.ref)).toEqual(["a@v2", "b@v1"]);
  });

  it("returns nothing rather than throwing when the table is unreadable", async () => {
    q.mockRejectedValue(new Error("boom"));
    expect(await listApproved()).toEqual([]);
  });
});

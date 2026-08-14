// No path where invented construction quantities can pass as production output.
//
// The stub agents exist so the runtime can be exercised without model
// nondeterminism, and that is worth keeping. What was not acceptable is what the
// worker used to do on a Claude outage: return the stub as `status: "succeeded"`,
// indistinguishable from a real bill. Somebody prices work from that.
//
// These tests pin the rule rather than the implementation: in production, a
// failure is a failure.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeJobResult, stubPolicy } from "../worker/src/agents.mjs";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEMO_STUB_MODE;
  delete process.env.NODE_ENV;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** A minimal envelope — enough for the stub to build an output template. */
const envelope = (job_type = "boq.derive_lines") => ({
  job_id: "0192f000-0000-7000-8000-000000000abc",
  job_type,
  tier: "deep",
  inputs: { artifacts: [], params: {} },
});

describe("when a stub may answer", () => {
  it("permits it in development", () => {
    process.env.NODE_ENV = "development";
    expect(stubPolicy(process.env).allowed).toBe(true);
  });

  it("permits it in test, so the suite runs without a key", () => {
    process.env.NODE_ENV = "test";
    expect(stubPolicy(process.env).allowed).toBe(true);
  });

  it("refuses it in production", () => {
    process.env.NODE_ENV = "production";
    const p = stubPolicy(process.env);
    expect(p.allowed).toBe(false);
    expect(p.why).toMatch(/production/);
  });

  it("permits it in production only on an explicit opt-in", () => {
    // A demo box is a real thing. It has to be chosen, not inherited.
    process.env.NODE_ENV = "production";
    process.env.DEMO_STUB_MODE = "true";
    expect(stubPolicy(process.env).allowed).toBe(true);
  });

  it("treats anything other than the literal true as off", () => {
    process.env.NODE_ENV = "production";
    for (const v of ["1", "yes", "TRUE ", "", "false"]) {
      process.env.DEMO_STUB_MODE = v;
      const allowed = stubPolicy(process.env).allowed;
      expect(allowed, `DEMO_STUB_MODE=${JSON.stringify(v)}`).toBe(v.toLowerCase() === "true");
    }
  });
});

describe("production with no AI configured", () => {
  beforeEach(() => { process.env.NODE_ENV = "production"; });

  it("fails the job rather than inventing a bill", async () => {
    const r: any = await computeJobResult(envelope());
    expect(r.status).toBe("failed");
    expect(r.outputs).toBeUndefined();
  });

  it("says what is wrong, in terms someone can act on", async () => {
    const r: any = await computeJobResult(envelope());
    expect(r.error.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("does not bill for work nothing did", async () => {
    const r: any = await computeJobResult(envelope());
    expect(r.usage.cost_minor).toBe(0);
    expect(r.usage.input_tokens).toBe(0);
  });
});

describe("development with no AI configured", () => {
  beforeEach(() => { process.env.NODE_ENV = "development"; });

  it("still answers, so the runtime can be exercised", async () => {
    const r: any = await computeJobResult(envelope());
    expect(r.status).toBe("succeeded");
    expect(r.outputs).toBeDefined();
  });

  it("records that a stub produced it, not a model that never ran", async () => {
    // The old code reported "claude-opus-4-8" for stub output, which wrote a
    // real model name onto a fabricated job and made the two indistinguishable
    // in ai_job from then on.
    const r: any = await computeJobResult(envelope());
    expect(r.usage.model).toBe("stub:deterministic");
    expect(r.usage.model).not.toMatch(/claude/);
  });

  it("charges nothing for it", async () => {
    const r: any = await computeJobResult(envelope());
    expect(r.usage.cost_minor).toBe(0);
  });
});

describe("a demo box in production", () => {
  it("answers, and still marks the answer as a stub", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEMO_STUB_MODE = "true";
    const r: any = await computeJobResult(envelope());
    expect(r.status).toBe("succeeded");
    expect(r.usage.model).toBe("stub:deterministic");
  });
});

describe("across job types", () => {
  it("refuses uniformly in production — not only for the bill", async () => {
    process.env.NODE_ENV = "production";
    for (const jt of ["boq.derive_lines", "schedule.build_programme", "cost.price_lines", "risk.assess"]) {
      const r: any = await computeJobResult(envelope(jt));
      expect(r.status, jt).toBe("failed");
    }
  });
});

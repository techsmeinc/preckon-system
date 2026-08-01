import { describe, it, expect } from "vitest";
// @ts-expect-error — the worker is plain JS.
import { runBoqRoster } from "../worker/src/agents.mjs";

// The four-stage bill pipeline, driven by a scripted model so the orchestration
// is verifiable without spending a token: outline → Agent Designer → section
// specialists → Completeness Verifier.
//
// What these assert is the ORCHESTRATION, not the estimating: that the designed
// specialist actually reaches the agent pricing its division, that an empty
// division is retried rather than silently dropped, that a failed designer
// degrades instead of stopping the bill, and that a check which errors is
// reported as unknown rather than passed.

const env = {
  job_type: "boq.derive_lines",
  inputs: { params: { project_name: "Kennel Block C", documents: [] }, artifacts: [] },
};

const OUTLINE = JSON.stringify({
  sections: [
    { code: "1", title: "Preliminaries", trade: "Preliminaries" },
    { code: "2", title: "Turf & surfacing", trade: "External works" },
  ],
});

const ROSTER = JSON.stringify({
  projectType: "Outdoor Kennel Facility Repair",
  projectDescription: "Repair and resurfacing of an outdoor kennel block.",
  scopeAreas: ["Mobilisation", "Turf"],
  reasoning: "The scope is dominated by turf replacement.",
  specialists: [
    { key: "mobilisation", label: "Mobilisation Specialist", expertise: "site setup", vocabulary: [], measurementGuide: "lump sums", typicalItems: [], ownedSections: ["1"] },
    { key: "turf", label: "Synthetic Turf Specialist", expertise: "turf systems, shockpad and sub-base", vocabulary: ["shockpad", "infill"], measurementGuide: "m2 of laid area", typicalItems: ["Supply and lay turf"], ownedSections: ["2"] },
  ],
  verifierChecks: [
    { key: "sub-base", topic: "Turf sub-base preparation", description: "Confirm sub-base prep is priced", rationale: "SOW requires a compacted sub-base" },
    { key: "drainage", topic: "Kennel drainage falls", description: "Confirm drainage falls are priced", rationale: "SOW requires hose-down drainage" },
  ],
});

const line = (code: string, description: string) =>
  ({ type: "boq_line", payload: { code, description, quantity: 1, unit: "nr", trade: "t", notes: "n" } });

/**
 * A model that answers by matching on the system prompt, and hands the handler
 * BOTH prompts. Which check the verifier is auditing lives in the user message,
 * not the system one, so a system-only matcher cannot tell two checks apart.
 */
function scripted(handlers: Array<[RegExp, (system: string, user: string) => string]>) {
  const calls: string[] = [];
  const call = async (_model: string, system: string, user: string) => {
    calls.push(`${system}\n<<USER>>\n${user}`);
    for (const [re, fn] of handlers) if (re.test(system)) return fn(system, user ?? "");
    throw new Error("unscripted call: " + system.slice(0, 60));
  };
  return { call, calls };
}

const base: Array<[RegExp, (s: string, u: string) => string]> = [
  [/lead quantity surveyor reading a tender pack/, () => OUTLINE],
  [/principal construction consultant/, () => ROSTER],
  [/pricing ONE division/, (s) => JSON.stringify({ outputs: [line(/Turf/.test(s) ? "2.1" : "1.1", "priced work")] })],
  [/auditing a bill of quantities for ONE specific omission/, () => JSON.stringify({ covered: true, evidence: "line 2.1", outputs: [] })],
];

describe("multi-agent BOQ", () => {
  it("runs all four stages and hands each division its designed specialist", async () => {
    const { call, calls } = scripted(base);
    const { lines, roster } = await runBoqRoster(env, "m", call);

    expect(lines).toHaveLength(2);
    expect(roster.projectType).toBe("Outdoor Kennel Facility Repair");
    expect(roster.specialists).toHaveLength(2);

    // The turf division must have been priced BY the Synthetic Turf Specialist,
    // with its vocabulary — that is the whole point of designing a roster.
    const turfPrompt = calls.find((c) => /pricing ONE division.*"2 Turf/s.test(c));
    expect(turfPrompt).toBeTruthy();
    expect(turfPrompt).toContain("Synthetic Turf Specialist");
    expect(turfPrompt).toContain("shockpad");
    expect(turfPrompt).toContain("Outdoor Kennel Facility Repair");

    // …and preliminaries by the other one, not the turf specialist.
    const prelim = calls.find((c) => /pricing ONE division.*"1 Prelim/s.test(c));
    expect(prelim).toContain("Mobilisation Specialist");
    expect(prelim).not.toContain("shockpad");

    expect(roster.verdicts).toHaveLength(2);
    expect(roster.verdicts.every((v: any) => v.covered === true)).toBe(true);
    expect(roster.trace.map((t: any) => t.stage)).toEqual(
      expect.arrayContaining(["outline", "designer", "sections", "verifier"])
    );
  });

  it("prices the scope a check finds missing, and marks where it came from", async () => {
    const { call } = scripted([
      ...base.slice(0, 3),
      [/auditing a bill of quantities/, (_s, u) =>
        /sub-base/i.test(u)
          ? JSON.stringify({ covered: false, outputs: [line("2.9", "Compacted sub-base to turf area")] })
          : JSON.stringify({ covered: true, evidence: "already priced", outputs: [] })],
    ]);
    const { lines, roster } = await runBoqRoster(env, "m", call);

    const added = lines.find((l: any) => l.payload.code === "2.9");
    expect(added).toBeTruthy();
    expect(added.payload.verified_by).toBe("Turf sub-base preparation");
    expect(roster.verdicts.find((v: any) => v.key === "sub-base").covered).toBe(false);
  });

  it("retries a division that came back empty instead of leaving a hole", async () => {
    let turfAttempts = 0;
    const { call } = scripted([
      ...base.filter(([re]) => !/pricing ONE division/.test(String(re))),
      [/pricing ONE division/, (s) => {
        if (!/Turf/.test(s)) return JSON.stringify({ outputs: [line("1.1", "prelim")] });
        turfAttempts++;
        return turfAttempts === 1
          ? JSON.stringify({ outputs: [] })                       // first attempt fails
          : JSON.stringify({ outputs: [line("2.1", "turf")] });   // retry succeeds
      }],
    ]);
    const { lines } = await runBoqRoster(env, "m", call);
    expect(turfAttempts).toBe(2);
    expect(lines.map((l: any) => l.payload.code).sort()).toEqual(["1.1", "2.1"]);
  });

  it("still produces a bill when the designer fails", async () => {
    const { call } = scripted([
      [/lead quantity surveyor reading a tender pack/, () => OUTLINE],
      [/principal construction consultant/, () => { throw new Error("designer unavailable"); }],
      [/pricing ONE division/, () => JSON.stringify({ outputs: [line("1.1", "generic")] })],
    ]);
    const { lines, roster } = await runBoqRoster(env, "m", call);
    expect(lines.length).toBeGreaterThan(0);
    expect(roster.isFallback).toBe(true);
    // No roster means no checks — but the bill still got written.
    expect(roster.verdicts).toBeUndefined();
  });

  it("reports a check that errored as unknown, never as passed", async () => {
    const { call } = scripted([
      ...base.slice(0, 3),
      [/auditing a bill of quantities/, (_s, u) => {
        if (/sub-base/i.test(u)) throw new Error("provider overloaded");
        return JSON.stringify({ covered: true, evidence: "ok", outputs: [] });
      }],
    ]);
    const { roster } = await runBoqRoster(env, "m", call);
    const failed = roster.verdicts.find((v: any) => v.key === "sub-base");
    expect(failed.covered).toBeNull();
    expect(failed.evidence).toMatch(/check failed/);
  });

  it("refuses to invent a bill when the outline is empty", async () => {
    const { call } = scripted([[/lead quantity surveyor/, () => JSON.stringify({ sections: [] })]]);
    await expect(runBoqRoster(env, "m", call)).rejects.toThrow(/no work divisions/);
  });
});

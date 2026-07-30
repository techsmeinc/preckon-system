import { describe, expect, it } from "vitest";
import { ALL_PACKS, PACKS } from "@/lib/pack/registry";
import { validatePack } from "@/lib/pack/contract";

// The domain-neutrality proof: Core hosts ANY pack that satisfies the contract.
// This runs the resolver over every registered domain — no construction-specific
// assertions, just the generic contract. Adding a vertical adds a case here for free.
describe("domain packs conform to the Core contract", () => {
  it("registers the construction domain (the focused pitch vertical)", () => {
    expect(ALL_PACKS.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(PACKS)).toContain("construction");
  });

  for (const pack of ALL_PACKS) {
    describe(`domain: ${pack.key}`, () => {
      it("passes the resolver (validatePack) with no errors", () => {
        const errors = validatePack(pack as any);
        expect(errors, errors.join("\n")).toEqual([]);
      });

      it("declares the full contract shape", () => {
        expect(pack.key).toBeTruthy();
        expect((pack as any).modules.length).toBeGreaterThanOrEqual(1);
        expect(pack.artifactTypes.length).toBeGreaterThanOrEqual(1);
        expect(pack.agents.length).toBeGreaterThanOrEqual(1);
        expect(pack.workflows.length).toBeGreaterThanOrEqual(1);
        expect(pack.lifecycle?.transitions?.length).toBeGreaterThanOrEqual(1);
        expect(pack.roles.some((r) => r.key === "owner")).toBe(true);
      });

      it("has exactly one default supervisor persona", () => {
        const defaults = pack.personas.filter((p) => p.is_default);
        expect(defaults.length).toBe(1);
      });

      it("every workflow maps to a declared module", () => {
        const modules = new Set((pack as any).modules.map((m: any) => m.key));
        for (const w of pack.workflows) expect(modules.has(w.module_key)).toBe(true);
      });
    });
  }
});

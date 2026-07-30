import type { DomainPack } from "./contract";
import { DEFAULT_DOMAIN_KEY } from "../constants";
import { CONSTRUCTION_PACK } from "./construction";

// The compiled-in domain packs (§D.7 — first-party, no runtime loader). A tenant
// binds to one via tenant_bootstrap.domain_key; Core treats this map purely as
// data, keyed by domain, with no domain baked in. Focused on CONSTRUCTION for now
// (underwriting + the other verticals are parked — the engine still hosts any
// pack that satisfies the contract; add one import + one entry to bring it back).
export const PACKS: Record<string, DomainPack> = {
  construction: CONSTRUCTION_PACK as unknown as DomainPack,
};

export const ALL_PACKS = Object.values(PACKS);

/**
 * Resolve a pack by domain key. Unknown/legacy keys fall back to the configured
 * default domain, and finally to the first registered pack — so Core always has a
 * pack to run without hard-coding any single vertical.
 */
export function getPack(domainKey: string): DomainPack {
  return PACKS[domainKey] ?? PACKS[DEFAULT_DOMAIN_KEY] ?? ALL_PACKS[0];
}

/** Default licensed modules for a domain = the distinct module_keys of its workflows. */
export function defaultModulesFor(domainKey: string): string[] {
  const pack = getPack(domainKey);
  return [...new Set(pack.workflows.map((w) => w.module_key))];
}

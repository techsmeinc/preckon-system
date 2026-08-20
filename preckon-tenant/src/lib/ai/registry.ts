/**
 * Model registry — aliases, capabilities and rate cards.
 *
 * AI Fabric P-09: application code references `preckon-reasoning`, never
 * `claude-opus-4-8`. Today four files name concrete models, which means
 * replacing a model is a code change and a deploy rather than a configuration
 * change, and the blueprint's claim that "any individual base model can be
 * replaced" is not true of this codebase.
 *
 * ── WHY PRICES ARE DATA ──────────────────────────────────────────────────────
 *
 * §9.11 is explicit that provider prices are mutable configuration, not
 * architectural constants. A price compiled into a build is wrong the day the
 * provider changes it, and every cost report built on it is quietly wrong
 * afterwards — which is worse than having no report, because people trust it.
 *
 * ── RESOLUTION FAILS LOUDLY ──────────────────────────────────────────────────
 *
 * An unknown alias throws rather than falling back to a default. A silent
 * fallback means a typo routes production traffic to the wrong model and
 * nothing ever says so; the cost shows up on a bill weeks later.
 */

import type { Boundary } from "./policy";
import type { RateCard } from "./budget";

export type Capability =
  | "classification"
  | "extraction"
  | "construction_reasoning"
  | "structured_output"
  | "tool_calling"
  | "multimodal"
  | "hard_reasoning";

export interface ModelEntry {
  alias: string;
  /** The provider adapter to use. Never referenced by application code. */
  provider: string;
  /** The provider's own model identifier. Changes without any code change. */
  providerModel: string;
  boundary: Boundary;
  frontier?: boolean;
  capabilities: Capability[];
  contextLimit: number;
  rateCard: RateCard;
  /** Typical latency, for budget checks before a request runs. */
  typicalLatencyMs?: number;
  status: "approved" | "candidate" | "retired";
  /** Version of the evaluation that approved it, per §33's promotion rule. */
  evaluationVersion?: string;
  licence?: string;
}

export class UnknownModelAlias extends Error {
  constructor(alias: string, known: string[]) {
    super(`No model registered under the alias "${alias}". Known aliases: ${known.join(", ") || "none"}.`);
    this.name = "UnknownModelAlias";
  }
}

export class ModelRegistry {
  private readonly byAlias = new Map<string, ModelEntry>();

  constructor(entries: ModelEntry[] = []) {
    for (const e of entries) this.register(e);
  }

  register(entry: ModelEntry): void {
    this.byAlias.set(entry.alias, entry);
  }

  /** Every entry, including candidates and retired ones. */
  all(): ModelEntry[] {
    return [...this.byAlias.values()];
  }

  /** Only what may serve production traffic. */
  approved(): ModelEntry[] {
    return this.all().filter((e) => e.status === "approved");
  }

  has(alias: string): boolean {
    return this.byAlias.has(alias);
  }

  /**
   * Resolve an alias, or throw.
   *
   * Retired models resolve so historical usage rows can still be priced and
   * explained — a ledger entry naming a model nobody can look up is a hole in
   * the audit trail.
   */
  resolve(alias: string): ModelEntry {
    const e = this.byAlias.get(alias);
    if (!e) throw new UnknownModelAlias(alias, [...this.byAlias.keys()]);
    return e;
  }

  /** Approved models that can do this work, cheapest first. */
  capableOf(capability: Capability): ModelEntry[] {
    return this.approved()
      .filter((e) => e.capabilities.includes(capability))
      .sort((a, b) =>
        (a.rateCard.inputPerMillionMinor + a.rateCard.outputPerMillionMinor) -
        (b.rateCard.inputPerMillionMinor + b.rateCard.outputPerMillionMinor));
  }

  /**
   * The cheapest approved model that can do the work within the boundaries the
   * policy permits.
   *
   * Cheapest rather than best, deliberately: P-07 routes routine work to the
   * smallest model that meets the quality bar, and "best" is how a platform
   * spends frontier money on document classification.
   */
  cheapestFor(capability: Capability, boundaries: Boundary[]): ModelEntry | null {
    return this.capableOf(capability).find((e) => boundaries.includes(e.boundary)) ?? null;
  }
}

export interface RegistryIssue { alias: string; message: string }

/** Structural problems with a registry, checked before it is trusted. */
export function validateRegistry(entries: ModelEntry[]): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    if (seen.has(e.alias)) issues.push({ alias: e.alias, message: "Duplicate alias." });
    seen.add(e.alias);

    if (!e.providerModel) issues.push({ alias: e.alias, message: "No provider model set." });
    if (!e.capabilities.length) issues.push({ alias: e.alias, message: "No capabilities declared." });
    if (e.contextLimit <= 0) issues.push({ alias: e.alias, message: "Context limit must be positive." });

    for (const [k, v] of Object.entries(e.rateCard)) {
      if (typeof v === "number" && v < 0) {
        issues.push({ alias: e.alias, message: `Rate ${k} cannot be negative.` });
      }
    }

    // §33: a model cannot become an approved production alias until it has a
    // measured evaluation behind it. An approved model with no evaluation
    // version was promoted on somebody's judgement.
    if (e.status === "approved" && !e.evaluationVersion) {
      issues.push({ alias: e.alias, message: "Approved without an evaluation version." });
    }
  }

  return issues;
}

/**
 * The aliases application code is allowed to use.
 *
 * Kept as a list so a static test can assert no route names a concrete model —
 * the rule is only real if something checks it.
 */
export const PRECKON_ALIASES = [
  "preckon-small",
  "preckon-reasoning",
  "preckon-multimodal",
  "frontier-reasoning",
  "frontier-multimodal",
] as const;

export type PreckonAlias = (typeof PRECKON_ALIASES)[number];

export function isPreckonAlias(value: string): value is PreckonAlias {
  return (PRECKON_ALIASES as readonly string[]).includes(value);
}

/**
 * Map the existing tier names onto aliases.
 *
 * The codebase currently routes by tier — routing, standard, deep. Keeping that
 * vocabulary working means the alias layer can be adopted without rewriting
 * every caller in one change.
 */
export const TIER_ALIAS: Record<string, PreckonAlias> = {
  routing: "preckon-small",
  standard: "preckon-reasoning",
  deep: "frontier-reasoning",
};

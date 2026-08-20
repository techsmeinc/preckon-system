// The dispatch decision: which model, and may we call it at all.
//
// policy.ts, registry.ts and budget.ts each answered one question correctly and
// in isolation, and nothing imported any of them — so a policy nobody consulted
// and a budget nobody checked constrained nothing. This is the single place
// that asks all three, on the path every AI job takes.
//
// Deliberately pure: the caller supplies the policy, the registry and the spend
// so the whole matrix of decisions can be tested without a database. The DB
// seam is store.ts.
//
// ── On enforcement ───────────────────────────────────────────────────────────
//
// Turning this on as a blocker would, today, stop every job in production. The
// reason is worth stating plainly, because it is a finding rather than a bug:
//
//   - Anything unclassified is `confidential` (policy.ts's deliberate default).
//   - Under `saas`, confidential permits `local` and `preckon` — not `external`.
//   - Every job currently runs on Anthropic, which is a third party: `external`.
//
// So the declared policy and the deployed reality disagree. That disagreement
// is a decision for the business — classify project data as `internal`, or
// operate `preckon`-boundary inference, or narrow what the tenant may send —
// and not something to resolve by quietly loosening the defaults.
//
// Until it is resolved, this records what WOULD have been blocked instead of
// blocking it, and the ledger makes the gap countable. Set AI_POLICY_ENFORCE=1
// to make the same decision binding.

import {
  DEFAULT_SENSITIVITY, allowedBoundaries, eligibleModels,
  type Sensitivity, type TenantPolicy,
} from "./policy";
import { estimateCostMinor, checkLimits, type Spend, type TenantLimits } from "./budget";
import type { ModelEntry } from "./registry";

export interface DispatchInput {
  /** Alias the tier maps onto — see TIER_ALIAS in registry.ts. */
  alias: string;
  /** Everything the registry currently knows. May be empty on a fresh install. */
  registry: ModelEntry[];
  policy: TenantPolicy;
  policyVersion: number;
  sensitivity?: Sensitivity;
  /** The module asking, for the frontier deny rules. */
  module?: string;
  estimatedInputTokens: number;
  spend: Spend;
  /** The model to use when the registry has nothing — today's env-var mapping,
   *  so an unseeded registry degrades to current behaviour rather than to an
   *  outage. */
  fallbackModel: string;
  enforce: boolean;
}

export type DenialReason =
  | "boundary_not_permitted"
  | "model_not_registered"
  | "model_not_approved"
  | "frontier_denied"
  | "not_on_allowlist"
  | "budget_exceeded";

export interface DispatchDecision {
  alias: string;
  /** What the worker should actually call. */
  model: string;
  provider: string | null;
  boundary: string | null;
  sensitivity: Sensitivity;
  policyVersion: number;
  /** What the policy says. False does not mean blocked — see `blocked`. */
  permitted: boolean;
  /** Whether this decision actually stops the job. */
  blocked: boolean;
  reasons: DenialReason[];
  /** Human-readable, for the audit trail and the error a caller sees. */
  why: string;
  estimatedCostMinor: number;
  /** How the work will run, for the usage ledger's execution_class. */
  executionClass: "local" | "preckon" | "external" | "stub";
}

const CLASS_OF: Record<string, DispatchDecision["executionClass"]> = {
  local: "local",
  preckon: "preckon",
  external: "external",
};

/**
 * Decide, before a job is queued, whether it may run and on what.
 *
 * Order matters: eligibility is settled before cost. A request that the policy
 * forbids must not be reported as a budget problem, or the operator fixes the
 * wrong thing — and worse, raising the budget would appear to fix it.
 */
export function decideDispatch(input: DispatchInput): DispatchDecision {
  const sensitivity = input.sensitivity ?? DEFAULT_SENSITIVITY;
  const entry = input.registry.find((m) => m.alias === input.alias) ?? null;
  const reasons: DenialReason[] = [];

  // No registry yet: fall through to the env-var model rather than refusing.
  // A governance layer whose first act is to break the product does not get
  // adopted; it gets reverted.
  if (!entry) {
    return {
      alias: input.alias,
      model: input.fallbackModel,
      provider: null,
      boundary: null,
      sensitivity,
      policyVersion: input.policyVersion,
      permitted: true,
      blocked: false,
      reasons: ["model_not_registered"],
      why: `No registry entry for "${input.alias}"; using the configured model ${input.fallbackModel}.`,
      estimatedCostMinor: 0,
      executionClass: "external",
    };
  }

  const permittedBoundaries = allowedBoundaries(input.policy, sensitivity);
  const eligible = eligibleModels(
    [{ alias: entry.alias, boundary: entry.boundary, frontier: entry.frontier }],
    input.policy,
    sensitivity,
    input.module,
  );
  const isEligible = eligible.some((m) => m.alias === entry.alias);

  if (!isEligible) {
    if (!permittedBoundaries.includes(entry.boundary)) reasons.push("boundary_not_permitted");
    if (entry.frontier && input.policy.denyFrontierModules?.includes(input.module ?? "")) {
      reasons.push("frontier_denied");
    }
    if (input.policy.modelAllowlist && !input.policy.modelAllowlist.includes(entry.alias)) {
      reasons.push("not_on_allowlist");
    }
    if (!reasons.length) reasons.push("boundary_not_permitted");
  }
  if (entry.status !== "approved") reasons.push("model_not_approved");

  const estimatedCostMinor = estimateCostMinor(
    input.estimatedInputTokens,
    { maxCostMinor: input.policy.budgets?.singleRequestUsdMinor },
    entry.rateCard,
  );

  // Cost is only consulted once eligibility passes, so the reported cause is
  // always the first thing that actually stops the request.
  if (!reasons.length) {
    const limits: TenantLimits = {
      dailyUsdMinor: input.policy.budgets?.dailyUsdMinor,
      projectMonthlyUsdMinor: input.policy.budgets?.projectMonthlyUsdMinor,
      singleRequestUsdMinor: input.policy.budgets?.singleRequestUsdMinor,
    };
    const limit = checkLimits(estimatedCostMinor, input.spend, limits);
    if (!limit.allowed) reasons.push("budget_exceeded");
  }

  const permitted = reasons.length === 0;
  return {
    alias: entry.alias,
    model: entry.providerModel,
    provider: entry.provider,
    boundary: entry.boundary,
    sensitivity,
    policyVersion: input.policyVersion,
    permitted,
    blocked: !permitted && input.enforce,
    reasons,
    why: permitted
      ? `Permitted: ${entry.alias} (${entry.boundary}) for ${sensitivity} data.`
      : explain(reasons, entry, sensitivity, permittedBoundaries),
    estimatedCostMinor,
    executionClass: CLASS_OF[entry.boundary] ?? "external",
  };
}

function explain(
  reasons: DenialReason[], entry: ModelEntry, sensitivity: Sensitivity, permitted: string[],
): string {
  const parts = reasons.map((r) => {
    switch (r) {
      case "boundary_not_permitted":
        return `${sensitivity} data may only go to [${permitted.join(", ") || "nothing"}], but ${entry.alias} is ${entry.boundary}`;
      case "model_not_approved":
        return `${entry.alias} is ${entry.status}, not approved`;
      case "frontier_denied":
        return `${entry.alias} is a frontier model and this module may not escalate`;
      case "not_on_allowlist":
        return `${entry.alias} is not on the tenant's model allowlist`;
      case "budget_exceeded":
        return "the tenant's AI budget is exhausted";
      default:
        return r;
    }
  });
  return parts.join("; ") + ".";
}

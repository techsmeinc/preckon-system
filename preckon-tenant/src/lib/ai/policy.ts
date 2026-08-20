/**
 * Tenant AI policy and data sensitivity.
 *
 * This is the gate that makes Preckon Private AI and Preckon Sovereign AI
 * sellable products rather than slides. Until now nothing in the platform knew
 * that some data must not leave a boundary, so nothing could stop a tender
 * price being sent to an external model — not because anyone decided it was
 * acceptable, but because the question was never asked.
 *
 * ── P-08: DATA POLICY OVERRIDES MODEL QUALITY ────────────────────────────────
 *
 * The AI Fabric blueprint states it plainly: a model is ineligible if the
 * tenant's policy or the data's classification does not permit that deployment
 * boundary, however much better that model is. Eligibility is therefore decided
 * BEFORE any scoring, and a model that fails it cannot win on quality.
 *
 * That ordering is the whole design. A router that scores first and filters
 * afterwards will eventually leak, because someone will add a fast path.
 *
 * ── WHY DENY IS THE DEFAULT ──────────────────────────────────────────────────
 *
 * An unclassified document is treated as `confidential`, not as `public`. On a
 * construction project the unclassified thing is usually the tender pricing
 * somebody uploaded without thinking, and the cost of being wrong is asymmetric:
 * over-restricting sends a job to a private model, under-restricting sends a
 * client's commercial position to a third party.
 */

/** How restricted a piece of data is. Ordered, least to most. */
export const SENSITIVITY_ORDER = ["public", "internal", "confidential", "restricted"] as const;
export type Sensitivity = (typeof SENSITIVITY_ORDER)[number];

/** Where a model runs. */
export type Boundary =
  /** Inside the tenant's own deployment. */
  | "local"
  /** Preckon-operated infrastructure, shared. */
  | "preckon"
  /** A third-party provider. */
  | "external";

export type DeploymentMode = "saas" | "private" | "sovereign";

export interface SensitivityRule {
  /** Boundaries permitted for this classification. */
  allow: Boundary[];
}

export interface TenantPolicy {
  deploymentMode: DeploymentMode;
  /** Per-classification boundary rules. Absent classifications fall back. */
  sensitivity?: Partial<Record<Sensitivity, SensitivityRule>>;
  /** Modules whose work may never escalate to a frontier model. */
  denyFrontierModules?: string[];
  /** If present, only these model aliases may be used at all. */
  modelAllowlist?: string[];
  budgets?: {
    dailyUsdMinor?: number;
    projectMonthlyUsdMinor?: number;
    singleRequestUsdMinor?: number;
  };
  /** Whether the provider may retain request content for its own purposes. */
  allowProviderLogging?: boolean;
  version?: number;
}

/** Anything unclassified is treated as confidential. See the header. */
export const DEFAULT_SENSITIVITY: Sensitivity = "confidential";

/**
 * What a deployment mode permits before the tenant narrows it further.
 *
 * Sovereign denies external at every classification including public — the
 * promise is "no mandatory external AI or data egress", and a mode that leaked
 * public data to a third party would not be sovereign in any sense a customer
 * would accept.
 */
export const MODE_DEFAULTS: Record<DeploymentMode, Record<Sensitivity, Boundary[]>> = {
  saas: {
    public: ["local", "preckon", "external"],
    internal: ["local", "preckon", "external"],
    confidential: ["local", "preckon"],
    restricted: ["local"],
  },
  private: {
    public: ["local", "preckon", "external"],
    internal: ["local", "preckon"],
    confidential: ["local"],
    restricted: ["local"],
  },
  sovereign: {
    public: ["local"],
    internal: ["local"],
    confidential: ["local"],
    restricted: ["local"],
  },
};

export function normaliseSensitivity(value: unknown): Sensitivity {
  const v = String(value ?? "").trim().toLowerCase();
  return (SENSITIVITY_ORDER as readonly string[]).includes(v) ? (v as Sensitivity) : DEFAULT_SENSITIVITY;
}

/** True when `a` is at least as restricted as `b`. */
export function atLeastAsRestricted(a: Sensitivity, b: Sensitivity): boolean {
  return SENSITIVITY_ORDER.indexOf(a) >= SENSITIVITY_ORDER.indexOf(b);
}

/**
 * The most restricted classification in a set.
 *
 * A request carrying one restricted document and forty public ones is a
 * restricted request. Averaging, or taking the majority, produces a boundary
 * decision that permits exactly the leak the classification existed to prevent.
 */
export function effectiveSensitivity(values: unknown[]): Sensitivity {
  if (!values.length) return DEFAULT_SENSITIVITY;
  return values
    .map(normaliseSensitivity)
    .reduce((worst, s) => (atLeastAsRestricted(s, worst) ? s : worst), SENSITIVITY_ORDER[0]);
}

/** Boundaries this policy permits for this classification. */
export function allowedBoundaries(policy: TenantPolicy, sensitivity: Sensitivity): Boundary[] {
  const modeAllows = MODE_DEFAULTS[policy.deploymentMode][sensitivity];
  const tenantRule = policy.sensitivity?.[sensitivity];
  if (!tenantRule) return modeAllows;

  // The tenant may only narrow, never widen. A policy that could widen its own
  // deployment mode would make the mode meaningless — a sovereign install could
  // configure itself back into calling a third party.
  return modeAllows.filter((b) => tenantRule.allow.includes(b));
}

export interface ModelCandidate {
  alias: string;
  boundary: Boundary;
  /** Marks a frontier/escalation model for the module-level deny rules. */
  frontier?: boolean;
}

export interface EligibilityRequest {
  sensitivity: Sensitivity;
  module?: string;
  /** Estimated cost in minor units, when known. */
  estimatedCostMinor?: number;
}

export interface Eligibility {
  eligible: ModelCandidate[];
  rejected: { alias: string; reason: string }[];
  /** Boundaries this request may use at all. */
  boundaries: Boundary[];
  why: string;
}

/**
 * Which models this request may use.
 *
 * Returns the rejections as well as the survivors, because "the good model was
 * not used" is a question somebody asks, and "policy" is not an answer. Each
 * rejection carries the rule that produced it.
 */
export function eligibleModels(
  policy: TenantPolicy, candidates: ModelCandidate[], req: EligibilityRequest,
): Eligibility {
  const boundaries = allowedBoundaries(policy, req.sensitivity);
  const eligible: ModelCandidate[] = [];
  const rejected: { alias: string; reason: string }[] = [];

  for (const c of candidates) {
    if (policy.modelAllowlist?.length && !policy.modelAllowlist.includes(c.alias)) {
      rejected.push({ alias: c.alias, reason: "Not on this tenant's model allowlist." });
      continue;
    }

    if (!boundaries.includes(c.boundary)) {
      rejected.push({
        alias: c.alias,
        reason: `${req.sensitivity} data may not go to a ${c.boundary} model under a ${policy.deploymentMode} deployment.`,
      });
      continue;
    }

    if (c.frontier && req.module && policy.denyFrontierModules?.includes(req.module)) {
      rejected.push({ alias: c.alias, reason: `Frontier escalation is denied for ${req.module}.` });
      continue;
    }

    eligible.push(c);
  }

  const why = eligible.length
    ? `${eligible.length} of ${candidates.length} models may handle ${req.sensitivity} data here (${boundaries.join(", ")}).`
    : `No approved model may handle ${req.sensitivity} data under a ${policy.deploymentMode} deployment. The request cannot run as asked.`;

  return { eligible, rejected, boundaries, why };
}

/**
 * Whether provider-side logging is permitted.
 *
 * Separate from boundary because they are different promises: a customer can
 * accept a request reaching an external model while refusing that model's
 * operator to retain the content. Defaults to denied.
 */
export function providerLoggingAllowed(policy: TenantPolicy): boolean {
  return policy.allowProviderLogging === true;
}

/** A safe starting policy for a tenant that has not configured one. */
export function defaultPolicy(mode: DeploymentMode = "saas"): TenantPolicy {
  return {
    deploymentMode: mode,
    allowProviderLogging: false,
    budgets: { singleRequestUsdMinor: 100 },
    version: 1,
  };
}

export interface PolicyIssue { field: string; message: string }

/** Structural problems with a policy, checked before it is stored. */
export function validatePolicy(policy: TenantPolicy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];

  if (!MODE_DEFAULTS[policy.deploymentMode]) {
    issues.push({ field: "deploymentMode", message: `Unknown deployment mode "${policy.deploymentMode}".` });
    return issues;
  }

  for (const [key, rule] of Object.entries(policy.sensitivity ?? {})) {
    const s = key as Sensitivity;
    if (!(SENSITIVITY_ORDER as readonly string[]).includes(s)) {
      issues.push({ field: `sensitivity.${key}`, message: `Unknown classification "${key}".` });
      continue;
    }
    const widened = (rule?.allow ?? []).filter((b) => !MODE_DEFAULTS[policy.deploymentMode][s].includes(b));
    if (widened.length) {
      // Reported rather than silently ignored: an administrator who thinks they
      // enabled external access needs to be told they did not.
      issues.push({
        field: `sensitivity.${key}`,
        message: `A ${policy.deploymentMode} deployment does not permit ${widened.join(", ")} for ${key} data; this rule cannot widen it.`,
      });
    }
  }

  for (const [k, v] of Object.entries(policy.budgets ?? {})) {
    if (typeof v === "number" && v < 0) {
      issues.push({ field: `budgets.${k}`, message: "A budget cannot be negative." });
    }
  }

  return issues;
}

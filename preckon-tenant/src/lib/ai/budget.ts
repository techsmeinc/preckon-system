/**
 * Budgets — token, cost and latency ceilings on every AI request.
 *
 * AI Fabric §21: every request carries four budgets and the router rejects or
 * re-routes when one would be exceeded. The blueprint is explicit that silently
 * spending past a configured limit is not an option, and until now there were no
 * limits to exceed.
 *
 * ── ESTIMATE BEFORE, MEASURE AFTER ───────────────────────────────────────────
 *
 * A budget checked only after the fact is an invoice, not a control. The
 * estimate here is deliberately conservative — it assumes the output budget is
 * spent in full, because a model that stops early costs less than predicted and
 * one that runs long is exactly the case the ceiling exists for.
 *
 * ── EXCEEDING A BUDGET IS A ROUTE, NOT AN ERROR ──────────────────────────────
 *
 * §21 lists what to do when a request is too expensive: reduce context, use a
 * cheaper model, split it, serve from cache, batch it, or ask for authorisation.
 * Failing outright is the last of those, not the first, so this returns the
 * options rather than throwing.
 */

export interface Budget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /** Minor units (fils, cents) to keep money in integers. */
  maxCostMinor?: number;
  maxLatencyMs?: number;
  /** Whether escalation to a frontier model is permitted at all. */
  allowFrontier?: boolean;
}

export interface RateCard {
  /** Minor units per million input tokens. */
  inputPerMillionMinor: number;
  outputPerMillionMinor: number;
  /** Discounted rate for cached input, when the provider offers one. */
  cachedInputPerMillionMinor?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Cost of a given usage under a rate card, in minor units.
 *
 * Rounded up. Under-reporting a fraction of a fil per call is harmless once and
 * material across a million calls, and the direction of the error should never
 * favour the estimate looking cheap.
 */
export function costMinor(usage: Usage, card: RateCard): number {
  const cached = Math.max(0, usage.cachedInputTokens ?? 0);
  const fresh = Math.max(0, usage.inputTokens - cached);
  const cachedRate = card.cachedInputPerMillionMinor ?? card.inputPerMillionMinor;

  const total =
    (fresh / 1_000_000) * card.inputPerMillionMinor +
    (cached / 1_000_000) * cachedRate +
    (Math.max(0, usage.outputTokens) / 1_000_000) * card.outputPerMillionMinor;

  return Math.ceil(total);
}

/**
 * What a request is expected to cost before it runs.
 *
 * Assumes the full output budget is spent — see the header.
 */
export function estimateCostMinor(inputTokens: number, budget: Budget, card: RateCard): number {
  return costMinor(
    { inputTokens, outputTokens: budget.maxOutputTokens ?? 0 },
    card,
  );
}

export type Remedy =
  | "reduce_context"
  | "cheaper_model"
  | "split_task"
  | "serve_from_cache"
  | "send_to_batch"
  | "require_authorisation"
  | "reject";

export interface BudgetCheck {
  withinBudget: boolean;
  estimatedCostMinor: number;
  /** Which ceilings would be broken. */
  exceeded: ("input_tokens" | "output_tokens" | "cost" | "latency")[];
  /** In the order §21 recommends trying them. */
  remedies: Remedy[];
  why: string;
}

/**
 * Whether this request fits, and what to do if it does not.
 *
 * `expectedLatencyMs` is optional because latency is frequently unknown until a
 * model is chosen; an unknown latency is not treated as a breach, since guessing
 * would reject work that would have completed comfortably.
 */
export function checkBudget(
  inputTokens: number, budget: Budget, card: RateCard, expectedLatencyMs?: number,
): BudgetCheck {
  const exceeded: BudgetCheck["exceeded"] = [];
  const estimated = estimateCostMinor(inputTokens, budget, card);

  if (budget.maxInputTokens != null && inputTokens > budget.maxInputTokens) exceeded.push("input_tokens");
  if (budget.maxCostMinor != null && estimated > budget.maxCostMinor) exceeded.push("cost");
  if (budget.maxLatencyMs != null && expectedLatencyMs != null && expectedLatencyMs > budget.maxLatencyMs) {
    exceeded.push("latency");
  }

  const remedies: Remedy[] = [];
  if (exceeded.includes("input_tokens") || exceeded.includes("cost")) {
    remedies.push("serve_from_cache", "reduce_context", "cheaper_model", "split_task");
  }
  if (exceeded.includes("latency")) {
    remedies.push("cheaper_model", "send_to_batch");
  }
  if (exceeded.includes("cost")) {
    remedies.push("require_authorisation");
  }
  if (exceeded.length) remedies.push("reject");

  const why = !exceeded.length
    ? `Within budget: about ${estimated} minor units for ${inputTokens} input tokens.`
    : `Would exceed ${exceeded.join(" and ")}. Estimated ${estimated} minor units against a ceiling of ${budget.maxCostMinor ?? "none"}.`;

  return {
    withinBudget: exceeded.length === 0,
    estimatedCostMinor: estimated,
    exceeded,
    remedies: [...new Set(remedies)],
    why,
  };
}

export interface Spend {
  todayMinor: number;
  projectMonthMinor: number;
}

export interface TenantLimits {
  dailyUsdMinor?: number;
  projectMonthlyUsdMinor?: number;
  singleRequestUsdMinor?: number;
}

export interface LimitCheck {
  allowed: boolean;
  breached: ("daily" | "project_monthly" | "single_request")[];
  why: string;
}

/**
 * Whether a tenant may spend this much right now.
 *
 * Checked against spend already recorded, which is why the per-attempt ledger
 * matters: a limit measured against under-counted spend permits more than the
 * customer agreed to, and the gap grows with every retry.
 */
export function checkLimits(cost: number, spend: Spend, limits: TenantLimits): LimitCheck {
  const breached: LimitCheck["breached"] = [];

  if (limits.singleRequestUsdMinor != null && cost > limits.singleRequestUsdMinor) {
    breached.push("single_request");
  }
  if (limits.dailyUsdMinor != null && spend.todayMinor + cost > limits.dailyUsdMinor) {
    breached.push("daily");
  }
  if (limits.projectMonthlyUsdMinor != null && spend.projectMonthMinor + cost > limits.projectMonthlyUsdMinor) {
    breached.push("project_monthly");
  }

  const why = !breached.length
    ? "Within the tenant's limits."
    : breached.includes("single_request")
      ? `This one request costs ${cost} against a per-request ceiling of ${limits.singleRequestUsdMinor}.`
      : breached.includes("daily")
        ? `Today's spend would reach ${spend.todayMinor + cost} against a daily ceiling of ${limits.dailyUsdMinor}.`
        : `This project's month would reach ${spend.projectMonthMinor + cost} against a ceiling of ${limits.projectMonthlyUsdMinor}.`;

  return { allowed: breached.length === 0, breached, why };
}

/**
 * Clamp a caller's requested budget to what the tenant permits.
 *
 * A module asking for a bigger budget than the tenant allows gets the tenant's
 * number, silently and always. The alternative — refusing — turns a policy
 * tightening into an outage across every module that asked for more.
 */
export function clampToLimits(budget: Budget, limits: TenantLimits): Budget {
  if (limits.singleRequestUsdMinor == null) return budget;
  return {
    ...budget,
    maxCostMinor: Math.min(budget.maxCostMinor ?? limits.singleRequestUsdMinor, limits.singleRequestUsdMinor),
  };
}

/** Default budgets per task class, in the absence of anything more specific. */
export const TASK_BUDGETS: Record<string, Budget> = {
  classification: { maxInputTokens: 4_000, maxOutputTokens: 150, maxLatencyMs: 10_000, allowFrontier: false },
  extraction: { maxInputTokens: 12_000, maxOutputTokens: 1_500, maxLatencyMs: 30_000, allowFrontier: false },
  reasoning: { maxInputTokens: 24_000, maxOutputTokens: 3_000, maxLatencyMs: 60_000, allowFrontier: true },
  narrative: { maxInputTokens: 16_000, maxOutputTokens: 4_000, maxLatencyMs: 90_000, allowFrontier: true },
};

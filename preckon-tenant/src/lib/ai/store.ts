// Where the governance tables meet the governance code.
//
// Migration 021 created ai_tenant_policy, ai_model_registry and
// ai_usage_ledger; the modules beside this file knew how to reason about all
// three and had no way to read or write any of them. This is that seam, and
// nothing more — the decisions live in govern.ts, which stays pure.
//
// Every read degrades to a safe default rather than throwing. The governance
// layer sits on the path of every AI job, so a missing table or an empty
// registry has to mean "carry on as before", not "the product is down". The
// alternative was learned the hard way elsewhere in this codebase: a strict
// layer added underneath working software fails closed and takes the feature
// with it.

import { query } from "../db";
import { newId } from "../ids";
import { logWarn } from "../log";
import { defaultPolicy, type TenantPolicy } from "./policy";
import type { ModelEntry } from "./registry";
import type { Spend } from "./budget";

/** MySQL JSON arrives parsed on some drivers and as text on others. */
function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

export interface LoadedPolicy {
  policy: TenantPolicy;
  version: number;
}

/**
 * A tenant's AI policy, or the deployment default.
 *
 * A tenant with no row is not misconfigured — it has simply never narrowed
 * anything, so it gets its mode's defaults. That is the same answer
 * defaultPolicy() gives, which keeps "no policy" and "default policy" from
 * being two subtly different states.
 */
export async function loadTenantPolicy(tenantId: string): Promise<LoadedPolicy> {
  try {
    const rows = await query<any>(
      `SELECT policy_version, deployment_mode, policy_json
         FROM ai_tenant_policy WHERE tenant_id = ?`,
      [tenantId],
    );
    const row = rows[0];
    if (!row) return { policy: defaultPolicy("saas"), version: 0 };
    const stored = asJson<Partial<TenantPolicy>>(row.policy_json, {});
    return {
      policy: { ...defaultPolicy(row.deployment_mode ?? "saas"), ...stored,
                deploymentMode: row.deployment_mode ?? stored.deploymentMode ?? "saas" },
      version: Number(row.policy_version ?? 0),
    };
  } catch (e) {
    logWarn("ai.policy.load_failed", { tenantId, error: String(e) });
    return { policy: defaultPolicy("saas"), version: 0 };
  }
}

/** Every approved and candidate model. Empty is a valid answer. */
export async function loadRegistry(): Promise<ModelEntry[]> {
  try {
    const rows = await query<any>(
      `SELECT alias, provider, provider_model, boundary, is_frontier, capabilities_json,
              context_limit, rate_card_json, typical_latency_ms, licence,
              evaluation_version, status
         FROM ai_model_registry WHERE status <> 'retired'`,
    );
    return rows.map((r) => ({
      alias: r.alias,
      provider: r.provider,
      providerModel: r.provider_model,
      boundary: r.boundary,
      frontier: !!r.is_frontier,
      capabilities: asJson(r.capabilities_json, []),
      contextLimit: Number(r.context_limit ?? 0),
      rateCard: asJson(r.rate_card_json, { inputPerMillionMinor: 0, outputPerMillionMinor: 0 }),
      typicalLatencyMs: r.typical_latency_ms ?? undefined,
      licence: r.licence ?? undefined,
      evaluationVersion: r.evaluation_version ?? undefined,
      status: r.status,
    })) as ModelEntry[];
  } catch (e) {
    logWarn("ai.registry.load_failed", { error: String(e) });
    return [];
  }
}

/**
 * What the tenant has spent, from the ledger.
 *
 * Deliberately read from ai_usage_ledger and not ai_job: the ledger has one row
 * per ATTEMPT, so a limit measured against it counts retries. ai-cost.ts still
 * reads ai_job and therefore under-counts, which is exactly the gap this table
 * was created to close.
 */
export async function spendFor(tenantId: string, projectId?: string | null): Promise<Spend> {
  try {
    const rows = await query<any>(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN cost_minor END), 0) AS today,
         COALESCE(SUM(CASE WHEN created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                            AND (? IS NULL OR project_id = ?) THEN cost_minor END), 0) AS month
       FROM ai_usage_ledger
       WHERE tenant_id = ?`,
      [projectId ?? null, projectId ?? null, tenantId],
    );
    return {
      todayMinor: Number(rows[0]?.today ?? 0),
      projectMonthMinor: Number(rows[0]?.month ?? 0),
    };
  } catch (e) {
    logWarn("ai.spend.load_failed", { tenantId, error: String(e) });
    return { todayMinor: 0, projectMonthMinor: 0 };
  }
}

export interface UsageRow {
  tenantId: string;
  projectId?: string | null;
  jobId?: string | null;
  requestId?: string | null;
  attempt?: number;
  module?: string | null;
  taskType?: string | null;
  executionClass: "deterministic" | "cache" | "local" | "preckon" | "external" | "stub";
  modelAlias?: string | null;
  provider?: string | null;
  providerModel?: string | null;
  sensitivity?: string | null;
  policyVersion?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  costMinor?: number;
  latencyMs?: number;
  cacheHit?: boolean;
  outcome: "succeeded" | "failed" | "rejected" | "cancelled";
  errorCode?: string | null;
}

/**
 * Append one attempt to the ledger.
 *
 * Never throws. Metering must not be able to fail the work it is metering — a
 * job that succeeded and then failed because its accounting row would not
 * insert would be the worst of both outcomes.
 */
export async function recordUsage(row: UsageRow): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_usage_ledger
         (id, tenant_id, project_id, job_id, request_id, attempt, module, task_type,
          execution_class, model_alias, provider, provider_model, sensitivity, policy_version,
          input_tokens, output_tokens, cost_minor, latency_ms, cache_hit, outcome, error_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newId(), row.tenantId, row.projectId ?? null, row.jobId ?? null, row.requestId ?? null,
        row.attempt ?? 1, row.module ?? null, row.taskType ?? null,
        row.executionClass, row.modelAlias ?? null, row.provider ?? null, row.providerModel ?? null,
        row.sensitivity ?? null, row.policyVersion ?? null,
        row.inputTokens ?? 0, row.outputTokens ?? 0, row.costMinor ?? 0, row.latencyMs ?? 0,
        row.cacheHit ? 1 : 0, row.outcome, row.errorCode ?? null,
      ],
    );
  } catch (e) {
    logWarn("ai.usage.record_failed", { jobId: row.jobId, error: String(e) });
  }
}

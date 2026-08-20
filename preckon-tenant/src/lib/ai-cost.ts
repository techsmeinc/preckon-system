/**
 * What the AI cost, and where it went.
 *
 * `ai_job` has recorded tokens and cost per job since the beginning; nothing
 * ever added them up. So the question "what does a project cost to run" — which
 * decides pricing, margin and whether a customer is affordable — had no answer
 * short of a database session.
 *
 * ── WHY THIS IS A PRODUCT CONCERN, NOT AN OPS ONE ────────────────────────────
 *
 * A tender with four hundred BOQ lines and a vision pass over thirteen drawings
 * is a different unit of cost from a small refurbishment, and the difference is
 * an order of magnitude rather than a percentage. Priced as one thing, the large
 * projects are sold at a loss and nobody sees it until the invoice. That makes
 * cost-per-project a number the product must expose, not a graph on an ops
 * dashboard.
 *
 * ── THE STUB CAVEAT ──────────────────────────────────────────────────────────
 *
 * Stub jobs report model "stub:deterministic" and zero cost, so a demo box does
 * not manufacture a spend figure. They are counted separately rather than
 * dropped: a project whose jobs were mostly stubs has a REAL cost of nearly
 * nothing and a PROJECTED cost that is quite different, and confusing the two
 * would be its own kind of wrong.
 */

import { query } from "./db";

/** Minor units — cents/fils — as stored. Formatting is the caller's business. */
export interface CostRow {
  key: string;
  label: string;
  jobs: number;
  /** Jobs answered by the deterministic stub: zero cost, and not a forecast. */
  stubJobs: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costMinor: number;
}

export interface CostSummary {
  totalCostMinor: number;
  totalJobs: number;
  stubJobs: number;
  failedJobs: number;
  /** Cost of the jobs that actually ran, per job. Stubs excluded — they would
   *  drag the average toward zero and make a demo box look cheap to operate. */
  meanCostMinorPerRealJob: number;
  rows: CostRow[];
}


/**
 * Where cost is counted from.
 *
 * ai_job carries only the LATEST usage for a job, so a job that failed twice
 * and then succeeded reported one attempt's cost and the two failures were
 * free. ai_usage_ledger has one row per attempt, which is what it was created
 * for, and reading it is the whole point of having written it.
 *
 * But the ledger starts empty — it was added on 20 Aug 2026 and holds nothing
 * before that. Reading it alone would erase every previous month from the cost
 * report, so this unions the two and takes ai_job only for jobs the ledger has
 * never seen. Going forward the ledger wins and retries are counted; looking
 * back, the history is still there.
 */
const SOURCE = `(
  SELECT tenant_id, project_id,
         module        AS agent_key,
         task_type     AS job_type,
         COALESCE(provider_model, model_alias) AS model,
         outcome       AS status,
         execution_class,
         input_tokens, output_tokens, cost_minor,
         created_at    AS queued_at
    FROM ai_usage_ledger
  UNION ALL
  SELECT j.tenant_id, j.project_id, j.agent_key, j.job_type, j.model, j.status,
         CASE WHEN j.model = 'stub:deterministic' THEN 'stub' ELSE 'external' END,
         j.input_tokens, j.output_tokens, j.cost_minor, j.queued_at
    FROM ai_job j
   WHERE NOT EXISTS (
     SELECT 1 FROM ai_usage_ledger l
      WHERE l.job_id = j.id AND l.tenant_id = j.tenant_id
   )
) AS usage`

const SELECT = `
  COUNT(*) AS jobs,
  SUM(CASE WHEN execution_class = 'stub' OR model = 'stub:deterministic' THEN 1 ELSE 0 END) AS stub_jobs,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
  COALESCE(SUM(input_tokens), 0)  AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(cost_minor), 0)    AS cost_minor`;

type Raw = {
  key: string | null;
  jobs: number;
  stub_jobs: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  cost_minor: number;
};

const toRow = (r: Raw, label?: string): CostRow => ({
  key: r.key ?? "(none)",
  label: label ?? r.key ?? "(none)",
  jobs: Number(r.jobs),
  stubJobs: Number(r.stub_jobs),
  failed: Number(r.failed),
  inputTokens: Number(r.input_tokens),
  outputTokens: Number(r.output_tokens),
  costMinor: Number(r.cost_minor),
});

function summarise(rows: CostRow[]): CostSummary {
  const totalJobs = rows.reduce((n, r) => n + r.jobs, 0);
  const stubJobs = rows.reduce((n, r) => n + r.stubJobs, 0);
  const totalCostMinor = rows.reduce((n, r) => n + r.costMinor, 0);
  const realJobs = totalJobs - stubJobs;
  return {
    totalCostMinor,
    totalJobs,
    stubJobs,
    failedJobs: rows.reduce((n, r) => n + r.failed, 0),
    meanCostMinorPerRealJob: realJobs > 0 ? Math.round(totalCostMinor / realJobs) : 0,
    rows,
  };
}

export type Grouping = "project" | "agent" | "job_type" | "model" | "day";

const GROUP_SQL: Record<Grouping, string> = {
  project: "project_id",
  agent: "agent_key",
  job_type: "job_type",
  model: "COALESCE(model, '(unrecorded)')",
  day: "DATE(queued_at)",
};

/**
 * Spend for one tenant over a window, grouped.
 *
 * Windowed on `queued_at` rather than `ended_at`: a job that never came back is
 * still work somebody paid for, and dropping it would quietly understate the
 * months with the most failures — exactly the months worth looking at.
 */
export async function costByTenant(
  tenantId: string,
  opts: { since?: Date; until?: Date; groupBy?: Grouping; projectId?: string } = {},
): Promise<CostSummary> {
  const group = GROUP_SQL[opts.groupBy ?? "project"];
  const where: string[] = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];

  if (opts.projectId) {
    where.push("project_id = ?");
    params.push(opts.projectId);
  }
  if (opts.since) {
    where.push("queued_at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    where.push("queued_at < ?");
    params.push(opts.until);
  }

  const rows = await query<Raw>(
    `SELECT ${group} AS \`key\`, ${SELECT}
       FROM ${SOURCE}
      WHERE ${where.join(" AND ")}
      GROUP BY ${group}
      ORDER BY cost_minor DESC
      LIMIT 500`,
    params,
  );
  return summarise(rows.map((r) => toRow(r)));
}

/**
 * Tenants over a ceiling in a window.
 *
 * The alert the plan asks for. Deliberately a query rather than a background
 * watcher: a threshold crossed at 3am matters at 9am, and a poller is another
 * moving part that can be down without anybody noticing it is down.
 */
export async function tenantsOverCeiling(
  ceilingMinor: number,
  since: Date,
): Promise<{ tenantId: string; costMinor: number; jobs: number }[]> {
  const rows = await query<{ tenant_id: string; cost_minor: number; jobs: number }>(
    `SELECT tenant_id, COALESCE(SUM(cost_minor), 0) AS cost_minor, COUNT(*) AS jobs
       FROM ${SOURCE}
      WHERE queued_at >= ?
      GROUP BY tenant_id
     HAVING cost_minor > ?
      ORDER BY cost_minor DESC`,
    [since, ceilingMinor],
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, costMinor: Number(r.cost_minor), jobs: Number(r.jobs) }));
}

/**
 * How much of the work never needed a model.
 *
 * The routing ladder in the plan — deterministic, then cache, then a small
 * model, then a large one — only improves if the split is measured. This is the
 * baseline that later work is judged against, and the number to watch is the
 * share of jobs that reached the deep tier at all.
 */
export async function tierMix(tenantId: string, since: Date): Promise<{ tier: string; jobs: number; costMinor: number }[]> {
  const rows = await query<{ tier: string; jobs: number; cost_minor: number }>(
    `SELECT tier, COUNT(*) AS jobs, COALESCE(SUM(cost_minor), 0) AS cost_minor
       FROM ${SOURCE}
      WHERE tenant_id = ? AND queued_at >= ?
      GROUP BY tier
      ORDER BY cost_minor DESC`,
    [tenantId, since],
  );
  return rows.map((r) => ({ tier: r.tier, jobs: Number(r.jobs), costMinor: Number(r.cost_minor) }));
}

/** Minor units to a readable amount. Presentation only — never used in maths. */
export const formatMinor = (minor: number, currency = "USD", locale = "en"): string =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);

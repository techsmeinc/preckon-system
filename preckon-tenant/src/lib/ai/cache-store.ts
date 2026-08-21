// The response cache, connected to its table.
//
// ai/cache.ts decided what a cache entry is keyed on and when reuse is safe;
// migration 021 created ai_response_cache to hold them. Neither knew about the
// other, so every identical request was paid for twice.
//
// The reason this is a correctness feature and not just a cost one: the same
// question asked twice should give the same answer. Two runs of the same
// workflow over the same inputs producing different BOQ lines is not a
// performance problem, it is a defensibility problem — somebody has to explain
// which one is right.
//
// Everything here fails open. A cache that can break the product when its table
// misbehaves is a worse trade than paying for the call again.

import { query, queryOne } from "../db";
import { logWarn } from "../log";
import { cacheKey, canReuse, type CacheDimensions, type CachedEntry } from "./cache";
import type { Sensitivity } from "./policy";

export interface CacheHit {
  key: string;
  response: unknown;
  /** Cost of the original call — what this hit saved. */
  costMinor: number;
  /** How many times this entry has now been served, including this one. */
  hits: number;
}

/** Rows store revision keys sorted and comma-joined so invalidation can LIKE them. */
const joinRevs = (r?: string[]) => [...(r ?? [])].sort().join(",");

/**
 * Rebuild the dimensions a row was stored under.
 *
 * `input` is not a column — it is hashed into the key and never kept, both
 * because the key already proves equality and because storing every prompt
 * verbatim in a cache table is a data-retention question nobody asked for. So
 * the reconstruction borrows the requested input: if the keys match, the inputs
 * matched, and if they do not match we never got here.
 */
function dimsFromRow(row: any, input: string): CacheDimensions {
  return {
    tenantId: row.tenant_id,
    projectId: row.project_id ?? null,
    taskType: row.task_type,
    input,
    revisionKeys: row.revision_keys ? String(row.revision_keys).split(",").filter(Boolean) : [],
    sensitivity: row.sensitivity as Sensitivity,
    policyVersion: Number(row.policy_version),
    promptVersion: String(row.prompt_version),
    schemaVersion: row.schema_version ?? undefined,
    modelAlias: row.model_alias ?? undefined,
  };
}

/**
 * Look for a reusable answer.
 *
 * The reuse decision is canReuse()'s, not this function's. It holds the rules
 * about which dimensions must match, and duplicating that judgement here is how
 * two parts of a system come to disagree about whether a stored answer is still
 * true. A key match alone would already be sufficient — a mismatch cannot
 * collide — so this second pass exists to catch the day someone widens the
 * lookup, and to name which dimension moved when it refuses.
 */
export async function lookup(
  tenantId: string, dims: CacheDimensions, maxAgeMs?: number, now = new Date(),
): Promise<CacheHit | null> {
  const key = cacheKey(dims);
  try {
    const row = await queryOne<any>(
      `SELECT cache_key, tenant_id, project_id, task_type, sensitivity, policy_version,
              prompt_version, schema_version, model_alias, revision_keys,
              response_json, cost_minor, hits, created_at
         FROM ai_response_cache
        WHERE tenant_id = ? AND cache_key = ?`,
      [tenantId, key],
    );
    if (!row) return null;

    const entry: CachedEntry = {
      key: row.cache_key,
      dimensions: dimsFromRow(row, dims.input),
      createdAt: row.created_at ?? new Date(),
    };

    const decision = canReuse(entry, dims, maxAgeMs, now);
    if (!decision.safe) {
      logWarn("ai.cache.reuse_refused", { key, reasons: decision.reasons, why: decision.why });
      return null;
    }

    // Counted on read rather than in a sweep: an entry nobody ever serves is
    // worth spotting, and this count is the only evidence of that.
    await query(
      `UPDATE ai_response_cache SET hits = hits + 1, last_hit_at = NOW(3)
        WHERE tenant_id = ? AND cache_key = ?`,
      [tenantId, key],
    ).catch(() => {});

    return {
      key,
      response: typeof row.response_json === "string" ? JSON.parse(row.response_json) : row.response_json,
      costMinor: Number(row.cost_minor ?? 0),
      hits: Number(row.hits ?? 0) + 1,
    };
  } catch (e) {
    logWarn("ai.cache.lookup_failed", { error: String(e) });
    return null;
  }
}

export interface StoreInput {
  dims: CacheDimensions;
  response: unknown;
  inputTokens?: number;
  outputTokens?: number;
  costMinor?: number;
}

/**
 * Remember an answer.
 *
 * Upsert rather than insert. The key is the primary key, so a second arrival
 * under the same key is the same question with every dimension unchanged — the
 * newer answer is the one to keep, and the hit count restarts because it is
 * counting reuse of *this* answer.
 */
export async function store(input: StoreInput): Promise<void> {
  const d = input.dims;
  try {
    await query(
      `INSERT INTO ai_response_cache
         (cache_key, tenant_id, project_id, task_type, sensitivity, policy_version,
          prompt_version, schema_version, model_alias, revision_keys,
          response_json, input_tokens, output_tokens, cost_minor)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         response_json = VALUES(response_json),
         input_tokens  = VALUES(input_tokens),
         output_tokens = VALUES(output_tokens),
         cost_minor    = VALUES(cost_minor),
         created_at    = NOW(3),
         last_hit_at   = NULL,
         hits          = 0`,
      [
        cacheKey(d), d.tenantId, d.projectId ?? null, d.taskType, d.sensitivity,
        d.policyVersion, d.promptVersion, d.schemaVersion ?? null, d.modelAlias ?? null,
        joinRevs(d.revisionKeys),
        JSON.stringify(input.response ?? null),
        input.inputTokens ?? 0, input.outputTokens ?? 0, input.costMinor ?? 0,
      ],
    );
  } catch (e) {
    logWarn("ai.cache.store_failed", { error: String(e) });
  }
}

export interface InvalidateOpts {
  projectId?: string;
  /** A single revision key — matches any entry computed from that revision. */
  revisionKey?: string;
  taskType?: string;
  policyVersionBelow?: number;
  promptVersion?: string;
  /** Everything for the tenant. Required to be explicit; see below. */
  all?: boolean;
}

/**
 * Drop what an event invalidates.
 *
 * Scoped by the trigger rather than flushed wholesale: a revised drawing
 * invalidates answers derived from that drawing, and discarding a tenant's
 * entire cache because one sheet changed turns a correctness fix into an hour
 * of recomputation.
 *
 * With no scoping option set this deletes nothing and says so. An invalidation
 * that quietly widens to "everything" because a caller passed an undefined
 * project id is the kind of bug that only shows up as a bill.
 */
export async function invalidate(tenantId: string, opts: InvalidateOpts): Promise<number> {
  try {
    const where = ["tenant_id = ?"];
    const params: unknown[] = [tenantId];

    if (!opts.all) {
      if (opts.projectId) { where.push("project_id = ?"); params.push(opts.projectId); }
      if (opts.taskType) { where.push("task_type = ?"); params.push(opts.taskType); }
      if (opts.promptVersion) { where.push("prompt_version = ?"); params.push(opts.promptVersion); }
      if (opts.policyVersionBelow != null) {
        where.push("policy_version < ?"); params.push(opts.policyVersionBelow);
      }
      if (opts.revisionKey) {
        // revision_keys is a sorted comma-joined list; the commas at both ends
        // stop `rev-1` from matching `rev-12`.
        where.push("CONCAT(',', revision_keys, ',') LIKE ?");
        params.push(`%,${opts.revisionKey},%`);
      }
      if (where.length === 1) {
        logWarn("ai.cache.invalidate_no_scope", { tenantId });
        return 0;
      }
    }

    const r = (await query<any>(
      `DELETE FROM ai_response_cache WHERE ${where.join(" AND ")}`, params,
    )) as unknown as { affectedRows?: number };
    return Number(r?.affectedRows ?? 0);
  } catch (e) {
    logWarn("ai.cache.invalidate_failed", { error: String(e) });
    return 0;
  }
}

export interface CacheStats {
  entries: number;
  hits: number;
  /** What the hits would have cost as calls — money not spent. */
  savedMinor: number;
  /** Entries stored but never served, which is cache that is only costing storage. */
  cold: number;
}

export async function stats(tenantId: string): Promise<CacheStats> {
  try {
    const r = await queryOne<any>(
      `SELECT COUNT(*) AS entries,
              COALESCE(SUM(hits), 0) AS hits,
              COALESCE(SUM(hits * cost_minor), 0) AS saved,
              SUM(hits = 0) AS cold
         FROM ai_response_cache WHERE tenant_id = ?`,
      [tenantId],
    );
    return {
      entries: Number(r?.entries ?? 0),
      hits: Number(r?.hits ?? 0),
      savedMinor: Number(r?.saved ?? 0),
      cold: Number(r?.cold ?? 0),
    };
  } catch {
    return { entries: 0, hits: 0, savedMinor: 0, cold: 0 };
  }
}

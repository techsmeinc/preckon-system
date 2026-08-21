// The prompt registry, connected to its table.
//
// Migration 021 created ai_prompt_version and the ledger kept prompt_key and
// prompt_version columns for it, but nothing resolved a prompt through it: the
// prompt reference came from a hardcoded `${type}@v1` string in runtime.ts and
// the ledger columns stayed NULL. So the two questions the registry exists to
// answer — "which prompt produced this output" and "what changed between the
// run that was right and the run that was wrong" — had no answer.
//
// That matters more here than in most products. When an estimator disputes a
// generated BOQ six months on, "the model changed" is not an answer anybody can
// act on. "Prompt boq-extract v4 was approved on 14 March, this output came from
// v3" is.
//
// ── WHY THE TABLE HAS NO TENANT_ID ───────────────────────────────────────────
//
// Prompts are product assets, not tenant data. Every tenant on a release runs
// the same approved prompt, which is what makes an eval result meaningful — a
// per-tenant prompt fork would mean the evals tested something no tenant runs.
// Reads here are therefore instance-wide by design and tagged for the scoping
// guard.

import { createHash } from "node:crypto";
import { query, queryOne } from "../db";
import { logWarn } from "../log";

export interface ResolvedPrompt {
  /** Stable identity of the prompt, independent of version. */
  key: string;
  version: number;
  /** `key@vN` — what goes in the envelope and the job row. */
  ref: string;
  /** System prefix, instructions, schema, model overrides. */
  prompt: Record<string, unknown>;
  /** Hash of the stable prefix, for spotting drift that breaks provider caching. */
  prefixHash: string | null;
  /** Which eval suite last passed against this version. */
  evalVersion: string | null;
  /** False when nothing was registered and the caller's fallback was used. */
  registered: boolean;
}

/** `boq-extract@v4` → the pieces. Tolerates a bare key. */
export function parseRef(ref: string): { key: string; version: number | null } {
  const m = String(ref ?? "").match(/^(.*?)@v(\d+)$/i);
  return m ? { key: m[1], version: Number(m[2]) } : { key: String(ref ?? ""), version: null };
}

export const formatRef = (key: string, version: number) => `${key}@v${version}`;

/**
 * Hash the part of a prompt that should stay byte-stable across versions.
 *
 * Providers cache on an exact prefix match, so an edit to the system prefix —
 * even a whitespace one — silently discards the cache and multiplies the input
 * cost of every call. Storing the hash makes that visible as a changed value
 * rather than as a bill.
 */
export function prefixHash(prompt: Record<string, unknown>): string {
  const prefix = String((prompt as any)?.system ?? (prompt as any)?.prefix ?? "");
  return createHash("sha256").update(prefix).digest("hex");
}

/**
 * The approved prompt for a task type.
 *
 * Highest approved version wins. Drafts are invisible here on purpose: a draft
 * is something someone is still editing, and the registry is not the place to
 * discover that an unfinished prompt reached production.
 *
 * A missing registration is not an error. The fallback is the caller's existing
 * reference, so an unregistered task keeps running exactly as it did before —
 * the registry adds provenance where it has been populated rather than becoming
 * a new way for dispatch to fail.
 */
export async function resolvePrompt(taskType: string, fallbackRef: string): Promise<ResolvedPrompt> {
  const fb = parseRef(fallbackRef);
  const unregistered: ResolvedPrompt = {
    key: fb.key || taskType,
    version: fb.version ?? 1,
    ref: fallbackRef,
    prompt: {},
    prefixHash: null,
    evalVersion: null,
    registered: false,
  };

  try {
    const row = await queryOne<any>(
      `-- prompts:instance-wide (prompts are product assets, not tenant data)
       SELECT prompt_key, version, prompt_json, prefix_hash, eval_version
         FROM ai_prompt_version
        WHERE task_type = ? AND status = 'approved'
        ORDER BY version DESC
        LIMIT 1`,
      [taskType],
    );
    if (!row) return unregistered;

    return {
      key: row.prompt_key,
      version: Number(row.version),
      ref: formatRef(row.prompt_key, Number(row.version)),
      prompt: typeof row.prompt_json === "string" ? JSON.parse(row.prompt_json) : (row.prompt_json ?? {}),
      prefixHash: row.prefix_hash ?? null,
      evalVersion: row.eval_version ?? null,
      registered: true,
    };
  } catch (e) {
    logWarn("ai.prompt.resolve_failed", { taskType, error: String(e) });
    return unregistered;
  }
}

/** Every approved prompt, for the admin view and for eval runs. */
export async function listApproved(): Promise<ResolvedPrompt[]> {
  try {
    const rows = await query<any>(
      `-- prompts:instance-wide
       SELECT p.prompt_key, p.version, p.prompt_json, p.prefix_hash, p.eval_version
         FROM ai_prompt_version p
         JOIN (SELECT task_type, MAX(version) AS v FROM ai_prompt_version
                WHERE status = 'approved' GROUP BY task_type) top
           ON top.task_type = p.task_type AND top.v = p.version
        WHERE p.status = 'approved'
        ORDER BY p.prompt_key`,
    );
    return rows.map((r) => ({
      key: r.prompt_key,
      version: Number(r.version),
      ref: formatRef(r.prompt_key, Number(r.version)),
      prompt: typeof r.prompt_json === "string" ? JSON.parse(r.prompt_json) : (r.prompt_json ?? {}),
      prefixHash: r.prefix_hash ?? null,
      evalVersion: r.eval_version ?? null,
      registered: true,
    }));
  } catch (e) {
    logWarn("ai.prompt.list_failed", { error: String(e) });
    return [];
  }
}

/**
 * Whether a stored prefix hash still matches the prompt beside it.
 *
 * Run as a check rather than enforced on write: a legitimately edited prefix
 * should be a new version, and the point of noticing is to tell the difference
 * between "someone versioned a change" and "someone edited a row in place".
 */
export function prefixDrifted(p: ResolvedPrompt): boolean {
  return p.registered && p.prefixHash != null && prefixHash(p.prompt) !== p.prefixHash;
}

/**
 * The durable half of the job seam.
 *
 * ai_job is the queue. Dispatch CLAIMS a row before sending it, and a reconciler
 * finds rows nobody is working on and sends them again. Between them, no single
 * failure — a worker restart, a container reschedule, a network blip, Core
 * itself dying mid-dispatch — can strand work: the row is written before the
 * send, so the worst case is a job that runs late, not one that never runs.
 *
 * The claim is one conditional UPDATE. Whoever's UPDATE reports a changed row
 * owns the job; everyone else moves on. That is what makes this safe with more
 * than one Core instance, and it needs no lock table and no broker.
 *
 * ── AT-LEAST-ONCE, AND WHY THAT IS FINE ──────────────────────────────────────
 *
 * A lease can expire while a worker is genuinely still running, so a job can run
 * twice. That is the correct trade: the alternative is work that silently never
 * completes. Duplicates are absorbed downstream — recordJobResult is idempotent
 * by status (the second callback for a finished job is a no-op) and proposals
 * carry an idempotency key. Make the lease generous rather than making the
 * reconciler clever.
 */

import { query } from "./db";
import type { JobEnvelope } from "./jobs";

/** How long a dispatched job may run before it is presumed lost. */
export const LEASE_SECONDS = Number(process.env.AI_JOB_LEASE_SECONDS ?? 900);

/** Backoff before a failed dispatch is tried again: 10s, 40s, 160s, capped. */
export const BACKOFF_BASE_SECONDS = Number(process.env.AI_JOB_BACKOFF_SECONDS ?? 10);
export const BACKOFF_MAX_SECONDS = Number(process.env.AI_JOB_BACKOFF_MAX_SECONDS ?? 600);

export function backoffSeconds(attempt: number): number {
  const s = BACKOFF_BASE_SECONDS * Math.pow(4, Math.max(0, attempt));
  return Math.min(s, BACKOFF_MAX_SECONDS);
}

export interface ClaimedJob {
  id: string;
  envelope: JobEnvelope;
  attempt: number;
  maxAttempts: number;
}

const parseEnvelope = (v: unknown): JobEnvelope =>
  (typeof v === "string" ? JSON.parse(v) : v) as JobEnvelope;

/**
 * Take ownership of a queued job so it can be dispatched.
 *
 * Returns null when somebody else got there first, when the job is no longer
 * queued, or when its backoff has not elapsed. The WHERE clause is the lock:
 * two Cores racing on the same row produce one winner and one null, because
 * MySQL applies the UPDATEs in sequence and the second finds status changed.
 */
export async function claimForDispatch(jobId: string, leaseSeconds = LEASE_SECONDS): Promise<ClaimedJob | null> {
  const res: any = await query(
    `UPDATE ai_job
        SET status = 'running',
            attempt = attempt + 1,
            dispatched_at = NOW(3),
            started_at = COALESCE(started_at, NOW(3)),
            lease_until = DATE_ADD(NOW(3), INTERVAL ? SECOND)
      WHERE id = ?
        AND status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW(3))
        AND attempt < max_attempts`,
    [leaseSeconds, jobId],
  );
  if (!res?.affectedRows) return null;

  const rows = await query<any>("SELECT id, envelope, attempt, max_attempts FROM ai_job WHERE id = ?", [jobId]);
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, envelope: parseEnvelope(r.envelope), attempt: r.attempt, maxAttempts: r.max_attempts };
}

/**
 * Hand a job back after a failed dispatch, or give up on it.
 *
 * Exhausting the attempts is a terminal, human-visible failure rather than a row
 * that quietly stops moving: the run step is waiting on this job, and a step
 * that waits forever is indistinguishable from one still working.
 */
export async function releaseForRetry(jobId: string, reason: string): Promise<"requeued" | "failed"> {
  const rows = await query<any>("SELECT attempt, max_attempts FROM ai_job WHERE id = ?", [jobId]);
  const r = rows[0];
  if (!r) return "failed";

  const short = String(reason).slice(0, 500);

  if (r.attempt >= r.max_attempts) {
    await query(
      `UPDATE ai_job
          SET status = 'failed', lease_until = NULL, last_error = ?, ended_at = NOW(3),
              error = JSON_OBJECT('message', ?, 'attempts', attempt)
        WHERE id = ? AND status NOT IN ('succeeded','cancelled')`,
      [short, `Gave up after ${r.attempt} attempt(s): ${short}`, jobId],
    );
    return "failed";
  }

  await query(
    `UPDATE ai_job
        SET status = 'queued', lease_until = NULL, last_error = ?,
            next_attempt_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
      WHERE id = ? AND status NOT IN ('succeeded','failed','cancelled')`,
    [short, backoffSeconds(r.attempt), jobId],
  );
  return "requeued";
}

/** Clear the lease once a result lands, so the reconciler stops watching it. */
export async function clearLease(jobId: string): Promise<void> {
  await query("UPDATE ai_job SET lease_until = NULL, next_attempt_at = NULL WHERE id = ?", [jobId]);
}

export interface ReconcileReport {
  dispatched: number;
  requeued: number;
  failed: number;
  /** Ids acted on, for the log line. Truncated — this runs every minute. */
  touched: string[];
}

export interface ReconcileOptions {
  /** How to reach the worker. Injected so the reconciler is testable offline. */
  dispatch: (env: JobEnvelope) => Promise<void>;
  /** Most jobs to act on in one pass. Keeps a backlog from becoming a stampede. */
  batch?: number;
  leaseSeconds?: number;
}

/**
 * One recovery pass. Safe to run concurrently with itself and with normal
 * dispatch — every transition goes through a conditional UPDATE.
 *
 * Two rules, in order:
 *
 *   1. running + lease expired  → the worker never called back. Requeue it, or
 *      fail it if the attempts are spent.
 *   2. queued + due             → nobody is working on it. Dispatch it.
 *
 * Expired leases first, because a reclaimed job becomes queued and is then
 * eligible for rule 2 on the NEXT pass rather than this one — one state change
 * per job per pass keeps the arithmetic honest and the logs readable.
 */
export async function reconcileJobs(opts: ReconcileOptions): Promise<ReconcileReport> {
  const batch = opts.batch ?? 25;
  const report: ReconcileReport = { dispatched: 0, requeued: 0, failed: 0, touched: [] };

  // 1. Leases that ran out.
  const lost = await query<any>(
    `SELECT id FROM ai_job
      WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < NOW(3)
      ORDER BY lease_until ASC LIMIT ?`,
    [batch],
  );
  for (const row of lost) {
    const outcome = await releaseForRetry(row.id, "the worker took this job and never reported back");
    if (outcome === "failed") report.failed++;
    else report.requeued++;
    report.touched.push(row.id);
  }

  // 2. Queued and due. Includes jobs whose very first dispatch never left the
  //    building, which is the case that used to strand a run permanently.
  const due = await query<any>(
    `SELECT id FROM ai_job
      WHERE status = 'queued'
        AND attempt < max_attempts
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW(3))
      ORDER BY queued_at ASC LIMIT ?`,
    [batch],
  );
  for (const row of due) {
    const claimed = await claimForDispatch(row.id, opts.leaseSeconds ?? LEASE_SECONDS);
    if (!claimed) continue; // someone else took it, or it moved on
    try {
      await opts.dispatch(claimed.envelope);
      report.dispatched++;
    } catch (e: any) {
      const outcome = await releaseForRetry(claimed.id, e?.message ?? "dispatch failed");
      if (outcome === "failed") report.failed++;
      else report.requeued++;
    }
    report.touched.push(claimed.id);
  }

  // Jobs that ran out of attempts without a live lease — belt and braces, so a
  // row cannot sit queued and ineligible forever with nothing to explain it.
  const spentRes: any = await query(
    `UPDATE ai_job
        SET status = 'failed', ended_at = NOW(3),
            error = JSON_OBJECT('message', CONCAT('Gave up after ', attempt, ' attempt(s): ', COALESCE(last_error, 'no further detail')))
      WHERE status = 'queued' AND attempt >= max_attempts`,
  );
  if (spentRes?.affectedRows) report.failed += spentRes.affectedRows;

  return report;
}

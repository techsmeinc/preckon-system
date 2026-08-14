// Recovery for AI jobs.
//
// The failure this exists to survive: dispatch was a bare HTTP POST at the end
// of enqueueJob, so a worker that happened to be restarting threw — with the
// ai_job row already written, the run step already bound to it, and nothing
// anywhere that would ever look at that row again. The job sat 'queued' forever
// and the step waited on a callback that was never coming.
//
// These test the queue's arithmetic and its state machine against a fake
// database, so they run without MySQL. The SQL itself is covered by the
// integration suite; what is worth pinning here is the policy: what gets
// retried, what gets abandoned, and when.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  backoffSeconds, claimForDispatch, reconcileJobs, releaseForRetry,
  BACKOFF_MAX_SECONDS,
} from "@/lib/job-queue";

const q = query as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => q.mockReset());

describe("backoff", () => {
  it("grows sharply, so a worker that is down is not hammered", () => {
    expect(backoffSeconds(0)).toBe(10);
    expect(backoffSeconds(1)).toBe(40);
    expect(backoffSeconds(2)).toBe(160);
  });

  it("stops growing, so a long outage does not park a job for a day", () => {
    expect(backoffSeconds(10)).toBe(BACKOFF_MAX_SECONDS);
    expect(backoffSeconds(99)).toBe(BACKOFF_MAX_SECONDS);
  });

  it("treats a nonsense attempt as the first one", () => {
    expect(backoffSeconds(-5)).toBe(10);
  });
});

describe("claiming a job", () => {
  it("returns the envelope when the claim wins", async () => {
    q.mockResolvedValueOnce({ affectedRows: 1 });
    q.mockResolvedValueOnce([{ id: "j1", envelope: JSON.stringify({ job_id: "j1" }), attempt: 1, max_attempts: 3 }]);

    const claimed = await claimForDispatch("j1");
    expect(claimed).toMatchObject({ id: "j1", attempt: 1, maxAttempts: 3 });
    expect(claimed!.envelope.job_id).toBe("j1");
  });

  it("returns null when another instance got there first", async () => {
    // The WHERE clause is the lock. Two Cores racing produce one winner and one
    // null, because the second finds the status already changed.
    q.mockResolvedValueOnce({ affectedRows: 0 });
    expect(await claimForDispatch("j1")).toBeNull();
  });

  it("moves the row to running and counts the attempt", async () => {
    q.mockResolvedValueOnce({ affectedRows: 1 });
    q.mockResolvedValueOnce([{ id: "j1", envelope: "{}", attempt: 1, max_attempts: 3 }]);
    await claimForDispatch("j1");

    const sql = String(q.mock.calls[0][0]);
    expect(sql).toMatch(/status\s*=\s*'running'/);
    expect(sql).toMatch(/attempt\s*=\s*attempt \+ 1/);
    // Only ever claims work nobody holds and whose backoff has elapsed.
    expect(sql).toMatch(/status\s*=\s*'queued'/);
    expect(sql).toMatch(/next_attempt_at IS NULL OR next_attempt_at <= NOW/);
    expect(sql).toMatch(/attempt < max_attempts/);
  });

  it("accepts an envelope the driver already parsed", async () => {
    // Some MySQL drivers hand back JSON columns parsed, some as text.
    q.mockResolvedValueOnce({ affectedRows: 1 });
    q.mockResolvedValueOnce([{ id: "j1", envelope: { job_id: "j1" }, attempt: 1, max_attempts: 3 }]);
    expect((await claimForDispatch("j1"))!.envelope.job_id).toBe("j1");
  });
});

describe("releasing a job after a failed dispatch", () => {
  it("requeues while attempts remain", async () => {
    q.mockResolvedValueOnce([{ attempt: 1, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });

    expect(await releaseForRetry("j1", "connection refused")).toBe("requeued");
    expect(String(q.mock.calls[1][0])).toMatch(/status\s*=\s*'queued'/);
  });

  it("gives up visibly once they are spent", async () => {
    // A step is waiting on this job. A row that quietly stops moving is
    // indistinguishable from one still working, which is the worse outcome.
    q.mockResolvedValueOnce([{ attempt: 3, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });

    expect(await releaseForRetry("j1", "connection refused")).toBe("failed");
    const sql = String(q.mock.calls[1][0]);
    expect(sql).toMatch(/status\s*=\s*'failed'/);
    expect(sql).toMatch(/ended_at/);
  });

  it("records why, so a retried job can explain itself", async () => {
    q.mockResolvedValueOnce([{ attempt: 1, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });
    await releaseForRetry("j1", "connection refused");
    expect(q.mock.calls[1][1]).toContain("connection refused");
  });

  it("truncates a runaway error rather than failing the update", async () => {
    q.mockResolvedValueOnce([{ attempt: 1, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });
    await releaseForRetry("j1", "x".repeat(5000));
    expect((q.mock.calls[1][1] as any[])[0].length).toBe(500);
  });

  it("never resurrects a job that already finished", async () => {
    q.mockResolvedValueOnce([{ attempt: 1, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 0 });
    await releaseForRetry("j1", "late failure");
    expect(String(q.mock.calls[1][0])).toMatch(/NOT IN \('succeeded','failed','cancelled'\)/);
  });
});

describe("a reconcile pass", () => {
  /** No lost leases, no due jobs, nothing spent. */
  const quiet = () => {
    q.mockResolvedValueOnce([]);            // expired leases
    q.mockResolvedValueOnce([]);            // due
    q.mockResolvedValueOnce({ affectedRows: 0 }); // spent
  };

  it("does nothing when there is nothing to do", async () => {
    quiet();
    const dispatch = vi.fn();
    expect(await reconcileJobs({ dispatch })).toMatchObject({ dispatched: 0, requeued: 0, failed: 0 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches a job whose first send never landed", async () => {
    q.mockResolvedValueOnce([]);                                  // no expired leases
    q.mockResolvedValueOnce([{ id: "j1" }]);                      // one due
    q.mockResolvedValueOnce({ affectedRows: 1 });                 // claim wins
    q.mockResolvedValueOnce([{ id: "j1", envelope: "{}", attempt: 1, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 0 });                 // none spent

    const dispatch = vi.fn().mockResolvedValue(undefined);
    const r = await reconcileJobs({ dispatch });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(r.dispatched).toBe(1);
    expect(r.touched).toContain("j1");
  });

  it("requeues a job the worker took and never reported back on", async () => {
    q.mockResolvedValueOnce([{ id: "j2" }]);                      // expired lease
    q.mockResolvedValueOnce([{ attempt: 1, max_attempts: 3 }]);   // releaseForRetry read
    q.mockResolvedValueOnce({ affectedRows: 1 });                 // requeued
    q.mockResolvedValueOnce([]);                                  // none due
    q.mockResolvedValueOnce({ affectedRows: 0 });

    const r = await reconcileJobs({ dispatch: vi.fn() });
    expect(r.requeued).toBe(1);
    expect(r.failed).toBe(0);
  });

  it("abandons a job that has exhausted its attempts", async () => {
    q.mockResolvedValueOnce([{ id: "j3" }]);
    q.mockResolvedValueOnce([{ attempt: 3, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce({ affectedRows: 0 });

    expect((await reconcileJobs({ dispatch: vi.fn() })).failed).toBe(1);
  });

  it("puts a job back when the redispatch also fails", async () => {
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([{ id: "j4" }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });
    q.mockResolvedValueOnce([{ id: "j4", envelope: "{}", attempt: 2, max_attempts: 3 }]);
    q.mockResolvedValueOnce([{ attempt: 2, max_attempts: 3 }]);   // releaseForRetry read
    q.mockResolvedValueOnce({ affectedRows: 1 });                 // requeued
    q.mockResolvedValueOnce({ affectedRows: 0 });

    const dispatch = vi.fn().mockRejectedValue(new Error("still down"));
    const r = await reconcileJobs({ dispatch });
    expect(r.dispatched).toBe(0);
    expect(r.requeued).toBe(1);
  });

  it("skips a job another instance claimed mid-pass", async () => {
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([{ id: "j5" }]);
    q.mockResolvedValueOnce({ affectedRows: 0 }); // lost the race
    q.mockResolvedValueOnce({ affectedRows: 0 });

    const dispatch = vi.fn();
    const r = await reconcileJobs({ dispatch });
    expect(dispatch).not.toHaveBeenCalled();
    expect(r.dispatched).toBe(0);
  });

  it("sweeps up rows left queued with no attempts remaining", async () => {
    // Belt and braces: a row must not sit queued and ineligible forever with
    // nothing to explain why it stopped.
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce({ affectedRows: 2 });

    const r = await reconcileJobs({ dispatch: vi.fn() });
    expect(r.failed).toBe(2);
    expect(String(q.mock.calls[2][0])).toMatch(/status\s*=\s*'queued' AND attempt >= max_attempts/);
  });

  it("bounds how much it takes on in one pass", async () => {
    quiet();
    await reconcileJobs({ dispatch: vi.fn(), batch: 5 });
    expect(q.mock.calls[0][1]).toEqual([5]);
    expect(q.mock.calls[1][1]).toEqual([5]);
  });

  it("handles expired leases before dispatching, one transition per job per pass", async () => {
    q.mockResolvedValueOnce([{ id: "j6" }]);
    q.mockResolvedValueOnce([{ attempt: 1, max_attempts: 3 }]);
    q.mockResolvedValueOnce({ affectedRows: 1 });
    q.mockResolvedValueOnce([]);
    q.mockResolvedValueOnce({ affectedRows: 0 });

    await reconcileJobs({ dispatch: vi.fn() });
    expect(String(q.mock.calls[0][0])).toMatch(/lease_until < NOW/);
  });
});

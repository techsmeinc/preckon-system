/**
 * Next.js runs this once, when the server starts.
 *
 * It exists to start the job reconciler. Without something running it, a job
 * whose dispatch was lost sits queued forever and the run step waiting on it
 * never moves — the failure the durable queue was built to survive.
 *
 * The timer is a CONVENIENCE, not the guarantee. A process-bound interval dies
 * with the process, and a deployment that scales to zero or restarts on deploy
 * has moments with no ticker at all. The endpoint at
 * /api/internal/jobs/reconcile is the real recovery path; this just means a
 * single-container install gets recovery without anyone having to set up cron.
 *
 * Everything here is defensive on purpose. Instrumentation runs on the edge
 * runtime too, and during `next build`, where there is no database and starting
 * a timer would be wrong.
 */

export async function register() {
  // Node runtime only. The edge runtime has no MySQL driver, and the build-time
  // pass has no database to talk to.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Opt out where something else owns recovery — a cron entry, a Kubernetes
  // CronJob, or a deployment that runs many replicas and would rather not have
  // every one of them scanning.
  if (String(process.env.AI_JOB_RECONCILE_DISABLED).toLowerCase() === "true") {
    console.log("[reconcile] in-process ticker disabled by AI_JOB_RECONCILE_DISABLED");
    return;
  }

  const everySeconds = Number(process.env.AI_JOB_RECONCILE_SECONDS ?? 60);
  if (!Number.isFinite(everySeconds) || everySeconds <= 0) return;

  const { reconcileJobs } = await import("./lib/job-queue");
  const { dispatchEnvelope } = await import("./lib/jobs");

  let running = false;

  const tick = async () => {
    // A slow pass must not overlap the next one: two passes racing would both
    // try to claim the same rows, and while the conditional UPDATE makes that
    // safe, it is wasted work and confusing logs.
    if (running) return;
    running = true;
    try {
      const r = await reconcileJobs({ dispatch: dispatchEnvelope });
      if (r.dispatched || r.requeued || r.failed) {
        console.log(`[reconcile] dispatched=${r.dispatched} requeued=${r.requeued} failed=${r.failed}`);
      }
    } catch (e: any) {
      // Never throw out of a timer — an unhandled rejection here would take the
      // server down over a transient database blip.
      console.error("[reconcile] pass failed:", e?.message ?? e);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, everySeconds * 1000);
  // Do not hold the process open on its own account.
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[reconcile] in-process ticker every ${everySeconds}s`);
}

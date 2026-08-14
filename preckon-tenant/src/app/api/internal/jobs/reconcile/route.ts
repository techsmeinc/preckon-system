import { serviceRoute, ok } from "@/lib/http";
import { reconcileJobs } from "@/lib/job-queue";
import { dispatchEnvelope } from "@/lib/jobs";

// POST /internal/jobs/reconcile — one recovery pass over the job queue.
//
// Finds work nobody is doing and starts it again: jobs whose dispatch never
// landed, and jobs a worker took and never reported back on. Everything it does
// goes through a conditional UPDATE, so running two of these at once is safe and
// so is running one while Core is dispatching normally.
//
// It is exposed as a route rather than being only an internal timer because the
// timer belongs to a process, and processes get restarted, scaled to zero, and
// run in environments where a background interval is not reliable. A cron entry,
// a systemd timer or an uptime check hitting this endpoint is a recovery path
// that does not depend on any particular instance staying alive:
//
//   * * * * * curl -fsS -X POST -H "authorization: Bearer $INTERNAL_SERVICE_TOKEN" \
//       http://localhost:3100/api/internal/jobs/reconcile
//
// Service auth, same as the worker's result callback — it can restart work, so
// it is not something an ordinary session should be able to trigger.
export const POST = serviceRoute(async () => {
  const report = await reconcileJobs({ dispatch: dispatchEnvelope });
  if (report.dispatched || report.requeued || report.failed) {
    console.log(
      `[reconcile] dispatched=${report.dispatched} requeued=${report.requeued} failed=${report.failed} ids=${report.touched.slice(0, 10).join(",")}`,
    );
  }
  return ok(report);
});

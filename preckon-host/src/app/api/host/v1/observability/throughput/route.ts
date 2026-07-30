import { getAuthContext, requirePermission } from "@/lib/context";
import { handle, ok, q } from "@/lib/http";

// GET /observability/throughput — jobs/min + success/fail + latency percentiles (§10.3)
// Mock shaped like the production Redis/Langfuse rollup, keyed off ?window=.
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "observability.read");

  const window = q(req, "window") ?? "1h";
  const buckets: Record<string, number> = { "15m": 15, "1h": 60, "6h": 72, "24h": 96 };
  const points = buckets[window] ?? 60;

  const now = Date.now();
  const stepMs = window === "24h" ? 15 * 60_000 : window === "6h" ? 5 * 60_000 : 60_000;

  const series = Array.from({ length: points }, (_, i) => {
    const t = now - (points - 1 - i) * stepMs;
    // Deterministic-ish wave so the chart looks alive without randomness churn.
    const jobs = Math.round(80 + 40 * Math.sin(i / 6) + (i % 5));
    const failed = Math.max(0, Math.round(jobs * 0.03 + (i % 7 === 0 ? 4 : 0)));
    return { t: new Date(t).toISOString(), jobs_per_min: jobs, succeeded: jobs - failed, failed };
  });

  const totalJobs = series.reduce((s, p) => s + p.jobs_per_min, 0);
  const totalFailed = series.reduce((s, p) => s + p.failed, 0);

  return ok({
    window,
    generated_at: new Date(now).toISOString(),
    source: "mock",
    series,
    summary: {
      total_jobs: totalJobs,
      success_rate: totalJobs ? +(1 - totalFailed / totalJobs).toFixed(4) : 1,
      fail_rate: totalJobs ? +(totalFailed / totalJobs).toFixed(4) : 0,
      latency_ms: { p50: 120, p95: 480 },
    },
  });
});

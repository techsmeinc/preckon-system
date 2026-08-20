import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// Operational metrics, in Prometheus text format.
//
// There was no metrics endpoint at all: trace ids existed on ai_job and nothing
// aggregated them, so "is it healthy" could only be answered by opening the
// database. The gap that matters is not knowing the numbers — it is that
// nobody finds out anything is wrong until a person notices and says so.
//
// Prometheus exposition format rather than JSON, because it is what a scraper
// expects and it costs nothing to emit: a name, optional labels, a number.
// Anything that wants JSON can read the same figures from the reporting APIs.
//
// Deliberately unauthenticated but INTERNAL-ONLY by deployment: it exposes
// counts and durations, never content. It is bound behind the same proxy as
// the app, so exposing it publicly is a reverse-proxy decision rather than
// something this file can decide. Where that is not acceptable, set
// METRICS_TOKEN and pass it as a bearer.

export const dynamic = "force-dynamic";

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge";
  values: { labels?: Record<string, string>; value: number }[];
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");

function render(metrics: Metric[]): string {
  const out: string[] = [];
  for (const m of metrics) {
    out.push(`# HELP ${m.name} ${m.help}`);
    out.push(`# TYPE ${m.name} ${m.type}`);
    for (const v of m.values) {
      const labels = v.labels && Object.keys(v.labels).length
        ? "{" + Object.entries(v.labels).map(([k, val]) => `${k}="${esc(String(val))}"`).join(",") + "}"
        : "";
      out.push(`${m.name}${labels} ${Number.isFinite(v.value) ? v.value : 0}`);
    }
  }
  return out.join("\n") + "\n";
}

/** Never let a metrics query take the endpoint down; report what answered. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) {
      return new NextResponse("unauthorized\n", { status: 401 });
    }
  }

  const started = Date.now();

  const jobsByStatus = await safe(() => query<any>(
    `SELECT status, COUNT(*) AS n FROM ai_job
      WHERE queued_at >= NOW() - INTERVAL 24 HOUR GROUP BY status`), []);

  const queueDepth = await safe(() => query<any>(
    `SELECT COUNT(*) AS n FROM ai_job WHERE status IN ('queued','running')`), [{ n: 0 }]);

  // The oldest thing still waiting. A rising number here is the earliest
  // visible sign that the worker has stopped, and it moves long before any
  // failure count does.
  const oldestQueued = await safe(() => query<any>(
    `SELECT COALESCE(TIMESTAMPDIFF(SECOND, MIN(queued_at), NOW()), 0) AS s
       FROM ai_job WHERE status = 'queued'`), [{ s: 0 }]);

  const usage = await safe(() => query<any>(
    `SELECT execution_class, COUNT(*) AS attempts,
            COALESCE(SUM(cost_minor),0) AS cost_minor,
            COALESCE(SUM(input_tokens + output_tokens),0) AS tokens
       FROM ai_usage_ledger
      WHERE created_at >= NOW() - INTERVAL 24 HOUR
      GROUP BY execution_class`), []);

  const rejected = await safe(() => query<any>(
    `SELECT COUNT(*) AS n FROM ai_usage_ledger
      WHERE outcome = 'rejected' AND created_at >= NOW() - INTERVAL 24 HOUR`), [{ n: 0 }]);

  const tenants = await safe(() => query<any>(`SELECT COUNT(*) AS n FROM tenant`), [{ n: 0 }]);
  const projects = await safe(() => query<any>(`SELECT COUNT(*) AS n FROM project`), [{ n: 0 }]);
  const docs = await safe(() => query<any>(`SELECT COUNT(*) AS n FROM document_register`), [{ n: 0 }]);

  const metrics: Metric[] = [
    {
      name: "preckon_ai_jobs_24h", help: "AI jobs queued in the last 24 hours, by status", type: "counter",
      values: jobsByStatus.map((r: any) => ({ labels: { status: String(r.status) }, value: Number(r.n) })),
    },
    {
      name: "preckon_ai_queue_depth", help: "Jobs queued or running right now", type: "gauge",
      values: [{ value: Number(queueDepth[0]?.n ?? 0) }],
    },
    {
      name: "preckon_ai_oldest_queued_seconds", help: "Age of the oldest job still queued", type: "gauge",
      values: [{ value: Number(oldestQueued[0]?.s ?? 0) }],
    },
    {
      name: "preckon_ai_attempts_24h", help: "AI attempts in the last 24 hours, by execution class", type: "counter",
      values: usage.map((r: any) => ({ labels: { execution_class: String(r.execution_class) }, value: Number(r.attempts) })),
    },
    {
      name: "preckon_ai_cost_minor_24h", help: "AI spend in minor units over 24 hours, by execution class", type: "counter",
      values: usage.map((r: any) => ({ labels: { execution_class: String(r.execution_class) }, value: Number(r.cost_minor) })),
    },
    {
      name: "preckon_ai_tokens_24h", help: "Tokens consumed in the last 24 hours", type: "counter",
      values: usage.map((r: any) => ({ labels: { execution_class: String(r.execution_class) }, value: Number(r.tokens) })),
    },
    {
      // Governance refusals. Zero here while enforcement is off still means
      // something: it is the count of jobs the policy WOULD have stopped.
      name: "preckon_ai_policy_rejected_24h", help: "Attempts refused by AI policy or budget", type: "counter",
      values: [{ value: Number(rejected[0]?.n ?? 0) }],
    },
    {
      name: "preckon_tenants", help: "Tenants provisioned", type: "gauge",
      values: [{ value: Number(tenants[0]?.n ?? 0) }],
    },
    {
      name: "preckon_projects", help: "Projects", type: "gauge",
      values: [{ value: Number(projects[0]?.n ?? 0) }],
    },
    {
      name: "preckon_documents_registered", help: "Controlled documents in the register", type: "gauge",
      values: [{ value: Number(docs[0]?.n ?? 0) }],
    },
    {
      name: "preckon_metrics_scrape_seconds", help: "Time taken to collect these metrics", type: "gauge",
      values: [{ value: (Date.now() - started) / 1000 }],
    },
  ];

  return new NextResponse(render(metrics), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}

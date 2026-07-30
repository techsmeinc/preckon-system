"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, unwrap, errMessage, useToast, useCan, StatusChip, Skeleton, ErrorBox } from "../_ui";

interface FailedJob {
  id: string;
  failed_at?: string;
  tenant_id?: string;
  job_type?: string;
  error_class?: string;
  error_message?: string;
  attempt?: number;
  max_attempts?: number;
  resolved?: number;
}

// ISO datetime → HH:MM for compact axis labels.
function hhmm(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ObservabilityPage() {
  const toast = useToast();
  const canManage = useCan("job.manage");

  // Observability auto-refreshes so "Live" is truthful. Background polls update
  // in place (no skeleton flash — see useApi refreshMs).
  const REFRESH = 15000;
  const queues = useApi<any>("/observability/queues", [], { refreshMs: REFRESH });
  const throughput = useApi<any>("/observability/throughput?window=8h", [], { refreshMs: REFRESH });
  const aiHealth = useApi<any>("/observability/ai-health", [], { refreshMs: REFRESH });
  const failed = useApi<any>("/observability/failed-jobs?resolved=false", [], { refreshMs: REFRESH });

  const q = queues.data ?? {};
  // `workers` may arrive as an array of {id,last_seen,status} or as scalar counts.
  const workersArr: any[] = Array.isArray(q.workers) ? q.workers : [];
  const queuesArr: any[] = Array.isArray(q.queues) ? q.queues : [];
  const workers =
    workersArr.length > 0
      ? workersArr.filter((w) => w.status !== "stale").length
      : q.workers_active ?? q.active_workers ?? null;
  const workersTotal = workersArr.length > 0 ? workersArr.length : q.workers_total ?? q.worker_count ?? workers;
  const depth =
    queuesArr.length > 0
      ? queuesArr.reduce((s, x) => s + (x.depth ?? x.pending ?? 0), 0)
      : q.depth ?? q.queue_depth ?? q.pending ?? null;
  const stalled =
    workersArr.length > 0
      ? workersArr.filter((w) => w.status === "stale").length
      : q.stalled ?? q.stalled_jobs ?? 0;
  const avgWait = q.avg_wait_seconds ?? q.avg_wait ?? null;

  // Throughput series: [{ t, jobs_per_min, succeeded, failed }] + summary.
  const series: any[] = Array.isArray(throughput.data?.series) ? throughput.data.series : [];
  const maxT = Math.max(1, ...series.map((s: any) => s.jobs_per_min ?? 0));
  const summary = throughput.data?.summary ?? null;

  // ai-health returns { providers: [{ provider_name, status, models:[{model,tier,
  // requests, error_rate, latency_ms:{p95} }] }] } — flatten to one row per model.
  const aiProviders: any[] = Array.isArray(aiHealth.data?.providers)
    ? aiHealth.data.providers
    : Array.isArray(unwrap(aiHealth.data))
      ? (unwrap(aiHealth.data) as any[])
      : [];
  const aiRows: any[] = aiProviders.flatMap((p: any) => {
    const models = Array.isArray(p.models) && p.models.length ? p.models : [null];
    return models.map((m: any) => ({
      id: `${p.provider_id ?? p.provider_key ?? p.name}:${m?.model ?? ""}`,
      provider: p.provider_name ?? p.name ?? p.provider_key ?? "—",
      tier: m?.tier ?? m?.model ?? "—",
      p95_latency_ms: m?.latency_ms?.p95 ?? m?.p95 ?? null,
      success_rate: m ? +((1 - (m.error_rate ?? 0)) * 100).toFixed(1) : null,
      requests_24h: m?.requests ?? null,
      status: p.status ?? "active",
    }));
  });

  const failedRows: FailedJob[] = unwrap(failed.data) ?? [];
  const [jobState, setJobState] = useState<Record<string, string>>({});

  async function retry(j: FailedJob) {
    try {
      await api.post(`/observability/failed-jobs/${j.id}/retry`, {});
      setJobState((m) => ({ ...m, [j.id]: "retried" }));
      toast("Job re-enqueued");
    } catch (e) {
      toast(errMessage(e));
    }
  }
  async function resolve(j: FailedJob) {
    const note = window.prompt("Resolve — add a triage note:") ?? "";
    try {
      await api.post(`/observability/failed-jobs/${j.id}/resolve`, { note });
      setJobState((m) => ({ ...m, [j.id]: "resolved" }));
      toast("Job resolved");
    } catch (e) {
      toast(errMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Observability</h2>
          <p>Platform health, job throughput and AI provider status.</p>
        </div>
        <span className="live-chip">
          <span className="live-dot" />
          Live · refreshes every {REFRESH / 1000}s
        </span>
      </div>

      <div className="sys" style={{ marginBottom: 16 }}>
        <div className="s">
          <div className="k">
            <span className={"led " + (stalled ? "warn" : "ok")} />
            Job queue
          </div>
          <div className="v">{queues.loading ? "—" : stalled ? "Degraded" : "Healthy"}</div>
          <div className="vs">
            {workers ?? "—"} workers · {stalled} stalled
          </div>
        </div>
        <div className="s">
          <div className="k">
            <span className="led ok" />
            Queue depth
          </div>
          <div className="v">{depth != null ? depth : "—"}</div>
          <div className="vs">pending jobs</div>
        </div>
        <div className="s">
          <div className="k">
            <span className="led ok" />
            Active workers
          </div>
          <div className="v">
            {workers != null ? `${workers} / ${workersTotal}` : "—"}
          </div>
          <div className="vs">heartbeats</div>
        </div>
        <div className="s">
          <div className="k">
            <span className="led ok" />
            Avg wait
          </div>
          <div className="v">{avgWait != null ? `${avgWait}s` : "—"}</div>
          <div className="vs">queue latency</div>
        </div>
      </div>

      <div className="row two2">
        <div className="card">
          <div className="chead">
            <div>
              <h3>Job throughput</h3>
              <div className="csub">Jobs per minute, recent window</div>
            </div>
            {summary && (
              <div className="csub" style={{ textAlign: "right", fontSize: 12 }}>
                {(summary.success_rate * 100).toFixed(1)}% success · p50 {summary.latency_ms?.p50 ?? "—"}ms · p95 {summary.latency_ms?.p95 ?? "—"}ms
              </div>
            )}
          </div>
          {throughput.loading ? (
            <Skeleton rows={4} />
          ) : series.length === 0 ? (
            <div className="csub" style={{ padding: "26px 0" }}>
              {throughput.error ? throughput.error : "No throughput data."}
            </div>
          ) : (
            <div className="bars" style={{ marginTop: 10 }}>
              {series.map((s: any, i: number) => {
                const h = Math.round(((s.jobs_per_min ?? 0) / maxT) * 140);
                const showLbl = i % Math.ceil(series.length / 8) === 0;
                return (
                  <div className="bar" key={s.t ?? i} title={`${hhmm(s.t)} · ${s.jobs_per_min} jobs/min`}>
                    <div className="stack" style={{ height: h }}>
                      <div className="seg-plan" style={{ height: h }} />
                    </div>
                    <div className="lbl">{showLbl ? hhmm(s.t) : ""}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Queue &amp; workers</h3>
          <div className="csub">Real-time</div>
          <div className="trow-lbl" style={{ borderTop: 0 }}>
            Queue depth <b>{depth != null ? `${depth} jobs` : "—"}</b>
          </div>
          <div className="trow-lbl">
            Active workers <b>{workers != null ? `${workers} / ${workersTotal}` : "—"}</b>
          </div>
          <div className="trow-lbl">
            Stalled jobs <b>{stalled}</b>
          </div>
          <div className="trow-lbl">
            Avg wait <b>{avgWait != null ? `${avgWait}s` : "—"}</b>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead">
          <div>
            <h3>AI provider health</h3>
            <div className="csub">Provider-independent routing</div>
          </div>
        </div>
        {aiHealth.loading ? (
          <Skeleton rows={3} />
        ) : aiHealth.error ? (
          <ErrorBox message={aiHealth.error} onRetry={aiHealth.reload} />
        ) : aiRows.length === 0 ? (
          <div className="csub" style={{ padding: "14px 0" }}>No AI health data.</div>
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Role</th>
                <th className="r">p95 latency</th>
                <th className="r">Success</th>
                <th className="r">Requests 24h</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {aiRows.map((p, i) => (
                <tr key={p.id ?? p.provider ?? i}>
                  <td className="t-name">{p.provider ?? p.name}</td>
                  <td className="num">{p.role ?? p.tier ?? "—"}</td>
                  <td className="num r">{p.p95_latency_ms != null ? `${p.p95_latency_ms}ms` : p.p95 ?? "—"}</td>
                  <td className="num r">{p.success_rate != null ? `${p.success_rate}%` : "—"}</td>
                  <td className="num r">{p.requests_24h ?? p.volume ?? "—"}</td>
                  <td>
                    <StatusChip status={p.status ?? "operational"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="chead">
          <div>
            <h3>Recent failed jobs</h3>
            <div className="csub">Errors in the last 24 hours</div>
          </div>
        </div>
        {failed.loading ? (
          <Skeleton rows={4} />
        ) : failed.error ? (
          <ErrorBox message={failed.error} onRetry={failed.reload} />
        ) : failedRows.length === 0 ? (
          <div className="csub" style={{ padding: "14px 0" }}>No failed jobs. </div>
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Tenant</th>
                <th>Job</th>
                <th>Attempts</th>
                <th>Error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {failedRows.map((j) => {
                const acted = jobState[j.id];
                return (
                  <tr key={j.id}>
                    <td className="num" style={{ color: "var(--slate-500)", fontSize: 12 }}>
                      {hhmm(j.failed_at) || "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{(j.tenant_id ?? "—").slice(0, 8)}</td>
                    <td className="num">{j.job_type ?? "—"}</td>
                    <td className="num">{j.attempt != null ? `${j.attempt}/${j.max_attempts ?? "?"}` : "—"}</td>
                    <td style={{ fontSize: 12.5 }}>
                      <span className="chip suspended">{j.error_class ?? "Error"}</span>{" "}
                      <span style={{ color: "var(--slate-500)" }}>{j.error_message ?? ""}</span>
                    </td>
                    <td className="r">
                      {acted ? (
                        <span style={{ color: "var(--slate-400)", fontSize: 12 }}>
                          {acted === "retried" ? "Retried" : "Resolved"}
                        </span>
                      ) : canManage ? (
                        <>
                          <button className="rowbtn" onClick={() => retry(j)}>
                            Retry
                          </button>{" "}
                          <button className="rowbtn" onClick={() => resolve(j)}>
                            Resolve
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

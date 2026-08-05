"use client";
// Shared machinery for every module surface.
//
// The review pattern is the app's signature interaction (blueprint §5): the AI
// proposal on one side, its source on the other, accept or correct inline.
// Every surface below is a variation on it, so the parts live here once.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/apiclient";
import { useCan, useToast, Drawer } from "@/lib/ui";
import { Icon } from "@/lib/icons";
import { humanize, typeLabel } from "@/lib/catalog";
import { confPct } from "@/lib/chain";
import { useI18n, type Key } from "@/lib/i18n";
import type { ChainStage } from "@/lib/chain";

export interface SurfaceProps {
  pid: string;
  stage: ChainStage;
  /** Every live artifact on the project (superseded excluded). */
  artifacts: any[];
  /** Artifacts this stage produced. */
  rows: any[];
  workflows: { key: string; name: string; moduleKey: string }[];
  runs: any[];
  reload: () => void;
}

/* ── Actions on a proposal ───────────────────────────────────────────────── */

export function useArtifactActions(pid: string, reload: () => void) {
  const toast = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const confirm = useCallback(async (id: string) => {
    setBusy(true);
    try { await api.post(`/projects/${pid}/artifacts/${id}/confirm`); toast(t("toast.confirmed")); reload(); }
    catch (e: any) { toast(e?.message ?? t("toast.confirmFail")); }
    finally { setBusy(false); }
  }, [pid, reload, toast, t]);

  const reject = useCallback(async (id: string) => {
    setBusy(true);
    try { await api.post(`/projects/${pid}/artifacts/${id}/reject`); toast(t("toast.rejected")); reload(); }
    catch (e: any) { toast(e?.message ?? t("toast.rejectFail")); }
    finally { setBusy(false); }
  }, [pid, reload, toast, t]);

  /** An edit supersedes the artifact and marks everything derived from it stale. */
  const correct = useCallback(async (id: string, payload: any) => {
    setBusy(true);
    try {
      const r = await api.patch<{ staleCount: number }>(`/projects/${pid}/artifacts/${id}`, { payload });
      toast(r.staleCount ? t("toast.correctionStale", { n: r.staleCount }) : t("toast.correctionSaved"));
      reload();
      return true;
    } catch (e: any) { toast(e?.message ?? t("toast.saveFail")); return false; }
    finally { setBusy(false); }
  }, [pid, reload, toast, t]);

  /** Bulk-accept the proposals the agent was already confident about. */
  const confirmMany = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    let n = 0;
    for (const id of ids) {
      try { await api.post(`/projects/${pid}/artifacts/${id}/confirm`); n++; } catch { /* keep going */ }
    }
    toast(t("toast.bulkAccepted", { n }));
    reload();
    setBusy(false);
  }, [pid, reload, toast, t]);

  return { confirm, reject, correct, confirmMany, busy };
}

/* ── Stage header: what this module is, and how to run it ────────────────── */

export function StageHeader({
  stage, workflows, runs, pid, reload, right,
}: {
  stage: ChainStage;
  workflows: { key: string; name: string; moduleKey: string }[];
  runs: any[];
  pid: string;
  reload: () => void;
  right?: React.ReactNode;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const canRun = useCan("workflow.run");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");
  const mine = workflows.filter((w) => w.moduleKey === stage.key);
  const mineKeys = new Set(mine.map((w) => w.key));
  const active = runs.find((r) => mineKeys.has(r.workflow_key) && (r.status === "running" || r.status === "awaiting_review"));

  async function start(key: string) {
    if (!key) return;
    setBusy(true);
    try { await api.post(`/projects/${pid}/runs`, { workflow_key: key }); toast(t("toast.runStarted")); reload(); }
    catch (e: any) { toast(e?.message ?? t("toast.runFail")); }
    finally { setBusy(false); }
  }

  const selected = choice || mine[0]?.key || "";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate-400)" }}>{stage.full}</span>
        {active && (
          <span className="chip running">
            {active.status === "awaiting_review" ? t("stage.paused") : t("stage.running")}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {right}
        {/* One or two workflows read fine as buttons; a pack with six needs a
            picker, or the header turns into a wall of verbs. */}
        {canRun && mine.length > 0 && (
          mine.length <= 2 ? (
            mine.map((w) => (
              <button key={w.key} className="mini sm" disabled={busy || !!active} onClick={() => start(w.key)} title={w.key}>
                ▶ {w.name}
              </button>
            ))
          ) : (
            <>
              <select
                className="mono"
                aria-label={t("stage.workflowLabel", { stage: stage.full })}
                value={selected}
                onChange={(e) => setChoice(e.target.value)}
                style={{ fontSize: 11.5, padding: "6px 9px", border: "1px solid var(--hairline)", borderRadius: 7, background: "var(--panel-2)", color: "var(--ink)", maxWidth: 220 }}
              >
                {mine.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
              </select>
              <button className="mini sm" disabled={busy || !!active || !selected} onClick={() => start(selected)}>▶ {t("stage.run")}</button>
            </>
          )
        )}
      </div>
    </div>
  );
}

/* ── Empty stage — honest about why there's nothing here ─────────────────── */

export function StageEmpty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="placeholder">
      <div className="pic"><Icon.clock /></div>
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  );
}

/* ── Provenance — "where did this number come from?" ─────────────────────── */

interface Trace {
  artifact: { id: string; type: string; status: string; confidence: number | null; version: number };
  provenance: { source_artifact_id: string; type_key: string }[];
  producingJob: { job_type: string; model: string | null; tier: string; trace_id: string | null } | null;
  auditEvents: { seq: number; action: string; created_at: string }[];
}

/** The source panel inside a review drawer: what this artifact was derived from. */
export function SourceTrace({ pid, artifactId, artifacts }: { pid: string; artifactId: string; artifacts: any[] }) {
  const { t } = useI18n();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTrace(null);
    setErr(null);
    api.get<Trace>(`/projects/${pid}/artifacts/${artifactId}/trace`)
      .then((res) => { if (alive) setTrace(res); })
      .catch((e) => { if (alive) setErr(e?.message ?? t("review.traceFail")); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, artifactId]);

  if (err) return <p className="csub">{err}</p>;
  if (!trace) return <p className="csub"><span className="spin" /> {t("review.tracing")}</p>;

  const job = trace.producingJob;
  return (
    <div className="boq-src">
      <div className="sh">
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{t("review.whereFrom")}</span>
        {trace.artifact.confidence != null && (
          <span className={"conf" + ((confPct(trace.artifact.confidence) ?? 100) < 90 ? " warn" : "")}>
            {t("review.confidence", { n: confPct(trace.artifact.confidence) ?? 0 })}
          </span>
        )}
      </div>
      {trace.provenance.length === 0 ? (
        <div style={{ padding: "11px 13px", fontSize: 12.5, color: "var(--slate-500)" }}>
          {t("review.noUpstream")}
        </div>
      ) : (
        <ul className="provlist">
          {trace.provenance.map((p) => {
            const src = artifacts.find((a) => a.id === p.source_artifact_id);
            return (
              <li key={p.source_artifact_id}>
                <span>{typeLabel(p.type_key, t)}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--slate-500)" }}>
                  {src ? summaryOf(src.payload) : p.source_artifact_id.slice(0, 8)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {job && (
        <div style={{ padding: "10px 13px", borderTop: "1px solid var(--hairline)", fontSize: 11.5, color: "var(--slate-500)" }} className="mono">
          {job.job_type} · {job.model ?? "stub agent"} · {job.tier} tier
        </div>
      )}
    </div>
  );
}

/** One-line summary of a payload — the fields a human recognises. */
export function summaryOf(payload: any): string {
  if (!payload || typeof payload !== "object") return "";
  for (const f of ["code", "sheet_no", "clause_ref", "activity", "package_name", "item", "description", "title", "project_name", "subject"]) {
    if (payload[f]) return String(payload[f]).slice(0, 42);
  }
  return "";
}

/* ── The review drawer, shared by every surface ──────────────────────────── */

export function ReviewDrawer({
  open, onClose, pid, artifact, artifacts, title, proposal, fields, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pid: string;
  artifact: any | null;
  artifacts: any[];
  title: string;
  /** The headline number/claim the agent is proposing. */
  proposal: React.ReactNode;
  /** Editable payload fields: [key, label, kind]. */
  fields: { key: string; label: Key; kind?: "number" | "text" | "textarea" }[];
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { confirm, correct, reject, busy } = useArtifactActions(pid, onSaved);
  const canConfirm = useCan("artifact.confirm");
  const canEdit = useCan("artifact.edit");
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** Opened deliberately on an already-confirmed record — see below. */
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (!artifact) return;
    const d: Record<string, string> = {};
    for (const f of fields) d[f.key] = artifact.payload?.[f.key] == null ? "" : String(artifact.payload[f.key]);
    setDraft(d);
    setCorrecting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.id]);

  if (!artifact) return null;
  const confirmed = artifact.status === "confirmed";
  const rejected = artifact.status === "rejected";

  // A confirmed record used to be read-only here, which left the estimator with
  // no way to fix a number they had already accepted — the one correction that
  // matters most, because by then it is carrying a bill. The store has always
  // supported it (a new version supersedes and everything derived goes stale);
  // only this drawer refused. It is now behind a deliberate second click, with
  // the consequence stated, rather than behind nothing at all.
  const editable = canEdit && (correcting || (!confirmed && !rejected));

  async function save() {
    const payload = { ...artifact.payload };
    for (const f of fields) {
      const raw = draft[f.key];
      if (raw === "" || raw == null) continue;
      payload[f.key] = f.kind === "number" ? Number(raw) : raw;
    }
    if (await correct(artifact.id, payload)) { onClose(); }
  }

  return (
    <Drawer
      open={open}
      title={title}
      onClose={onClose}
      footer={
        rejected ? (
          <button className="mini" onClick={onClose}>{t("common.close")}</button>
        ) : confirmed ? (
          correcting ? (
            <>
              <button className="mini" disabled={busy} onClick={() => setCorrecting(false)}>{t("common.cancel")}</button>
              <button className="mini pri" disabled={busy} onClick={save}>{t("review.saveCorrection")}</button>
            </>
          ) : (
            <>
              <button className="mini" onClick={onClose}>{t("common.close")}</button>
              {canEdit && <button className="mini" onClick={() => setCorrecting(true)}>{t("review.correctThis")}</button>}
            </>
          )
        ) : (
          <>
            {canEdit && <button className="mini" disabled={busy} onClick={save}>{t("review.saveCorrection")}</button>}
            {canConfirm && <button className="mini" disabled={busy} onClick={() => reject(artifact.id).then(onClose)}>{t("review.rejected")}</button>}
            {canConfirm && <button className="mini pri" disabled={busy} onClick={() => confirm(artifact.id).then(onClose)}>{t("review.acceptAsIs")}</button>}
          </>
        )
      }
    >
      <div className="boq-prop">
        <div className="lab">{artifact.source === "human" ? t("review.humanEntry") : t("review.aiProposal")}</div>
        {proposal}
        <div style={{ fontSize: 12.5, color: "var(--slate-500)", marginTop: 8 }}>
          {t("review.meta", { agent: humanize(artifact.source_agent_key ?? "agent"), version: artifact.version, status: humanize(artifact.status) })}
        </div>
      </div>

      <SourceTrace pid={pid} artifactId={artifact.id} artifacts={artifacts} />

      {correcting && (
        <div className="synth warn" style={{ marginBottom: 12 }}>
          <span>{t("review.correctWarn")}</span>
        </div>
      )}

      {editable && fields.map((f) => (
        <div className="fld" key={f.key}>
          <label className="fl" htmlFor={`rf-${f.key}`}>{t(f.label)}</label>
          {/* A specification clause or a narrative section is paragraphs, and
              paragraphs typed into a one-line box cannot be read back while you
              write them. */}
          {f.kind === "textarea" ? (
            <textarea
              id={`rf-${f.key}`}
              rows={8}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          ) : (
            <input
              id={`rf-${f.key}`}
              type="text"
              className={f.kind === "number" ? "mono" : undefined}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          )}
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: "var(--slate-500)" }}>
        {rejected ? t("review.rejectedNote") : confirmed ? t("review.decidedNote") : t("review.undecidedNote")}
      </div>
    </Drawer>
  );
}

/* ── Small shared bits ───────────────────────────────────────────────────── */

export function ConfChip({ c }: { c: number | null | undefined }) {
  const pct = confPct(c);
  if (pct == null) return null;
  return <span className={"conf" + (pct < 90 ? " warn" : "")}>{pct}%</span>;
}

export function StatusCell({ a, onReview }: { a: any; onReview: (a: any) => void }) {
  const { t } = useI18n();
  if (a.status === "confirmed") {
    return (
      <span className="acc">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12l4 4 10-10" /></svg>
        {t("review.accepted")}
      </span>
    );
  }
  if (a.status === "rejected") return <span className="chip rejected">{t("review.rejected")}</span>;
  return (
    <>
      <ConfChip c={a.confidence} />{" "}
      <button className="rowbtn" onClick={() => onReview(a)}>{a.status === "stale" ? t("review.reReview") : t("review.review")}</button>
    </>
  );
}

/** Rows a stage is waiting on, and the high-confidence subset worth bulk-accepting. */
export function pendingOf(rows: any[]) {
  const pending = rows.filter((a) => a.status === "pending" || a.status === "stale");
  const highConf = pending.filter((a) => (confPct(a.confidence) ?? 0) >= 90).map((a) => a.id);
  return { pending, highConf };
}

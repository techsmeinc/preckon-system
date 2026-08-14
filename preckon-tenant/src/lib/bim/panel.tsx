"use client";
// The BIM Studio panel as it appears on the Drawings stage: loads the project's
// model, hands it to the Studio, and saves it back with optimistic concurrency.

import { useEffect, useState } from "react";
import { api } from "@/lib/apiclient";
import { useApi, useCan, useToast, Skeleton, ErrorBox } from "@/lib/ui";
import { useI18n, type Key } from "@/lib/i18n";
import { BimStudio } from "./studio";
import { emptyDocument, type BimDocument } from "./model";
import { SPECIALIST_LIST } from "./agents";
import type { DocDiff } from "./proposal";
import { AuthoringPanel } from "./authoring-panel";
import { GetDesktop } from "@/lib/desktopLink";

interface Loaded { doc: BimDocument; version: number }

/** One tool call, as the route reports it. */
interface TraceEntry {
  tool: string; label: string; module: string; scope: string;
  kind: string; ok: boolean; summary: string; data?: unknown; affected?: number;
}

interface AgentResponse {
  reply: string;
  applied: number;
  assumptions?: string[];
  trace?: TraceEntry[];
  /** Present when the assistant asked instead of guessing. */
  question?: string;
  proposal: string | null;
  diff: DocDiff | null;
  skipped?: { name: string; reason: string }[];
}

export function BimStudioPanel({ pid, onMeasured }: { pid: string; onMeasured?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const canEdit = useCan("artifact.edit");
  const { data, loading, error, reload } = useApi<Loaded>(`/projects/${pid}/bim`);
  const [savedOnce, setSavedOnce] = useState(false);

  const [measuring, setMeasuring] = useState(false);
  const [full, setFull] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [specialist, setSpecialist] = useState("all");
  const [drawing, setDrawing] = useState(false);
  /* What the assistant is offering, awaiting a decision. Survives nothing but
     this session on purpose — the server keeps the authoritative copy, and it
     is re-read on load so a reload never loses an unanswered proposal. */
  const [proposal, setProposal] = useState<{ id: string; diff: DocDiff; reply: string; assumptions: string[] } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [nonce, setNonce] = useState(0);
  /* Which tools ran, in order. Shown because an assistant that edits a building
     model should be legible: the estimator can see it looked before it wrote,
     and which tool did the writing. */
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [openTrace, setOpenTrace] = useState<number | null>(null);
  /* The assistant could not tell what was meant. Kept separate from a failure —
     a question is the RIGHT outcome for an ambiguous instruction, and the
     original wording stays in the box so it can be amended rather than retyped. */
  const [question, setQuestion] = useState<string | null>(null);
  /* Authoring is a different job from drawing, so it is folded away rather than
     competing with the canvas. Open it when you want to build a tool; the rest
     of the time it is one line. */
  const [authoring, setAuthoring] = useState(false);

  /* Ask the assistant to draw.
     It comes back with a PROPOSAL, not a changed model: what it would add, in
     plain language, for a person to accept or throw away. The model is not
     touched until somebody presses Apply — which is the difference between an
     assistant and something that edits your drawing while you watch. */
  async function draw() {
    const text = instruction.trim();
    if (!text) return;
    setDrawing(true);
    setQuestion(null);
    try {
      const r = await api.post<AgentResponse>(`/projects/${pid}/bim/agent`, { instruction: text, specialist });
      setTrace(r.trace ?? []);

      if (r.question) {
        // Ambiguous, and it said so instead of guessing. The instruction stays
        // put so the answer can be appended to it.
        setQuestion(r.question);
      } else if (r.proposal && r.diff) {
        setProposal({ id: r.proposal, diff: r.diff, reply: r.reply, assumptions: r.assumptions ?? [] });
        setInstruction("");
      } else {
        // It answered without changing anything — a query rather than an
        // instruction. Say what it said and leave the model alone.
        toast(r.reply || t("bim.noChange"));
      }
    } catch (e: any) {
      toast(e?.message ?? t("bim.drawFail"), "bad");
    } finally { setDrawing(false); }
  }

  /** Accept the proposal, or bin it. Only this writes to the model. */
  async function decide(decision: "apply" | "discard") {
    if (!proposal) return;
    setDeciding(true);
    try {
      const r = await api.post<{ applied: boolean }>(`/projects/${pid}/bim/proposal`, { id: proposal.id, decision });
      toast(r.applied ? t("bim.proposalApplied") : t("bim.proposalDiscarded"));
      setProposal(null);
      if (r.applied) { setNonce((n) => n + 1); reload(); }
    } catch (e: any) {
      toast(e?.message ?? t("bim.drawFail"), "bad");
    } finally { setDeciding(false); }
  }


  async function save(doc: BimDocument, baseVersion: number): Promise<number> {
    const r = await api.put<{ version: number }>(`/projects/${pid}/bim`, { doc, baseVersion });
    toast(t("bim.saved"));
    setSavedOnce(true);
    return r.version;
  }

  /** Measure the saved model into drawing_measurement records — the join that
   *  puts modelled geometry into the BOQ. */
  async function measure() {
    setMeasuring(true);
    try {
      const r = await api.post<{ emitted: number; superseded: number }>(`/projects/${pid}/bim/takeoff`);
      toast(t("bim.takeoffDone", { n: r.emitted }));
      onMeasured?.();
    } catch (e: any) {
      toast(e?.message ?? t("bim.takeoffFail"), "bad");
    } finally { setMeasuring(false); }
  }

  /* Full screen belongs here rather than inside the canvas: the thing an
     estimator needs room for is the whole studio — the discipline ribbon, the
     catalogue they place from, and the instruction box — not just the drawing
     they are placing into. A canvas alone at full size can be read and not
     edited. Escape leaves, so there is always a way back out. */
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  /* Take the model's measurements back out of the register. Superseded rather
     than deleted, so anything already derived from them stays traceable. */
  async function clearTakeoff() {
    if (!window.confirm(t("bim.clearConfirm"))) return;
    setMeasuring(true);
    try {
      const r = await api.del<{ superseded: number }>(`/projects/${pid}/bim/takeoff`);
      toast(r.superseded ? t("bim.cleared", { n: r.superseded }) : t("bim.clearNone"));
      onMeasured?.();
    } catch (e: any) {
      toast(e?.message ?? t("bim.takeoffFail"), "bad");
    } finally { setMeasuring(false); }
  }

  if (loading) return <Skeleton rows={6} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className={"card bim-studio" + (full ? " is-full" : "")} style={full ? undefined : { marginBottom: 16 }}>
      <div className="chead">
        <div><h2>{t("bim.studio")}</h2><div className="csub">{t("bim.studioSub")}</div></div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* The workstation runs this exact panel, so it hides itself there. */}
          <GetDesktop />
        {canEdit && (
          <>
            {/* Measuring is one click that writes a hundred records. The click
                that undoes it belongs next to it, not in a support email. */}
            <button className="mini sm" onClick={clearTakeoff} disabled={measuring}>
              {t("bim.clearTakeoff")}
            </button>
            <button className="mini sm" onClick={measure} disabled={measuring}>
              {measuring ? t("bim.measuring") : t("bim.takeoff")}
            </button>
          </>
        )}
        </div>
      </div>
      {canEdit && (
        <div className="bim-ask">
          <select value={specialist} onChange={(e) => setSpecialist(e.target.value)} aria-label={t("bim.specialist")}>
            {SPECIALIST_LIST.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") draw(); }}
            placeholder={t("bim.askPlaceholder")}
            aria-label={t("bim.ask")}
            disabled={drawing}
          />
          <button className="mini sm pri" onClick={draw} disabled={drawing || !instruction.trim()}>
            {drawing ? t("bim.drawing") : t("bim.draw")}
          </button>
        </div>
      )}

      {/* What it did, step by step. An assistant that edits a building model
          has to be legible: this shows it looked before it wrote, which tool
          wrote, and what came back. Collapsed by default — it is evidence to
          reach for, not a thing to read every time. */}
      {trace.length > 0 && (
        <ol className="bim-trace">
          {trace.map((s, i) => (
            <li key={i} className={"bt-step" + (s.ok ? "" : " is-bad")}>
              <button
                type="button"
                className="bt-head"
                aria-expanded={openTrace === i}
                onClick={() => setOpenTrace(openTrace === i ? null : i)}
              >
                <span className="bt-dot" aria-hidden />
                <b>{s.label}</b>
                <span className="bt-mod">{s.module}</span>
                {s.scope === "personal" && <span className="bt-scope">{t("bim.toolPersonal")}</span>}
                <span className="csub bt-sum">{s.summary}</span>
              </button>
              {openTrace === i && s.data !== undefined && (
                <pre className="bt-data mono">{JSON.stringify(s.data, null, 2)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* It asked rather than guessed. Deliberately not a toast: a question
          needs to stay on screen while the answer is typed. */}
      {question && (
        <div className="bim-question">
          <b>{t("bim.questionTitle")}</b>
          <p>{question}</p>
          <span className="csub">{t("bim.questionHint")}</span>
        </div>
      )}

      {/* The proposal. Shown as what it is: a suggestion with a size, and two
          buttons. The model underneath is untouched until Apply is pressed. */}
      {proposal && (
        <div className="bim-proposal">
          <div className="bp-head">
            <b>{t("bim.proposalTitle")}</b>
            <span className="mono">{proposal.diff.summary}</span>
          </div>
          {proposal.reply && <p className="csub bp-reply">{proposal.reply}</p>}

          {/* Anything the assistant decided for itself, said out loud. A guess
              a reviewer never sees is a guess they cannot correct. */}
          {proposal.assumptions.length > 0 && (
            <ul className="bp-assumed">
              {proposal.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}

          {/* Itemised, up to a point. A reviewer who cannot see WHAT changed
              approves everything, which is the same as not being asked. */}
          <ul className="sch-notes bp-list">
            {proposal.diff.added.slice(0, 8).map((a) => <li key={a.id}>+ {a.label}</li>)}
            {proposal.diff.changed.slice(0, 8).map((c) => (
              <li key={c.id}>~ {c.label} <span className="csub">({c.fields.join(", ")})</span></li>
            ))}
            {proposal.diff.removed.slice(0, 8).map((r) => <li key={r.id}>− {r.label}</li>)}
            {proposal.diff.added.length + proposal.diff.changed.length + proposal.diff.removed.length > 24 && (
              <li className="csub">…and more — apply to see the whole model</li>
            )}
          </ul>

          <div className="bp-actions">
            <button className="mini sm pri" onClick={() => decide("apply")} disabled={deciding}>
              {deciding ? t("bim.applying") : t("bim.proposalApply")}
            </button>
            <button className="mini sm" onClick={() => decide("discard")} disabled={deciding}>
              {t("bim.proposalDiscard")}
            </button>
          </div>
        </div>
      )}

      {/* Authoring mode. Behind a disclosure because building a tool and drawing
          with one are different jobs, and the canvas should not lose room to a
          form nobody has opened. */}
      {canEdit && (
        <div className="bim-auth-wrap">
          <button
            type="button"
            className="bim-auth-toggle"
            aria-expanded={authoring}
            onClick={() => setAuthoring((v) => !v)}
          >
            <span aria-hidden>{authoring ? "▾" : "▸"}</span> {t("auth.title")}
            <span className="csub">{t("auth.sub")}</span>
          </button>
          {authoring && <AuthoringPanel pid={pid} />}
        </div>
      )}

      <BimStudio
        // The assistant rewrites the document server-side, so remount on its
        // result; manual edits between draws are preserved by Save.
        key={`studio-${nonce}`}
        initialDoc={data?.doc ?? emptyDocument()}
        version={data?.version ?? 0}
        onSave={save}
        readOnly={!canEdit}
        full={full}
        onToggleFull={() => setFull((v) => !v)}
        t={(k, vars) => t(k as Key, vars)}
      />
    </div>
  );
}

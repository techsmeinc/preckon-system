"use client";
// NarrativeLogix — the technical submission. Seven sections, always shown in
// the order an evaluator reads them, whether or not they have been written yet.
//
// The empty rows are the point. A submission is scored section by section, and
// the failure that costs a bid is not a weak section but a missing one — so the
// screen names all seven from the start and shows which are still blank, rather
// than listing only what happens to exist and letting an absence look like an
// intention.

import { useMemo, useState } from "react";
import {
  ReviewDrawer, StageHeader, StatusCell, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/apiclient";
import { useCan, useToast } from "@/lib/ui";

/** The submission's fixed running order. */
const SECTIONS: Array<{ key: string; title: string; desc: string }> = [
  { key: "executive_summary", title: "Executive Summary", desc: "Understanding, approach, differentiators" },
  { key: "company_profile", title: "Company Profile", desc: "Track record, comparable experience, certifications" },
  { key: "technical_approach", title: "Technical Approach & Methodology", desc: "Method per discipline, sequencing, plant, standards" },
  { key: "programme", title: "Project Programme", desc: "Phases, milestones, critical path, early procurement" },
  { key: "quality", title: "Quality Assurance Plan", desc: "QA/QC framework, ITPs, non-conformance, standards" },
  { key: "hse", title: "Health, Safety & Environment", desc: "HSE system, HIRAC, environmental controls, emergency" },
  { key: "risk_management", title: "Risk Management", desc: "Key project risks with specific mitigations" },
];

/** Minimal markdown → readable blocks. Headings, bullets and paragraphs cover
 *  everything the narrative prompt asks for; anything else renders as prose
 *  rather than showing the reader raw syntax. */
function Markdown({ src }: { src: string }) {
  const blocks = useMemo(() => {
    const out: React.ReactNode[] = [];
    let list: string[] = [];
    const flush = (i: number) => {
      if (!list.length) return;
      out.push(<ul key={`u${i}`} style={{ margin: "6px 0 10px", paddingInlineStart: 20, lineHeight: 1.75 }}>{list.map((li, j) => <li key={j}>{li}</li>)}</ul>);
      list = [];
    };
    src.split("\n").forEach((raw, i) => {
      const line = raw.trimEnd();
      if (/^\s*[-*]\s+/.test(line)) { list.push(line.replace(/^\s*[-*]\s+/, "")); return; }
      flush(i);
      if (!line.trim()) return;
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        const level = h[1].length;
        out.push(
          <div key={i} style={{ fontWeight: 600, fontSize: level <= 2 ? 15 : 13.5, marginTop: level <= 2 ? 18 : 12, marginBottom: 4 }}>
            {h[2]}
          </div>
        );
        return;
      }
      out.push(<p key={i} style={{ margin: "0 0 10px", lineHeight: 1.75 }}>{line}</p>);
    });
    flush(9999);
    return out;
  }, [src]);
  return <div style={{ fontSize: 13.5 }}>{blocks}</div>;
}

export default function NarrativeSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const [open, setOpen] = useState<string | null>("executive_summary");
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const canRun = useCan("workflow.run");
  const toast = useToast();
  const [gen, setGen] = useState<string | null>(null);

  // One section at a time. A reviewer rejects HSE, or the programme moves and
  // only that section is stale — re-running all seven to fix one is slow and
  // rewrites six sections somebody had already accepted.
  async function generate(section: string) {
    setGen(section);
    try {
      await api.post(`/projects/${pid}/narrative/${section}`, {});
      toast(t("narrative.generating"));
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("common.loadFail"));
    } finally {
      setGen(null);
    }
  }
  const { pending, highConf } = pendingOf(rows);

  // Written sections keyed by their section id, newest first so a re-run
  // supersedes rather than duplicates on screen.
  const bySection = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rows) {
      const k = r.payload?.section;
      if (k && !m.has(k)) m.set(k, r);
    }
    return m;
  }, [rows]);

  const written = SECTIONS.filter((s) => bySection.get(s.key)?.payload?.word_count > 0).length;
  const words = rows.reduce((n, r) => n + (Number(r.payload?.word_count) || 0), 0);

  // No early empty state. The seven sections are the screen — a bid team needs
  // to see what the submission WILL contain, and to start any section, before
  // anything has been written. An empty-state card would hide both.

  return (
    <>
      <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />

      <div className="boq-sum">
        <div className="s"><div className="k">{t("narrative.sectionsWritten")}</div><div className="v">{written}/{SECTIONS.length}</div></div>
        <div className="s"><div className="k">{t("narrative.words")}</div><div className="v">{words.toLocaleString()}</div></div>
        <div className="s"><div className="k">{t("boq.needsReview")}</div><div className={"v" + (pending.length ? " warn" : "")}>{pending.length}</div></div>
      </div>

      <div className="card" style={{ padding: "14px 18px" }}>
        <div className="chead">
          <div>
            <h3>{t("narrative.title")}</h3>
            <div className="csub">{t("narrative.titleSub")}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a className="mini" href={`/api/v1/projects/${pid}/narrative/export.md`} download>
              {t("narrative.downloadAll")}
            </a>
            {highConf.length > 1 && (
              <button className="mini" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          {SECTIONS.map((s, i) => {
            const a = bySection.get(s.key);
            const isOpen = open === s.key;
            const empty = !a || !(Number(a.payload?.word_count) > 0);
            return (
              <div key={s.key} style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(isOpen ? null : s.key)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(isOpen ? null : s.key); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 2px", cursor: "pointer" }}
                >
                  <span className="mono" style={{ color: "var(--slate-500)", fontSize: 11 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{a?.payload?.title ?? s.title}</span>
                    <span className="csub" style={{ display: "block", fontSize: 12 }}>{s.desc}</span>
                  </span>
                  {empty
                    ? <span className="csub">{t("narrative.notWritten")}</span>
                    : <span className="csub mono">{Number(a.payload.word_count).toLocaleString()} {t("narrative.wordsShort")}</span>}
                  {canRun && (
                    <button
                      className="mini"
                      disabled={gen === s.key}
                      onClick={(e) => { e.stopPropagation(); generate(s.key); }}
                    >
                      {gen === s.key ? t("narrative.generating") : empty ? t("narrative.generate") : t("narrative.regenerate")}
                    </button>
                  )}
                  {a && <StatusCell a={a} onReview={setReview} />}
                </div>

                {isOpen && a && !empty && (
                  <div style={{ padding: "4px 2px 18px" }}>
                    <Markdown src={String(a.payload.body_md ?? "")} />
                    {a.payload.grounded_in && (
                      <div className="csub" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                        <b>{t("narrative.groundedIn")}</b> {a.payload.grounded_in}
                      </div>
                    )}
                  </div>
                )}
                {isOpen && empty && (
                  <div className="csub" style={{ padding: "0 2px 18px" }}>{t("narrative.notWrittenSub")}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review?.payload?.title ?? ""}
        proposal={<div className="csub">{Number(review?.payload?.word_count ?? 0).toLocaleString()} {t("narrative.wordsShort")}</div>}
        fields={[{ key: "title", label: "narrative.fieldTitle" }, { key: "body_md", label: "narrative.fieldBody" }]}
        onSaved={reload}
      />
    </>
  );
}

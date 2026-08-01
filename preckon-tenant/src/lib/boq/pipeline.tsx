"use client";
// How the bill was built — the multi-agent pipeline, made visible.
//
// A reviewer facing two hundred priced lines needs to know who wrote them.
// This shows the roster the Agent Designer invented for THIS project (not a
// fixed list of trades), which division each specialist owned, and how the
// project-specific completeness checks came out — including the lines a check
// found missing and priced, which deserve a closer read than the rest.

import { useState } from "react";
import { useApi } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";

interface Specialist {
  key: string;
  label: string;
  expertise?: string;
  vocabulary?: string[];
  measurementGuide?: string;
  ownedSections?: string[];
}
interface Verdict {
  key: string;
  topic: string;
  covered: boolean | null;
  evidence: string | null;
  added: number;
}
interface Roster {
  projectType?: string;
  projectDescription?: string;
  scopeAreas?: string[];
  reasoning?: string;
  specialists?: Specialist[];
  verifierChecks?: Array<{ key: string; topic: string; description: string; rationale?: string }>;
  verdicts?: Verdict[];
  trace?: Array<{ stage: string; message: string }>;
  isFallback?: boolean;
}

export function BoqPipeline({ pid }: { pid: string }) {
  const { t } = useI18n();
  const { data } = useApi<{ roster: Roster | null; ran_at?: string; model?: string }>(
    `/projects/${pid}/boq/roster`
  );
  const [open, setOpen] = useState(false);

  const roster = data?.roster;
  if (!roster || roster.isFallback) return null;

  const specialists = roster.specialists ?? [];
  const verdicts = roster.verdicts ?? [];
  const gaps = verdicts.filter((v) => v.covered === false);
  const unknown = verdicts.filter((v) => v.covered === null);

  return (
    <div className="card boqpipe" style={{ marginBottom: 16 }}>
      <div className="chead">
        <div>
          <h3>{t("pipe.title")}</h3>
          <div className="csub">
            {roster.projectType ? `${roster.projectType} · ` : ""}
            {t("pipe.sub", { specialists: specialists.length, checks: verdicts.length })}
          </div>
        </div>
        <button className="mini sm" onClick={() => setOpen((o) => !o)}>
          {open ? t("pipe.hide") : t("pipe.show")}
        </button>
      </div>

      <div className="pipe-stages">
        <Stage n={1} label={t("pipe.outline")} sub={t("pipe.outlineSub")} done />
        <Stage n={2} label={t("pipe.designer")} sub={t("pipe.designerSub", { n: specialists.length })} done />
        <Stage n={3} label={t("pipe.sections")} sub={t("pipe.sectionsSub", { n: specialists.length })} done />
        <Stage
          n={4}
          label={t("pipe.verifier")}
          sub={t("pipe.verifierSub", { covered: verdicts.filter((v) => v.covered === true).length, total: verdicts.length })}
          done={verdicts.length > 0}
          warn={gaps.length > 0 || unknown.length > 0}
        />
      </div>

      {/* A check that FAILED is the most useful thing on this screen: it names
          scope that was missing and has now been priced. */}
      {gaps.length > 0 && (
        <div className="synth" style={{ marginTop: 10 }}>
          <span>
            {t("pipe.gaps", { n: gaps.length, lines: gaps.reduce((s, g) => s + g.added, 0) })}{" "}
            {gaps.map((g) => g.topic).join(" · ")}
          </span>
        </div>
      )}
      {unknown.length > 0 && (
        <div className="synth" style={{ marginTop: 10 }}>
          <span>{t("pipe.unknown", { n: unknown.length })}</span>
        </div>
      )}

      {open && (
        <>
          {roster.projectDescription && (
            <p className="csub" style={{ marginTop: 12 }}>{roster.projectDescription}</p>
          )}
          {roster.reasoning && (
            <p className="csub" style={{ marginTop: 6, fontStyle: "italic" }}>{roster.reasoning}</p>
          )}

          <h4 style={{ marginTop: 16 }}>{t("pipe.roster")}</h4>
          <div className="tw">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("pipe.specialist")}</th>
                  <th>{t("pipe.knows")}</th>
                  <th>{t("pipe.owns")}</th>
                </tr>
              </thead>
              <tbody>
                {specialists.map((s) => (
                  <tr key={s.key}>
                    <td><b>{s.label}</b></td>
                    <td>
                      {s.expertise}
                      {s.measurementGuide && <div className="csub">{s.measurementGuide}</div>}
                    </td>
                    <td className="mono">{(s.ownedSections ?? []).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {verdicts.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>{t("pipe.checks")}</h4>
              <div className="tw">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t("pipe.check")}</th>
                      <th>{t("common.status")}</th>
                      <th>{t("pipe.evidence")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verdicts.map((v) => (
                      <tr key={v.key} className={v.covered === false ? "warn" : ""}>
                        <td>{v.topic}</td>
                        <td>
                          {v.covered === true ? (
                            <span className="acc">{t("pipe.covered")}</span>
                          ) : v.covered === false ? (
                            <span className="conf warn">{t("pipe.added", { n: v.added })}</span>
                          ) : (
                            <span className="conf warn">{t("pipe.checkFailed")}</span>
                          )}
                        </td>
                        <td className="csub">{v.evidence ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stage({ n, label, sub, done, warn }: { n: number; label: string; sub: string; done?: boolean; warn?: boolean }) {
  return (
    <div className={"pipe-stage" + (done ? " done" : "") + (warn ? " warn" : "")}>
      <span className="pipe-n">{n}</span>
      <span className="pipe-l">
        <b>{label}</b>
        <small>{sub}</small>
      </span>
    </div>
  );
}

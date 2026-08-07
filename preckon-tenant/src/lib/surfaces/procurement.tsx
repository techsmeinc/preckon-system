"use client";
// ProcureLogix — the estimate grouped into buyout packages. Each package opens
// to its real scope: the BOQ lines its `boq_codes` point at, and what they price.
//
// HONEST LIMIT: there is no vendor or RFQ entity in the artifact schema yet, so
// this surface stops at the package. It says so rather than showing a vendor
// list that isn't backed by anything.

import { useMemo, useState } from "react";
import { ofType } from "@/lib/project";
import { money, qty } from "@/lib/chain";
import { useCan, Drawer } from "@/lib/ui";
import {
  SourceTrace, StageEmpty, StageHeader, StatusCell, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";
import { unitLabel } from "./drawings";
import { useI18n } from "@/lib/i18n";

export default function ProcurementSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<any | null>(null);
  const canConfirm = useCan("artifact.confirm");
  const { confirm, reject, confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  const boq = ofType(artifacts, "boq_line");
  const costs = ofType(artifacts, "cost_line");

  const scopeOf = (pkg: any) => {
    const codes: string[] = pkg?.payload?.boq_codes ?? [];
    return codes
      .map((code) => ({
        code,
        line: boq.find((l) => l.payload?.code === code) ?? null,
        cost: costs.find((c) => c.payload?.boq_code === code) ?? null,
      }))
      .filter((s) => s.line || s.cost);
  };

  const totals = useMemo(() => {
    const minor = rows.reduce((n, p) => n + Number(p.payload?.estimated_value_minor ?? 0), 0);
    const ccy = rows.find((p) => p.payload?.currency)?.payload?.currency ?? "";
    const lines = new Set(rows.flatMap((p) => p.payload?.boq_codes ?? [])).size;
    const lead = Math.max(0, ...rows.map((p) => Number(p.payload?.lead_time_weeks ?? 0)));
    return { minor, ccy, lines, lead };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("proc.emptyTitle")} sub={t("proc.emptySub")} />
      </>
    );
  }

  const scope = open ? scopeOf(open) : [];
  const scopeValue = scope.reduce((n, s) => n + Number(s.cost?.payload?.amount_minor ?? 0), 0);

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <div className="kpis">
        <div className="kpi"><div className="k">{t("proc.packages")}</div><div className="v">{rows.length}</div><div className="sub">{t("proc.buyoutScopes")}</div></div>
        <div className="kpi"><div className="k">{t("proc.totalValue")}</div><div className="v">{money(totals.minor, totals.ccy)}</div><div className="sub">{t("proc.acrossPackages")}</div></div>
        <div className="kpi"><div className="k">{t("proc.linesCovered")}</div><div className="v">{totals.lines}</div><div className="sub">{t("proc.ofBoqLines", { n: boq.length })}</div></div>
        <div className="kpi"><div className="k">{t("proc.longestLead")}</div><div className="v">{totals.lead ? t("sched.weeks", { n: totals.lead }) : "—"}</div><div className="sub">{t("proc.drivesEarly")}</div></div>
      </div>

      <div className="card" style={{ padding: "14px 18px" }}>
        <div className="chead">
          <div><h2>{t("proc.title")}</h2><div className="csub">{t("proc.titleSub")}</div></div>
          {pending.length > 0 && <span className="chip pending">{t("est.toConfirm", { n: pending.length })}</span>}
        </div>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr><th>{t("proc.colPackage")}</th><th>{t("proc.colTrade")}</th><th className="r">{t("proc.colLines")}</th><th className="r">{t("projects.colValue")}</th><th className="r">{t("proc.colLead")}</th><th className="r">{t("common.status")}</th><th><span className="vh">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.status === "pending" || p.status === "stale" ? "flagged" : ""}>
                <td className="t-name">{p.payload?.package_name ?? "—"}</td>
                <td>{p.payload?.trade ?? "—"}</td>
                <td className="num r">{(p.payload?.boq_codes ?? []).length}</td>
                <td className="num r">{money(p.payload?.estimated_value_minor, p.payload?.currency)}</td>
                <td className="num r">{p.payload?.lead_time_weeks != null ? t("proc.weeks", { n: p.payload.lead_time_weeks }) : "—"}</td>
                <td className="r"><StatusCell a={p} onReview={setOpen} /></td>
                <td className="r"><button className="rowbtn" onClick={() => setOpen(p)}>{t("common.open")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer
        open={!!open}
        title={open?.payload?.package_name ?? t("proc.package")}
        onClose={() => setOpen(null)}
        footer={
          open && (open.status === "pending" || open.status === "stale") && canConfirm ? (
            <>
              <button className="mini" disabled={busy} onClick={() => reject(open.id).then(() => setOpen(null))}>{t("review.rejected")}</button>
              <button className="mini pri" disabled={busy} onClick={() => confirm(open.id).then(() => setOpen(null))}>{t("proc.confirmPackage")}</button>
            </>
          ) : (
            <button className="mini" onClick={() => setOpen(null)}>{t("common.close")}</button>
          )
        }
      >
        {open && (
          <>
            <div className="boq-prop">
              <div className="lab">{t("proc.packageValue")}</div>
              <div className="val">{money(open.payload?.estimated_value_minor, open.payload?.currency)}</div>
              <div style={{ fontSize: 12.5, color: "var(--slate-500)", marginTop: 6 }}>
                {t("proc.scopeLines", { n: (open.payload?.boq_codes ?? []).length })} · {open.payload?.trade ?? "—"}
                {open.payload?.lead_time_weeks != null ? " · " + t("proc.weekLead", { n: open.payload.lead_time_weeks }) : ""}
              </div>
            </div>

            <label className="fl" style={{ marginBottom: 8 }}>{t("proc.scope")}</label>
            {scope.length === 0 ? (
              <p className="csub">{t("proc.noScope")}</p>
            ) : (
              <div className="card" style={{ padding: "6px 14px", marginBottom: 16 }}>
                <table>
                  <tbody>
                    {scope.map((s) => (
                      <tr key={s.code}>
                        <td className="num" style={{ color: "var(--slate-500)" }}>{s.code}</td>
                        <td style={{ fontSize: 12.5 }}>
                          {s.line?.payload?.description ?? "—"}
                          {s.line && <span className="mono" style={{ color: "var(--slate-400)", fontSize: 11 }}> · {qty(s.line.payload?.quantity)} {unitLabel(s.line.payload?.unit)}</span>}
                        </td>
                        <td className="num r">{s.cost ? money(s.cost.payload?.amount_minor, s.cost.payload?.currency) : "—"}</td>
                      </tr>
                    ))}
                    {scopeValue > 0 && (
                      <tr>
                        <td />
                        <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t("proc.pricedScope")}</td>
                        <td className="num r" style={{ fontWeight: 600, color: "var(--ink)" }}>{money(scopeValue, open.payload?.currency)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <SourceTrace pid={pid} artifactId={open.id} artifacts={artifacts} />

            <div className="synth" style={{ marginTop: 4 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flex: "none" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg>
              <span><b>{t("proc.vendorsLead")}</b> {t("proc.vendorsBody")}</span>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}

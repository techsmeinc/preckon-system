"use client";
// QuantLogix — the bill of quantities. A dense, mono, traceable table: every
// line links back to the measurement it came from, and a flagged line opens the
// review drawer with the proposal, its sources and accept/correct.

import { Fragment, useMemo, useState } from "react";
import { ofType } from "@/lib/project";
import { money, qty, confPct } from "@/lib/chain";
import { BoqPipeline } from "@/lib/boq/pipeline";
import {
  ReviewDrawer, StageEmpty, StageHeader, StatusCell, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";
import { unitLabel } from "./drawings";
import { useI18n } from "@/lib/i18n";

export default function BoqSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  // Rates live on cost_line, keyed by BOQ code — the estimate stage's output
  // read back here so a line shows its money without leaving the bill.
  const costs = ofType(artifacts, "cost_line");
  const costFor = (code: string) => costs.find((c) => c.payload?.boq_code === code) ?? null;

  const trades = useMemo(() => {
    const by = new Map<string, any[]>();
    for (const l of rows) {
      const trade = l.payload?.trade ?? t("boq.unclassified");
      if (!by.has(trade)) by.set(trade, []);
      by.get(trade)!.push(l);
    }
    for (const list of by.values()) list.sort((a, b) => String(a.payload?.code ?? "").localeCompare(String(b.payload?.code ?? "")));
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const totals = useMemo(() => {
    let minor = 0;
    let ccy = "";
    for (const l of rows) {
      const c = costFor(l.payload?.code);
      if (c) { minor += Number(c.payload?.amount_minor ?? 0); ccy = ccy || c.payload?.currency || ""; }
    }
    const decided = rows.filter((l) => l.status === "confirmed").length;
    return { minor, ccy, decided, pct: rows.length ? Math.round((decided / rows.length) * 100) : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, costs]);

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />

      <BoqPipeline pid={pid} />
        <StageEmpty title={t("boq.emptyTitle")} sub={t("boq.emptySub")} />
      </>
    );
  }

  return (
    <>
      <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />

      <div className="boq-sum">
        <div className="s"><div className="k">{t("boq.pricedValue")}</div><div className="v">{totals.minor ? money(totals.minor, totals.ccy) : "—"}</div></div>
        <div className="s"><div className="k">{t("boq.lines")}</div><div className="v">{rows.length}</div></div>
        <div className="s"><div className="k">{t("boq.needsReview")}</div><div className={"v" + (pending.length ? " warn" : "")}>{pending.length}</div></div>
        <div className="s"><div className="k">{t("boq.reviewed")}</div><div className="v">{totals.pct}%</div></div>
      </div>

      <div className="card" style={{ padding: "14px 18px" }}>
        <div className="chead">
          <div>
            <h3>{t("boq.title")}</h3>
            <div className="csub">{t("boq.titleSub")}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {highConf.length > 1 && (
              <button className="mini" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button>
            )}
          </div>
        </div>

        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>{t("boq.colCode")}</th><th>{t("boq.colDescription")}</th><th>{t("boq.colUnit")}</th><th className="r">{t("boq.colQty")}</th>
              <th className="r">{t("boq.colRate")}</th><th className="r">{t("boq.colAmount")}</th><th>{t("boq.colSource")}</th><th className="r">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(([trade, list]) => (
              <Fragment key={trade}>
                <tr className="grp-row"><td colSpan={8}>{trade}</td></tr>
                {list.map((l) => {
                  const c = costFor(l.payload?.code);
                  const flagged = (l.status === "pending" || l.status === "stale") && (confPct(l.confidence) ?? 100) < 90;
                  return (
                    <tr key={l.id} className={flagged ? "flagged" : ""}>
                      <td className="num" style={{ color: "var(--slate-500)" }}>{l.payload?.code ?? "—"}</td>
                      <td className="t-name" style={{ fontWeight: 500 }}>{l.payload?.description ?? "—"}</td>
                      <td className="num">{unitLabel(l.payload?.unit)}</td>
                      <td className="num r">{qty(l.payload?.quantity)}</td>
                      <td className="num r">{c ? money(c.payload?.rate_minor, "") : "—"}</td>
                      <td className="num r">{c ? money(c.payload?.amount_minor, c.payload?.currency) : "—"}</td>
                      <td><button className="srcchip" onClick={() => setReview(l)}>{t("boq.trace")}</button></td>
                      <td className="r"><StatusCell a={l} onReview={setReview} /></td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? `${review.payload?.code ?? ""} · ${review.payload?.description ?? "Line"}` : ""}
        proposal={<div className="val">{qty(review?.payload?.quantity)} <small>{unitLabel(review?.payload?.unit)}</small></div>}
        fields={[
          { key: "quantity", label: "boq.fieldQuantity", kind: "number" },
          { key: "description", label: "boq.fieldDescription" },
        ]}
        onSaved={reload}
      />
    </>
  );
}

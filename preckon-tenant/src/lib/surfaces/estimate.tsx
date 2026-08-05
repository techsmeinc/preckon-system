"use client";
// CostLogix — the priced bill. Rates applied to every BOQ line, each showing
// where the rate came from, plus a live cost buildup: change a percentage and
// every figure below it recalculates.
//
// The mark-up percentages are estimator chrome, not tenant data — they are kept
// per project on this device. The priced lines underneath are real artifacts.

import { useMemo, useState } from "react";
import { ofType } from "@/lib/project";
import { money, qty } from "@/lib/chain";
import { readPref, writePref } from "@/lib/brand";
import {
  ReviewDrawer, StageEmpty, StageHeader, StatusCell, pendingOf, useArtifactActions, type SurfaceProps,
} from "./common";
import { unitLabel } from "./drawings";
import { useI18n } from "@/lib/i18n";

interface Buildup { prelims: number; ohp: number; cont: number }
const DEFAULT_BUILDUP: Buildup = { prelims: 8, ohp: 6, cont: 4 };

export default function EstimateSurface({ pid, stage, artifacts, rows, workflows, runs, reload }: SurfaceProps) {
  const { t } = useI18n();
  const [review, setReview] = useState<any | null>(null);
  const { confirmMany, busy } = useArtifactActions(pid, reload);
  const { pending, highConf } = pendingOf(rows);

  const [buildup, setBuildup] = useState<Buildup>(() => readPref(`buildup-${pid}`, DEFAULT_BUILDUP));
  function setPct(k: keyof Buildup, v: string) {
    const next = { ...buildup, [k]: Number(v) || 0 };
    setBuildup(next);
    writePref(`buildup-${pid}`, next);
  }

  const boq = ofType(artifacts, "boq_line");
  const costFor = (code: string) => rows.find((c) => c.payload?.boq_code === code) ?? null;

  const priced = useMemo(() => {
    const list = boq.map((l) => ({ line: l, cost: costFor(l.payload?.code) }));
    return list.sort((a, b) => String(a.line.payload?.code ?? "").localeCompare(String(b.line.payload?.code ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boq, rows]);

  const direct = rows.reduce((n, c) => n + Number(c.payload?.amount_minor ?? 0), 0);
  const ccy = rows[0]?.payload?.currency ?? "";
  const prelimsAmt = (direct * buildup.prelims) / 100;
  const ohpAmt = ((direct + prelimsAmt) * buildup.ohp) / 100;
  const contAmt = ((direct + prelimsAmt + ohpAmt) * buildup.cont) / 100;
  const total = direct + prelimsAmt + ohpAmt + contAmt;
  const unpriced = priced.filter((p) => !p.cost).length;

  if (rows.length === 0) {
    return (
      <>
        <StageHeader stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload} />
        <StageEmpty title={t("est.emptyTitle")} sub={t("est.emptySub")} />
      </>
    );
  }

  return (
    <>
      <StageHeader
        stage={stage} workflows={workflows} runs={runs} pid={pid} reload={reload}
        right={highConf.length > 1 ? <button className="mini sm" disabled={busy} onClick={() => confirmMany(highConf)}>{t("stage.acceptAll")}</button> : undefined}
      />

      <div className="kpis">
        <div className="kpi"><div className="k">{t("est.directCost")}</div><div className="v">{money(direct, ccy)}</div><div className="sub">{t("est.fromBill")}</div></div>
        <div className="kpi"><div className="k">{t("est.prelimsOhp")}</div><div className="v">{money(prelimsAmt + ohpAmt, ccy)}</div><div className="sub">{t("est.onDirect")}</div></div>
        <div className="kpi"><div className="k">{t("est.contingency")}</div><div className="v">{money(contAmt, ccy)}</div><div className="sub">{t("est.onSubtotal")}</div></div>
        <div className="kpi"><div className="k">{t("est.tenderTotal")}</div><div className="v">{money(total, ccy)}</div><div className="sub">{t("est.allIn")}</div></div>
      </div>

      <div className="row est">
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="chead">
            <div><h3>{t("est.pricedBill")}</h3><div className="csub">{t("est.pricedBillSub")}</div></div>
            {pending.length > 0 && <span className="chip pending">{t("est.toConfirm", { n: pending.length })}</span>}
          </div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr><th>{t("boq.colCode")}</th><th>{t("boq.colDescription")}</th><th className="r">{t("boq.colQty")}</th><th>{t("boq.colUnit")}</th><th className="r">{t("boq.colRate")}</th><th>{t("boq.colSource")}</th><th className="r">{t("boq.colAmount")}</th><th className="r">{t("common.status")}</th></tr>
            </thead>
            <tbody>
              {priced.map(({ line, cost }) => (
                <tr key={line.id} className={!cost ? "flagged" : ""}>
                  <td className="num" style={{ color: "var(--slate-500)" }}>{line.payload?.code ?? "—"}</td>
                  <td className="t-name" style={{ fontWeight: 500 }}>{line.payload?.description ?? "—"}</td>
                  <td className="num r">{qty(line.payload?.quantity)}</td>
                  <td className="num">{unitLabel(line.payload?.unit)}</td>
                  <td className="num r">{cost ? money(cost.payload?.rate_minor, "") : <span style={{ color: "var(--amber)" }}>—</span>}</td>
                  <td>{cost ? <RateSource source={cost.payload?.rate_source} ref_={cost.payload?.rate_book_ref} /> : <span className="rs rs-none">{t("est.noRate")}</span>}</td>
                  <td className="num r">{cost ? money(cost.payload?.amount_minor, cost.payload?.currency) : "—"}</td>
                  <td className="r">{cost ? <StatusCell a={cost} onReview={setReview} /> : <span className="csub">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unpriced > 0 && (
            <div className="csub" style={{ marginTop: 12, color: "var(--amber)" }}>
              {t("est.unpriced", { n: unpriced })}
            </div>
          )}
        </div>

        <div className="card">
          <h3>{t("est.buildup")}</h3>
          <div className="csub">{t("est.buildupSub")}</div>
          <div style={{ marginTop: 8 }}>
            <div className="bd-row first">{t("est.directWorks")} <b>{money(direct, ccy)}</b></div>
            <div className="bd-row">
              {t("est.preliminaries")}
              <span className="pin">
                <input type="number" value={buildup.prelims} onChange={(e) => setPct("prelims", e.target.value)} aria-label={t("est.preliminaries")} />%
                <span className="amt">{money(prelimsAmt, "")}</span>
              </span>
            </div>
            <div className="bd-row">
              {t("est.overheads")}
              <span className="pin">
                <input type="number" value={buildup.ohp} onChange={(e) => setPct("ohp", e.target.value)} aria-label={t("est.overheads")} />%
                <span className="amt">{money(ohpAmt, "")}</span>
              </span>
            </div>
            <div className="bd-row">
              {t("est.contingency")}
              <span className="pin">
                <input type="number" value={buildup.cont} onChange={(e) => setPct("cont", e.target.value)} aria-label={t("est.contingency")} />%
                <span className="amt">{money(contAmt, "")}</span>
              </span>
            </div>
            <div className="bd-total">{t("est.tenderTotal")} <b>{money(total, ccy)}</b></div>
          </div>
          <div style={{ fontSize: 11, color: "var(--slate-500)", marginTop: 14 }}>
            {t("est.buildupNote")}
          </div>
        </div>
      </div>

      <ReviewDrawer
        open={!!review}
        onClose={() => setReview(null)}
        pid={pid}
        artifact={review}
        artifacts={artifacts}
        title={review ? t("est.rateTitle", { code: review.payload?.boq_code ?? "" }) : ""}
        proposal={
          <>
            <div className="val">{money(review?.payload?.rate_minor, review?.payload?.currency)}</div>
            <div style={{ fontSize: 12.5, color: "var(--slate-500)", marginTop: 8 }}>
              {review?.payload?.rate_source ? t("est.rateSource", { source: review.payload.rate_source }) : t("est.noRateSource")}
              {review?.payload?.rate_book_ref ? ` · ${review.payload.rate_book_ref}` : ""}
            </div>
          </>
        }
        fields={[
          { key: "rate_minor", label: "est.fieldRate", kind: "number" },
          { key: "rate_source", label: "est.fieldSource" },
        ]}
        onSaved={reload}
      />
    </>
  );
}

function RateSource({ source, ref_ }: { source?: string; ref_?: string }) {
  const s = (source ?? "").toLowerCase();
  const cls = s.includes("librar") ? "rs-lib" : s.includes("hist") ? "rs-hist" : s.includes("manual") ? "rs-man" : "rs-lib";
  return <span className={"rs " + cls} title={ref_ ?? undefined}>{source ?? "Library"}</span>;
}

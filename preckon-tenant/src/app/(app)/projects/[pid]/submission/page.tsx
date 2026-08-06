"use client";
// The submission register — the last screen before the envelope goes.
//
// Everything upstream is derived: quantities from drawings, rates from the
// bill, the programme from the quantities. Nothing here is. A bid bond is
// chased from a bank, an insurance certificate from a broker, a signed form of
// tender from a director who is in a meeting — collected, not computed.
//
// Which is why it is a register rather than another agent stage: there is
// nothing to run, and a stage that cannot be run would sit at "pending" for
// ever. What it does instead is tell you what is outstanding, who is chasing
// it, and whether the envelope is complete — the questions asked in the last
// forty-eight hours of every bid.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/apiclient";
import { useApi, useCan, useToast, Skeleton, ErrorBox } from "@/lib/ui";
import { useI18n, fmtDateLocal } from "@/lib/i18n";
import {
  GROUP_LABEL, STATE_LABEL, hydrate, outstanding, readiness,
  type ItemState, type SubmissionItem, type SubmissionPack,
} from "@/lib/submission";

const STATES: ItemState[] = ["pending", "ready", "submitted", "na"];
const GROUPS = ["commercial", "technical", "legal", "company"] as const;

export default function SubmissionPage() {
  const { pid } = useParams<{ pid: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const canEdit = useCan("project.update");
  const { data, loading, error, reload } = useApi<any>(`/projects/${pid}`, []);

  const [pack, setPack] = useState<SubmissionPack | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    if (data) setPack(hydrate(data.submission));
  }, [data]);

  const grouped = useMemo(() => {
    const by = new Map<string, SubmissionItem[]>();
    for (const i of pack?.items ?? []) {
      if (!by.has(i.group)) by.set(i.group, []);
      by.get(i.group)!.push(i);
    }
    return by;
  }, [pack]);

  if (loading && !pack) return <Skeleton rows={8} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!pack) return null;

  const edit = (id: string, patch: Partial<SubmissionItem>) => {
    setPack((p) => (p ? { ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : p));
    setDirty(true);
  };

  async function save(next?: SubmissionPack) {
    const body = next ?? pack;
    if (!body) return;
    setSaving(true);
    try {
      await api.patch(`/projects/${pid}`, { submission: body });
      setDirty(false);
      toast(t("sub.saved"));
    } catch (e: any) {
      toast(e?.message ?? t("common.loadFail"));
    } finally {
      setSaving(false);
    }
  }

  function addItem() {
    const label = adding.trim();
    if (!label) return;
    // Every client's instructions to bidders differ. A checklist you cannot add
    // to is a checklist people keep on paper instead.
    const id = `custom_${Date.now().toString(36)}`;
    setPack((p) => (p ? { ...p, items: [...p.items, { id, label, group: "commercial", state: "pending" }] } : p));
    setAdding("");
    setDirty(true);
  }

  const pct = readiness(pack);
  const left = outstanding(pack);
  const submitted = pack.items.filter((i) => i.state === "submitted").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("sub.title")}</h1>
          <p>{t("sub.sub")}</p>
        </div>
        {canEdit && (
          <button className="mini pri" disabled={saving || !dirty} onClick={() => save()}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        )}
      </div>

      <div className="kpis">
        <div className="kpi"><div className="k">{t("sub.readiness")}</div><div className="v">{pct}%</div><div className="s">{t("sub.readinessSub")}</div></div>
        <div className="kpi"><div className="k">{t("sub.outstanding")}</div><div className={"v" + (left ? " warn" : "")}>{left}</div><div className="s">{t("sub.outstandingSub")}</div></div>
        <div className="kpi"><div className="k">{t("sub.inEnvelope")}</div><div className="v">{submitted}</div><div className="s">{t("sub.inEnvelopeSub")}</div></div>
        <div className="kpi">
          <div className="k">{t("sub.due")}</div>
          <div className="v">{data?.due_date ? fmtDateLocal(data.due_date, { day: "numeric", month: "short" }) : "—"}</div>
          <div className="s">{data?.due_date ? t("sub.dueSub") : t("sub.dueUnset")}</div>
        </div>
      </div>

      {GROUPS.map((g) => {
        const items = grouped.get(g) ?? [];
        if (!items.length) return null;
        return (
          <div className="card" key={g} style={{ marginBottom: 14 }}>
            <div className="chead">
              <div>
                <h3>{GROUP_LABEL[g]}</h3>
                <div className="csub">
                  {t("sub.groupSub", {
                    n: items.filter((i) => i.state === "pending").length,
                    total: items.filter((i) => i.state !== "na").length,
                  })}
                </div>
              </div>
            </div>

            <div className="tw">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("sub.colItem")}</th>
                    <th style={{ width: 150 }}>{t("sub.colState")}</th>
                    <th style={{ width: 150 }}>{t("sub.colOwner")}</th>
                    <th>{t("sub.colNote")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className={i.state === "na" ? "dim" : ""}>
                      <td>
                        <b>{i.label}</b>
                        {/* Where the chain already produced it, say so — half
                            these items are downloads somebody has forgotten
                            they can make. */}
                        {i.from && <div className="csub">{i.from}</div>}
                      </td>
                      <td>
                        <select
                          className="mini"
                          value={i.state}
                          disabled={!canEdit}
                          aria-label={i.label}
                          onChange={(e) => edit(i.id, { state: e.target.value as ItemState })}
                        >
                          {STATES.map((st) => <option key={st} value={st}>{STATE_LABEL[st]}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          className="ced-filter"
                          value={i.owner ?? ""}
                          placeholder={t("sub.ownerPlaceholder")}
                          disabled={!canEdit}
                          aria-label={`${i.label} — ${t("sub.colOwner")}`}
                          onChange={(e) => edit(i.id, { owner: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="ced-filter"
                          value={i.note ?? ""}
                          placeholder={t("sub.notePlaceholder")}
                          disabled={!canEdit}
                          aria-label={`${i.label} — ${t("sub.colNote")}`}
                          onChange={(e) => edit(i.id, { note: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {canEdit && (
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="chead">
            <div>
              <h3>{t("sub.addTitle")}</h3>
              <div className="csub">{t("sub.addSub")}</div>
            </div>
          </div>
          <div className="bim-ask" style={{ marginTop: 10 }}>
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
              placeholder={t("sub.addPlaceholder")}
              aria-label={t("sub.addTitle")}
            />
            <button className="mini sm" disabled={!adding.trim()} onClick={addItem}>{t("common.add")}</button>
          </div>

          <div className="frow" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <div className="field">
              <label htmlFor="sub-method">{t("sub.method")}</label>
              <input
                id="sub-method"
                value={pack.method ?? ""}
                placeholder={t("sub.methodPlaceholder")}
                onChange={(e) => { setPack({ ...pack, method: e.target.value }); setDirty(true); }}
              />
            </div>
            <div className="field">
              <label htmlFor="sub-when">{t("sub.submittedOn")}</label>
              <input
                id="sub-when"
                type="date"
                value={pack.submittedAt ? String(pack.submittedAt).slice(0, 10) : ""}
                onChange={(e) => { setPack({ ...pack, submittedAt: e.target.value || null }); setDirty(true); }}
              />
            </div>
          </div>

          <p className="csub" style={{ marginTop: 10, marginBottom: 0 }}>{t("sub.foot")}</p>
        </div>
      )}
    </>
  );
}

"use client";
// The submission cover details — reference number, project number, location,
// client, who it is submitted to.
//
// These print on the header block of every exported bill and programme. Until
// now they had nowhere to live, so the exports rendered them blank and an
// estimator retyped them into Excel after each download — which meant the next
// download lost them again. Saved here once, every export carries them.

import { useEffect, useState } from "react";
import { api } from "@/lib/apiclient";
import { useCan, useToast } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";

interface Cover {
  ref_no?: string | null;
  due_date?: string | null;
  code?: string | null;
  name?: string | null;
  location?: string | null;
  client_name?: string | null;
  submitted_to?: string | null;
}

const FIELDS: Array<{ key: keyof Cover; label: string; placeholder: string; kind?: "date" }> = [
  { key: "ref_no", label: "cover.refNo", placeholder: "QO/17/26" },
  { key: "code", label: "cover.number", placeholder: "17" },
  { key: "name", label: "cover.name", placeholder: "Spark" },
  { key: "location", label: "cover.location", placeholder: "Salmiya, Kuwait" },
  { key: "client_name", label: "cover.client", placeholder: "AIGCC Group" },
  { key: "submitted_to", label: "cover.submittedTo", placeholder: "Consultant / Client" },
  // A date, not text: the projects list sorts and counts on it, and a typed
  // "14th Aug" cannot be counted.
  { key: "due_date", label: "cover.due", placeholder: "", kind: "date" },
];

export function ProjectCover({ pid, onSaved }: { pid: string; onSaved?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const canEdit = useCan("project.update");
  const [v, setV] = useState<Cover>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/projects/${pid}`).then((p: any) => {
      if (live) setV({
        ref_no: p?.ref_no ?? "", code: p?.code ?? "", name: p?.name ?? "",
        location: p?.location ?? "", client_name: p?.client_name ?? "",
        submitted_to: p?.submitted_to ?? "",
        // The API returns a full timestamp; the input wants a plain date.
        due_date: p?.due_date ? String(p.due_date).slice(0, 10) : "",
      });
    }).catch(() => {});
    return () => { live = false; };
  }, [pid]);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/projects/${pid}`, { ...v, due_date: v.due_date ? v.due_date : null });
      setDirty(false);
      toast(t("cover.saved"));
      onSaved?.();
    } catch (e: any) {
      toast(e?.message ?? t("common.loadFail"));
    } finally {
      setBusy(false);
    }
  }

  // Empty fields are named rather than hidden: a blank on a tender cover is
  // something to fill in before submission, and an invisible one never is.
  const missing = FIELDS.filter((f) => !String(v[f.key] ?? "").trim()).length;

  return (
    <div className="card" style={{ padding: "14px 18px", marginTop: 14 }}>
      <div className="chead">
        <div>
          <h3>{t("cover.title")}</h3>
          <div className="csub">{t("cover.sub")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {missing > 0 && <span className="chip warn">{t("cover.missing", { n: missing })}</span>}
          {canEdit && (
            <button className="mini" disabled={busy || !dirty} onClick={save}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          )}
        </div>
      </div>

      <div className="frow" style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        {FIELDS.map((f) => (
          <div className="field" key={String(f.key)}>
            <label htmlFor={`cov-${f.key}`}>{t(f.label as any)}</label>
            <input
              id={`cov-${f.key}`}
              type={f.kind === "date" ? "date" : "text"}
              value={String(v[f.key] ?? "")}
              placeholder={f.placeholder}
              disabled={!canEdit}
              onChange={(e) => { setV({ ...v, [f.key]: e.target.value }); setDirty(true); }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

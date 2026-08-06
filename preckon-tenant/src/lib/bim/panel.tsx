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

interface Loaded { doc: BimDocument; version: number }

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
  const [nonce, setNonce] = useState(0);

  /** Draw by instruction. The assistant returns the finished model, so the
   *  Studio remounts on it rather than trying to replay commands client-side. */
  async function draw() {
    const text = instruction.trim();
    if (!text) return;
    setDrawing(true);
    try {
      const r = await api.post<{ reply: string; applied: number; dropped: number }>(
        `/projects/${pid}/bim/agent`, { instruction: text, specialist }
      );
      toast(r.reply || t("bim.drewN", { n: r.applied }));
      setInstruction("");
      setNonce((n) => n + 1);
      reload();
    } catch (e: any) {
      toast(e?.message ?? t("bim.drawFail"), "bad");
    } finally { setDrawing(false); }
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
        <div><h3>{t("bim.studio")}</h3><div className="csub">{t("bim.studioSub")}</div></div>
        {canEdit && (
          <div style={{ display: "flex", gap: 6 }}>
            {/* Measuring is one click that writes a hundred records. The click
                that undoes it belongs next to it, not in a support email. */}
            <button className="mini sm" onClick={clearTakeoff} disabled={measuring}>
              {t("bim.clearTakeoff")}
            </button>
            <button className="mini sm" onClick={measure} disabled={measuring}>
              {measuring ? t("bim.measuring") : t("bim.takeoff")}
            </button>
          </div>
        )}
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

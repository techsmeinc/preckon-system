"use client";
// Documents — where the chain starts. Drop the tender pack in; Preckon reads
// every page, and the Document agent classifies each one into a typed document
// the rest of the chain can trace back to.

import { use, useRef, useState } from "react";
import { useApi, useCan, useToast, Skeleton, StatusChip } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { Icon } from "@/lib/icons";
import { useProject, ofType } from "@/lib/project";
import { humanize } from "@/lib/catalog";
import { useI18n, fmtDateLocal } from "@/lib/i18n";

export default function DocumentsPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const toast = useToast();
  const { t } = useI18n();
  const canEdit = useCan("artifact.edit");
  const canRun = useCan("workflow.run");
  const { artifacts, runs, workflows, reload } = useProject();
  const files = useApi<any[]>(`/projects/${pid}/files`, [], { refreshMs: 4000 });
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [classifying, setClassifying] = useState(false);

  async function upload(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      for (const f of chosen) {
        await api.upload(`/projects/${pid}/files`, f);
        toast(t("docs.ingested", { name: f.name }));
      }
      files.reload();
      reload();
    } catch (er: any) {
      toast(er?.message ?? t("docs.uploadFail"));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  const list = files.data ?? [];
  // What the Document agent made of each file — the classified view of the pack.
  const docs = ofType(artifacts, "document");
  const docFor = (fileId: string) => docs.find((d) => d.payload?.file_id === fileId);

  // Classification is the first node of every workflow, so before any chain is
  // run the whole pack reads "not classified yet". Offer that one step here.
  const CLASSIFY_KEY = "workflow.classify";
  const classifyAvailable = workflows.some((w) => w.key === CLASSIFY_KEY);
  const classifyRunning = runs.some(
    (r) => r.workflow_key === CLASSIFY_KEY && (r.status === "running" || r.status === "awaiting_review")
  );
  const unclassified = list.filter((f) => !docFor(f.id)).length;

  async function classify() {
    setClassifying(true);
    try {
      await api.post(`/projects/${pid}/runs`, { workflow_key: CLASSIFY_KEY });
      toast(t("docs.classifyStarted"));
      reload();
    } catch (er: any) {
      toast(er?.message ?? t("docs.classifyFail"));
    } finally {
      setClassifying(false);
    }
  }

  return (
    <>
      <input ref={ref} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />

      {canEdit && (
        <button
          className={"dropzone" + (drag ? " drag" : "")}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        >
          {busy ? (
            <><span className="spin" /><div style={{ fontWeight: 600, color: "var(--ink)", marginTop: 8 }}>{t("docs.reading")}</div></>
          ) : (
            <>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 15V3m0 0L8 7m4-4 4 4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
              <div style={{ fontWeight: 600, color: "var(--ink)" }}>{t("docs.drop")}</div>
              <div style={{ fontSize: 12, marginTop: 3 }}>{t("docs.dropSub")}</div>
            </>
          )}
        </button>
      )}

      {files.loading ? <Skeleton rows={3} /> : list.length === 0 ? (
        <div className="placeholder">
          <div className="pic"><Icon.upload /></div>
          <h3>{t("docs.noneTitle")}</h3>
          <p>{t("docs.noneSub")}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: "14px 18px" }}>
          <div className="chead">
            <div><h3>{t("docs.setTitle")}</h3><div className="csub">{t("docs.setSub", { files: list.length, docs: docs.length })}</div></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {canRun && classifyAvailable && unclassified > 0 && (
                <button
                  className="mini"
                  disabled={classifying || classifyRunning}
                  onClick={classify}
                  title={t("docs.classifyHint")}
                >
                  {classifyRunning ? t("docs.classifyRunning") : t("docs.classify", { n: unclassified })}
                </button>
              )}
              {canEdit && <button className="mini" disabled={busy} onClick={() => ref.current?.click()}>{t("docs.upload")}</button>}
            </div>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr><th>{t("docs.colFile")}</th><th>{t("docs.colClassified")}</th><th className="r">{t("docs.colPages")}</th><th className="r">{t("docs.colSize")}</th><th>{t("common.status")}</th><th className="r">{t("docs.colUploaded")}</th></tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const d = docFor(f.id);
                return (
                  <tr key={f.id}>
                    <td>
                      <div className="t-name">{f.filename}</div>
                      <div className="t-sub">{fileKind(f.mime, f.filename)}</div>
                      {/* A drawing that was parsed says so in the terms an
                          estimator checks first: units, and how much is in it. */}
                      {f.cad_layers != null && (
                        <div className="t-sub mono" style={{ marginTop: 2 }}>
                          {t("docs.cadRead", {
                            units: f.cad_units ?? "?",
                            layers: f.cad_layers,
                            blocks: f.cad_blocks,
                            sheets: f.cad_sheets,
                          })}
                        </div>
                      )}
                    </td>
                    <td>{d ? <span className="stage">{humanize(d.payload?.doc_type ?? "document")}</span> : <span className="csub">{t("docs.notClassified")}</span>}</td>
                    <td className="r num">{f.page_count ?? "—"}</td>
                    <td className="r num">{f.size_bytes ? (f.size_bytes / 1024).toFixed(0) + " KB" : "—"}</td>
                    <td><StatusChip status={f.status} /></td>
                    <td className="r mono" style={{ fontSize: 11 }}>{fmtDateLocal(f.created_at, { dateStyle: "medium", timeStyle: "short" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function fileKind(mime?: string, filename?: string): string {
  // Browsers send no useful mime for .dxf/.dwg — it arrives as
  // application/octet-stream, which would read as "octet-stream" in the table.
  if (filename && /\.dxf$/i.test(filename)) return "CAD drawing (DXF)";
  if (filename && /\.dwg$/i.test(filename)) return "CAD drawing (DWG)";
  if (!mime) return "—";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("msword") || mime.includes("officedocument.wordprocessing")) return "Word";
  if (mime.includes("sheet") || mime.includes("excel")) return "Spreadsheet";
  if (mime.includes("image")) return "Image";
  if (mime.includes("text")) return "Text";
  return mime.split("/").pop() ?? mime;
}

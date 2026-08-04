"use client";
// Drawing editor — a workspace tool, not a stage.
//
// It first lived inside DrawLogix, behind an Edit button on one sheet of one
// project. That is the wrong home for it: editing a drawing is not a step in a
// bid's lifecycle, it is something an estimator does at any hour to any drawing
// they have — including one that is not in a project yet, sitting in a folder
// on their machine.
//
// So it sits under Tools with Copilot and the Library. Pick a project and a
// sheet, or open a .dxf straight off the disk. DrawLogix still links here with
// the project and sheet already chosen, which is the same journey it always
// offered — the editor just no longer lives inside it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi, EmptyState } from "@/lib/ui";
import { Icon } from "@/lib/icons";
import { useI18n } from "@/lib/i18n";
import { CadEditor } from "@/lib/cad/editor";

interface ProjectLite { id: string; name: string }
interface FileLite { id: string; filename: string; cad_layers: number | null }

const isDrawing = (name: string) => /\.(dxf|dwg)$/i.test(name ?? "");
/** Sheet sets are numbered "01-…", "02-…"; numeric-aware so 2 sorts before 10. */
const bySheet = (a: FileLite, b: FileLite) =>
  a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: "base" });

export default function DrawingEditorPage() {
  const { t } = useI18n();
  const projects = useApi<ProjectLite[]>("/projects", []);

  const [pid, setPid] = useState<string | null>(null);
  const [fid, setFid] = useState<string | null>(null);
  /** A drawing opened from disk — held in memory, never uploaded. */
  const [local, setLocal] = useState<{ name: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Deep link from DrawLogix. Read off the URL rather than useSearchParams so
  // the page needs no Suspense boundary to prerender.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("pid");
    const f = q.get("fid");
    if (p) setPid(p);
    if (f) setFid(f);
  }, []);

  const files = useApi<FileLite[]>(pid ? `/projects/${pid}/files` : null, [pid]);
  const drawings = (files.data ?? []).filter((f) => f.cad_layers != null || isDrawing(f.filename)).sort(bySheet);

  // Once a project's sheets are known, open the first unless the URL named one.
  useEffect(() => {
    if (!drawings.length) return;
    setFid((cur) => (cur && drawings.some((d) => d.id === cur) ? cur : drawings[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.data]);

  const openLocal = useCallback(async (f: File) => {
    // .dwg is a binary format with no open reader in the browser; the sidecar
    // converts one only after it has been uploaded to a project. Say so rather
    // than handing the parser bytes it will fail on.
    if (/\.dwg$/i.test(f.name)) { window.alert(t("studio.dwgLocal")); return; }
    setLocal({ name: f.name, text: await f.text() });
    setPid(null);
    setFid(null);
  }, [t]);

  const chosen = drawings.find((d) => d.id === fid) ?? null;

  return (
    <>
      <div className="phead">
        <div>
          <h1>{t("studio.title")}</h1>
          <p>{t("studio.sub")}</p>
        </div>
      </div>

      <div className="card" style={{ padding: "14px 18px", marginBottom: 14 }}>
        <div className="ced-source">
          <label className="ced-fld">
            {t("studio.project")}
            <select
              value={pid ?? ""}
              onChange={(e) => { setPid(e.target.value || null); setFid(null); setLocal(null); }}
              disabled={projects.loading}
            >
              <option value="">{t("studio.pickProject")}</option>
              {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="ced-fld">
            {t("studio.drawing")}
            <select
              value={fid ?? ""}
              onChange={(e) => { setFid(e.target.value || null); setLocal(null); }}
              disabled={!pid || files.loading || !drawings.length}
            >
              {!drawings.length && <option value="">{files.loading ? "…" : t("studio.noDrawings")}</option>}
              {drawings.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
            </select>
          </label>

          <span className="ced-spacer" />

          <input
            ref={fileInput}
            type="file"
            accept=".dxf,.dwg"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void openLocal(f); e.target.value = ""; }}
          />
          <button className="btn btn-ghost" onClick={() => fileInput.current?.click()}>
            <Icon.upload /> {t("studio.openLocal")}
          </button>
        </div>
      </div>

      {local ? (
        <CadEditor key={`local:${local.name}`} filename={local.name} dxfText={local.text} onClose={() => setLocal(null)} />
      ) : pid && chosen ? (
        <CadEditor key={`${pid}:${chosen.id}`} pid={pid} fid={chosen.id} filename={chosen.filename} onSaved={files.reload} />
      ) : (
        <EmptyState
          title={t("studio.emptyTitle")}
          sub={pid && !files.loading && !drawings.length ? t("studio.noDrawingsSub") : t("studio.emptySub")}
        />
      )}
    </>
  );
}

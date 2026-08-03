"use client";
// The parsed drawings — what the CAD sidecar actually read out of each .dxf/.dwg.
//
// This sits on the Drawings stage beside BIM Studio, and the two are different
// things on purpose: the Studio is a model you author, this is a drawing
// somebody else issued. What makes it worth a screen is that these are the exact
// facts the agents were given. When an estimator questions a quantity, this is
// where the answer is — the layer it was run off, the block that was counted,
// the note that supplied the thickness.
//
// A drawing set is read one sheet at a time, so the sheet picker is a dropdown
// rather than a row of tabs: thirteen filenames like
// "03-MDVQ-AB-03-FLOORING PLAN & FINISHING SCHEDULE.dwg" wrap into an
// unreadable block of buttons, and the sheet you want is found by reading its
// number, not by hunting a wall of text. Sheets are ordered by name so the set
// reads 01, 02, 03 — the order it was issued in — and the first opens by default.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useApi, Skeleton } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { useI18n } from "@/lib/i18n";

interface CadLayerView {
  layer: string;
  runLength_m: number | null;
  largestArea_m2: number | null;
  inserts: number;
}
interface CadView {
  filename: string;
  units: string | null;
  sheets: string[];
  titleBlock: Record<string, string>;
  footprint: { area_m2: number; layer: string } | null;
  layers: CadLayerView[];
  blocks: Array<{ name: string; total: number }>;
  schedules: Array<{ layer: string; header: string[]; rows: string[][] }>;
  notes: string[];
  warnings: string[];
  svg: string | null;
  /** Set when the parser itself could not read the file — nothing was measured. */
  parseError: string | null;
  /** Set when the drawing measured fine but the sheet would not draw. */
  renderError: string | null;
  /** False means nobody has tried to draw it yet, so the viewer should. */
  renderAttempted: boolean;
}

const isDrawing = (name: string) => /\.(dxf|dwg)$/i.test(name ?? "");

/** Sheet sets are numbered ("01-…", "02-…"); numeric-aware sort keeps 2 before
 *  10, which a plain string sort would not. */
const bySheetName = (a: any, b: any) =>
  String(a.filename).localeCompare(String(b.filename), undefined, { numeric: true, sensitivity: "base" });

export function ParsedSheets({ pid }: { pid: string }) {
  const { t } = useI18n();
  const files = useApi<any[]>(`/projects/${pid}/files`, []);
  // Every uploaded drawing belongs here, including one the parser choked on:
  // the estimator uploaded it and expects to find it, and a sheet that is
  // missing from the picker reads as a lost file rather than a failed parse.
  const drawings = (files.data ?? [])
    .filter((f) => f.cad_layers != null || isDrawing(f.filename))
    .sort(bySheetName);
  const [open, setOpen] = useState<string | null>(null);

  if (files.loading || drawings.length === 0) return null;
  const active = drawings.some((f) => f.id === open) ? (open as string) : drawings[0].id;
  const index = drawings.findIndex((f) => f.id === active);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="chead">
        <div>
          <h3>{t("cad.title")}</h3>
          <div className="csub">{t("cad.sub")}</div>
        </div>
        <div className="cad-pick">
          <label htmlFor="cad-sheet-pick">{t("cad.sheet")}</label>
          <select
            id="cad-sheet-pick"
            value={active}
            onChange={(e) => setOpen(e.target.value)}
            aria-label={t("cad.sheet")}
          >
            {drawings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
          </select>
          <span className="cad-count mono">
            {index + 1}/{drawings.length}
          </span>
        </div>
      </div>

      <SheetDetail key={active} pid={pid} fid={active} />
    </div>
  );
}

function SheetDetail({ pid, fid }: { pid: string; fid: string }) {
  const { t } = useI18n();
  const { data, loading, error } = useApi<CadView>(`/projects/${pid}/files/${fid}/cad`);
  if (loading) return <Skeleton rows={4} />;
  if (error || !data) return <div className="csub">{error ?? t("common.loadFail")}</div>;

  return (
    <>
      {data.warnings.length > 0 && (
        <div className="synth" style={{ marginBottom: 12 }}>
          <span>{data.warnings.slice(0, 3).join(" · ")}</span>
        </div>
      )}

      <div className="bim-wrap">
        <div className="bim-main">
          <SheetCanvas pid={pid} fid={fid} view={data} />
        </div>

        <aside className="bim-side">
          <h4>{t("cad.measured")}</h4>
          <div className="trow-lbl" style={{ borderTop: 0 }}>
            {t("cad.units")} <b className="mono">{data.units ?? "—"}</b>
          </div>
          {data.footprint && (
            <div className="trow-lbl">
              {t("cad.footprint")} <b className="mono">{data.footprint.area_m2} m²</b>
            </div>
          )}
          {data.sheets.length > 0 && (
            <div className="trow-lbl">{t("cad.sheets")} <b>{data.sheets.join(", ")}</b></div>
          )}
          {Object.entries(data.titleBlock).slice(0, 6).map(([k, v]) => (
            <div className="trow-lbl" key={k}>{k} <b>{v}</b></div>
          ))}

          {data.blocks.length > 0 && (
            <>
              <h4 style={{ marginTop: 18 }}>{t("cad.blocks")}</h4>
              {data.blocks.slice(0, 12).map((b) => (
                <div className="bim-leg-r" key={b.name}>
                  <span>{b.name}</span>
                  <b className="mono">{b.total}</b>
                </div>
              ))}
            </>
          )}

          {data.layers.length > 0 && (
            <>
              <h4 style={{ marginTop: 18 }}>{t("cad.layers")}</h4>
              {data.layers.slice(0, 14).map((l) => (
                <div className="trow-lbl" key={l.layer}>
                  {l.layer}{" "}
                  <b className="mono">
                    {[
                      l.runLength_m ? `${l.runLength_m} m` : "",
                      l.largestArea_m2 ? `${l.largestArea_m2} m²` : "",
                      l.inserts ? `${l.inserts} nr` : "",
                    ].filter(Boolean).join(" · ") || "—"}
                  </b>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>

      {data.schedules.map((s, i) => (
        <div className="tw" key={i} style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr>{s.header.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
            <tbody>
              {s.rows.slice(0, 30).map((r, j) => (
                <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {data.notes.length > 0 && (
        <p className="csub" style={{ marginTop: 12 }}>
          <b>{t("cad.notes")}</b> {data.notes.slice(0, 20).join(" · ")}
        </p>
      )}
    </>
  );
}

/* ── the sheet itself ────────────────────────────────────────────────────── */

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 24;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * The drawing, with the two controls a drawing is useless without: zoom and pan.
 *
 * A general-arrangement plan fitted to a 560px panel is legible as a shape and
 * nothing else — the door tag, the dimension string and the room name are all
 * sub-pixel. Fit-to-window is the right first view (it answers "which sheet is
 * this?"), but every question after that needs to get closer, so the sheet
 * starts fitted and zooms about the cursor from there.
 *
 * It also renders on demand. The sheet used to be drawn once during upload and
 * a failure was permanent: NULL in the column, "could not be rendered" on the
 * screen forever. Here, a drawing nobody has drawn yet is drawn on arrival, and
 * one that failed offers a retry — because the usual causes (sidecar still
 * booting, converter not yet installed) are fixed by then and the bytes never
 * changed.
 */
function SheetCanvas({ pid, fid, view }: { pid: string; fid: string; view: CadView }) {
  const { t } = useI18n();
  const [svg, setSvg] = useState<string | null>(view.svg);
  const [err, setErr] = useState<string | null>(view.renderError);
  const [rendering, setRendering] = useState(false);
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const render = useCallback(async () => {
    setRendering(true);
    try {
      const r = await api.post<{ svg: string | null; error: string | null }>(
        `/projects/${pid}/files/${fid}/cad/render`
      );
      setSvg(r.svg);
      setErr(r.error);
    } catch (e: any) {
      setErr(e?.message ?? t("common.loadFail"));
    } finally {
      setRendering(false);
    }
  }, [pid, fid, t]);

  // Drawn on arrival only when nobody has tried yet. Re-running a render that is
  // known to have failed on every visit would burn a slow sidecar call each time
  // to reach the same answer; that retry is the estimator's to ask for.
  useEffect(() => {
    if (!view.svg && !view.renderAttempted && !view.parseError) void render();
  }, [view.svg, view.renderAttempted, view.parseError, render]);

  const fit = useCallback(() => {
    setZ(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Zoom about the pointer, so the detail under the cursor stays under it —
  // zooming to the centre of a 13-sheet plan means chasing the thing you were
  // looking at back across the panel after every notch.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setZ((prev) => {
        const next = clampZoom(prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
        const k = next / prev;
        setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
        return next;
      });
    };
    // Non-passive: the browser assumes a wheel listener won't preventDefault and
    // scrolls the page out from under the drawing otherwise.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svg]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const endDrag = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const dxfHref = `/api/v1/projects/${pid}/files/${fid}/dxf`;
  const dxfName = view.filename?.replace(/\.[^.]+$/, "") + ".dxf";

  return (
    <>
      <div className="bim-bar cad-bar">
        <b className="cad-name" title={view.filename}>{view.filename}</b>
        <div className="cad-tools">
          {svg && (
            <>
              <button className="btn btn-ghost" onClick={() => setZ((p) => clampZoom(p / 1.3))} aria-label={t("cad.zoomOut")}>−</button>
              <span className="cad-zoom mono">{Math.round(z * 100)}%</span>
              <button className="btn btn-ghost" onClick={() => setZ((p) => clampZoom(p * 1.3))} aria-label={t("cad.zoomIn")}>+</button>
              <button className="btn btn-ghost" onClick={fit}>{t("cad.fit")}</button>
            </>
          )}
          {/* DXF, not the original: a .dwg opens in AutoCAD and nothing else,
              and these are the exact bytes the quantities were measured from. */}
          <a className="btn btn-ghost" href={dxfHref} download={dxfName}>{t("cad.downloadDxf")}</a>
        </div>
      </div>

      {svg ? (
        <div
          ref={viewportRef}
          className="cad-view"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={fit}
        >
          <div
            className="cad-sheet"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${z})` }}
            // The renderer emits a standalone, self-contained SVG — no scripts,
            // no external refs — so it is safe to inline and needed to make it
            // scale to the panel.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        <div className="cad-empty">
          {rendering ? (
            <>
              <div className="sk" style={{ width: 180 }} />
              <p className="csub">{t("cad.rendering")}</p>
            </>
          ) : (
            <>
              <h4>{view.parseError ? t("cad.unreadable") : t("cad.noRender")}</h4>
              {/* The reason, verbatim from the parser. "Could not be rendered"
                  is not something anybody can act on; "the linework is in an
                  xref that was not uploaded" is. */}
              <p className="csub">{view.parseError ?? err ?? t("cad.noRenderWhy")}</p>
              <div className="cad-tools" style={{ justifyContent: "center", marginTop: 12 }}>
                {!view.parseError && (
                  <button className="btn btn-ghost" onClick={render} disabled={rendering}>
                    {t("cad.retryRender")}
                  </button>
                )}
                <a className="btn btn-ghost" href={dxfHref} download={dxfName}>{t("cad.downloadDxf")}</a>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

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

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useApi, Skeleton } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { useI18n } from "@/lib/i18n";
import Link from "next/link";

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
  /** The sheet is fetched separately — see SheetCanvas. */
  hasSvg: boolean;
  /** Set when the parser itself could not read the file — nothing was measured. */
  parseError: string | null;
  /** Set when the drawing measured fine but the sheet would not draw. */
  renderError: string | null;
  /** False means nobody has tried to draw it yet, so the viewer should. */
  renderAttempted: boolean;
}

const isDrawing = (name: string) => /\.(dxf|dwg)$/i.test(name ?? "");

/* ── keeping a sheet once it has been looked at ──────────────────────────────
 *
 * A drawing set is read by moving up and down the dropdown — 03, back to 01,
 * on to 04 — and every one of those moves used to be a fresh download of a
 * multi-megabyte sheet. The server now caches hard, but a browser cache can be
 * evicted mid-session and a private response is not always kept, so the sheets
 * already seen are held here too. Second look at a sheet is then not fast, it
 * is free: the markup is already in memory and paints on the same frame.
 *
 * Bounded, because a thirteen-sheet set of dense plans is real memory. Oldest
 * first — the sheet you came from is the one you are most likely to go back to.
 * Keyed by file id, which never changes for a given upload.
 */
const SHEET_CACHE_MAX = 6;
const sheetCache = {
  m: new Map<string, string>(),
  has(fid: string) { return this.m.has(fid); },
  get(fid: string) { return this.m.get(fid); },
  set(fid: string, svg: string) {
    this.m.delete(fid);              // re-insert so it counts as most recent
    this.m.set(fid, svg);
    while (this.m.size > SHEET_CACHE_MAX) this.m.delete(this.m.keys().next().value as string);
  },
};

/** In-flight requests are shared: opening a sheet the prefetcher is already
 *  fetching should join that request, not start a second one. */
const inflight = new Map<string, Promise<string>>();

function fetchSheet(pid: string, fid: string): Promise<string> {
  const cached = sheetCache.get(fid);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(fid);
  if (running) return running;
  const p = fetch(`/api/v1/projects/${pid}/files/${fid}/cad/svg`, { credentials: "include" })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((text) => { sheetCache.set(fid, text); return text; })
    .finally(() => { inflight.delete(fid); });
  inflight.set(fid, p);
  return p;
}

/* The measured facts are small — a few kilobytes — but small is not free when
 * every move in the dropdown remounts the panel and pays for another round
 * trip. Held the same way as the sheets, so going back to a sheet costs
 * nothing at all and going forward to a warmed one costs nothing either. */
const viewCache = new Map<string, CadView>();
const viewInflight = new Map<string, Promise<CadView>>();

function fetchView(pid: string, fid: string): Promise<CadView> {
  const cached = viewCache.get(fid);
  if (cached) return Promise.resolve(cached);
  const running = viewInflight.get(fid);
  if (running) return running;
  const p = api.get<CadView>(`/projects/${pid}/files/${fid}/cad`)
    .then((v) => { viewCache.set(fid, v); return v; })
    .finally(() => { viewInflight.delete(fid); });
  viewInflight.set(fid, p);
  return p;
}

type Schedule = CadView["schedules"][number];

/** Order-preserving de-duplication — a repeated note is noise, not emphasis. */
const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/**
 * Is this line of text a note, or a fragment the extractor picked up off the
 * sheet?
 *
 * Every drawing carries loose text that is not prose: keynote numbers ("1",
 * "2", "8A"), grid references, a lone "1 : 100". Listed as bullets they read as
 * a note list with eight empty entries in it, which is what the estimator saw.
 * A note has words in it — at least two, or one long enough to say something.
 */
function isRealNote(s: string): boolean {
  const t = s.trim();
  if (t.length < 4) return false;
  if (!/[A-Za-z؀-ۿ]{3}/.test(t)) return false;      // no word in it at all
  if (/^[\d\s.,:;/×x+\-—–()]+$/.test(t)) return false;         // pure numbering / a scale
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  return words.length >= 2 || t.length >= 14;
}

/**
 * Is this a real schedule, or room tags the parser mistook for one?
 *
 * The extractor detects a "table" from text that lines up in a grid. On a floor
 * plan the room labels do exactly that, so a plan comes back carrying a
 * "schedule" that is four hundred repetitions of BED ROOM / TOILET / SHOWER
 * TRAY. Two signals separate them: a real schedule has several DISTINCT column
 * headings, and its cells are mostly distinct values (a door schedule lists
 * different doors). A tag cloud has neither.
 */
function classifySchedule(s: Schedule): "table" | "tags" {
  const cells = s.rows.flat().map((c) => String(c ?? "").trim()).filter(Boolean);
  if (!cells.length) return "table";
  const distinctHeaders = new Set(s.header.map((h) => String(h ?? "").trim().toLowerCase()).filter(Boolean));
  const distinctCells = new Set(cells.map((c) => c.toLowerCase()));
  const repetition = distinctCells.size / cells.length;
  // Fewer than two real headings, and the same handful of values over and over.
  return distinctHeaders.size < 2 && repetition < 0.35 ? "tags" : "table";
}

/**
 * What to call a table that came off a drawing.
 *
 * The extractor only knows the CAD layer it found the text on, so the heading
 * read "A-ANN-SPE" — which is the draughtsman's layer name, not a title, and
 * tells the estimator nothing about whether it is the door schedule or the
 * abbreviations key. A real schedule almost always names itself in its own
 * first cells ("FINISH SCHEDULE", "DOOR SCHEDULE", "GENERAL NOTES"), so use
 * that when it is there and fall back to the layer when it is not.
 */
const TITLE_RE = /\b(SCHEDULE|LEGEND|ABBREVIATION|NOTES?|KEY|TABLE|SPECIFICATION|FINISHES?)\b/i;
function scheduleTitle(s: Schedule): string | null {
  const cells = [...s.header, ...s.rows.slice(0, 3).flat()];
  for (const raw of cells) {
    const c = String(raw ?? "").trim();
    // Long enough to be a title, short enough not to be a specification line.
    if (c.length >= 4 && c.length <= 60 && TITLE_RE.test(c)) return c;
  }
  return null;
}

/** The distinct labels in a tag cloud with how many times each appears. */
function tagCounts(s: Schedule): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const raw of [...s.header, ...s.rows.flat()]) {
    const label = String(raw ?? "").trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
}

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
  // Sets are read in order, so the next sheet and the one behind it are the two
  // most likely next clicks. Fetching them while this one is being looked at
  // makes the move to either of them instant instead of a wait.
  const neighbours = [drawings[index + 1]?.id, drawings[index - 1]?.id].filter(Boolean) as string[];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="chead">
        <div>
          <h2>{t("cad.title")}</h2>
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
            {/* Every uploaded drawing is listed, including one that is still
                being read or could not be read at all — a sheet missing from
                the picker reads as a lost file. The state is on the option so
                the reason is visible before it is opened rather than after. */}
            {drawings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
                {f.cad_layers == null
                  ? ` — ${f.status === "processing" ? t("cad.optReading") : t("cad.optUnread")}`
                  : ""}
              </option>
            ))}
          </select>
          <span className="cad-count mono">
            {index + 1}/{drawings.length}
          </span>
        </div>
      </div>

      <SheetDetail key={active} pid={pid} fid={active} neighbours={neighbours} />
    </div>
  );
}

function SheetDetail({ pid, fid, neighbours = [] }: { pid: string; fid: string; neighbours?: string[] }) {
  const { t } = useI18n();
  // Seeded from the cache, so a sheet that has already been looked at — or one
  // the prefetcher warmed while you were reading its neighbour — arrives with
  // no loading state at all.
  const [data, setData] = useState<CadView | null>(() => viewCache.get(fid) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (viewCache.has(fid)) { setData(viewCache.get(fid)!); return; }
    let live = true;
    fetchView(pid, fid)
      .then((v) => { if (live) setData(v); })
      .catch((e: any) => { if (live) setError(e?.message ?? t("common.loadFail")); });
    return () => { live = false; };
  }, [pid, fid, t]);

  // Warm the sheets either side, but only once this one has painted — a
  // prefetch that competes with the drawing the estimator is actually waiting
  // for makes the visible sheet slower, which is the opposite of the point.
  const ready = !!data;
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      for (const n of neighbours) {
        void fetchView(pid, n).catch(() => { /* prefetch is best-effort */ });
        void fetchSheet(pid, n).catch(() => { /* ditto */ });
      }
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pid, neighbours.join(",")]);

  if (error) return <div className="csub">{error}</div>;
  if (!data) return <Skeleton rows={4} />;

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

      <Schedules schedules={data.schedules} />

      <Notes notes={data.notes} />
    </>
  );
}

/**
 * Everything the extractor read as a table, folded away.
 *
 * A thirteen-sheet set produces a dozen of these per drawing, and rendered one
 * under another they ran for several screens of repeated title-block fragments
 * before the reader reached anything they wanted. Collapsed, the sheet ends
 * where the drawing ends and a schedule is one click away — which is the right
 * ratio, because on most sheets the schedules are checked once and the drawing
 * is looked at twenty times.
 */
function Schedules({ schedules }: { schedules: Schedule[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  // The first is opened by default only when it is the only one; with several,
  // opening one arbitrarily is just the old wall of text with extra steps.
  useEffect(() => { setOpen(schedules.length === 1 ? 0 : null); }, [schedules.length]);

  if (!schedules.length) return null;

  return (
    <div className="card sch" style={{ marginTop: 12 }}>
      <div className="chead">
        <div>
          <h2>{t("cad.schedules")}</h2>
          <div className="csub">{t("cad.schedulesSub", { n: schedules.length })}</div>
        </div>
      </div>

      <div className="sch-list">
        {schedules.map((s, i) => {
          const kind = classifySchedule(s);
          const isOpen = open === i;
          const cols = Math.max(s.header.length, ...s.rows.map((r) => r.length), 0);
          const named = scheduleTitle(s);
          const title = kind === "tags"
            ? t("cad.tagsOn", { layer: s.layer })
            : named ?? t("cad.tableOn", { layer: s.layer || "—" });
          return (
            <div className={"sch-item" + (isOpen ? " on" : "")} key={i}>
              <button className="sch-head" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
                <span className="tw-glyph" aria-hidden>{isOpen ? "▾" : "▸"}</span>
                <span className="sch-name">{title}</span>
                {/* The layer stays visible even when the table names itself —
                    it is how you find the same text back in the CAD file. */}
                {named && <span className="sch-layer mono">{s.layer}</span>}
                <span className="sch-meta mono">{kind === "tags" ? "" : `${s.rows.length} × ${cols}`}</span>
              </button>

              {isOpen && (kind === "tags" ? (
                // A cloud of room tags is not a table. Rendered as one it is four
                // hundred cells of the word "BED ROOM"; counted once each it is a
                // door count and a light count waiting to be used.
                <div className="sch-tags">
                  {tagCounts(s).map(([label, n]) => (
                    <span className="srcchip" key={label}>{label} <b className="mono">×{n}</b></span>
                  ))}
                </div>
              ) : (
                <div className="sch-body">
                  {/* A finishes cell is a whole specification sentence. Left to
                      size themselves those columns run to thousands of pixels, so
                      the width is capped, the text wraps, and the table scrolls
                      inside its own box rather than stretching the page. */}
                  <table className="tbl" style={{ tableLayout: "fixed", minWidth: Math.max(720, cols * 150) }}>
                    <thead>
                      <tr>
                        {Array.from({ length: cols }, (_, j) => (
                          <th key={j} style={{ width: 150, whiteSpace: "normal", wordBreak: "break-word", verticalAlign: "bottom" }}>
                            {s.header[j] ?? ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.slice(0, 60).map((r, j) => (
                        <tr key={j}>
                          {Array.from({ length: cols }, (_, k) => (
                            <td key={k} style={{ width: 150, whiteSpace: "normal", wordBreak: "break-word", verticalAlign: "top" }}>
                              {r[k] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.rows.length > 60 && (
                    <div className="csub" style={{ padding: "8px 2px 0" }}>
                      {t("cad.rowsShown", { n: 60, total: s.rows.length })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const real = useMemo(() => dedupe(notes).filter(isRealNote), [notes]);
  if (!real.length) return null;
  const shown = all ? real : real.slice(0, 12);
  return (
    <div className="card" style={{ marginTop: 12, padding: "14px 18px" }}>
      <div className="chead" style={{ marginBottom: 8 }}>
        <div>
          <h2>{t("cad.notes")}</h2>
          <div className="csub">{t("cad.notesSub")}</div>
        </div>
        {real.length > 12 && (
          <button className="mini sm" onClick={() => setAll((v) => !v)}>
            {all ? t("cad.hideTable") : t("cad.rowsShown", { n: shown.length, total: real.length })}
          </button>
        )}
      </div>
      <ul className="sch-notes">
        {shown.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
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
  const [svg, setSvg] = useState<string | null>(() => sheetCache.get(fid) ?? null);
  const [err, setErr] = useState<string | null>(view.renderError);
  const [rendering, setRendering] = useState(false);
  const [fetching, setFetching] = useState(view.hasSvg && !sheetCache.has(fid));

  /* The sheet arrives after the facts rather than inside them. It is megabytes
     on a real drawing, and carrying it in the same JSON meant the units, the
     layers and the block counts could not paint until the whole picture had
     downloaded. */
  useEffect(() => {
    if (!view.hasSvg || sheetCache.has(fid)) return;
    let live = true;
    setFetching(true);
    fetchSheet(pid, fid)
      .then((text) => { if (live) setSvg(text); })
      .catch(() => { if (live) setErr((e) => e ?? t("cad.noRenderWhy")); })
      .finally(() => { if (live) setFetching(false); });
    return () => { live = false; };
  }, [pid, fid, view.hasSvg, t]);
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
      if (r.svg) sheetCache.set(fid, r.svg);
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
    if (!view.hasSvg && !view.renderAttempted && !view.parseError) void render();
  }, [view.hasSvg, view.renderAttempted, view.parseError, render]);

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
          {/* The editor is a workspace tool, not a panel inside this card —
              drawing needs the width, and an estimator opens it for drawings
              that are not on this stage at all. This just arrives there with
              the project and sheet already chosen. */}
          {!view.parseError && (
            <Link className="btn btn-primary" href={`/drawings?pid=${pid}&fid=${fid}`}>{t("ed.open")}</Link>
          )}
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
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${z})`,
              // Read back by the stroke-width rule: a CSS transform scales the
              // linework with everything else, so the stroke is divided out to
              // stay one hairline wide at every zoom.
              ["--cad-z" as any]: z,
            }}
            // The renderer emits a standalone, self-contained SVG — no scripts,
            // no external refs — so it is safe to inline and needed to make it
            // scale to the panel.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        <div className="cad-empty">
          {rendering || fetching ? (
            <>
              <div className="sk" style={{ width: 180 }} />
              <p className="csub">{rendering ? t("cad.rendering") : t("cad.loadingSheet")}</p>
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

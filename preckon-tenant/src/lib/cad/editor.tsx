"use client";
// DrawLogix editor — the issued drawing, opened for markup.
//
// The estimator's question is never "can I redraw this building". It is "the
// wall on grid C is 200 not 150, and nobody has dimensioned the plant room."
// So this is a CAD editor scoped to what a bill needs: draw, dimension, hatch,
// annotate, move, erase — on real DXF geometry, with real object snaps, at real
// coordinates, and it writes a real DXF back out.
//
// Two exits, deliberately different:
//   Download DXF   — the marked-up sheet leaves for the consultant.
//   Save to project — the marked-up sheet comes BACK IN as a project file, so
//                     the sidecar re-reads it and the agents measure the version
//                     that carries the correction. That is the one that matters.
//
// The original file is never overwritten. A markup is a revision, and an issued
// drawing that silently changed under a signed-off quantity is how a bill stops
// being defensible.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DxfParser from "dxf-parser";
import { api } from "@/lib/apiclient";
import { useCan, useToast } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { cachedText } from "@/lib/desktop";
import {
  entityBody, nativeUnit, parseToModel, serializeModel, unitFactor as unitFactorOf, withIds,
  UNIT_OPTIONS, type DxfModel,
} from "./model";
import {
  ALL_SNAP_MODES, CadViewport, DEFAULT_SNAPS, type CadHandle, type SnapMode, type Tool,
} from "./viewport";
import { applyCadOps, type CadMark, type CadOp } from "./agent";
import { compareRevisions, type RevisionDiff } from "./compare";
import { assessRevisionImpact, dimensionChanges, type ImpactReport, type MeasurementRef } from "./impact";
import type { TraceEntry as CadTrace } from "@/lib/bim/agent2";
import { saveOver } from "./roundtrip";
import { IsoView } from "./isoview";
import { assumedHeight } from "./iso";

const DRAW: Array<[Tool, string, string]> = [
  ["line", "ed.line", "╱"],
  ["polyline", "ed.polyline", "⌁"],
  ["rect", "ed.rect", "▭"],
  ["circle", "ed.circle", "◯"],
  ["text", "ed.text", "T"],
  ["dimension", "ed.dimension", "↔"],
  ["hatch", "ed.hatch", "▨"],
];
const MODIFY: Array<[Tool, string, string]> = [
  ["move", "ed.move", "✥"],
  ["copy", "ed.copy", "⧉"],
  ["rotate", "ed.rotate", "⟳"],
  ["scale", "ed.scale", "⤢"],
  ["mirror", "ed.mirror", "◧"],
];
const SNAP_KEY: Record<SnapMode, string> = {
  end: "ed.snapEnd", mid: "ed.snapMid", center: "ed.snapCenter",
  intersection: "ed.snapInt", perp: "ed.snapPerp", nearest: "ed.snapNear", node: "ed.snapNode",
};

// Muted swatches for the layer list — the canvas is bright-on-black, a panel is not.
const ACI_CHIP: Record<number, string> = {
  1: "#dc2626", 2: "#ca8a04", 3: "#16a34a", 4: "#0891b2", 5: "#2563eb",
  6: "#c026d3", 7: "#374151", 8: "#6b7280", 9: "#9ca3af", 30: "#ea580c",
};

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/dxf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The drawing's DXF, fetched once per session.
 *
 * The server keeps the converted file now, so a repeat open is a fast read
 * rather than another ODA conversion — but it is still a round trip carrying
 * the whole drawing, and an estimator comparing two sheets flips between them
 * constantly. Held here, the second open of a drawing costs nothing.
 *
 * Only three, because a DXF is a large string and the point is the drawing you
 * just came from, not a session-long history. Text rather than a parsed model
 * on purpose: a model is edited in place by whoever holds it, and handing the
 * same one to a later open would carry somebody's markup into it.
 */
const DXF_CACHE_MAX = 3;
const dxfCache = new Map<string, string>();
const dxfInflight = new Map<string, Promise<string>>();

function fetchDxf(pid: string, fid: string): Promise<string> {
  const hit = dxfCache.get(fid);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = dxfInflight.get(fid);
  if (running) return running;
  /* On the desktop this is read off this machine after the first time — a
     converted .dwg is several megabytes and its bytes never change, so the
     download happens once and then never again, including across restarts. */
  const p = cachedText(`dxf:${fid}`, `/api/v1/projects/${pid}/files/${fid}/dxf`)
    .then((text) => {
      dxfCache.set(fid, text);
      while (dxfCache.size > DXF_CACHE_MAX) dxfCache.delete(dxfCache.keys().next().value as string);
      return text;
    })
    .finally(() => { dxfInflight.delete(fid); });
  dxfInflight.set(fid, p);
  return p;
}

export function CadEditor({
  pid, fid, filename, dxfText, onClose, onSaved,
}: {
  /** Present when the drawing belongs to a project — enables Save to project. */
  pid?: string;
  /** Fetch the drawing from this project file. Ignored when `dxfText` is given. */
  fid?: string;
  filename: string;
  /** An already-loaded DXF — a file opened from disk, never uploaded. */
  dxfText?: string;
  onClose?: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const canUpload = useCan("artifact.edit");
  const vp = useRef<CadHandle>(null);

  const [model, setModel] = useState<DxfModel | null>(null);
  /* The drawing exactly as it arrived. Saving re-emits THIS, with only the
     entities that were edited replaced — so the blocks, hatches, dimensions and
     splines the model cannot read survive a markup untouched. Without it, Save
     wrote a tracing of the parts we understood and threw the rest away. */
  const sourceRef = useRef<string | null>(null);
  const [past, setPast] = useState<DxfModel[]>([]);
  const [future, setFuture] = useState<DxfModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tool, setTool] = useState<Tool>("select");
  const [measuring, setMeasuring] = useState(false);
  const [activeLayer, setActiveLayer] = useState("0");
  const [selCount, setSelCount] = useState(0);
  const [mono, setMono] = useState(false);
  const [osnap, setOsnap] = useState(true);
  const [snaps, setSnaps] = useState<SnapMode[]>(DEFAULT_SNAPS);
  const [snapMenu, setSnapMenu] = useState(false);
  const [ortho, setOrtho] = useState(false);
  const [polar, setPolar] = useState(false);
  const [display, setDisplay] = useState("mm");
  const [precision, setPrecision] = useState(0);
  const [filter, setFilter] = useState("");
  /* A CAD canvas at 620px with a ribbon above and a layer list beside it gives
     the drawing about half the window. Escape leaves — a full-screen view with
     no visible way out is a trap. */
  const [full, setFull] = useState(false);

  /* The assistant. It reads the sheet as it stands on screen — including markup
     added a minute ago and not yet saved — because that is the drawing the
     question is about. Its measurements come back as marks on the canvas, so a
     figure can be checked rather than believed. */
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [chat, setChat] = useState<Array<{
    q: string; a: string; ops: number; removed?: number;
    trace?: CadTrace[]; assumptions?: string[]; question?: boolean;
  }>>([]);
  const [marks, setMarks] = useState<CadMark[]>([]);
  /* Ask measures and explains; Edit changes the sheet through the tool registry.
     Two modes rather than one box because they want different things back — a
     measurement wants marks on the canvas to check it against, an edit wants the
     tools it ran. Folding them together would make both answers worse. */
  const [mode, setMode] = useState<"ask" | "edit">("ask");
  /* Revision comparison. The diff runs in the browser because compareRevisions
     is pure and the editor already fetches and parses DXF — sending two whole
     drawings to the server to be diffed would move megabytes to compute
     something this page can do locally. Only the measurements come from the
     API, because only the server knows them. */
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [diff, setDiff] = useState<RevisionDiff | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [compareAgainst, setCompareAgainst] = useState("");
  /* A change large enough that it is worth seeing the number first. Holds the
     instruction, so agreeing re-sends it rather than making anyone retype. */
  const [pending, setPending] = useState<{ instruction: string; label: string; affected: number } | null>(null);
  const [copilot, setCopilot] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  /* Plan, stood up, or both. Split is the useful one: you point at something in
     the plan and see what it is in the same glance. */
  const [view, setView] = useState<"2d" | "3d" | "split">("2d");
  const [storey, setStorey] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Follow the conversation, the way any chat does — otherwise the answer you
  // just asked for arrives below the fold.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, asking]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  /* ── load ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setPast([]); setFuture([]); setDirty(false);

    const take = (text: string) => {
      if (!live) return;
      sourceRef.current = text;
      const raw = parseToModel(new DxfParser().parseSync(text) as any);
      if (!raw.entities.length) throw new Error("empty");
      const m = withIds(raw);
      setModel(m);
      setDisplay(nativeUnit(m.insunits));
      setActiveLayer(m.layers.some((l) => l.name === "0") ? "0" : (m.layers[0]?.name ?? "0"));
    };

    // A file opened from disk is already in hand. Otherwise fetch it: the DXF
    // endpoint returns converted bytes for a .dwg too, so the editor never has
    // to care which format was uploaded.
    const load = dxfText !== undefined
      ? Promise.resolve().then(() => take(dxfText))
      : fetchDxf(pid ?? "", fid ?? "").then(take);

    load
      .catch((e) => { if (live) setError(e?.message === "empty" ? t("ed.noGeometry") : t("ed.loadFail")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [pid, fid, dxfText, t]);

  /* The bytes both exits write. Preserves the original file where there is one,
     so a markup keeps the drawing's blocks, hatches and dimensions rather than
     replacing the sheet with a tracing of the parts this model understands. */
  const outputDxf = useCallback(
    (m: DxfModel) => saveOver(sourceRef.current, m, () => serializeModel(m), (es) => entityBody(es as any)),
    []
  );

  /* ── history ─────────────────────────────────────────────────────────── */
  const apply = useCallback((next: DxfModel) => {
    setModel((cur) => {
      if (cur) setPast((p) => [...p.slice(-49), cur]);
      return next;
    });
    setFuture([]);
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setModel((cur) => { if (cur) setFuture((f) => [cur, ...f]); return p[p.length - 1]; });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      setModel((cur) => { if (cur) setPast((p) => [...p, cur]); return f[0]; });
      return f.slice(1);
    });
  }, []);

  // Ctrl+Z / Ctrl+Y, plus the AutoCAD function keys people already have in their
  // fingers: F3 osnap, F8 ortho, F10 polar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "F3") { e.preventDefault(); setOsnap((v) => !v); return; }
      if (e.key === "F8") { e.preventDefault(); setOrtho((v) => !v); return; }
      if (e.key === "F10") { e.preventDefault(); setPolar((v) => !v); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Leaving with unsaved markup should cost a click, not a drawing.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ── layers ──────────────────────────────────────────────────────────── */
  const setLayers = (fn: (l: DxfModel["layers"]) => DxfModel["layers"]) =>
    setModel((m) => (m ? { ...m, layers: fn(m.layers) } : m));
  const toggleLayer = (name: string) =>
    setLayers((ls) => ls.map((l) => (l.name === name ? { ...l, visible: !l.visible } : l)));
  const allLayers = (visible: boolean) => setLayers((ls) => ls.map((l) => ({ ...l, visible })));

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of model?.entities ?? []) c.set(e.layer, (c.get(e.layer) ?? 0) + 1);
    return c;
  }, [model?.entities]);

  const layerList = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const ls = model?.layers ?? [];
    return q ? ls.filter((l) => l.name.toLowerCase().includes(q)) : ls;
  }, [model?.layers, filter]);

  /* ── exits ───────────────────────────────────────────────────────────── */
  const base = filename.replace(/\.[^.]+$/, "");
  function doDownload() {
    if (!model) return;
    download(outputDxf(model), `${base}-markup.dxf`);
  }
  async function doSave() {
    if (!model || !pid) return;
    setSaving(true);
    try {
      const name = `${base}-markup.dxf`;
      const file = new File([outputDxf(model)], name, { type: "application/dxf" });
      await api.upload(`/projects/${pid}/files`, file);
      setDirty(false);
      toast(t("ed.saved"));
      onSaved?.();
    } catch (e: any) {
      toast(e?.message ?? t("common.loadFail"));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Edit mode: the tool-driven assistant.
   *
   * Ops come back already decided but NOT applied — the browser applies them
   * once, here, so the canvas and the server agree on exactly what happened.
   * A large change comes back as a count and no ops, and is only carried out
   * after somebody has seen the number and said yes.
   */
  async function runAssistant(instruction: string, preapproved = false) {
    if (!instruction || !model || !pid) return;
    setAsking(true);
    setMarks([]);
    try {
      const r = await api.post<{
        status: "done" | "needs_confirmation" | "needs_input";
        reply: string; question?: string; ops?: CadOp[]; assumptions?: string[];
        trace?: CadTrace[]; pending?: { label: string; affected: number };
      }>(`/projects/${pid}/cad/assistant`, {
        instruction, filename, preapproved,
        model: { insunits: model.insunits, layers: model.layers, entities: model.entities },
      });

      if (r.status === "needs_confirmation" && r.pending) {
        setPending({ instruction, label: r.pending.label, affected: r.pending.affected });
        setChat((c) => [...c, { q: instruction, a: r.reply, ops: 0, trace: r.trace, assumptions: r.assumptions }]);
        return;
      }

      setPending(null);
      let applied = 0, removed = 0;
      if (r.ops?.length) {
        const out = applyCadOps(model, r.ops);
        applied = out.added;
        removed = out.removed;
        if (applied || removed) apply(out.model);
      }
      setChat((c) => [...c, {
        q: instruction, a: r.question ?? r.reply, ops: applied, removed,
        trace: r.trace, assumptions: r.assumptions, question: r.status === "needs_input",
      }]);
      setAsk("");
    } catch (e: any) {
      setChat((c) => [...c, { q: instruction, a: e?.message ?? t("common.loadFail"), ops: 0 }]);
    } finally {
      setAsking(false);
    }
  }

  async function askAgent() {
    const q = ask.trim();
    if (!q || !model || !pid) return;
    if (mode === "edit") return runAssistant(q);
    setAsking(true);
    setMarks([]);
    try {
      const r = await api.post<{ answer: string; ops: CadOp[]; marks: CadMark[] }>(
        `/projects/${pid}/cad/agent`,
        // The geometry goes with the question. The digest is built server-side:
        // the measurements are the part that has to be trustworthy, and a number
        // the client could shape first is a number nobody can rely on.
        { question: q, filename, model: { insunits: model.insunits, layers: model.layers, entities: model.entities } }
      );
      setMarks(r.marks ?? []);
      let applied = 0, removed = 0;
      if (r.ops?.length) {
        const out = applyCadOps(model, r.ops);
        applied = out.added;
        removed = out.removed;
        if (applied || removed) apply(out.model);
      }
      setChat((c) => [...c, { q, a: r.answer, ops: applied, removed }]);
      setAsk("");
    } catch (e: any) {
      setChat((c) => [...c, { q, a: e?.message ?? t("common.loadFail"), ops: 0 }]);
    } finally {
      setAsking(false);
    }
  }

  /**
   * Compare the open sheet against another revision.
   *
   * The diff runs here rather than on the server: compareRevisions is pure, this
   * page already fetches and parses DXF, and shipping two whole drawings across
   * the wire to compute something the browser can do locally would be slower and
   * no more correct.
   *
   * Argument order is deliberate — the OTHER file is the earlier revision and
   * what is open is the later one, so "added" reads as what this revision added.
   */
  async function runCompare(otherFid: string) {
    if (!model || !pid || !otherFid) return;
    setComparing(true);
    setDiff(null);
    setImpact(null);
    try {
      const text = await fetchDxf(pid, otherFid);
      const other = withIds(parseToModel(new DxfParser().parseSync(text) as any));
      const d = compareRevisions(other, model);
      setDiff(d);

      /* Measurements come from the server because only it knows them. A failure
         here must not lose the diff — the comparison is useful on its own, and
         the impact is the bonus. */
      try {
        const rows = await api.get<any>(`/projects/${pid}/artifacts?type=drawing_measurement`);
        const items: any[] = rows?.artifacts ?? rows ?? [];
        const sheet = filename.replace(/\.[^.]+$/, "");
        const mine: MeasurementRef[] = items
          .map((a) => ({ id: a.id, ...(a.payload ?? {}) }))
          .filter((m: any) => m.sheet_no && sheet.includes(m.sheet_no))
          .map((m: any) => ({
            id: m.id, sheet_no: m.sheet_no, item: m.item,
            quantity: Number(m.quantity ?? 0), unit: m.unit ?? "",
            source_layers: m.source_layers,
          }));
        setImpact(assessRevisionImpact(sheet, d, mine));
      } catch {
        // Left null; the diff still renders.
      }
    } catch (e: any) {
      toast(e?.message ?? t("common.loadFail"), "bad");
    } finally {
      setComparing(false);
    }
  }

  const pick = (nt: Tool) => { setTool(nt); setMeasuring(false); };
  const factor = model ? unitFactorOf(model.insunits, display) : 1;

  if (loading) return <div className="cad-empty"><p className="csub">{t("ed.loading")}</p></div>;
  if (error || !model) {
    return (
      <div className="cad-empty">
        <h4>{t("ed.cannotEdit")}</h4>
        <p className="csub">{error}</p>
        {onClose && (
          <div className="cad-tools" style={{ justifyContent: "center", marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={onClose}>{t("ed.close")}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={"ced" + (full ? " is-full" : "")}>
      {/* ── ribbon ─────────────────────────────────────────────────────── */}
      <div className="ced-rib">
        <div className="ced-grp">
          <button className={"ced-t" + (tool === "select" && !measuring ? " on" : "")} onClick={() => pick("select")}>▣ {t("ed.select")}</button>
          <button className={"ced-t" + (tool === "pan" ? " on" : "")} onClick={() => pick("pan")}>✋ {t("ed.pan")}</button>
          <button className={"ced-t" + (measuring ? " on" : "")} onClick={() => { setMeasuring((v) => !v); setTool("select"); }}>⟷ {t("ed.measure")}</button>
        </div>

        <span className="ced-sep" />
        <div className="ced-grp">
          {DRAW.map(([k, label, glyph]) => (
            <button key={k} className={"ced-t" + (tool === k && !measuring ? " on" : "")} onClick={() => pick(k)}>
              {glyph} {t(label as any)}
            </button>
          ))}
        </div>

        <span className="ced-sep" />
        <div className="ced-grp">
          {MODIFY.map(([k, label, glyph]) => (
            <button
              key={k}
              className={"ced-t" + (tool === k && !measuring ? " on" : "")}
              disabled={!selCount}
              title={selCount ? undefined : t("ed.selectFirst")}
              onClick={() => pick(k)}
            >
              {glyph} {t(label as any)}
            </button>
          ))}
          <button className="ced-t" disabled={!selCount} onClick={() => vp.current?.deleteSelection()}>✕ {t("ed.erase")}</button>
        </div>

        <span className="ced-sep" />
        <div className="ced-grp">
          <button className="ced-t" disabled={!past.length} onClick={undo}>↶ {t("ed.undo")}</button>
          <button className="ced-t" disabled={!future.length} onClick={redo}>↷ {t("ed.redo")}</button>
        </div>

        <span className="ced-spacer" />

        <div className="ced-grp">
          <button className="ced-t" onClick={() => vp.current?.zoom(1 / 1.3)}>−</button>
          <button className="ced-t" onClick={() => vp.current?.zoom(1.3)}>+</button>
          <button className="ced-t" onClick={() => vp.current?.fit()}>{t("ed.fit")}</button>
          <span className="ced-sep" />
          {/* 2D is where the measuring happens, so it leads and stays the
              default. The other two are for reading the drawing, not taking
              quantities off it. */}
          {([["2d", t("ed.view2d")], ["split", t("ed.viewSplit")], ["3d", t("ed.view3d")]] as const).map(([v, label]) => (
            <button
              key={v}
              className={"ced-t" + (view === v ? " on" : "")}
              onClick={() => setView(v)}
              aria-pressed={view === v}
            >
              {label}
            </button>
          ))}
          <button className={"ced-t" + (full ? " on" : "")} onClick={() => setFull((v) => !v)} aria-pressed={full}>
            {full ? "⤡" : "⤢"} {full ? t("ed.exitFull") : t("ed.full")}
          </button>
        </div>
      </div>

      {/* ── status strip: the drafting aids, where AutoCAD puts them ────── */}
      <div className="ced-aids">
        <button className={"ced-aid" + (osnap ? " on" : "")} onClick={() => setOsnap((v) => !v)}>{t("ed.osnap")} <kbd>F3</kbd></button>
        <div className="ced-snapwrap">
          <button className="ced-aid" onClick={() => setSnapMenu((v) => !v)} aria-expanded={snapMenu}>{t("ed.snapModes", { n: snaps.length })} ▾</button>
          {snapMenu && (
            <div className="ced-snapmenu" onMouseLeave={() => setSnapMenu(false)}>
              {ALL_SNAP_MODES.map((m) => (
                <label key={m}>
                  <input
                    type="checkbox"
                    checked={snaps.includes(m)}
                    onChange={() => setSnaps((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}
                  />
                  {t(SNAP_KEY[m] as any)}
                </label>
              ))}
            </div>
          )}
        </div>
        <button className={"ced-aid" + (ortho ? " on" : "")} onClick={() => { setOrtho((v) => !v); setPolar(false); }}>{t("ed.ortho")} <kbd>F8</kbd></button>
        <button className={"ced-aid" + (polar ? " on" : "")} onClick={() => { setPolar((v) => !v); setOrtho(false); }}>{t("ed.polar")} <kbd>F10</kbd></button>
        <button className={"ced-aid" + (mono ? " on" : "")} onClick={() => setMono((v) => !v)}>{t("ed.mono")}</button>

        <span className="ced-spacer" />

        <label className="ced-fld">
          {t("ed.activeLayer")}
          <select value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)}>
            {model.layers.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </label>
        <label className="ced-fld">
          {t("ed.units")}
          <select value={display} onChange={(e) => setDisplay(e.target.value)}>
            {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="ced-fld">
          {t("ed.precision")}
          <select value={precision} onChange={(e) => setPrecision(Number(e.target.value))}>
            {[0, 1, 2, 3].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      {/* ── canvas + layers ────────────────────────────────────────────── */}
      <div className="ced-body">
        <div className={"ced-canvas ced-view-" + view}>
          {view !== "3d" && (
          <CadViewport
            ref={vp}
            model={model}
            mono={mono}
            units={display}
            unitFactor={factor}
            precision={precision}
            measuring={measuring}
            fitOn={fid ?? filename}
            tool={tool}
            activeLayer={activeLayer}
            osnap={osnap}
            snapModes={snaps}
            ortho={ortho}
            polar={polar}
            onChange={apply}
            onOperationDone={() => setTool("select")}
            onSelectionChange={setSelCount}
            marks={marks}
          />
          )}

          {view === "split" && <div className="ced-split-rule" aria-hidden />}

          {view !== "2d" && (
            <IsoView
              model={model}
              units={display}
              wallHeight={storey ?? assumedHeight(model)}
              onWallHeight={setStorey}
              hint={t("ed.isoHint")}
            />
          )}
        </div>

        <aside className="ced-side">
          {/* Revision comparison. Folded away by default: it answers a question
              you ask occasionally and deliberately, unlike the assistant, which
              is the first thing reached for on an unfamiliar sheet. */}
          {pid && fid && (
            <div className="ced-cmp">
              <button className="ced-cop-h" onClick={() => setCompareOpen((v) => !v)} aria-expanded={compareOpen}>
                <span className="tw-glyph" aria-hidden>{compareOpen ? "▾" : "▸"}</span>
                <span>{t("ed.compare")}</span>
                {diff && <span className="ced-cop-n mono">{diff.added.length + diff.removed.length + diff.moved.length + diff.textChanged.length}</span>}
              </button>

              {compareOpen && (
                <div className="ced-cmp-body">
                  <p className="ced-cop-intro">{t("ed.compareIntro")}</p>
                  <div className="ced-cmp-pick">
                    <select
                      value={compareAgainst}
                      onChange={(e) => setCompareAgainst(e.target.value)}
                      aria-label={t("ed.compareAgainst")}
                      disabled={comparing}
                    >
                      <option value="">{t("ed.comparePick")}</option>
                      {(otherFiles ?? []).map((f: any) => (
                        <option key={f.id} value={f.id}>{f.filename}</option>
                      ))}
                    </select>
                    <button
                      className="mini sm pri"
                      onClick={() => runCompare(compareAgainst)}
                      disabled={comparing || !compareAgainst}
                    >
                      {comparing ? t("ed.comparing") : t("ed.compareRun")}
                    </button>
                  </div>

                  {diff && (
                    <div className="ced-cmp-out">
                      <div className="ced-cmp-sum">{diff.summary}</div>

                      {/* Dimension changes first, and ranked by proportion: they
                          are the one signal a reader can act on immediately, and
                          the one most easily lost in a diff of two thousand
                          entities. */}
                      {dimensionChanges(diff).length > 0 && (
                        <>
                          <div className="ced-cmp-h">{t("ed.compareDims")}</div>
                          <ul className="ced-cmp-list">
                            {dimensionChanges(diff).slice(0, 8).map((c, i) => (
                              <li key={i}>
                                <span className="mono">{c.before} → {c.after}</span>
                                <span className="csub">
                                  {c.delta > 0 ? "+" : ""}{c.delta}
                                  {c.percent !== null ? ` · ${c.percent}%` : ""} · {c.layer}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}

                      {diff.byLayer.length > 0 && (
                        <>
                          <div className="ced-cmp-h">{t("ed.compareLayers")}</div>
                          <ul className="ced-cmp-list">
                            {diff.byLayer.slice(0, 8).map((l) => (
                              <li key={l.layer}>
                                <span className="mono">{l.layer}</span>
                                <span className="csub">
                                  {[l.added && `+${l.added}`, l.removed && `−${l.removed}`,
                                    l.moved && `↔${l.moved}`, l.textChanged && `✎${l.textChanged}`]
                                    .filter(Boolean).join("  ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}

                      {/* What it means for the numbers. "Unverifiable" is its own
                          line on purpose: a measurement with no recorded source
                          cannot be shown safe, and folding it into "unaffected"
                          is how a stale quantity reaches a bill. */}
                      {impact && (
                        <div className={"ced-cmp-impact" + (impact.needsReview ? " needs-review" : "")}>
                          <div className="ced-cmp-h">{t("ed.compareImpact")}</div>
                          <ul className="ced-cmp-list">
                            {impact.affected.slice(0, 8).map((a) => (
                              <li key={a.id}>
                                <b>{a.item}</b>
                                <span className="csub">{a.quantity} {a.unit} · {a.via.join(", ")}</span>
                              </li>
                            ))}
                          </ul>
                          <p className="csub">
                            {t("ed.compareCounts", {
                              affected: impact.affected.length,
                              unknown: impact.unknown.length,
                              ok: impact.unaffected,
                            })}
                          </p>
                          {/* Nothing here recalculates. */}
                          <p className="csub">{t("ed.compareNoRecalc")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* The assistant sits above the layer list because it is the thing you
              reach for first on an unfamiliar sheet: what is this, how big is
              it, how many of those are there. */}
          {pid && (
            <div className="ced-cop">
              <button className="ced-cop-h" onClick={() => setCopilot((v) => !v)} aria-expanded={copilot}>
                <span className="tw-glyph" aria-hidden>{copilot ? "▾" : "▸"}</span>
                <span>{t("ed.copilot")}</span>
                {marks.length > 0 && <span className="ced-cop-n mono">{marks.length}</span>}
              </button>

              {copilot && (
                <>
                  {chat.length === 0 && <p className="ced-cop-intro">{t("ed.copilotIntro")}</p>}

                  <div className="ced-cop-log" ref={logRef}>
                    {chat.map((m, i) => (
                      <div className="ced-cop-turn" key={i}>
                        <div className="q">{m.q}</div>
                        {/* Which tools ran. The same reasoning as BIM Studio: an
                            assistant that changes an issued drawing has to show
                            that it looked before it wrote. */}
                        {m.trace && m.trace.length > 0 && (
                          <ol className="ced-cop-trace">
                            {m.trace.map((s, j) => (
                              <li key={j} className={s.ok ? "" : "is-bad"}>
                                <b>{s.label}</b>
                                <span className="mod">{s.module}</span>
                                <span className="sum">{s.summary}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                        <div className={"a" + (m.question ? " is-question" : "")}>{m.a}</div>
                        {/* What it decided for itself — the part worth arguing
                            with, so never folded into the sentence above. */}
                        {m.assumptions && m.assumptions.length > 0 && (
                          <ul className="ced-cop-assumed">
                            {m.assumptions.map((x, j) => <li key={j}>{x}</li>)}
                          </ul>
                        )}
                        {/* Stated on every turn, including when nothing
                            happened. An answer that describes an edit which was
                            never applied is indistinguishable from one that
                            worked, unless the drawing says otherwise. */}
                        {m.ops > 0 || (m.removed ?? 0) > 0 ? (
                          <div className="ced-cop-edit">
                            {m.ops > 0 && t("ed.copilotAdded", { n: m.ops })}
                            {m.ops > 0 && (m.removed ?? 0) > 0 ? " · " : ""}
                            {(m.removed ?? 0) > 0 && t("ed.copilotRemoved", { n: m.removed ?? 0 })}
                            {" · "}{t("ed.copilotUndo")}
                          </div>
                        ) : (
                          <div className="ced-cop-edit none">{t("ed.copilotNoChange")}</div>
                        )}
                      </div>
                    ))}
                    {asking && <div className="ced-cop-turn"><div className="a">{t("ed.copilotThinking")}</div></div>}
                  </div>

                  {/* Starters, because the useful questions are not obvious and
                      an empty box teaches nobody what this can answer. */}
                  {chat.length === 0 && (
                    <div className="ced-cop-eg">
                      {[t("ed.eg1"), t("ed.eg2"), t("ed.eg3")].map((q) => (
                        <button key={q} onClick={() => setAsk(q)}>{q}</button>
                      ))}
                    </div>
                  )}

                  {/* The number, before the change. The only place a large
                      deletion gets questioned — ops go straight to the canvas
                      here, so there is no proposal step further down. */}
                  {pending && (
                    <div className="ced-cop-confirm">
                      <b>{t("ed.confirmTitle", { n: pending.affected })}</b>
                      <span className="csub">{pending.label}</span>
                      <div className="ced-cop-acts">
                        <button className="mini sm pri" disabled={asking}
                          onClick={() => { const i = pending.instruction; setPending(null); void runAssistant(i, true); }}>
                          {t("ed.confirmGo")}
                        </button>
                        <button className="mini sm" disabled={asking} onClick={() => setPending(null)}>
                          {t("ed.confirmNo")}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="ced-cop-ask">
                    {/* Ask measures, Edit changes. Stated rather than inferred:
                        somebody about to alter an issued sheet should have had
                        to choose to. */}
                    <div className="ced-cop-mode" role="group" aria-label={t("ed.modeLabel")}>
                      <button className={mode === "ask" ? "on" : ""} onClick={() => setMode("ask")} disabled={asking}>
                        {t("ed.modeAsk")}
                      </button>
                      <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")} disabled={asking || !canUpload}>
                        {t("ed.modeEdit")}
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={ask}
                      onChange={(e) => setAsk(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void askAgent(); } }}
                      placeholder={mode === "edit" ? t("ed.editPlaceholder") : t("ed.copilotPlaceholder")}
                      aria-label={t("ed.copilot")}
                      disabled={asking}
                    />
                    <div className="ced-cop-acts">
                      {marks.length > 0 && (
                        <button className="mini sm" onClick={() => setMarks([])}>{t("ed.copilotClear")}</button>
                      )}
                      <button className="mini sm pri" onClick={askAgent} disabled={asking || !ask.trim()}>
                        {asking ? t("ed.copilotThinking") : mode === "edit" ? t("ed.modeEdit") : t("ed.copilotAsk")}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Layers moved to the foot and closed by default. It is a reference
              list you open when you want it; leaving it expanded gave a
              seventy-layer sheet the whole panel and squeezed the assistant —
              the thing you actually work with — into four lines. */}
          <div className={"ced-lay" + (layersOpen ? " on" : "")}>
            <button className="ced-lay-h" onClick={() => setLayersOpen((v) => !v)} aria-expanded={layersOpen}>
              <span className="tw-glyph" aria-hidden>{layersOpen ? "▾" : "▸"}</span>
              <span>{t("ed.layers")}</span>
              <b className="mono">{model.layers.length}</b>
            </button>

            {layersOpen && (
              <div className="ced-lay-body">
                <input
                  className="ced-filter"
                  value={filter}
                  placeholder={t("ed.layerFilter")}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="ced-layeracts">
                  <button className="mini sm" onClick={() => allLayers(true)}>{t("ed.allOn")}</button>
                  <button className="mini sm" onClick={() => allLayers(false)}>{t("ed.allOff")}</button>
                </div>
                <div className="ced-layers">
                  {layerList.map((l) => (
                    <div className={"ced-layer" + (l.visible ? "" : " off")} key={l.name}>
                      <button className="eye" onClick={() => toggleLayer(l.name)} aria-label={l.name} title={t("ed.toggleLayer")}>
                        {l.visible ? "◉" : "○"}
                      </button>
                      <i style={{ background: ACI_CHIP[l.aci] ?? "#374151" }} />
                      {/* Clicking the name selects that layer's geometry — the
                          fastest way to erase a redundant layer or move it as one. */}
                      <button
                        className="nm"
                        title={t("ed.selectLayer")}
                        onClick={() => { pick("select"); vp.current?.selectLayer(l.name); }}
                      >
                        {l.name}
                      </button>
                      <b className="mono">{counts.get(l.name) ?? 0}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="ced-stats">
            <div className="trow-lbl" style={{ borderTop: 0 }}>{t("ed.entities")} <b className="mono">{model.entities.length}</b></div>
            <div className="trow-lbl">{t("ed.selected")} <b className="mono">{selCount}</b></div>
          </div>
        </aside>
      </div>

      {/* ── exits ──────────────────────────────────────────────────────── */}
      <div className="ced-foot">
        <span className="csub">{dirty ? t("ed.unsaved") : pid ? t("ed.saveHint") : t("ed.localHint")}</span>
        <span className="ced-spacer" />
        {onClose && <button className="btn btn-ghost" onClick={onClose}>{t("ed.close")}</button>}
        <button className="btn btn-ghost" onClick={doDownload}>{t("ed.download")}</button>
        {pid && canUpload && (
          <button className="btn btn-primary" disabled={saving || !dirty} onClick={doSave}>
            {saving ? t("ed.saving") : t("ed.save")}
          </button>
        )}
      </div>
    </div>
  );
}

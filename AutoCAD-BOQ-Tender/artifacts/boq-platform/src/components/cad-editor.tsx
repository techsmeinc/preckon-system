import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Loader2, AlertTriangle, MousePointer2, Square, ArrowUpRight, Cloud, Pen, Type,
  Highlighter, Ruler, Hexagon, Spline, Trash2, Undo2, Save, Download, X, ZoomIn, ZoomOut, Maximize,
} from "lucide-react";

type Tool =
  | "pan" | "rect" | "highlight" | "arrow" | "cloud" | "pen" | "text"
  | "dist" | "area" | "angle";

interface Anno {
  id: string;
  type: "rect" | "highlight" | "arrow" | "cloud" | "pen" | "text" | "dist" | "area" | "angle";
  points: number[]; // flat [x0,y0,x1,y1,…] in SVG view-box coords
  color: string;
  text?: string;
}

const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0f172a"];

const MARKUP_TOOLS: { tool: Tool; icon: typeof Square; label: string }[] = [
  { tool: "pan", icon: MousePointer2, label: "Select / pan" },
  { tool: "rect", icon: Square, label: "Rectangle" },
  { tool: "highlight", icon: Highlighter, label: "Highlight" },
  { tool: "arrow", icon: ArrowUpRight, label: "Arrow" },
  { tool: "cloud", icon: Cloud, label: "Revision cloud" },
  { tool: "pen", icon: Pen, label: "Freehand" },
  { tool: "text", icon: Type, label: "Text note" },
];
const MEASURE_TOOLS: { tool: Tool; icon: typeof Square; label: string }[] = [
  { tool: "dist", icon: Ruler, label: "Distance" },
  { tool: "area", icon: Hexagon, label: "Area" },
  { tool: "angle", icon: Spline, label: "Angle" },
];
const DRAG_TOOLS: Tool[] = ["rect", "highlight", "arrow", "cloud", "pen", "dist"];

let _seq = 0;
const newId = () => `a${Date.now().toString(36)}${_seq++}`;

interface CadEditorProps {
  documentId: number;
  originalName: string;
  /** Rendered SVG URL (same one the viewer uses). */
  svgUrl: string;
  onClose: () => void;
}

/**
 * Markup + measurement editor for a CAD drawing. The server-rendered SVG is the
 * (read-only) background; annotations are drawn on a transparent overlay that
 * shares the SVG's view-box, so they track pan/zoom exactly and align on export.
 * The original DWG/DXF is never modified — annotations persist per document.
 */
export function CadEditor({ documentId, originalName, svgUrl, onClose }: CadEditorProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [svg, setSvg] = useState("");

  const [annos, setAnnos] = useState<Anno[]>([]);
  const [draft, setDraft] = useState<Anno | null>(null);
  const [tool, setTool] = useState<Tool>("pan");
  const [color, setColor] = useState(COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pan / zoom (CSS transform on the canvas container).
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const drawing = useRef(false);

  // Parse the background SVG's view-box + physical width to scale measurements.
  const { vbW, vbH, mmPerUnit } = useMemo(() => {
    const vb = /viewBox="([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+)"/.exec(svg);
    const wmm = /width="([\d.eE+-]+)mm"/.exec(svg);
    const W = vb ? parseFloat(vb[3]) : 1000, H = vb ? parseFloat(vb[4]) : 1000;
    const widthMm = wmm ? parseFloat(wmm[1]) : W;
    return { vbW: W, vbH: H, mmPerUnit: W > 0 ? widthMm / W : 1 };
  }, [svg]);

  // World-proportional sizes (so strokes/labels render in screen *and* export).
  const U = vbW || 1000;
  const STROKE = U * 0.0013;
  const FONT = U * 0.013;
  const HEAD = U * 0.012;

  // ── Load background SVG + saved annotations ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus("loading"); setError("");
    (async () => {
      try {
        const [sRes, aRes] = await Promise.all([
          fetch(svgUrl, { credentials: "include" }),
          fetch(`/api/documents/${documentId}/annotations`, { credentials: "include" }),
        ]);
        if (!sRes.ok) {
          let msg = `Render failed (${sRes.status})`;
          try { const j = await sRes.json(); msg = j.detail || j.error || msg; } catch { /* */ }
          throw new Error(msg);
        }
        const text = await sRes.text();
        const saved = aRes.ok ? await aRes.json().catch(() => null) : null;
        if (cancelled) return;
        setSvg(text);
        setAnnos(Array.isArray(saved?.annotations) ? saved.annotations : []);
        setDirty(false);
        setScale(1); setTx(0); setTy(0);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to open drawing");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [svgUrl, documentId]);

  // Size the injected background SVG to fill the host.
  useEffect(() => {
    const el = hostRef.current?.querySelector("svg");
    if (el) { el.setAttribute("width", "100%"); el.setAttribute("height", "100%"); (el as SVGElement).style.display = "block"; }
  }, [svg]);

  // Wheel-zoom (native, non-passive).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || status !== "ready") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(80, Math.max(0.05, +(s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [status]);

  // Delete / Escape shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDraft(null); drawing.current = false; setSelectedId(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setAnnos((a) => a.filter((x) => x.id !== selectedId)); setSelectedId(null); setDirty(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Client px → SVG view-box coords (CTM already includes the CSS transform).
  const toView = (e: { clientX: number; clientY: number }) => {
    const svgEl = overlayRef.current;
    const ctm = svgEl?.getScreenCTM();
    if (!svgEl || !ctm) return { x: 0, y: 0 };
    const p = svgEl.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const r = p.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  };

  const commit = (a: Anno) => { setAnnos((prev) => [...prev, a]); setDirty(true); };

  const onDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const p = toView(e);
    if (tool === "pan") { pan.current = { x: e.clientX, y: e.clientY, tx, ty }; setSelectedId(null); return; }
    if (tool === "text") {
      const t = window.prompt("Note text:");
      if (t && t.trim()) commit({ id: newId(), type: "text", points: [p.x, p.y], color, text: t.trim() });
      return;
    }
    if (tool === "area" || tool === "angle") {
      setDraft((d) => {
        const pts = d ? [...d.points, p.x, p.y] : [p.x, p.y];
        const next: Anno = { id: d?.id ?? newId(), type: tool, points: pts, color };
        if (tool === "angle" && pts.length >= 6) { commit({ ...next, points: pts.slice(0, 6) }); return null; }
        return next;
      });
      return;
    }
    if (DRAG_TOOLS.includes(tool)) {
      drawing.current = true;
      setDraft({ id: newId(), type: tool as Anno["type"], points: tool === "pen" ? [p.x, p.y] : [p.x, p.y, p.x, p.y], color });
    }
  };

  const onMove = (e: ReactMouseEvent) => {
    if (pan.current) { setTx(pan.current.tx + (e.clientX - pan.current.x)); setTy(pan.current.ty + (e.clientY - pan.current.y)); return; }
    if (!drawing.current || !draft) return;
    const p = toView(e);
    setDraft((d) => {
      if (!d) return d;
      if (d.type === "pen") return { ...d, points: [...d.points, p.x, p.y] };
      return { ...d, points: [d.points[0], d.points[1], p.x, p.y] };
    });
  };

  const onUp = () => {
    if (pan.current) { pan.current = null; return; }
    if (drawing.current && draft) {
      drawing.current = false;
      const pts = draft.points;
      const big = draft.type === "pen"
        ? pts.length >= 6
        : Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) > U * 0.004;
      if (big) commit(draft);
      setDraft(null);
    }
  };

  const finishArea = () => {
    if (draft && draft.type === "area" && draft.points.length >= 6) commit(draft);
    setDraft(null);
  };

  // ── Persistence ────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: annos }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      setDirty(false);
      toast({ title: "Markup saved", description: `${annos.length} annotation${annos.length === 1 ? "" : "s"} saved.` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved markup?")) return;
    onClose();
  };

  // ── Export annotated PNG (background SVG + overlay, rasterised) ─────────────
  const exportPng = async () => {
    try {
      const overlayMarkup = overlayRef.current ? serializeAnnotations(annos) : "";
      const combined = svg.replace(/<\/svg>\s*$/, `${overlayMarkup}</svg>`);
      const blobUrl = URL.createObjectURL(new Blob([combined], { type: "image/svg+xml" }));
      const img = new Image();
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("render")); img.src = blobUrl; });
      const targetW = Math.min(4000, Math.max(1600, vbW > 0 ? 2400 : 1600));
      const ar = vbH / vbW || 0.7;
      const canvas = document.createElement("canvas");
      canvas.width = targetW; canvas.height = Math.round(targetW * ar);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `${originalName.replace(/\.[^.]+$/, "")}-markup.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    } catch {
      toast({ title: "Export failed", description: "Could not rasterise the drawing.", variant: "destructive" });
    }
  };

  // Serialize one annotation to an SVG fragment string (used for PNG export).
  const serializeAnnotations = (list: Anno[]) =>
    list.map((a) => annoToSvgString(a, { STROKE, FONT, HEAD, mmPerUnit })).join("");

  const fmtLen = (units: number) => {
    const mm = units * mmPerUnit;
    return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`;
  };
  const fmtArea = (u2: number) => {
    const mm2 = u2 * mmPerUnit * mmPerUnit; const m2 = mm2 / 1e6;
    return m2 >= 0.01 ? `${m2.toFixed(2)} m²` : `${mm2.toFixed(0)} mm²`;
  };

  const sizing = { STROKE, FONT, HEAD, mmPerUnit, fmtLen, fmtArea };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1b1d23]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap border-b border-white/10 bg-[#23262e] px-3 py-2 text-white">
        <span className="mr-1 max-w-[28ch] truncate text-sm font-medium" title={originalName}>{originalName}</span>
        <span className="text-[10px] text-white/50">{dirty ? "● unsaved" : "saved"}</span>
        <span className="mx-1 h-5 w-px bg-white/15" />
        {MARKUP_TOOLS.map(({ tool: t, icon: Icon, label }) => (
          <ToolBtn key={t} active={tool === t} title={label} onClick={() => { setTool(t); setDraft(null); }}><Icon className="h-4 w-4" /></ToolBtn>
        ))}
        <span className="mx-1 h-5 w-px bg-white/15" />
        {MEASURE_TOOLS.map(({ tool: t, icon: Icon, label }) => (
          <ToolBtn key={t} active={tool === t} title={label} onClick={() => { setTool(t); setDraft(null); }}><Icon className="h-4 w-4" /></ToolBtn>
        ))}
        {tool === "area" && draft && (
          <Button size="sm" variant="secondary" className="h-7" onClick={finishArea}>Finish area</Button>
        )}
        <span className="mx-1 h-5 w-px bg-white/15" />
        {/* Colours */}
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button key={c} title={c} onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border ${color === c ? "ring-2 ring-white ring-offset-1 ring-offset-[#23262e]" : "border-white/20"}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <ToolBtn title="Delete selected" disabled={!selectedId} onClick={() => { if (selectedId) { setAnnos((a) => a.filter((x) => x.id !== selectedId)); setSelectedId(null); setDirty(true); } }}><Trash2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Undo last" disabled={!annos.length} onClick={() => { setAnnos((a) => a.slice(0, -1)); setDirty(true); }}><Undo2 className="h-4 w-4" /></ToolBtn>
        <span className="flex-1" />
        {/* Zoom */}
        <ToolBtn title="Zoom out" onClick={() => setScale((s) => Math.max(0.05, +(s / 1.2).toFixed(3)))}><ZoomOut className="h-4 w-4" /></ToolBtn>
        <span className="w-11 text-center text-xs tabular-nums text-white/70">{Math.round(scale * 100)}%</span>
        <ToolBtn title="Zoom in" onClick={() => setScale((s) => Math.min(80, +(s * 1.2).toFixed(3)))}><ZoomIn className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Fit" onClick={() => { setScale(1); setTx(0); setTy(0); }}><Maximize className="h-4 w-4" /></ToolBtn>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <Button size="sm" variant="secondary" className="h-7 gap-1" onClick={exportPng} disabled={status !== "ready"}><Download className="h-3.5 w-3.5" /> PNG</Button>
        <Button size="sm" className="h-7 gap-1" onClick={save} disabled={saving || status !== "ready"}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
        <ToolBtn title="Close" onClick={handleClose}><X className="h-4 w-4" /></ToolBtn>
      </div>

      {/* Hint bar */}
      <div className="border-b border-white/10 bg-[#1f222a] px-3 py-1 text-[11px] text-white/55">
        {tool === "pan" && "Drag to pan · scroll to zoom · click a markup to select, then Delete"}
        {DRAG_TOOLS.includes(tool) && "Drag to draw"}
        {tool === "text" && "Click to place a text note"}
        {tool === "area" && "Click each corner, then ‘Finish area’ (or double-click) — area shown in the drawing's units"}
        {tool === "angle" && "Click three points: end, vertex, end"}
        {mmPerUnit !== 1 ? "" : ""}
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden">
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-white/70"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-6 text-center text-white/70">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
            <p className="text-sm">Couldn&apos;t open this drawing for markup.</p>
            <p className="max-w-md break-words text-xs opacity-70">{error}</p>
          </div>
        )}
        {status === "ready" && (
          <div
            ref={viewportRef}
            className={`h-full w-full ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onDoubleClick={() => { if (tool === "area") finishArea(); }}
          >
            <div
              className="h-full w-full"
              style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "center center" }}
            >
              {/* Background drawing (read-only) on white */}
              <div ref={hostRef} className="absolute inset-0 bg-white" dangerouslySetInnerHTML={{ __html: svg }} />
              {/* Annotation overlay — same view-box, so it aligns with the drawing */}
              <svg ref={overlayRef} className="absolute inset-0 h-full w-full" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }}>
                {annos.map((a) => (
                  <AnnoView key={a.id} a={a} selected={a.id === selectedId} sizing={sizing}
                    onSelect={() => { if (tool === "pan") setSelectedId(a.id); }} interactive={tool === "pan"} />
                ))}
                {draft && <AnnoView a={draft} selected={false} sizing={sizing} preview />}
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({ active, disabled, title, onClick, children }: { active?: boolean; disabled?: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded text-white/80 transition-colors disabled:opacity-30 ${active ? "bg-primary text-primary-foreground" : "hover:bg-white/10"}`}>
      {children}
    </button>
  );
}

interface Sizing {
  STROKE: number; FONT: number; HEAD: number; mmPerUnit: number;
  fmtLen: (u: number) => string; fmtArea: (u: number) => string;
}

// Revision-cloud path around a bounding box.
function cloudPath(x1: number, y1: number, x2: number, y2: number): string {
  const xmin = Math.min(x1, x2), xmax = Math.max(x1, x2), ymin = Math.min(y1, y2), ymax = Math.max(y1, y2);
  const w = xmax - xmin, h = ymax - ymin;
  if (w <= 0 || h <= 0) return "";
  const r = Math.max(Math.min(w, h) / 10, 1);
  const arcs = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / (r * 2)));
    const ux = (bx - ax) / n, uy = (by - ay) / n;
    let d = "";
    for (let i = 0; i < n; i++) d += ` A ${r} ${r} 0 0 1 ${ax + ux * (i + 1)} ${ay + uy * (i + 1)}`;
    return d;
  };
  return `M ${xmin} ${ymin}` + arcs(xmin, ymin, xmax, ymin) + arcs(xmax, ymin, xmax, ymax) +
    arcs(xmax, ymax, xmin, ymax) + arcs(xmin, ymax, xmin, ymin) + " Z";
}

function polyArea(pts: number[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const x1 = pts[i], y1 = pts[i + 1];
    const x2 = pts[(i + 2) % pts.length], y2 = pts[(i + 3) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function AnnoView({ a, selected, sizing, onSelect, interactive, preview }: {
  a: Anno; selected: boolean; sizing: Sizing; onSelect?: () => void; interactive?: boolean; preview?: boolean;
}) {
  const { STROKE, FONT, HEAD, fmtLen, fmtArea } = sizing;
  const p = a.points;
  const sw = STROKE * (selected ? 2 : 1);
  const hit = interactive ? "stroke" : "none";
  const common = { stroke: a.color, strokeWidth: sw, fill: "none", style: { pointerEvents: hit as "stroke" | "none", cursor: interactive ? "pointer" : "default" }, onClick: onSelect };
  const label = (x: number, y: number, t: string, anchor = "middle") => (
    <text x={x} y={y} fontSize={FONT} fill={a.color} stroke="#fff" strokeWidth={FONT * 0.12} paintOrder="stroke"
      textAnchor={anchor as "middle"} dominantBaseline="central" style={{ pointerEvents: "none" }}>{t}</text>
  );

  switch (a.type) {
    case "rect":
      return <rect x={Math.min(p[0], p[2])} y={Math.min(p[1], p[3])} width={Math.abs(p[2] - p[0])} height={Math.abs(p[3] - p[1])} {...common} />;
    case "highlight":
      return <rect x={Math.min(p[0], p[2])} y={Math.min(p[1], p[3])} width={Math.abs(p[2] - p[0])} height={Math.abs(p[3] - p[1])}
        fill={a.color} fillOpacity={0.22} stroke="none" style={{ pointerEvents: hit as "fill" | "none" }} onClick={onSelect} />;
    case "cloud":
      return <path d={cloudPath(p[0], p[1], p[2], p[3])} {...common} />;
    case "pen":
      return <polyline points={pairs(p)} {...common} strokeLinecap="round" strokeLinejoin="round" />;
    case "arrow": {
      const ang = Math.atan2(p[3] - p[1], p[2] - p[0]);
      const a1 = ang + Math.PI - 0.4, a2 = ang + Math.PI + 0.4;
      return (
        <g onClick={onSelect} style={{ pointerEvents: hit as "stroke" | "none", cursor: interactive ? "pointer" : "default" }}>
          <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke={a.color} strokeWidth={sw} />
          <line x1={p[2]} y1={p[3]} x2={p[2] + HEAD * Math.cos(a1)} y2={p[3] + HEAD * Math.sin(a1)} stroke={a.color} strokeWidth={sw} />
          <line x1={p[2]} y1={p[3]} x2={p[2] + HEAD * Math.cos(a2)} y2={p[3] + HEAD * Math.sin(a2)} stroke={a.color} strokeWidth={sw} />
        </g>
      );
    }
    case "text":
      return <text x={p[0]} y={p[1]} fontSize={FONT * 1.1} fill={a.color} stroke="#fff" strokeWidth={FONT * 0.13} paintOrder="stroke"
        dominantBaseline="central" style={{ pointerEvents: interactive ? "all" : "none", cursor: interactive ? "pointer" : "default" }} onClick={onSelect}>{a.text}</text>;
    case "dist": {
      const len = Math.hypot(p[2] - p[0], p[3] - p[1]);
      return (
        <g onClick={onSelect} style={{ pointerEvents: hit as "stroke" | "none" }}>
          <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke={a.color} strokeWidth={sw} markerStart="" />
          <circle cx={p[0]} cy={p[1]} r={sw * 1.6} fill={a.color} />
          <circle cx={p[2]} cy={p[3]} r={sw * 1.6} fill={a.color} />
          {label((p[0] + p[2]) / 2, (p[1] + p[3]) / 2 - FONT * 0.8, fmtLen(len))}
        </g>
      );
    }
    case "area": {
      if (p.length < 4) return null;
      const area = p.length >= 6 ? polyArea(p) : 0;
      let cx = 0, cy = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; }
      cx /= p.length / 2; cy /= p.length / 2;
      return (
        <g onClick={onSelect} style={{ pointerEvents: hit as "fill" | "none" }}>
          <polygon points={pairs(p)} fill={a.color} fillOpacity={0.15} stroke={a.color} strokeWidth={sw} />
          {area > 0 && label(cx, cy, fmtArea(area))}
        </g>
      );
    }
    case "angle": {
      if (p.length < 6) return <polyline points={pairs(p)} {...common} />;
      const [ex1, ey1, vx, vy, ex2, ey2] = p;
      const deg = Math.abs(((Math.atan2(ey1 - vy, ex1 - vx) - Math.atan2(ey2 - vy, ex2 - vx)) * 180) / Math.PI);
      const d = deg > 180 ? 360 - deg : deg;
      return (
        <g onClick={onSelect} style={{ pointerEvents: hit as "stroke" | "none" }}>
          <polyline points={`${ex1},${ey1} ${vx},${vy} ${ex2},${ey2}`} stroke={a.color} strokeWidth={sw} fill="none" />
          {label(vx, vy - FONT, `${d.toFixed(1)}°`)}
        </g>
      );
    }
    default:
      return null;
  }
}

const pairs = (p: number[]) => { let s = ""; for (let i = 0; i < p.length; i += 2) s += `${p[i]},${p[i + 1]} `; return s.trim(); };

// String form of an annotation for PNG export (mirrors AnnoView, no interactivity).
function annoToSvgString(a: Anno, s: { STROKE: number; FONT: number; HEAD: number; mmPerUnit: number }): string {
  const p = a.points; const c = a.color; const sw = s.STROKE; const esc = (t: string) => t.replace(/[<&>]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]!));
  const fmtLen = (u: number) => { const mm = u * s.mmPerUnit; return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`; };
  const fmtArea = (u: number) => { const mm2 = u * s.mmPerUnit * s.mmPerUnit, m2 = mm2 / 1e6; return m2 >= 0.01 ? `${m2.toFixed(2)} m²` : `${mm2.toFixed(0)} mm²`; };
  const lbl = (x: number, y: number, t: string) => `<text x="${x}" y="${y}" font-size="${s.FONT}" fill="${c}" stroke="#fff" stroke-width="${s.FONT * 0.12}" paint-order="stroke" text-anchor="middle" dominant-baseline="central">${esc(t)}</text>`;
  switch (a.type) {
    case "rect": return `<rect x="${Math.min(p[0], p[2])}" y="${Math.min(p[1], p[3])}" width="${Math.abs(p[2] - p[0])}" height="${Math.abs(p[3] - p[1])}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
    case "highlight": return `<rect x="${Math.min(p[0], p[2])}" y="${Math.min(p[1], p[3])}" width="${Math.abs(p[2] - p[0])}" height="${Math.abs(p[3] - p[1])}" fill="${c}" fill-opacity="0.22"/>`;
    case "cloud": return `<path d="${cloudPath(p[0], p[1], p[2], p[3])}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
    case "pen": return `<polyline points="${pairs(p)}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "arrow": {
      const ang = Math.atan2(p[3] - p[1], p[2] - p[0]); const a1 = ang + Math.PI - 0.4, a2 = ang + Math.PI + 0.4;
      return `<line x1="${p[0]}" y1="${p[1]}" x2="${p[2]}" y2="${p[3]}" stroke="${c}" stroke-width="${sw}"/>` +
        `<line x1="${p[2]}" y1="${p[3]}" x2="${p[2] + s.HEAD * Math.cos(a1)}" y2="${p[3] + s.HEAD * Math.sin(a1)}" stroke="${c}" stroke-width="${sw}"/>` +
        `<line x1="${p[2]}" y1="${p[3]}" x2="${p[2] + s.HEAD * Math.cos(a2)}" y2="${p[3] + s.HEAD * Math.sin(a2)}" stroke="${c}" stroke-width="${sw}"/>`;
    }
    case "text": return `<text x="${p[0]}" y="${p[1]}" font-size="${s.FONT * 1.1}" fill="${c}" stroke="#fff" stroke-width="${s.FONT * 0.13}" paint-order="stroke" dominant-baseline="central">${esc(a.text ?? "")}</text>`;
    case "dist": { const len = Math.hypot(p[2] - p[0], p[3] - p[1]); return `<line x1="${p[0]}" y1="${p[1]}" x2="${p[2]}" y2="${p[3]}" stroke="${c}" stroke-width="${sw}"/>` + lbl((p[0] + p[2]) / 2, (p[1] + p[3]) / 2 - s.FONT * 0.8, fmtLen(len)); }
    case "area": {
      if (p.length < 6) return "";
      let cx = 0, cy = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; } cx /= p.length / 2; cy /= p.length / 2;
      return `<polygon points="${pairs(p)}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="${sw}"/>` + lbl(cx, cy, fmtArea(polyArea(p)));
    }
    case "angle": {
      if (p.length < 6) return "";
      const [ex1, ey1, vx, vy, ex2, ey2] = p;
      const raw = Math.abs(((Math.atan2(ey1 - vy, ex1 - vx) - Math.atan2(ey2 - vy, ex2 - vx)) * 180) / Math.PI);
      const d = raw > 180 ? 360 - raw : raw;
      return `<polyline points="${ex1},${ey1} ${vx},${vy} ${ex2},${ey2}" fill="none" stroke="${c}" stroke-width="${sw}"/>` + lbl(vx, vy - s.FONT, `${d.toFixed(1)}°`);
    }
    default: return "";
  }
}

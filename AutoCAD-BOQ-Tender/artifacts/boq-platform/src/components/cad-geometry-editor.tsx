import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Loader2, AlertTriangle, MousePointer2, Hand, Minus, Circle as CircleIcon, Spline, Type,
  Trash2, Save, X, Maximize, Undo2,
} from "lucide-react";

type Tool = "select" | "pan" | "line" | "circle" | "pline" | "text";

type Geom =
  | { kind: "line"; points: number[] }
  | { kind: "polyline"; points: number[]; closed: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "arc"; cx: number; cy: number; r: number; start: number; end: number }
  | { kind: "text"; x: number; y: number; height: number; rotation: number; text: string }
  | { kind: "insert"; x: number; y: number; rotation: number; name: string };

interface RawEntity {
  handle: string;
  type: string;
  layer: string;
  color?: { aci?: number; rgb?: number[] };
  geom: Geom;
}

interface EditEntity {
  /** Server handle for existing entities, or a temp id ("new:N") for added ones. */
  id: string;
  origin: "existing" | "new";
  type: string;
  layer: string;
  geom: Geom;
  deleted?: boolean;
  /** Accumulated translation for existing entities (new ones bake it into geom). */
  movedDx?: number;
  movedDy?: number;
  /** Existing TEXT/MTEXT whose content changed. */
  textDirty?: boolean;
}

type Op =
  | { op: "delete"; handle: string }
  | { op: "move"; handle: string; dx: number; dy: number }
  | { op: "edit_text"; handle: string; text: string }
  | { op: "add_line"; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { op: "add_circle"; layer: string; cx: number; cy: number; r: number }
  | { op: "add_polyline"; layer: string; points: number[]; closed: boolean }
  | { op: "add_text"; layer: string; x: number; y: number; height: number; text: string };

interface CadGeometryEditorProps {
  documentId: number;
  originalName: string;
  onClose: () => void;
  /** Called with the new (versioned) document after a successful save. */
  onSaved?: (doc: { id: number; originalName: string }) => void;
}

const TOOLS: { tool: Tool; icon: typeof Minus; label: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select / move (V)" },
  { tool: "pan", icon: Hand, label: "Pan (H)" },
  { tool: "line", icon: Minus, label: "Add line (L)" },
  { tool: "circle", icon: CircleIcon, label: "Add circle (C)" },
  { tool: "pline", icon: Spline, label: "Add polyline (P)" },
  { tool: "text", icon: Type, label: "Add text (T)" },
];

let _seq = 0;
const tempId = () => `new:${_seq++}`;

// ── geometry helpers (world units) ───────────────────────────────────────────
function translateGeom(g: Geom, dx: number, dy: number): Geom {
  switch (g.kind) {
    case "line":
    case "polyline":
      return { ...g, points: g.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
    case "circle":
    case "arc":
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
    case "text":
    case "insert":
      return { ...g, x: g.x + dx, y: g.y + dy };
  }
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

/** Shortest distance from point (px,py) to segment (ax,ay)-(bx,by). */
function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

/** Distance from a world point to an entity's geometry (for hit-testing). */
function entityDist(g: Geom, px: number, py: number): number {
  switch (g.kind) {
    case "line":
      return pointSegDist(px, py, g.points[0], g.points[1], g.points[2], g.points[3]);
    case "polyline": {
      let best = Infinity;
      const n = g.points.length / 2;
      for (let i = 0; i < n - 1; i++) {
        best = Math.min(best, pointSegDist(px, py,
          g.points[i * 2], g.points[i * 2 + 1], g.points[i * 2 + 2], g.points[i * 2 + 3]));
      }
      if (g.closed && n > 2) {
        best = Math.min(best, pointSegDist(px, py,
          g.points[(n - 1) * 2], g.points[(n - 1) * 2 + 1], g.points[0], g.points[1]));
      }
      return best;
    }
    case "circle":
    case "arc":
      return Math.abs(dist(px, py, g.cx, g.cy) - g.r);
    case "text":
    case "insert":
      return dist(px, py, g.x, g.y);
  }
}

function arcPoints(cx: number, cy: number, r: number, start: number, end: number): string {
  let a0 = start, a1 = end;
  while (a1 < a0) a1 += 360;
  const segs = Math.max(8, Math.ceil((a1 - a0) / 6));
  const pts: string[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = ((a0 + (a1 - a0) * (i / segs)) * Math.PI) / 180;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(" ");
}

/**
 * Real geometry editor for a DWG/DXF drawing. Loads the drawing's editable
 * model-space entities (lines, polylines, circles, arcs, text, block markers)
 * as vectors and lets the user select/move/delete them and add new lines,
 * circles, polylines and text. On save it sends the edit ops to the server,
 * which applies them with ezdxf and writes a NEW versioned .dwg/.dxf — the
 * original is preserved. This edits the true geometry, not an overlay.
 */
export function CadGeometryEditor({ documentId, originalName, onClose, onSaved }: CadGeometryEditorProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);

  const [entities, setEntities] = useState<EditEntity[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [layer, setLayer] = useState("0");
  const [saving, setSaving] = useState(false);

  // View: world point (cx,cy) at viewport centre, scale = pixels per world unit.
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 1 });
  const [size, setSize] = useState({ w: 1, h: 1 });

  // In-progress multi-click add (line/circle/polyline) and live cursor.
  const [draft, setDraft] = useState<number[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const moveRef = useRef<{ wx: number; wy: number } | null>(null);

  const W = size.w, H = size.h;
  const worldToScreen = useCallback((wx: number, wy: number) => ({
    x: W / 2 + (wx - view.cx) * view.scale,
    y: H / 2 - (wy - view.cy) * view.scale,
  }), [W, H, view]);
  const screenToWorld = useCallback((sx: number, sy: number) => ({
    x: view.cx + (sx - W / 2) / view.scale,
    y: view.cy - (sy - H / 2) / view.scale,
  }), [W, H, view]);

  const groupTransform = `translate(${W / 2},${H / 2}) scale(${view.scale},${-view.scale}) translate(${-view.cx},${-view.cy})`;

  const fitTo = useCallback((bounds: { minX: number; minY: number; maxX: number; maxY: number } | null) => {
    if (!bounds || W < 2 || H < 2) return;
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
    const scale = Math.min(W / bw, H / bh) * 0.9;
    setView({ cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, scale });
  }, [W, H]);

  const boundsOf = useCallback((ents: EditEntity[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const e of ents) {
      if (e.deleted) continue;
      const g = e.geom;
      if (g.kind === "line" || g.kind === "polyline") for (let i = 0; i < g.points.length; i += 2) acc(g.points[i], g.points[i + 1]);
      else if (g.kind === "circle" || g.kind === "arc") { acc(g.cx - g.r, g.cy - g.r); acc(g.cx + g.r, g.cy + g.r); }
      else acc(g.x, g.y);
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }, []);

  // Measure the SVG element.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load entities.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading"); setError("");
    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/entities`, { credentials: "include" });
        if (!res.ok) {
          let msg = `Failed to load drawing (${res.status})`;
          try { const j = await res.json(); msg = j.detail || j.error || msg; } catch { /* not JSON */ }
          throw new Error(msg);
        }
        const data = (await res.json()) as { entities: RawEntity[]; bounds: any; truncated?: boolean };
        if (cancelled) return;
        const ents: EditEntity[] = data.entities.map((e) => ({
          id: e.handle, origin: "existing", type: e.type, layer: e.layer, geom: e.geom,
        }));
        setEntities(ents);
        setTruncated(!!data.truncated);
        setStatus("ready");
        // Fit once we also have a size; defer to next frame.
        requestAnimationFrame(() => fitTo(data.bounds ?? boundsOf(ents)));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load drawing");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit when size first becomes known.
  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current && status === "ready" && W > 2 && entities.length) {
      didFit.current = true;
      fitTo(boundsOf(entities));
    }
  }, [status, W, entities, fitTo, boundsOf]);

  const layers = useMemo(() => {
    const s = new Set<string>(["0"]);
    for (const e of entities) s.add(e.layer);
    return Array.from(s).sort();
  }, [entities]);

  // Derive the edit-op list from current entity state.
  const ops = useMemo<Op[]>(() => {
    const list: Op[] = [];
    for (const e of entities) {
      if (e.origin === "existing") {
        if (e.deleted) { list.push({ op: "delete", handle: e.id }); continue; }
        if (e.movedDx || e.movedDy) list.push({ op: "move", handle: e.id, dx: e.movedDx || 0, dy: e.movedDy || 0 });
        if (e.textDirty && e.geom.kind === "text") list.push({ op: "edit_text", handle: e.id, text: e.geom.text });
      } else {
        if (e.deleted) continue;
        const g = e.geom;
        if (g.kind === "line") list.push({ op: "add_line", layer: e.layer, x1: g.points[0], y1: g.points[1], x2: g.points[2], y2: g.points[3] });
        else if (g.kind === "circle") list.push({ op: "add_circle", layer: e.layer, cx: g.cx, cy: g.cy, r: g.r });
        else if (g.kind === "polyline") list.push({ op: "add_polyline", layer: e.layer, points: g.points, closed: g.closed });
        else if (g.kind === "text") list.push({ op: "add_text", layer: e.layer, x: g.x, y: g.y, height: g.height, text: g.text });
      }
    }
    return list;
  }, [entities]);
  const dirty = ops.length > 0;

  // ── pointer interactions ───────────────────────────────────────────────────
  const hitTest = useCallback((wx: number, wy: number): string | null => {
    const tol = 8 / view.scale; // 8px in world units
    let best: string | null = null, bestD = tol;
    for (const e of entities) {
      if (e.deleted) continue;
      const d = entityDist(e.geom, wx, wy);
      if (d <= bestD) { bestD = d; best = e.id; }
    }
    return best;
  }, [entities, view.scale]);

  const mutateGeom = (id: string, fn: (e: EditEntity) => EditEntity) =>
    setEntities((prev) => prev.map((e) => (e.id === id ? fn(e) : e)));

  const onPointerDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    (ev.target as Element).setPointerCapture?.(ev.pointerId);

    if (tool === "pan" || ev.button === 1) {
      panRef.current = { sx, sy, cx: view.cx, cy: view.cy };
      return;
    }
    if (tool === "select") {
      const hit = hitTest(w.x, w.y);
      setSelected(hit);
      if (hit) moveRef.current = { wx: w.x, wy: w.y };
      else panRef.current = { sx, sy, cx: view.cx, cy: view.cy }; // empty space → pan
      return;
    }
    if (tool === "line") {
      if (draft.length === 0) setDraft([w.x, w.y]);
      else {
        const [x1, y1] = draft;
        addEntity({ kind: "line", points: [x1, y1, w.x, w.y] });
        setDraft([]);
      }
      return;
    }
    if (tool === "circle") {
      if (draft.length === 0) setDraft([w.x, w.y]);
      else {
        const [cx, cy] = draft;
        addEntity({ kind: "circle", cx, cy, r: dist(cx, cy, w.x, w.y) });
        setDraft([]);
      }
      return;
    }
    if (tool === "pline") {
      setDraft((d) => [...d, w.x, w.y]);
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Text:");
      if (text) {
        const hStr = window.prompt("Text height (drawing units):", "2.5");
        const height = Math.max(0.01, parseFloat(hStr || "2.5") || 2.5);
        addEntity({ kind: "text", x: w.x, y: w.y, height, rotation: 0, text });
      }
      return;
    }
  };

  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    setCursor(w);

    if (panRef.current) {
      const p = panRef.current;
      setView((v) => ({ ...v, cx: p.cx - (sx - p.sx) / v.scale, cy: p.cy + (sy - p.sy) / v.scale }));
      return;
    }
    if (moveRef.current && selected) {
      const m = moveRef.current;
      const dx = w.x - m.wx, dy = w.y - m.wy;
      if (dx || dy) {
        mutateGeom(selected, (e) => ({
          ...e,
          geom: translateGeom(e.geom, dx, dy),
          movedDx: (e.movedDx || 0) + (e.origin === "existing" ? dx : 0),
          movedDy: (e.movedDy || 0) + (e.origin === "existing" ? dy : 0),
        }));
        moveRef.current = { wx: w.x, wy: w.y };
      }
    }
  };

  const onPointerUp = () => { panRef.current = null; moveRef.current = null; };

  const onWheel = (ev: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    const before = screenToWorld(sx, sy);
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const scale = Math.max(1e-6, v.scale * factor);
      return { scale, cx: before.x - (sx - W / 2) / scale, cy: before.y + (sy - H / 2) / scale };
    });
  };

  const addEntity = (geom: Geom) => {
    setEntities((prev) => [...prev, { id: tempId(), origin: "new", type: geom.kind.toUpperCase(), layer, geom }]);
  };

  const finishPolyline = useCallback((closed: boolean) => {
    if (draft.length >= 4) addEntity({ kind: "polyline", points: [...draft], closed });
    setDraft([]);
  }, [draft, layer]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setEntities((prev) => prev.flatMap((e) => {
      if (e.id !== selected) return [e];
      if (e.origin === "new") return []; // unsaved add → just drop it
      return [{ ...e, deleted: true }];
    }));
    setSelected(null);
  }, [selected]);

  const editSelectedText = useCallback(() => {
    const e = entities.find((x) => x.id === selected);
    if (!e || e.geom.kind !== "text") return;
    const next = window.prompt("Edit text:", e.geom.text);
    if (next == null) return;
    mutateGeom(e.id, (x) => x.geom.kind === "text"
      ? { ...x, geom: { ...x.geom, text: next }, textDirty: x.origin === "existing" ? true : x.textDirty }
      : x);
  }, [entities, selected]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") { setDraft([]); setSelected(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); deleteSelected(); }
      else if (e.key === "Enter" && tool === "pline") finishPolyline(false);
      else if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "h" || e.key === "H") setTool("pan");
      else if (e.key === "l" || e.key === "L") setTool("line");
      else if (e.key === "c" || e.key === "C") setTool("circle");
      else if (e.key === "p" || e.key === "P") setTool("pline");
      else if (e.key === "t" || e.key === "T") setTool("text");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, tool, deleteSelected, finishPolyline]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/edit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `Save failed (${res.status})`);
      const failed = (data.errors ?? []) as string[];
      toast({
        title: "Saved as new revision",
        description: `${data.document?.originalName ?? "edited drawing"} — ${data.applied} edit(s) applied${failed.length ? `, ${failed.length} skipped` : ""}.`,
      });
      onSaved?.(data.document);
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn’t save edits", description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved geometry edits?")) return;
    onClose();
  };

  const selectedEntity = entities.find((e) => e.id === selected) || null;

  // ── render ─────────────────────────────────────────────────────────────────
  const ACCENT = "#2563eb";
  const aciToCss = (aci?: number) => {
    // Minimal ACI palette for the common indices; default to slate.
    const map: Record<number, string> = { 1: "#ef4444", 2: "#eab308", 3: "#22c55e", 4: "#06b6d4", 5: "#3b82f6", 6: "#d946ef", 7: "#e5e7eb" };
    return (aci && map[aci]) || "#cbd5e1";
  };

  const renderGeom = (e: EditEntity, isSel: boolean) => {
    const stroke = isSel ? ACCENT : aciToCss();
    const sw = isSel ? 2.2 : 1.2;
    const common = { stroke, strokeWidth: sw, fill: "none", vectorEffect: "non-scaling-stroke" as const };
    const g = e.geom;
    switch (g.kind) {
      case "line":
        return <line key={e.id} x1={g.points[0]} y1={g.points[1]} x2={g.points[2]} y2={g.points[3]} {...common} />;
      case "polyline": {
        const pts = [];
        for (let i = 0; i < g.points.length; i += 2) pts.push(`${g.points[i]},${g.points[i + 1]}`);
        const Tag = g.closed ? "polygon" : "polyline";
        return <Tag key={e.id} points={pts.join(" ")} {...common} />;
      }
      case "circle":
        return <circle key={e.id} cx={g.cx} cy={g.cy} r={g.r} {...common} />;
      case "arc":
        return <polyline key={e.id} points={arcPoints(g.cx, g.cy, g.r, g.start, g.end)} {...common} />;
      case "text":
      case "insert":
        // Marker only in world space; the label is drawn in screen space below.
        return <circle key={e.id} cx={g.x} cy={g.y} r={3 / view.scale} fill={isSel ? ACCENT : "#64748b"} stroke="none" />;
    }
  };

  // Screen-space labels for text/insert (avoids the flipped-Y mirror).
  const labels = entities.filter((e) => !e.deleted && (e.geom.kind === "text" || e.geom.kind === "insert"));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0e14]">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#11151f] px-3 py-2 text-white">
        <span className="truncate text-sm font-medium">{originalName}</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">geometry edit</span>
        {truncated && <span className="text-[10px] text-amber-300/80">large drawing — only the first entities are selectable</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 text-white hover:bg-white/10" onClick={() => fitTo(boundsOf(entities))}>
            <Maximize className="mr-1 h-4 w-4" /> Fit
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={save} className="h-8">
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save{dirty ? ` (${ops.length})` : ""}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10" onClick={requestClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Tool rail */}
        <div className="flex w-12 flex-col items-center gap-1 border-r border-white/10 bg-[#11151f] py-2">
          {TOOLS.map((t) => (
            <Button
              key={t.tool}
              size="icon"
              variant="ghost"
              title={t.label}
              className={`h-9 w-9 text-white hover:bg-white/10 ${tool === t.tool ? "bg-white/15 ring-1 ring-blue-400" : ""}`}
              onClick={() => { setTool(t.tool); setDraft([]); }}
            >
              <t.icon className="h-4 w-4" />
            </Button>
          ))}
          <div className="my-1 h-px w-6 bg-white/10" />
          <Button size="icon" variant="ghost" title="Delete selected (Del)" disabled={!selected}
            className="h-9 w-9 text-red-300 hover:bg-white/10 disabled:opacity-30" onClick={deleteSelected}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Canvas */}
        <div className="relative min-w-0 flex-1">
          {status === "loading" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-white/70">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">Loading editable geometry…</p>
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-6 text-center text-white/70">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
              <p className="text-sm">Couldn’t load this drawing for editing.</p>
              <p className="max-w-md break-words text-xs opacity-70">{error}</p>
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          )}

          <svg
            ref={svgRef}
            className={`h-full w-full ${tool === "pan" ? "cursor-grab" : tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={() => { if (tool === "pline") finishPolyline(false); else if (tool === "select") editSelectedText(); }}
          >
            <g transform={groupTransform}>
              {status === "ready" && entities.map((e) => (e.deleted ? null : renderGeom(e, e.id === selected)))}

              {/* Draft preview */}
              {tool === "line" && draft.length === 2 && cursor && (
                <line x1={draft[0]} y1={draft[1]} x2={cursor.x} y2={cursor.y} stroke={ACCENT} strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              )}
              {tool === "circle" && draft.length === 2 && cursor && (
                <circle cx={draft[0]} cy={draft[1]} r={dist(draft[0], draft[1], cursor.x, cursor.y)} stroke={ACCENT} strokeWidth={1.2} strokeDasharray="4 3" fill="none" vectorEffect="non-scaling-stroke" />
              )}
              {tool === "pline" && draft.length >= 2 && (
                <polyline
                  points={[...Array(draft.length / 2)].map((_, i) => `${draft[i * 2]},${draft[i * 2 + 1]}`).concat(cursor ? [`${cursor.x},${cursor.y}`] : []).join(" ")}
                  stroke={ACCENT} strokeWidth={1.2} strokeDasharray="4 3" fill="none" vectorEffect="non-scaling-stroke"
                />
              )}
            </g>

            {/* Screen-space text labels */}
            {status === "ready" && labels.map((e) => {
              const g = e.geom as Extract<Geom, { kind: "text" } | { kind: "insert" }>;
              const p = worldToScreen(g.x, g.y);
              if (p.x < -50 || p.y < -50 || p.x > W + 50 || p.y > H + 50) return null;
              const fontSize = g.kind === "text" ? Math.max(9, Math.min(36, g.height * view.scale)) : 11;
              const txt = g.kind === "text" ? g.text : `▣ ${g.name}`;
              return (
                <text key={`l${e.id}`} x={p.x + 4} y={p.y - 4} fontSize={fontSize}
                  fill={e.id === selected ? ACCENT : "#94a3b8"} className="pointer-events-none select-none">
                  {txt.length > 40 ? txt.slice(0, 40) + "…" : txt}
                </text>
              );
            })}
          </svg>

          {/* Bottom status strip */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center gap-4 bg-black/40 px-3 py-1 text-[11px] text-white/70">
            <span>Tool: <b className="text-white/90">{tool}</b></span>
            {cursor && <span className="tabular-nums">x {cursor.x.toFixed(2)}  y {cursor.y.toFixed(2)}</span>}
            <span>Zoom {(view.scale).toFixed(2)}×</span>
            {tool === "pline" && draft.length >= 4 && <span className="text-blue-300">Enter / double-click to finish, Esc to cancel</span>}
          </div>
        </div>

        {/* Right inspector */}
        <div className="w-56 shrink-0 border-l border-white/10 bg-[#11151f] p-3 text-xs text-white/80">
          <p className="mb-2 font-medium text-white/90">Properties</p>
          <label className="mb-3 block">
            <span className="mb-1 block text-white/60">New-entity layer</span>
            <select value={layer} onChange={(e) => setLayer(e.target.value)}
              className="w-full rounded border border-white/15 bg-[#0b0e14] px-2 py-1 text-white">
              {layers.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>

          {selectedEntity ? (
            <div className="space-y-1 rounded border border-white/10 bg-black/20 p-2">
              <p className="text-white/90">{selectedEntity.type}</p>
              <p className="text-white/50">layer: {selectedEntity.layer}</p>
              <p className="text-white/50">{selectedEntity.origin === "new" ? "newly added" : `handle ${selectedEntity.id}`}</p>
              {selectedEntity.geom.kind === "text" && (
                <Button size="sm" variant="outline" className="mt-1 h-7 w-full" onClick={editSelectedText}>
                  <Type className="mr-1 h-3.5 w-3.5" /> Edit text
                </Button>
              )}
              <Button size="sm" variant="outline" className="mt-1 h-7 w-full text-red-300" onClick={deleteSelected}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          ) : (
            <p className="text-white/40">Nothing selected. Use the Select tool and click an entity.</p>
          )}

          <div className="mt-4 border-t border-white/10 pt-3 text-white/50">
            <p className="mb-1 flex items-center gap-1"><Undo2 className="h-3 w-3" /> {ops.length} pending edit(s)</p>
            <p className="text-[10px] leading-relaxed">Saving writes a new revision; the original drawing is preserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

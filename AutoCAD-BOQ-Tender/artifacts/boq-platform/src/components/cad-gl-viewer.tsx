import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { DxfViewer, type LayerInfo } from "dxf-viewer";
import { Loader2, AlertTriangle, Maximize, Download, Layers, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CadGlViewerProps {
  /** URL the DXF is fetched from (server converts DWG → DXF via ODA, cached). */
  url: string;
  /** Optional URL to the original file, offered as a download fallback. */
  downloadUrl?: string;
  /**
   * Optional URL returning a ROBUST model-space bounds {minX,minY,maxX,maxY}
   * (MAD-windowed server-side). Critical: these drawings scatter entities km
   * away, so fitting to the renderer's raw extents shrinks the real plan to an
   * invisible speck — the reason the earlier WebGL attempt looked "blank".
   */
  boundsUrl?: string;
  /** Font URLs used to render TEXT/MTEXT. Defaults to the bundled CAD font. */
  fonts?: string[];
  /** Offered as a button on error — fall back to the server-rendered SVG view. */
  onFallback?: () => void;
}

/** New Worker for off-main-thread DXF parsing (Vite resolves the URL at build). */
const createWorker = () =>
  new Worker(new URL("../lib/dxf-worker.ts", import.meta.url), { type: "module" });

/**
 * Exact-geometry DWG/DXF viewer rendered client-side with WebGL via dxf-viewer
 * (three.js). Unlike the server SVG render it keeps native layer colors,
 * linetypes, hatches and fonts, and gives GPU-smooth pan/zoom. DWG is converted
 * to DXF server-side first; this component only ever fetches a .dxf URL.
 */
export function CadGlViewer({ url, downloadUrl, boundsUrl, fonts = ["/fonts/cad-text.ttf"], onFallback }: CadGlViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DxfViewer | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showLayers, setShowLayers] = useState(false);
  const [dark, setDark] = useState(true); // AutoCAD model space is black by default

  // Robust server bounds (MAD-windowed) cached after first fetch — preferred over
  // the renderer's raw extents so stray far-flung entities don't shrink the plan.
  const robustBounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  const fitView = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const rb = robustBounds.current;
    const b = rb ?? v.GetBounds();
    if (b && b.maxX > b.minX && b.maxY > b.minY) v.FitView(b.minX, b.maxX, b.minY, b.maxY, 0.06);
  }, []);

  const toggleLayer = (name: string) => {
    const v = viewerRef.current;
    if (!v) return;
    setHidden((prev) => {
      const next = new Set(prev);
      const show = next.has(name);
      if (show) next.delete(name);
      else next.add(name);
      v.ShowLayer(name, show);
      return next;
    });
  };

  const setBackground = useCallback((isDark: boolean) => {
    const v = viewerRef.current;
    const r = v?.GetRenderer();
    if (!r) return;
    r.setClearColor(new THREE.Color(isDark ? "#1a1a1a" : "#ffffff"), 1);
    v!.Render();
  }, []);

  // Create the viewer once, load the drawing, populate layers.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const viewer = new DxfViewer(container, {
      clearColor: new THREE.Color("#1a1a1a"),
      autoResize: true,
      colorCorrection: true, // keeps light-on-dark entities visible on either bg
      antialias: true,
    });
    viewerRef.current = viewer;

    setStatus("loading");
    setError("");
    setProgress(null);

    viewer
      .Load({
        url,
        fonts,
        workerFactory: createWorker,
        progressCbk: (phase, processed, total) => {
          if (cancelled) return;
          setProgress({ phase, pct: total > 0 ? Math.round((processed / total) * 100) : 0 });
        },
      })
      .then(async () => {
        if (cancelled) return;
        // The earlier WebGL attempt could "succeed" yet draw nothing. Treat an
        // empty scene as a failure so the user gets the download fallback rather
        // than staring at a blank canvas.
        if (!viewer.GetBounds()) {
          throw new Error("The drawing parsed but contained no renderable geometry in this viewer.");
        }
        setLayers(Array.from(viewer.GetLayers()));
        // Prefer the robust server bounds for fit; fall back to raw extents.
        if (boundsUrl) {
          try {
            const br = await fetch(boundsUrl, { credentials: "include" });
            if (br.ok) {
              const b = (await br.json()) as { minX: number; minY: number; maxX: number; maxY: number };
              if (typeof b?.minX === "number" && b.maxX > b.minX) robustBounds.current = b;
            }
          } catch { /* fall back to GetBounds */ }
        }
        if (cancelled) return;
        setStatus("ready");
        fitView();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load drawing");
        setStatus("error");
      });

    return () => {
      cancelled = true;
      viewerRef.current = null;
      try { viewer.Destroy(); } catch { /* already torn down */ }
    };
  }, [url, fonts, boundsUrl, fitView]);

  const openOriginal = () =>
    downloadUrl && window.open(downloadUrl, "_blank", "noopener,noreferrer");

  return (
    <div className="relative h-full w-full overflow-hidden rounded border bg-[#1a1a1a]">
      {/* The WebGL canvas mounts here; dxf-viewer owns pan/zoom on it. */}
      <div ref={containerRef} className="absolute inset-0" />

      {status === "ready" && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur">
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Layers" onClick={() => setShowLayers((s) => !s)}><Layers className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Fit to window" onClick={fitView}><Maximize className="h-4 w-4" /></Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title={dark ? "White background" : "Dark background"}
            onClick={() => { const next = !dark; setDark(next); setBackground(next); }}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {downloadUrl && <Button size="icon" variant="ghost" className="h-7 w-7" title="Download original file" onClick={openOriginal}><Download className="h-4 w-4" /></Button>}
        </div>
      )}

      {/* Layer panel */}
      {status === "ready" && showLayers && layers.length > 0 && (
        <div className="absolute right-2 top-12 z-10 max-h-[60%] w-56 overflow-auto rounded-md border bg-background/95 p-2 text-xs shadow-md backdrop-blur">
          <p className="mb-1 px-1 font-medium text-muted-foreground">Layers ({layers.length})</p>
          {layers.map((l) => (
            <label key={l.name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={!hidden.has(l.name)}
                onChange={() => toggleLayer(l.name)}
              />
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20"
                style={{ backgroundColor: `#${(l.color >>> 0).toString(16).padStart(6, "0").slice(-6)}` }}
              />
              <span className="truncate" title={l.displayName}>{l.displayName}</span>
            </label>
          ))}
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#1a1a1a] text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          <p className="text-xs text-white/70">
            {progress ? `${progress.phase}… ${progress.pct}%` : "Loading drawing…"}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-6 text-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm">Couldn&apos;t render this drawing in the browser.</p>
          <p className="max-w-md break-words text-xs opacity-70">{error}</p>
          <div className="flex items-center gap-2">
            {onFallback && (
              <Button variant="outline" size="sm" onClick={onFallback}>
                Open simplified view
              </Button>
            )}
            {downloadUrl && (
              <Button variant="outline" size="sm" onClick={openOriginal}>
                <Download className="mr-2 h-4 w-4" /> Download original
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

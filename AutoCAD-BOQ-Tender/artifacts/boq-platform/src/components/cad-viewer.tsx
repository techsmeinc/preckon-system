import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Loader2, AlertTriangle, ZoomIn, ZoomOut, Maximize, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CadViewerProps {
  /** URL the rendered SVG is fetched from (server renders DWG/DXF → SVG). */
  url: string;
  /** Optional URL to the original file, offered as a download fallback. */
  downloadUrl?: string;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 60;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +s.toFixed(3)));

/**
 * In-portal DWG/DXF drawing viewer. The server renders the drawing to a vector
 * SVG (DWG converted via ODA first), cropped to the real drawing and drawn
 * black-on-white. This injects that SVG and adds CAD-style pan (drag) and zoom
 * (wheel / buttons) with a fit-to-window reset. Vector, so it stays crisp.
 */
export function CadViewer({ url, downloadUrl }: CadViewerProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [svg, setSvg] = useState("");
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const reset = () => { setScale(1); setTx(0); setTy(0); };

  // Fetch + inject the rendered SVG.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError("");
    setSvg("");
    (async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          let msg = `Render failed (${res.status})`;
          try { const j = await res.json(); msg = j.detail || j.error || msg; } catch { /* not JSON */ }
          throw new Error(msg);
        }
        const text = await res.text();
        if (cancelled) return;
        setSvg(text);
        setScale(1); setTx(0); setTy(0);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to render drawing");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Make the injected <svg> fill the host (the transform handles zoom on top).
  useEffect(() => {
    const el = hostRef.current?.querySelector("svg");
    if (el) {
      el.setAttribute("width", "100%");
      el.setAttribute("height", "100%");
      el.style.display = "block";
    }
  }, [svg]);

  // Wheel-zoom as a native non-passive listener so preventDefault works.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || status !== "ready") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale((s) => clampScale(s * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [status]);

  const onDown = (e: ReactMouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, tx, ty }; };
  const onMove = (e: ReactMouseEvent) => {
    if (!drag.current) return;
    setTx(drag.current.tx + (e.clientX - drag.current.x));
    setTy(drag.current.ty + (e.clientY - drag.current.y));
  };
  const endDrag = () => { drag.current = null; };

  const openOriginal = () => downloadUrl && window.open(downloadUrl, "_blank", "noopener,noreferrer");

  return (
    <div className="relative h-full w-full overflow-hidden rounded border bg-white">
      {status === "ready" && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur">
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Zoom out" onClick={() => setScale((s) => clampScale(s / 1.2))}><ZoomOut className="h-4 w-4" /></Button>
          <span className="w-12 px-1 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Zoom in" onClick={() => setScale((s) => clampScale(s * 1.2))}><ZoomIn className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Fit to window" onClick={reset}><Maximize className="h-4 w-4" /></Button>
          {downloadUrl && <Button size="icon" variant="ghost" className="h-7 w-7" title="Download original file" onClick={openOriginal}><Download className="h-4 w-4" /></Button>}
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-xs">Rendering drawing… (first open of a large DWG can take a moment)</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-6 text-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm">Couldn&apos;t render this drawing in the browser.</p>
          <p className="max-w-md break-words text-xs opacity-70">{error}</p>
          {downloadUrl && (
            <Button variant="outline" size="sm" onClick={openOriginal}>
              <Download className="mr-2 h-4 w-4" /> Download original
            </Button>
          )}
        </div>
      )}

      {status === "ready" && (
        <div
          ref={viewportRef}
          className="h-full w-full cursor-grab active:cursor-grabbing"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <div
            ref={hostRef}
            className="h-full w-full select-none"
            style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "center center" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
}

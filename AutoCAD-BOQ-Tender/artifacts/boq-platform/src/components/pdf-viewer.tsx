import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite resolves this to a hashed asset URL and serves the worker as a file.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2, AlertTriangle } from "lucide-react";

// Render the PDF.js worker from a bundled asset (no CDN dependency).
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  /** URL the PDF bytes are fetched from. */
  url: string;
}

/**
 * Canvas-based PDF preview. Unlike an <iframe>/<embed>, this draws every page
 * with PDF.js so it renders inside the portal regardless of the browser's
 * "always download PDFs" setting. All pages are rendered top-to-bottom in a
 * scrollable column.
 */
export function PdfViewer({ url }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    setStatus("loading");
    setError("");
    container.replaceChildren();

    const loadingTask = pdfjsLib.getDocument({ url, withCredentials: true });

    (async () => {
      try {
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        // Scale to the container width (capped) so pages are crisp but not huge.
        const targetWidth = Math.min(container.clientWidth - 24, 1100);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / baseViewport.width;
          // Render at devicePixelRatio for sharpness on HiDPI screens.
          const dpr = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.className = "mx-auto mb-4 rounded shadow-sm bg-white";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);

          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render PDF");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      loadingTask.destroy().catch(() => {});
    };
  }, [url]);

  return (
    <div className="relative h-full w-full rounded border bg-muted/30">
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground p-6">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm">Couldn&apos;t render this PDF.</p>
          <p className="text-xs opacity-70">{error}</p>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full overflow-auto p-3" />
    </div>
  );
}

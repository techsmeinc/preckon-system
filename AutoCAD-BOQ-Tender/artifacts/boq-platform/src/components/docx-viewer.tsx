import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { Loader2, AlertTriangle } from "lucide-react";

interface DocxViewerProps {
  /** URL the .docx bytes are fetched from. */
  url: string;
}

/**
 * Renders a .docx inside the portal by converting it to styled HTML with
 * docx-preview (pure client-side, no server round-trip beyond fetching the
 * bytes). Word formatting, tables and images are preserved reasonably well.
 * Legacy binary .doc is NOT supported by this library.
 */
export function DocxViewer({ url }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    setStatus("loading");
    setError("");
    container.replaceChildren();

    (async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        await renderAsync(blob, container, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
        });
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render document");
        setStatus("error");
      }
    })();

    return () => { cancelled = true; };
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
          <p className="text-sm">Couldn&apos;t render this document.</p>
          <p className="text-xs opacity-70">{error}</p>
          <p className="text-xs opacity-70">Legacy .doc files aren&apos;t supported — only .docx.</p>
        </div>
      )}
      {/* docx-preview injects its own white "page" sheets; center them on a grey bg. */}
      <div ref={containerRef} className="h-full w-full overflow-auto p-4 flex flex-col items-center [&_.docx-wrapper]:bg-transparent [&_.docx]:bg-white [&_.docx]:shadow-sm" />
    </div>
  );
}

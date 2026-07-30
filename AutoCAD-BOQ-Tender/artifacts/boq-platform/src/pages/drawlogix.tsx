import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, PencilRuler, RefreshCw } from "lucide-react";

/**
 * DrawLogix — a top-level tool page (sidebar item, NOT a project tab). Embeds the
 * standalone DrawLogix Next.js app (the DXF concept studio in /DrawLogix) at THIS
 * same origin under /drawlogix: Vite (dev) and nginx (prod) proxy /drawlogix to the
 * DrawLogix server (basePath "/drawlogix"), so the user only ever uses this port.
 * Override the URL with VITE_DRAWLOGIX_URL if hosted elsewhere.
 */
const DRAWLOGIX_URL = (import.meta.env.VITE_DRAWLOGIX_URL as string | undefined) ?? "/drawlogix";

export function DrawLogixPage() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-6 py-3">
        <div className="flex items-center gap-2">
          <PencilRuler className="h-5 w-5 text-accent" />
          <div>
            <h1 className="font-semibold leading-tight">DrawLogix</h1>
            <p className="text-xs text-muted-foreground">AI drawing-lifecycle studio — SOW → requirements → concept plan (SVG / DXF)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setReloadKey(k => k + 1)} title="Reload DrawLogix">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.open(DRAWLOGIX_URL, "_blank", "noopener,noreferrer")} title="Open DrawLogix in a new tab">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open full screen
          </Button>
        </div>
      </header>
      <iframe
        key={reloadKey}
        src={DRAWLOGIX_URL}
        title="DrawLogix"
        className="min-h-0 flex-1 w-full border-0"
        sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups"
      />
    </div>
  );
}

export default DrawLogixPage;

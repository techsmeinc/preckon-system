// Preckon Workstation — two tools, this machine, no network.
//
// Not the workspace in a window. This build contains the drawing editor and BIM
// Studio and nothing else: no projects, no BOQ, no agents, no sign-in. Drawings
// come off the disk and go back to the disk.
//
// The two tools are the REAL components from the web app, imported unmodified.
// Only four modules are swapped out — the API client, the workspace hooks, the
// translator and the desktop bridge — because everything else they need is
// geometry, and geometry does not care where it is running. That is what keeps
// this from becoming a second editor that drifts away from the first one.

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CadEditor } from "@tenant/lib/cad/editor";
import { BimStudio } from "@tenant/lib/bim/studio";
import { emptyDocument, type BimDocument } from "@tenant/lib/bim/model";
import { ToastHost } from "./shims/ui";
import { t } from "./shims/i18n";

/** The bridge from preload.js. Absent only if this page is opened in a browser,
 *  which is not a supported way to run it but should not white-screen. */
const bridge = () => (window as any).preckon ?? null;

type Tool = "editor" | "studio";

interface Opened { name: string; text: string }

function Workstation() {
  const [tool, setTool] = useState<Tool>("editor");
  const [drawing, setDrawing] = useState<Opened | null>(null);
  const [doc, setDoc] = useState<BimDocument>(() => emptyDocument());
  const [studioFull, setStudioFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /* Open a drawing off this machine.
     A .dwg is converted here by the ODA converter — the one thing a browser
     genuinely cannot do, and the reason this build exists. */
  const open = useCallback(async () => {
    const b = bridge();
    if (!b) { setNote("This page needs the Preckon desktop app to reach your files."); return; }
    setBusy(true);
    setNote(null);
    try {
      const res = await b.openDrawing();
      if (!res) return;                                   // cancelled
      if (res.error) {
        setNote(res.error);
        if (res.needsConverter && window.confirm(`${res.error}\n\nPoint Preckon at the converter now?`)) {
          if (await b.chooseConverter()) { setBusy(false); void open(); return; }
        }
        return;
      }
      setDrawing({ name: res.name, text: res.text ?? "" });
      setTool("editor");
    } finally { setBusy(false); }
  }, []);

  // Ctrl/Cmd+O, because this is the only way into the app and a keyboard is
  // how anybody who uses CAD all day opens a file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); void open(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* The studio has nowhere to save to, so it saves nowhere and says so. Its
     Download button is the real exit. Returning the same version keeps the
     component's optimistic-concurrency check happy without inventing one. */
  const saveDoc = useCallback(async (next: BimDocument, base: number) => {
    setDoc(next);
    setNote("Saved in this session. Use Download to write it to your disk — there is no workspace here.");
    return base;
  }, []);

  return (
    <ToastHost>
      <div className="ws">
        <header className="ws-bar">
          <div className="ws-brand">
            <span className="ws-mark">P</span>
            <div>
              <b>Preckon Workstation</b>
              <small>Drawings on this machine</small>
            </div>
          </div>

          <nav className="ws-tabs" role="tablist" aria-label="Tool">
            <button
              role="tab" aria-selected={tool === "editor"}
              className={tool === "editor" ? "on" : ""}
              onClick={() => setTool("editor")}
            >
              Drawing editor
            </button>
            <button
              role="tab" aria-selected={tool === "studio"}
              className={tool === "studio" ? "on" : ""}
              onClick={() => setTool("studio")}
            >
              BIM Studio
            </button>
          </nav>

          <div className="ws-actions">
            {drawing && <span className="ws-file" title={drawing.name}>{drawing.name}</span>}
            <button className="btn btn-primary" onClick={open} disabled={busy}>
              {busy ? "Opening…" : "Open drawing"}
            </button>
          </div>
        </header>

        {note && <div className="ws-note" role="status">{note}</div>}

        <main className="ws-body">
          {tool === "editor" ? (
            drawing ? (
              /* Keyed on the file so opening another one remounts rather than
                 leaving the previous drawing's history and layers behind. */
              <CadEditor
                key={drawing.name + drawing.text.length}
                filename={drawing.name}
                dxfText={drawing.text}
                onClose={() => setDrawing(null)}
              />
            ) : (
              <div className="ws-empty">
                <h2>Open a drawing</h2>
                <p>
                  A <b>.dwg</b> or a <b>.dxf</b>, straight off this machine. DWG is converted
                  here — nothing is uploaded and nothing waits on a network.
                </p>
                <button className="btn btn-primary" onClick={open} disabled={busy}>Open drawing</button>
                <p className="ws-hint">Ctrl+O</p>
              </div>
            )
          ) : (
            <BimStudio
              initialDoc={doc}
              version={0}
              onSave={saveDoc}
              full={studioFull}
              onToggleFull={() => setStudioFull((v) => !v)}
              t={t}
            />
          )}
        </main>
      </div>
    </ToastHost>
  );
}

createRoot(document.getElementById("root")!).render(<Workstation />);

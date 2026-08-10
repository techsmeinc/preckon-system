// Preckon Workstation — the drawing editor and BIM Studio, on this machine.
//
// Not the workspace in a window: there is no BOQ, no tender, no procurement,
// no chain. Two tools. But they are the WHOLE of those two tools, which means
// they are signed in to the same workspace the web app uses and carry
// everything that depends on it — the project list, the sheets in each project,
// save-back, the takeoff, and both assistants.
//
// The tools themselves are the real components, imported unmodified from the
// tenant source. Four modules are redirected: the API client and the workspace
// hooks now go through the main process, the translator reads the workspace's
// own dictionary, and the desktop bridge is the real one. Nothing is
// reimplemented, so this cannot drift into a second, worse editor.
//
// What it adds over the browser: a .dwg opens straight off the disk, converted
// here. And with no connection at all, a local file still opens and still
// saves to disk — the workspace features are the part that goes quiet.

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CadEditor } from "@tenant/lib/cad/editor";
import { BimStudioPanel } from "@tenant/lib/bim/panel";
import { BimStudio } from "@tenant/lib/bim/studio";
import { emptyDocument, type BimDocument } from "@tenant/lib/bim/model";
import { ToastHost, refreshMe, useMe } from "./shims/ui";
import { onSignInNeeded, api } from "./shims/apiclient";
import { t } from "./shims/i18n";

const bridge = () => (window as any).preckon ?? null;

type Tool = "editor" | "studio";
interface Project { id: string; name: string }
interface FileRow { id: string; filename: string; cad_layers: number | null }
interface Local { name: string; text: string }

const isDrawing = (n: string) => /\.(dxf|dwg)$/i.test(n ?? "");
/** Sheet sets are numbered — 01, 02, 10 — so sort numerically or 10 lands before 2. */
const bySheet = (a: FileRow, b: FileRow) =>
  a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: "base" });

function Workstation() {
  const me = useMe();
  const [tool, setTool] = useState<Tool>("editor");

  const [server, setServer] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [fid, setFid] = useState<string | null>(null);

  /* A file opened off this machine, which belongs to no project. Held apart
     from the project selection because they are genuinely different things:
     one can be saved back to a project, the other can only be downloaded. */
  const [local, setLocal] = useState<Local | null>(null);

  const [doc, setDoc] = useState<BimDocument>(() => emptyDocument());
  const [modelName, setModelName] = useState("model.json");
  const [studioKey, setStudioKey] = useState(0);
  const [studioFull, setStudioFull] = useState(false);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => { bridge()?.workspace.server().then(setServer); }, []);
  // Any 401 anywhere — including from inside a tool — surfaces here as an
  // offer to sign in, rather than as a failure the reader has to interpret.
  useEffect(() => onSignInNeeded(() => setNeedsSignIn(true)), []);

  const loadProjects = useCallback(async () => {
    try {
      const rows = await api.get<Project[]>("/projects");
      setProjects(rows ?? []);
      setNeedsSignIn(false);
    } catch { /* the sign-in banner is already up, or the workspace is offline */ }
  }, []);

  useEffect(() => { if (me) void loadProjects(); }, [me, loadProjects]);

  // A project's drawings, for the sheet picker.
  useEffect(() => {
    if (!pid) { setFiles([]); setFid(null); return; }
    let live = true;
    api.get<FileRow[]>(`/projects/${pid}/files`)
      .then((rows) => {
        if (!live) return;
        const drawings = (rows ?? []).filter((f) => f.cad_layers != null || isDrawing(f.filename)).sort(bySheet);
        setFiles(drawings);
        setFid(drawings[0]?.id ?? null);
      })
      .catch(() => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [pid]);

  const signIn = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    if (await b.workspace.signIn()) {
      setNeedsSignIn(false);
      await refreshMe();
      await loadProjects();
    }
  }, [loadProjects]);

  const signOut = useCallback(async () => {
    await bridge()?.workspace.signOut();
    await refreshMe();
    setProjects([]); setPid(null); setFiles([]); setFid(null);
  }, []);

  /* Open a drawing off this machine. A .dwg is converted here — the one thing
     a browser genuinely cannot do, and the reason this build exists. */
  const openLocal = useCallback(async () => {
    const b = bridge();
    if (!b) { setNote("This page needs the Preckon desktop app to reach your files."); return; }
    setBusy(true);
    setNote(null);
    try {
      const res = await b.openDrawing();
      if (!res) return;
      if (res.error) {
        setNote(res.error);
        if (res.needsConverter && window.confirm(`${res.error}\n\nPoint Preckon at the converter now?`)) {
          if (await b.chooseConverter()) { setBusy(false); void openLocal(); return; }
        }
        return;
      }
      setLocal({ name: res.name, text: res.text ?? "" });
      setFid(null);                       // a disk file supersedes the sheet picker
      setTool("editor");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); void openLocal(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLocal]);

  /* BIM Studio with no project saves to a file, because there is nowhere else
     for it to go. With a project selected the real panel takes over and saves
     to the workspace — same component the web app uses, so the Ask AI box, the
     takeoff and Remove takeoff all come with it. */
  const saveDocToDisk = useCallback(async (next: BimDocument, base: number) => {
    setDoc(next);
    const b = bridge();
    if (!b) { setNote("Nowhere to save — this page needs the Preckon desktop app."); return base; }
    const where = await b.saveAs(modelName, JSON.stringify(next, null, 2));
    if (where) {
      setModelName(where.split(/[\\/]/).pop() ?? modelName);   // Windows paths use backslashes
      setNote(`Saved to ${where}`);
    }
    return base;
  }, [modelName]);

  const openModel = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    const res = await b.openModel();
    if (!res) return;
    if (res.error) { setNote(res.error); return; }
    try {
      const parsed = JSON.parse(res.text ?? "");
      if (!parsed || typeof parsed !== "object" || !parsed.elements || !parsed.order) {
        throw new Error("not a Preckon model");
      }
      setDoc(parsed as BimDocument);
      setModelName(res.name);
      setStudioKey((k) => k + 1);        // the studio owns its history — remount it
      setPid(null);                      // a file on disk is not a project's model
      setTool("studio");
      setNote(null);
    } catch (e: any) {
      setNote(`That file is not a Preckon model (${e?.message ?? e}).`);
    }
  }, []);

  const chosen = files.find((f) => f.id === fid) ?? null;

  return (
    <ToastHost>
      <div className="ws">
        <header className="ws-bar">
          <div className="ws-brand">
            <span className="ws-mark">P</span>
            <div>
              <b>Preckon Workstation</b>
              <small>{me ? (me.email ?? "Signed in") : "Not signed in"}</small>
            </div>
          </div>

          <nav className="ws-tabs" role="tablist" aria-label="Tool">
            <button role="tab" aria-selected={tool === "editor"} className={tool === "editor" ? "on" : ""}
                    onClick={() => setTool("editor")}>Drawing editor</button>
            <button role="tab" aria-selected={tool === "studio"} className={tool === "studio" ? "on" : ""}
                    onClick={() => setTool("studio")}>BIM Studio</button>
          </nav>

          {/* The project list, exactly as the workspace has it. Empty and
              disabled until somebody signs in, rather than hidden — so it is
              obvious that projects exist and a sign-in is what is missing. */}
          <label className="ws-pick">
            <span>Project</span>
            <select
              value={pid ?? ""}
              onChange={(e) => { setPid(e.target.value || null); setLocal(null); }}
              disabled={!me || projects.length === 0}
            >
              <option value="">{me ? (projects.length ? "Choose a project" : "No projects") : "Sign in first"}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          {tool === "editor" && pid && (
            <label className="ws-pick">
              <span>Drawing</span>
              <select
                value={local ? "" : (fid ?? "")}
                onChange={(e) => { setFid(e.target.value || null); setLocal(null); }}
                disabled={!files.length}
              >
                {!files.length && <option value="">No drawings</option>}
                {local && <option value="">{local.name} (on this machine)</option>}
                {files.map((f) => <option key={f.id} value={f.id}>{f.filename}</option>)}
              </select>
            </label>
          )}

          <div className="ws-actions">
            {tool === "editor" ? (
              <button className="btn btn-primary" onClick={openLocal} disabled={busy}>
                {busy ? "Opening…" : "Open from disk"}
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={openModel}>Open model</button>
            )}
            {me
              ? <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
              : <button className="btn btn-ghost" onClick={signIn}>Sign in</button>}
          </div>
        </header>

        {needsSignIn && !me && (
          <div className="ws-note" role="status">
            Your workspace session has expired, so projects and the assistants are unavailable.
            Files on this machine still open normally.{" "}
            <button className="mini sm" onClick={signIn}>Sign in to {server || "Preckon"}</button>
          </div>
        )}
        {note && <div className="ws-note" role="status">{note}</div>}

        <main className="ws-body">
          {tool === "editor" ? (
            local ? (
              /* No pid: this drawing belongs to no project, so Save to project
                 and the assistant are correctly unavailable on it. */
              <CadEditor
                key={`local:${local.name}:${local.text.length}`}
                filename={local.name}
                dxfText={local.text}
                onClose={() => setLocal(null)}
              />
            ) : pid && chosen ? (
              /* With a project and a sheet, this is the identical editor the web
                 app runs — Save to project and the drawing assistant included. */
              <CadEditor
                key={`${pid}:${chosen.id}`}
                pid={pid}
                fid={chosen.id}
                filename={chosen.filename}
              />
            ) : (
              <div className="ws-empty">
                <h2>Open a drawing</h2>
                <p>
                  A <b>.dwg</b> or a <b>.dxf</b> straight off this machine — DWG is converted
                  here, with nothing uploaded{me ? " — or pick a sheet from one of your projects above." : "."}
                </p>
                <button className="btn btn-primary" onClick={openLocal} disabled={busy}>Open from disk</button>
                <p className="ws-hint">Ctrl+O</p>
                {!me && (
                  <p className="ws-hint">
                    <button className="mini sm" onClick={signIn}>Sign in</button> to reach your projects.
                  </p>
                )}
              </div>
            )
          ) : pid ? (
            /* The workspace's own panel: loads the project's model, saves it
               back, and brings the Ask AI box, Measure into BOQ and Remove
               takeoff with it. Not a reimplementation — the same file. */
            <BimStudioPanel pid={pid} />
          ) : (
            <BimStudio
              key={studioKey}
              initialDoc={doc}
              version={0}
              onSave={saveDocToDisk}
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

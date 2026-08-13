// Preckon desktop — the drawing workstation.
//
// This is deliberately NOT an offline Preckon. Projects, artifacts, the audit
// chain and the agents stay on the server, where the audit chain and the
// entitlement model live and where they belong. What moves to this machine is
// everything that made drawings slow:
//
//   - Opening a .dwg. Converted here, by a converter on this machine, with no
//     upload and no round trip. This is the headline: the browser build cannot
//     do it at all.
//   - Fetching a sheet. Cached on disk permanently, so a 9 MB drawing is a wait
//     once and never again — including across restarts, which a browser cache
//     will not promise.
//
// The window loads the ordinary web app. That is the point: one UI, one deploy,
// one set of bugs. The app notices `window.preckon` and routes file work
// through it; a browser without it behaves exactly as it does today.

const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, Menu } = require("electron");
const { pathToFileURL } = require("node:url");
const { promises: fs } = require("node:fs");
const path = require("node:path");
const { findConverter, toDxf } = require("./oda");
const { DrawingCache } = require("./cache");

// The page is served from disk over a custom scheme rather than opened as a
// file:// URL, and that is not ceremony — it is the difference between the app
// working and a white window.
//
// Chromium gives a file:// page an OPAQUE origin. A Content-Security-Policy of
// `script-src 'self'` on such a page matches nothing at all, so the bundle and
// the stylesheet are both refused and you get an empty window with a working
// menu bar and no clue why. Loading the identical files over app:// gives the
// page a real origin, so 'self' means something and a strict policy can stay.
const RENDERER = path.join(__dirname, "..", "renderer");
const PAGE = "app://preckon/index.html";

// Must be declared before the app is ready. `standard` gives the scheme real
// origin semantics; `secure` puts it on the same footing as https, which is
// what ES modules and a strict CSP both expect.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/* ── the workspace ───────────────────────────────────────────────────────────
 *
 * The workstation is useful with no network at all — open a file, mark it up,
 * save it. But an estimator's drawings are IN a project, and so is everything
 * that makes the two tools worth using: the sheet list, save-back, the takeoff,
 * and both assistants. So it signs in to the same workspace the web app uses.
 *
 * Every request goes through THIS process, never the renderer. Three reasons,
 * and they all matter:
 *
 *   - The renderer's origin is app://preckon. Fetching a different origin from
 *     there is a cross-origin request the tenant API sends no CORS headers for,
 *     and its session cookie would not be attached anyway.
 *   - Doing it here means the page's Content-Security-Policy can keep saying
 *     connect-src 'self'. The renderer genuinely cannot reach the network, so a
 *     compromised page cannot exfiltrate a drawing.
 *   - The cookie lives in a partition owned by the main process, out of reach
 *     of anything running in the page.
 */
const DEFAULT_SERVER = "https://app.preckon.com";
const PARTITION = "persist:preckon-workspace";
const workspaceSession = () => session.fromPartition(PARTITION);

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const readSettings = async () => {
  try { return JSON.parse(await fs.readFile(settingsFile(), "utf8")); } catch { return {}; }
};
const writeSettings = async (s) => fs.writeFile(settingsFile(), JSON.stringify(s, null, 2));

let cache;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0b1220",
    title: "Preckon Workstation",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // The window loads a remote origin and the preload can touch the disk, so
      // these three are not defaults to leave alone — they are the boundary.
      // Isolation keeps the page's JavaScript out of the preload's scope; no
      // node integration means the page cannot require() its way to the
      // filesystem; sandbox holds the renderer to the OS sandbox.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // This window renders one local page and never navigates. Any link goes to
  // the real browser — a window holding a bridge to this machine's disk must
  // never be pointed at somebody else's HTML.
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== PAGE) { e.preventDefault(); void shell.openExternal(url); }
  });

  /* The renderer's console, in the terminal that launched the app.
     A packaged Electron app has nowhere to print, so a CSP refusal or a React
     error is invisible: the window is simply blank. This is how the last
     failure stayed a mystery, and one line of forwarding is the cure. */
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    const tag = ["debug", "info", "warn", "error"][level] ?? "log";
    console.log(`[renderer:${tag}] ${message}${source ? `  (${source}:${line})` : ""}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[renderer] failed to load ${url}: ${desc} (${code})`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] process gone:", details.reason);
  });

  if (process.env.PRECKON_DEBUG) win.webContents.openDevTools({ mode: "detach" });

  void win.loadURL(PAGE);
  return win;
}

app.whenReady().then(async () => {
  cache = new DrawingCache(path.join(app.getPath("userData"), "drawings"));

  /* Serve the renderer. Every request is resolved inside RENDERER and checked
     to still be inside it afterwards — a scheme handler is a file reader, and
     "../../.." in a URL must not turn this one into a way to read the disk. */
  protocol.handle("app", async (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname);
    const file = path.normalize(path.join(RENDERER, rel === "/" ? "index.html" : rel));
    if (file !== RENDERER && !file.startsWith(RENDERER + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      return await net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  /* ── what the page is allowed to ask this machine to do ────────────────── */

  // Deliberately narrow. There is no "read this path" — the only files that can
  // be read are ones the user picked in a native dialog on this call, and the
  // only files that can be written are cache entries under our own directory.
  // A compromised page must not be able to turn this bridge into a file reader.

  ipcMain.handle("preckon:open-drawing", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Open a drawing",
      properties: ["openFile"],
      filters: [
        { name: "Drawings", extensions: ["dwg", "dxf"] },
        { name: "AutoCAD drawing", extensions: ["dwg"] },
        { name: "DXF", extensions: ["dxf"] },
      ],
    });
    if (canceled || !filePaths[0]) return null;
    return readDrawing(filePaths[0]);
  });

  /* Write a file the user names. The DRAWING editor already leaves via its own
     Download button, but BIM Studio had no exit at all in this build: its only
     save path is the workspace, which does not exist here, so a morning's
     modelling lived in a browser tab until it was closed. A tool you cannot
     save from is not a tool. */
  /* One call for the whole API. The renderer hands it the same method and path
     the web app uses, so the components calling it are unmodified. */
  ipcMain.handle("preckon:api", async (_e, method, apiPath, body) => {
    const base = (await readSettings()).server ?? DEFAULT_SERVER;
    const url = `${base}/api/v1${apiPath}`;
    try {
      const res = await net.fetch(url, {
        method: String(method ?? "GET").toUpperCase(),
        session: workspaceSession(),
        useSessionCookies: true,          // without this the session cookie is not sent
        headers: body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 204) return { ok: true, data: null };
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          code: json?.error?.code ?? "error",
          // 401 is the one the renderer acts on: it means "sign in", not "broken".
          message: json?.error?.message ?? `Request failed (${res.status})`,
        };
      }
      return { ok: true, data: json };
    } catch (e) {
      return { ok: false, status: 0, code: "offline", message: `Cannot reach ${base} — ${e?.message ?? e}` };
    }
  });

  /* A raw body, not JSON.
     The drawing endpoints return DXF and SVG as text, and the JSON client above
     would choke on both. Split out rather than made clever, because the
     difference between "parse this" and "hand it over" is exactly the sort of
     thing that turns into a silent mis-parse later. The path arrives with its
     /api/v1 prefix already on it, the way the components write it. */
  ipcMain.handle("preckon:api-text", async (_e, apiPath) => {
    const base = (await readSettings()).server ?? DEFAULT_SERVER;
    try {
      const res = await net.fetch(`${base}${apiPath}`, {
        session: workspaceSession(),
        useSessionCookies: true,
      });
      const text = await res.text();
      return res.ok
        ? { ok: true, text }
        : { ok: false, status: res.status, message: `Request failed (${res.status})` };
    } catch (e) {
      return { ok: false, status: 0, message: `Cannot reach ${base} — ${e?.message ?? e}` };
    }
  });

  /* Save a drawing back into a project.
     Multipart is built here rather than in the page: a File object cannot cross
     the IPC boundary, but the drawing's text can, and text is all a DXF is. */
  ipcMain.handle("preckon:upload", async (_e, apiPath, filename, text, mime) => {
    const base = (await readSettings()).server ?? DEFAULT_SERVER;
    try {
      const form = new FormData();
      form.append("file", new Blob([String(text ?? "")], { type: mime || "application/octet-stream" }), String(filename));
      const res = await net.fetch(`${base}/api/v1${apiPath}`, {
        method: "POST",
        session: workspaceSession(),
        useSessionCookies: true,
        body: form,
      });
      const body = await res.text();
      let json = null;
      try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
      if (!res.ok) {
        return { ok: false, status: res.status, code: json?.error?.code ?? "error",
                 message: json?.error?.message ?? `Upload failed (${res.status})` };
      }
      return { ok: true, data: json };
    } catch (e) {
      return { ok: false, status: 0, code: "offline", message: `Cannot reach ${base} — ${e?.message ?? e}` };
    }
  });

  /* Sign in by letting the workspace do it.
     A window at the real login page, in the same cookie partition the API calls
     use. Preckon's own form, its own rate limiting, its own password rules —
     and this app never sees or stores a password. */
  ipcMain.handle("preckon:sign-in", async () => {
    const base = (await readSettings()).server ?? DEFAULT_SERVER;
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 520, height: 680, title: "Sign in to Preckon",
        webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
      });
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
        if (!win.isDestroyed()) win.close();
      };
      // Signed in when the workspace stops showing the login page.
      win.webContents.on("did-navigate", (_e, url) => {
        if (!/\/login/.test(new URL(url).pathname)) finish(true);
      });
      win.webContents.on("did-navigate-in-page", (_e, url) => {
        if (!/\/login/.test(new URL(url).pathname)) finish(true);
      });
      win.on("closed", () => { done || resolve(false); done = true; });
      void win.loadURL(`${base}/login`);
    });
  });

  ipcMain.handle("preckon:sign-out", async () => {
    await workspaceSession().clearStorageData({ storages: ["cookies"] });
  });

  ipcMain.handle("preckon:server", async (_e, next) => {
    const s = await readSettings();
    if (typeof next === "string" && next.trim()) {
      // Changing workspace must not carry the old one's session across.
      await workspaceSession().clearStorageData({ storages: ["cookies"] });
      await writeSettings({ ...s, server: next.trim().replace(/\/+$/, "") });
      return next.trim();
    }
    return s.server ?? DEFAULT_SERVER;
  });

  ipcMain.handle("preckon:save-as", async (_e, defaultName, text) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save",
      defaultPath: String(defaultName ?? "untitled"),
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, String(text ?? ""), "utf8");
    return filePath;
  });

  /* Read one back. Same rule as every other read here: the only file that can
     be opened is the one picked in this dialog, on this call. */
  ipcMain.handle("preckon:open-model", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Open a model",
      properties: ["openFile"],
      filters: [{ name: "Preckon model", extensions: ["json"] }],
    });
    if (canceled || !filePaths[0]) return null;
    try {
      return { name: path.basename(filePaths[0]), text: await fs.readFile(filePaths[0], "utf8") };
    } catch (e) {
      return { name: path.basename(filePaths[0]), error: `Could not read that file: ${e?.message ?? e}` };
    }
  });

  ipcMain.handle("preckon:cache-get", async (_e, key) => {
    const buf = await cache.get(String(key));
    return buf ? buf.toString("utf8") : null;
  });

  ipcMain.handle("preckon:cache-set", async (_e, key, text) => {
    await cache.set(String(key), Buffer.from(String(text), "utf8"));
  });

  ipcMain.handle("preckon:cache-stats", async () => ({ bytes: await cache.size() }));
  ipcMain.handle("preckon:cache-clear", async () => { await cache.clear(); });

  ipcMain.handle("preckon:converter", async () => {
    const s = await readSettings();
    const found = await findConverter(path.join(process.resourcesPath ?? ".", "oda"), s.odaPath);
    return { path: found, chosen: !!s.odaPath };
  });

  // Asks where the converter is. Only reachable from a button the user pressed
  // after being told DWG needs it.
  ipcMain.handle("preckon:choose-converter", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Where is ODAFileConverter?",
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Programs", extensions: ["exe"] }] : [],
    });
    if (canceled || !filePaths[0]) return null;
    const s = await readSettings();
    await writeSettings({ ...s, odaPath: filePaths[0] });
    return filePaths[0];
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(menu()));
  createWindow();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

/**
 * A drawing off the disk, as DXF text the editor can parse.
 *
 * A .dxf is already what we want. A .dwg goes through the converter, and when
 * there isn't one the answer says so in words the reader can act on — "install
 * this" or "export DXF instead" — rather than failing at the parser with
 * something about unexpected bytes.
 */
async function readDrawing(file) {
  const name = path.basename(file);
  if (/\.dxf$/i.test(name)) return { name, text: await fs.readFile(file, "utf8") };

  const s = await readSettings();
  const converter = await findConverter(path.join(process.resourcesPath ?? ".", "oda"), s.odaPath);
  if (!converter) {
    return {
      name,
      error:
        "This is a .dwg, and no DWG converter was found on this machine. " +
        "Install the ODA File Converter and point Preckon at it, or export the drawing as DXF from AutoCAD.",
      needsConverter: true,
    };
  }
  try {
    return { name: name.replace(/\.dwg$/i, ".dxf"), text: await toDxf(converter, file) };
  } catch (e) {
    return { name, error: `The DWG could not be converted: ${e?.message ?? e}` };
  }
}

const menu = () => [
  ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
  { role: "fileMenu" },
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
];

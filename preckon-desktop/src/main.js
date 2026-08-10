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

const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const { pathToFileURL } = require("node:url");
const { promises: fs } = require("node:fs");
const path = require("node:path");
const { findConverter, toDxf } = require("./oda");
const { DrawingCache } = require("./cache");

// Loaded from disk. There is no server, no origin and no session — this build
// is the drawing editor and BIM Studio, and both are geometry running on the
// machine in front of you. Nothing here needs a network to work, which is the
// entire point: a site office with no signal is where drawings get marked up.
const PAGE = path.join(__dirname, "..", "renderer", "index.html");

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
    if (url !== pathToFileURL(PAGE).href) { e.preventDefault(); void shell.openExternal(url); }
  });

  void win.loadFile(PAGE);
  return win;
}

app.whenReady().then(async () => {
  cache = new DrawingCache(path.join(app.getPath("userData"), "drawings"));

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

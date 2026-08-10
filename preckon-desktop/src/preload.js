// The bridge, and the whole of it.
//
// Everything the web app can ask this machine to do is on this object. There is
// no general file read, no path argument that reaches the disk, and no way to
// widen it from the page: a file is only readable if the user picked it in a
// native dialog during that same call, and the cache writes only inside the
// app's own data directory.
//
// The web app treats this as optional. `isDesktop` is how it decides whether to
// offer local DWG at all, and every call has a browser-side fallback — the same
// build runs in Chrome with none of this present.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("preckon", {
  isDesktop: true,
  platform: process.platform,

  /** Native picker → { name, text } | { name, error, needsConverter? } | null.
   *  Accepts .dwg, which the browser build cannot: it is converted here. */
  openDrawing: () => ipcRenderer.invoke("preckon:open-drawing"),

  /** Write text to a file the user names, and read one back. BIM Studio's only
   *  way in and out of this machine — the drawing editor has its own. */
  saveAs: (defaultName, text) => ipcRenderer.invoke("preckon:save-as", defaultName, text),
  openModel: () => ipcRenderer.invoke("preckon:open-model"),

  /* The workspace, reached through the main process. The renderer never touches
     the network itself — see the note in main.js — so the page's CSP can keep
     forbidding it outright while these still work. */
  workspace: {
    request: (method, path, body) => ipcRenderer.invoke("preckon:api", method, path, body),
    upload: (path, filename, text, mime) => ipcRenderer.invoke("preckon:upload", path, filename, text, mime),
    /** Raw body — the drawing endpoints return DXF and SVG, not JSON. */
    text: (path) => ipcRenderer.invoke("preckon:api-text", path),
    signIn: () => ipcRenderer.invoke("preckon:sign-in"),
    signOut: () => ipcRenderer.invoke("preckon:sign-out"),
    server: (next) => ipcRenderer.invoke("preckon:server", next),
  },

  /** Where the DWG converter is, and whether the user chose it themselves. */
  converter: () => ipcRenderer.invoke("preckon:converter"),
  chooseConverter: () => ipcRenderer.invoke("preckon:choose-converter"),

  /* A drawing is immutable — a revision is a new upload with a new id — so a
     key naming one names one exact set of bytes forever, and this cache never
     needs invalidating. It survives restarts, which is the part a browser
     cache cannot promise. */
  cache: {
    get: (key) => ipcRenderer.invoke("preckon:cache-get", key),
    set: (key, text) => ipcRenderer.invoke("preckon:cache-set", key, text),
    stats: () => ipcRenderer.invoke("preckon:cache-stats"),
    clear: () => ipcRenderer.invoke("preckon:cache-clear"),
  },
});

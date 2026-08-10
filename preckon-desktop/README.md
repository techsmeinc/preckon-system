# Preckon desktop — the drawing workstation

This is **not** an offline Preckon. Projects, artifacts, the audit chain and the
agents stay on the server, where the audit chain and the entitlement model live.
What moves onto the estimator's machine is the part that was slow:

| | Browser | Desktop |
|---|---|---|
| Open a local `.dxf` | works today | works today |
| **Open a local `.dwg`** | **impossible** — closed binary, no reader in a page | **converted here, no upload** |
| Fetch a 9 MB sheet | every session, subject to eviction | **once, ever** — on disk, survives restarts |
| Projects, BOQ, agents | server | server (unchanged) |

One UI, one deploy. The window loads the ordinary web app; the app notices
`window.preckon` and routes file work through it. A browser without the bridge
behaves exactly as it does today, from the same build.

## Running it

```powershell
cd preckon-desktop
npm install
npm start                                     # against https://app.preckon.com

# against a local tenant instead — PowerShell has no inline env-var prefix,
# so this is two statements, not the `VAR=x cmd` form you would use in bash
$env:PRECKON_URL = "http://localhost:3100"; npm start
```

## DWG — read this before shipping a build

DWG support depends on the **ODA File Converter**, the same tool the server
sidecar uses via `EZDXF_ODAFC`. The app finds it in this order:

1. **Bundled**, at `vendor/oda/` → packaged into `resources/oda`.
2. **Chosen by the user**, remembered in `settings.json` in the app's data dir.
3. **Installed in the usual place** — scanned automatically, so most users are
   never asked.

`vendor/oda/` is deliberately **empty and git-ignored**. Populating it and
shipping the result redistributes ODA's software, and **that requires a current
ODA membership**. Do not put binaries there until that agreement is in place —
the app is fully functional without it, because paths 2 and 3 cover any machine
where the user has installed the converter themselves.

If no converter is found, opening a `.dwg` does not fail silently. It offers to
be pointed at one, and names the alternative: export DXF from AutoCAD.

## Security

The window loads a remote origin **and** the preload can touch the disk, so the
boundary is the point:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The bridge in `preload.js` is the complete list of what the page may ask this
  machine to do. There is **no general file read**: a file is readable only if
  the user picked it in a native dialog during that same call.
- Cache writes are confined to the app's own data directory, and the filename is
  a hash of the key — a crafted key cannot escape the directory.
- Any navigation away from the configured origin opens in the real browser
  instead. A supplier's link must never load in a window with this bridge
  attached.

## What is not done yet

- **No packaged CAD sidecar.** Rendering an issued sheet still asks the server.
  Local rendering means freezing the Python `ezdxf` service (PyInstaller) and
  shipping a binary per platform — the next substantial piece of work.
- **No offline queue.** Editing a drawing with no connection will fail at save,
  as it does in the browser. The cache makes drawings *readable* offline; it
  does not make edits durable offline.
- **Not code-signed.** Windows SmartScreen and macOS Gatekeeper will both warn
  until certificates are in place. Signing is separate from the ODA question and
  also needs buying.

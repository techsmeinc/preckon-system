// DWG → DXF, on this machine.
//
// DWG is Autodesk's closed binary format. There is no open reader for it, which
// is why the browser build refuses a local .dwg outright: it can only offer one
// after the file has been uploaded and a server-side converter has run. That
// round trip is the thing this app exists to remove.
//
// The converter is the ODA File Converter, the same one the server sidecar uses
// via EZDXF_ODAFC. It is looked for in three places, in this order:
//
//   1. Bundled with the app, under resources/oda. This is the good experience —
//      DWG simply works — and it requires an ODA membership to redistribute.
//      See README before shipping a build with vendor/oda populated.
//   2. A path the user chose, remembered in settings. This is the path that
//      needs no contract: the converter is free to download and install, and we
//      just ask where it is.
//   3. The usual install locations, so most users never get asked at all.

const { spawn } = require("node:child_process");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Where the converter usually lands, per platform. */
function commonPaths() {
  if (process.platform === "win32") {
    const bases = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(Boolean);
    const out = [];
    for (const base of bases) {
      out.push(path.join(base, "ODA", "ODAFileConverter", "ODAFileConverter.exe"));
      // Versioned installs: ODAFileConverter 25.4.0, and so on. Resolved by a
      // scan in findConverter, since the version is not knowable up front.
      out.push(path.join(base, "ODA"));
    }
    return out;
  }
  if (process.platform === "darwin") {
    return ["/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter"];
  }
  return ["/usr/bin/ODAFileConverter", "/opt/oda/ODAFileConverter"];
}

const exists = (p) => fs.access(p).then(() => true, () => false);

/** The converter executable inside a directory, whatever it is versioned as. */
async function scanDir(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = await scanDir(full);
      if (hit) return hit;
    } else if (/^ODAFileConverter(\.exe)?$/i.test(e.name)) {
      return full;
    }
  }
  return null;
}

/**
 * Locate the converter. Returns its path, or null when there is none — which is
 * a state the app has to handle rather than crash on, because plenty of users
 * only ever open .dxf and should never be told to install anything.
 */
async function findConverter(bundledDir, remembered) {
  if (remembered && (await exists(remembered))) return remembered;

  const bundled = await scanDir(bundledDir);
  if (bundled) return bundled;

  for (const p of commonPaths()) {
    if (await exists(p)) {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        const hit = await scanDir(p);
        if (hit) return hit;
      } else {
        return p;
      }
    }
  }
  return null;
}

/**
 * Convert one .dwg to DXF and return the text.
 *
 * The converter works on DIRECTORIES, not files — it takes an input folder, an
 * output folder, and converts everything matching a filter. So the file is
 * copied alone into a scratch folder, converted, and read back. The scratch
 * folder is removed afterwards whether it worked or not; these are drawings,
 * and leaving copies of a client's drawings in temp is not acceptable.
 *
 * Output version is ACAD2018 ASCII DXF: `dxf-parser` reads it, and ASCII is
 * what the editor's parser expects.
 */
async function toDxf(converter, dwgPath) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "preckon-dwg-"));
  const inDir = path.join(work, "in");
  const outDir = path.join(work, "out");
  await fs.mkdir(inDir);
  await fs.mkdir(outDir);

  const base = path.basename(dwgPath);
  await fs.copyFile(dwgPath, path.join(inDir, base));

  try {
    await run(converter, [inDir, outDir, "ACAD2018", "DXF", "0", "1", base]);
    const produced = base.replace(/\.dwg$/i, ".dxf");
    return await fs.readFile(path.join(outDir, produced), "utf8");
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => { /* temp dir; best effort */ });
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    // The converter is a Qt application and will try to open a window on a
    // machine with no display. On Linux that hangs forever; offscreen makes it
    // behave as the batch tool it is.
    const env = { ...process.env, QT_QPA_PLATFORM: process.platform === "linux" ? "offscreen" : undefined };
    const child = spawn(cmd, args, { env, windowsHide: true });
    let err = "";
    child.stderr?.on("data", (d) => { err += String(d); });
    // Five minutes. A large sheet genuinely takes a while, and a converter that
    // has wedged must not hold the window open forever.
    const timer = setTimeout(() => { child.kill(); reject(new Error("The DWG conversion took too long (over 5 minutes).")); }, 300_000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // The converter exits 0 even for some failures, so the caller checks for
      // the output file rather than trusting this.
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `The converter exited with code ${code}.`));
    });
  });
}

module.exports = { findConverter, toDxf };

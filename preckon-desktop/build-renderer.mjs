// Bundle the two tools into a standalone page.
//
//   node build-renderer.mjs [--watch]
//
// The components come from the tenant source, unmodified. Four modules are
// redirected to local shims — the API client, the workspace hooks, the
// translator and the desktop bridge — and everything else compiles as-is.
//
// Why bundle rather than statically export the Next app: an export drags in the
// router, the workspace shell, the session, the entitlements and the whole
// dictionary set, to render two components that need none of it. This produces
// one JS file and one CSS file from the same source of truth.

import { build, context } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tenant = path.resolve(here, "..", "preckon-tenant", "src");
const out = path.join(here, "renderer", "dist");

/** Redirect the four workspace seams to the standalone stand-ins, and map the
 *  tenant's own "@/" imports so its internal cross-references still resolve. */
const alias = {
  "@/lib/apiclient": path.join(here, "renderer", "shims", "apiclient.ts"),
  "@/lib/ui": path.join(here, "renderer", "shims", "ui.tsx"),
  "@/lib/i18n": path.join(here, "renderer", "shims", "i18n.tsx"),
  "@/lib/desktop": path.join(tenant, "lib", "desktop.ts"),
  "@tenant": tenant,
  "@": tenant,
};

const options = {
  entryPoints: [path.join(here, "renderer", "main.tsx")],
  bundle: true,
  outdir: out,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],           // Electron 33 ships Chromium 130; 120 is slack
  jsx: "automatic",
  loader: { ".css": "css" },
  alias,
  // Next injects this; the components read it in a couple of places and a bare
  // `process` reference is a runtime crash in a plain bundle.
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  sourcemap: true,
  logLevel: "info",
  // "use client" is a Next directive with no meaning here, and esbuild warns
  // about it once per file — forty warnings that hide a real one.
  logOverride: { "unsupported-jsx-comment": "silent", "different-path-case": "silent" },
  banner: { js: "/* Preckon Workstation — built from preckon-tenant/src */" },
};

async function copyStyles() {
  await fs.mkdir(out, { recursive: true });
  // The workspace stylesheet, plus this app's own shell. The components are the
  // real ones, so they need the real CSS — a second stylesheet would drift.
  const globals = await fs.readFile(path.join(tenant, "app", "globals.css"), "utf8");
  const shell = await fs.readFile(path.join(here, "renderer", "shell.css"), "utf8");
  await fs.writeFile(path.join(out, "app.css"), globals + "\n\n" + shell);
}

const watch = process.argv.includes("--watch");
await copyStyles();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await build(options);
  const { size } = await fs.stat(path.join(out, "main.js"));
  console.log(`renderer: ${(size / 1024).toFixed(0)} kB`);
}

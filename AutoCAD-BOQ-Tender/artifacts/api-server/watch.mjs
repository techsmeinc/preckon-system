// Dev watcher for the API server: rebuilds the bundle with esbuild on every
// source change and restarts `node dist/index.mjs` so backend edits take effect
// without a manual `pnpm dev` restart. Used by the `dev` script.
import { createRequire } from "node:module";
import { context } from "esbuild";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { esbuildOptions, distDir, artifactDir } from "./build.mjs";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies.
globalThis.require = createRequire(import.meta.url);

const entry = path.resolve(distDir, "index.mjs");
let child = null;

// On Windows, child.kill() only reaps the immediate node process; spawn is
// direct (no shell) here, so a plain kill is enough. Wait for exit before the
// next start so the port is released.
function stopServer() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) { resolve(); return; }
    const c = child;
    child = null;
    c.once("exit", () => resolve());
    try { c.kill(); } catch { resolve(); }
  });
}

async function startServer() {
  await stopServer();
  child = spawn(process.execPath, ["--enable-source-maps", entry], {
    cwd: artifactDir,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    // Distinguish our own restart-kill (child set to null) from a real crash.
    if (child && signal == null && code != null && code !== 0) {
      process.stderr.write(`[api:watch] server exited (code=${code}) — waiting for next change to retry\n`);
    }
  });
}

// esbuild plugin: after each successful (re)build, restart the server.
const restartPlugin = {
  name: "restart-server",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        process.stderr.write(`[api:watch] build failed with ${result.errors.length} error(s) — server NOT restarted\n`);
        return;
      }
      process.stdout.write("[api:watch] rebuilt — restarting server\n");
      await startServer();
    });
  },
};

await rm(distDir, { recursive: true, force: true });
const ctx = await context({
  ...esbuildOptions(),
  plugins: [...esbuildOptions().plugins, restartPlugin],
});

async function shutdown() {
  try { await ctx.dispose(); } catch {}
  await stopServer();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGBREAK", shutdown);

await ctx.watch();
process.stdout.write("[api:watch] watching src/ for changes...\n");

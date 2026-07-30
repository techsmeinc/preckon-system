#!/usr/bin/env node
// One-command local dev: spawns the API server and the boq-platform Vite dev
// server with the env vars they need, and pipes both logs into this terminal
// with [api] / [web] prefixes. Ctrl+C kills both.
//
// Usage: `pnpm dev` from the repo root.
//
// Override defaults via env vars before running (any one of these):
//   $env:DATABASE_URL = "mysql://user:pass@host:3306/dbname"
//   $env:API_PORT     = "5000"
//   $env:WEB_PORT     = "5173"

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const API_PORT = process.env.API_PORT ?? "5000";
const WEB_PORT = process.env.WEB_PORT ?? "5173";
const CAD_PORT = process.env.CAD_PORT ?? "7400";
const CAD_EXTRACTOR_URL = process.env.CAD_EXTRACTOR_URL ?? `http://127.0.0.1:${CAD_PORT}`;
const DRAWLOGIX_PORT = process.env.DRAWLOGIX_PORT ?? "3001";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "mysql://root@localhost:3306/boq_tender";

const procs = [
  {
    name: "api",
    color: "\x1b[36m", // cyan
    env: {
      PORT: API_PORT,
      DATABASE_URL,
      CAD_EXTRACTOR_URL,
      NODE_ENV: "development",
    },
    args: [
      "--config.verify-deps-before-run=false",
      "--filter",
      "@workspace/api-server",
      "run",
      "dev",
    ],
  },
  {
    name: "web",
    color: "\x1b[32m", // green
    env: {
      PORT: WEB_PORT,
      BASE_PATH: "/",
    },
    args: [
      "--config.verify-deps-before-run=false",
      "--filter",
      "@workspace/boq-platform",
      "run",
      "dev",
    ],
  },
];

// CAD extractor sidecar (Python/FastAPI). Powers document CAD ingestion AND the
// in-portal DWG/DXF drawing viewer. Optional: only started if its virtualenv
// exists, and its exit never tears down api/web — so contributors without the
// Python env can still run the JS stack. Set CAD_PORT / CAD_EXTRACTOR_URL to
// override, or point at an already-running sidecar.
const cadDir = resolve(root, "services/cad-extractor");
const cadPython = resolve(
  cadDir,
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
);
if (process.env.CAD_EXTRACTOR_URL) {
  // Caller is pointing us at an externally-managed sidecar — don't spawn one.
} else if (existsSync(cadPython)) {
  procs.push({
    name: "cad",
    color: "\x1b[35m", // magenta
    cmd: cadPython,
    cwd: cadDir,
    optional: true, // its death must not kill api/web
    env: { PYTHONUNBUFFERED: "1" },
    args: ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", CAD_PORT],
  });
} else {
  console.warn(
    `\x1b[33m[cad] virtualenv not found at ${cadPython} — skipping the CAD sidecar.\n` +
    `      DWG/DXF preview + CAD ingestion will be unavailable. To enable it:\n` +
    `      cd services/cad-extractor && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt\x1b[0m`,
  );
}

// DrawLogix studio (standalone Next.js concept-plan app). Lives in /DrawLogix with
// its OWN node_modules (npm, NOT part of the pnpm workspace). Served under basePath
// "/drawlogix" on :3001; the boq-platform Vite server proxies /drawlogix → here, so
// it renders inside the portal's DrawLogix tab. Without it, that tab shows a Next
// 404. Optional: only started if its deps are installed, and its exit never tears
// down api/web. Set DRAWLOGIX_URL to point at an already-running instance instead.
const drawlogixDir = resolve(root, "DrawLogix");
const drawlogixNext = resolve(
  drawlogixDir,
  process.platform === "win32" ? "node_modules/.bin/next.cmd" : "node_modules/.bin/next",
);
if (process.env.DRAWLOGIX_URL) {
  // Caller is pointing the proxy at an externally-managed DrawLogix — don't spawn one.
} else if (existsSync(drawlogixNext)) {
  procs.push({
    name: "drawlogix",
    color: "\x1b[34m", // blue
    cmd: drawlogixNext,
    cwd: drawlogixDir,
    optional: true, // its death must not kill api/web
    env: { NODE_ENV: "development" },
    args: ["dev", "-p", DRAWLOGIX_PORT],
  });
} else {
  console.warn(
    `\x1b[33m[drawlogix] deps not installed at ${drawlogixDir} — skipping the DrawLogix studio.\n` +
    `      The portal's DrawLogix tab will show a 404. To enable it:\n` +
    `      cd DrawLogix && npm install\x1b[0m`,
  );
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function prefixLine(name, color, line) {
  return `${color}[${name}]${RESET} ${line}`;
}

function pipe(stream, write, name, color) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      write(prefixLine(name, color, line) + "\n");
    }
  });
  stream.on("end", () => {
    if (buf) write(prefixLine(name, color, buf) + "\n");
  });
}

const children = procs.map((p) => {
  const child = spawn(p.cmd ?? "pnpm", p.args, {
    cwd: p.cwd ?? root,
    env: { ...process.env, ...p.env },
    shell: true,
  });
  pipe(child.stdout, (s) => process.stdout.write(s), p.name, p.color);
  pipe(child.stderr, (s) => process.stderr.write(s), p.name, p.color);
  child.on("exit", (code, signal) => {
    process.stderr.write(
      prefixLine(p.name, p.color, `${DIM}exited (code=${code} signal=${signal})${RESET}`) +
        "\n",
    );
    // Optional procs (the CAD sidecar) must not bring down the whole dev stack.
    if (p.optional) {
      process.stderr.write(
        prefixLine(p.name, p.color, `${DIM}optional service — leaving api/web running${RESET}`) + "\n",
      );
      return;
    }
    shutdown(code ?? 1);
  });
  return child;
});

// On Windows, child.kill() only kills the immediate shell wrapper, leaving the
// grandchild (pnpm → node/vite) holding ports like 5173. Use taskkill /T /F to
// terminate the entire process tree by PID.
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: false });
    } catch {
      try { child.kill(); } catch {}
    }
  } else {
    try { child.kill(); } catch {}
  }
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killTree(c);
  setTimeout(() => process.exit(exitCode), 800).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGBREAK", () => shutdown(0));
process.on("exit", () => { for (const c of children) killTree(c); });

const hasCad = procs.some((p) => p.name === "cad");
const hasDrawlogix = procs.some((p) => p.name === "drawlogix");
console.log(
  `${DIM}Starting api on http://localhost:${API_PORT}  +  web on http://localhost:${WEB_PORT}` +
    (hasCad ? `  +  cad sidecar on ${CAD_EXTRACTOR_URL}` : "") +
    (hasDrawlogix ? `  +  drawlogix on http://localhost:${DRAWLOGIX_PORT}/drawlogix` : "") +
    `${RESET}`,
);
console.log(`${DIM}DATABASE_URL=${DATABASE_URL}${RESET}`);
console.log(`${DIM}Ctrl+C to stop ${hasCad ? "all" : "both"}.${RESET}\n`);

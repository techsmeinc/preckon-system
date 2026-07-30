import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// Remove rival lockfiles so they don't get committed alongside pnpm-lock.yaml.
for (const f of ["package-lock.json", "yarn.lock"]) {
  const p = resolve(process.cwd(), f);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch {}
  }
}

// Detect the package manager. pnpm sets npm_config_user_agent like "pnpm/9.x ...".
// pnpm 11+'s auto deps-status check sometimes spawns inner installs without that
// var set, so accept both an explicit pnpm/ prefix and an empty/missing UA — only
// reject when we can clearly see npm or yarn was used.
const ua = (process.env.npm_config_user_agent ?? "").toLowerCase();
if (ua.startsWith("npm/") || ua.startsWith("yarn/")) {
  console.error("This repo uses pnpm. Install pnpm: https://pnpm.io/installation");
  process.exit(1);
}

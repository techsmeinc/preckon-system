// What desktop builds are available to download, read off disk.
//
// The installers are NOT in the Docker image. They are ~100 MB each and change
// on a different cadence from the web app: baking them in would put a
// hundred-megabyte layer into every deploy of a one-line CSS fix, and shipping
// a new installer would mean rebuilding and restarting the workspace to do it.
//
// So they live on a volume the app only reads. Publishing a new build is a copy
// into that directory — no rebuild, no restart, no downtime. The page below
// lists whatever is actually there, which also means a platform nobody has
// built for yet simply does not appear, rather than offering a 404.

import { promises as fs } from "node:fs";
import path from "node:path";

export const DOWNLOAD_DIR = process.env.DESKTOP_DOWNLOAD_DIR ?? "./.downloads";

export type Platform = "windows" | "mac" | "linux";

export interface Build {
  file: string;
  platform: Platform;
  /** Bytes — shown, because 118 MB over a site connection is worth warning about. */
  size: number;
  /** From the filename, which is where electron-builder puts it. */
  version: string | null;
  updated: string;
}

/** electron-builder's output names, and nothing else. Anything unrecognised in
 *  that directory is ignored rather than offered — a stray .zip somebody left
 *  there must not become a download link. */
function classify(name: string): Platform | null {
  if (/\.exe$/i.test(name)) return "windows";
  if (/\.dmg$/i.test(name)) return "mac";
  if (/\.(AppImage|deb)$/i.test(name)) return "linux";
  return null;
}

const versionOf = (name: string) => /(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? null;

export async function listBuilds(): Promise<Build[]> {
  let names: string[];
  try {
    names = await fs.readdir(DOWNLOAD_DIR);
  } catch {
    return [];               // nothing published yet — a normal state, not an error
  }

  const out: Build[] = [];
  for (const name of names) {
    const platform = classify(name);
    if (!platform) continue;
    const stat = await fs.stat(path.join(DOWNLOAD_DIR, name)).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({
      file: name,
      platform,
      size: stat.size,
      version: versionOf(name),
      updated: stat.mtime.toISOString(),
    });
  }
  // Newest first, so a page listing two versions of the same platform leads
  // with the one somebody should actually take.
  return out.sort((a, b) => b.updated.localeCompare(a.updated));
}

/**
 * Resolve a requested filename to a real path inside the download directory.
 *
 * The name comes off a URL, so it is treated as hostile: basename strips any
 * traversal, the result is required to still match what was asked for, and the
 * resolved path is required to sit inside the directory. Three checks for one
 * property, because this is the one place a bad string reaches the filesystem.
 */
export async function resolveBuild(requested: string): Promise<string | null> {
  const base = path.basename(requested);
  if (base !== requested || !classify(base)) return null;
  const full = path.resolve(DOWNLOAD_DIR, base);
  if (!full.startsWith(path.resolve(DOWNLOAD_DIR) + path.sep)) return null;
  const stat = await fs.stat(full).catch(() => null);
  return stat?.isFile() ? full : null;
}

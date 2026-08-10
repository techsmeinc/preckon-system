"use client";
// The desktop shell, when there is one.
//
// Preckon runs in a browser and in an Electron window off the SAME build. The
// window attaches a small bridge to `window.preckon`; a browser has none. So
// every capability here is optional and every caller has a path that works
// without it — the desktop app makes drawings local, it does not make a second
// product.
//
// What the bridge buys:
//   - .dwg opened straight off the disk. The browser genuinely cannot do this:
//     DWG is closed and binary and there is no reader for it in a page, which
//     is why the web build refuses one and asks for an upload instead.
//   - A sheet fetched once, ever. The cache is on disk and survives restarts,
//     which is what a 9 MB drawing over a slow line actually needs.

export interface OpenedDrawing {
  name: string;
  text?: string;
  error?: string;
  /** The file was a .dwg and no converter is installed. Worth offering to fix. */
  needsConverter?: boolean;
}

interface Bridge {
  isDesktop: true;
  platform: string;
  openDrawing(): Promise<OpenedDrawing | null>;
  converter(): Promise<{ path: string | null; chosen: boolean }>;
  chooseConverter(): Promise<string | null>;
  cache: {
    get(key: string): Promise<string | null>;
    set(key: string, text: string): Promise<void>;
    stats(): Promise<{ bytes: number }>;
    clear(): Promise<void>;
  };
  /** Present in the standalone workstation, where the page cannot reach the
   *  network itself and every request is made by the main process. */
  workspace?: {
    text(path: string): Promise<{ ok: boolean; text?: string; status?: number; message?: string }>;
  };
}

/** The bridge, or null in a browser. Never throws — callers branch on null. */
export function desktop(): Bridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as any).preckon;
  return b?.isDesktop ? (b as Bridge) : null;
}

export const isDesktop = () => desktop() !== null;

/**
 * Fetch something once and keep it on this machine for good.
 *
 * Only safe because of what it is used for: a drawing's bytes never change —
 * a revised drawing is a new upload with a new id — so a key naming the file
 * and its render names one exact payload forever. Nothing that can change
 * belongs in here.
 *
 * In a browser this is just the fetch, and the HTTP cache does what it can.
 */
export async function cachedText(key: string, url: string): Promise<string> {
  const d = desktop();
  if (d) {
    const hit = await d.cache.get(key).catch(() => null);
    if (hit != null) return hit;
  }
  /* Two ways to ask, and the difference is not cosmetic.
     In a browser this is an ordinary fetch. In the standalone workstation the
     page is served from app:// with a CSP that forbids reaching the network at
     all, so a fetch here resolves against the app's own origin and 404s — the
     drawing then reports itself as "could not be opened for editing", which is
     a lie about the drawing. There, the main process makes the request. */
  let text: string;
  if (d?.workspace?.text) {
    // Called on its object, not detached: the bridge is a plain object across
    // contextBridge and there is no reason to risk how a stray `this` behaves.
    const res = await d.workspace.text(url);
    if (!res.ok) throw new Error(res.message ?? String(res.status ?? "request failed"));
    text = res.text ?? "";
  } else {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  }
  // Stored after the fact and never awaited for correctness: a cache that
  // would not write is a slower app, not a broken one.
  if (d) void d.cache.set(key, text).catch(() => { /* out of disk, most likely */ });
  return text;
}

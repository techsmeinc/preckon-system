"use client";
// White-labelling (§7). The whole accent is one CSS variable, --brand: every
// primary button, active nav item, chain node, progress bar and Gantt critical
// bar reads it. Admin → Branding rewrites it live.
//
// Persistence note: in production this value is provisioned in the Host console
// and injected per tenant from `tenant_theme`. There is no tenant_theme column
// in this plane's schema yet, so the console stores the operator's choice
// locally and the Branding screen says so plainly.

export const BRAND_DEFAULT = "#15C2A8";
const KEY = "preckon-brand";

export const BRAND_SWATCHES = ["#15C2A8", "#3B82F6", "#6366F1", "#10B981", "#F5A524", "#EC4899"];

export function readBrand(): string {
  if (typeof window === "undefined") return BRAND_DEFAULT;
  try {
    return localStorage.getItem(KEY) || BRAND_DEFAULT;
  } catch {
    return BRAND_DEFAULT;
  }
}

export function applyBrand(hex: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--brand", hex);
}

export function saveBrand(hex: string): void {
  applyBrand(hex);
  try {
    localStorage.setItem(KEY, hex);
  } catch {
    /* private mode — the accent still applies for this session */
  }
}

export function resetBrand(): void {
  saveBrand(BRAND_DEFAULT);
}

/* ── Local-only preferences (theme, notification toggles, estimate mark-ups) ──
   Each is per-user chrome, not tenant data — kept out of the audited store on
   purpose. Anything that must survive a device change belongs in the API. */

export function readPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(`preckon-${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`preckon-${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

"use client";
// Localization: English, Arabic (RTL) and French.
//
// Two levels, resolved in order: the person's own choice → the workspace default
// (set by an admin, stored in tenant_setting.theme) → English. So a new user in
// an Arabic workspace gets Arabic, and can still switch to French for themselves.
//
// Everything user-facing goes through `t`. Numbers, money and dates go through
// the formatters here so they follow the locale too — an app that translates its
// labels but formats "1,240.50" the English way in French is only half-localized.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type Dict, type Key } from "./en";
import { ar } from "./ar";
import { fr } from "./fr";

export type Locale = "en" | "ar" | "fr";
export type Dir = "ltr" | "rtl";

export interface LocaleMeta {
  code: Locale;
  /** The language's name in its own language — how a picker should list it. */
  native: string;
  /** The name in English, for admin copy. */
  english: string;
  dir: Dir;
  /** BCP-47 tag handed to Intl. */
  intl: string;
}

export const LOCALES: LocaleMeta[] = [
  { code: "en", native: "English", english: "English", dir: "ltr", intl: "en" },
  { code: "ar", native: "العربية", english: "Arabic", dir: "rtl", intl: "ar" },
  { code: "fr", native: "Français", english: "French", dir: "ltr", intl: "fr" },
];

const DICTS: Record<Locale, Dict> = { en, ar, fr };

export const isLocale = (v: unknown): v is Locale => v === "en" || v === "ar" || v === "fr";
export const localeMeta = (l: Locale): LocaleMeta => LOCALES.find((x) => x.code === l) ?? LOCALES[0];
export const dirOf = (l: Locale): Dir => localeMeta(l).dir;

/* ── formatting ───────────────────────────────────────────────────────────
   Pure helpers elsewhere (money, qty, timeAgo in lib/chain) can't call a hook,
   so the provider publishes the active locale here for them to read. */

let activeLocale: Locale = "en";
export function setFormattingLocale(l: Locale): void { activeLocale = l; }
export function getFormattingLocale(): Locale { return activeLocale; }

/**
 * Arabic keeps Western digits. Arabic-Indic numerals (٠١٢٣) are correct
 * typographically, but a bill of quantities is read against drawings, rate books
 * and exports that all use Western digits — mixing the two invites transcription
 * errors on numbers that end up in a submitted price.
 */
export function intlTag(l: Locale = activeLocale): string {
  return l === "ar" ? "ar-u-nu-latn" : localeMeta(l).intl;
}

export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions, l?: Locale): string {
  return new Intl.NumberFormat(intlTag(l), opts).format(n);
}

export function fmtDateLocal(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions, l?: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat(intlTag(l), opts).format(d);
}

/* ── interpolation + plurals ──────────────────────────────────────────────
   A string may carry plural forms separated by "|", ordered by CLDR category.
   Two forms mean one|other; six mean zero|one|two|few|many|other (Arabic). */

const PLURAL_2 = ["one", "other"] as const;
const PLURAL_6 = ["zero", "one", "two", "few", "many", "other"] as const;

function pickPlural(raw: string, n: number, locale: Locale): string {
  const parts = raw.split("|");
  if (parts.length < 2) return raw;
  const order = parts.length >= 6 ? PLURAL_6 : PLURAL_2;
  const cat = new Intl.PluralRules(localeMeta(locale).intl).select(n);
  const idx = order.indexOf(cat as any);
  return parts[idx >= 0 && idx < parts.length ? idx : parts.length - 1];
}

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: Key, vars?: Vars): string {
  // Fall back to English for a key a locale hasn't translated yet, so a gap
  // shows up as English rather than a raw key in front of a customer.
  const raw = DICTS[locale][key] ?? en[key] ?? key;
  const n = vars && typeof vars.n === "number" ? vars.n : undefined;
  let out = n === undefined ? raw : pickPlural(raw, n, locale);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, typeof v === "number" ? fmtNumber(v, undefined, locale) : String(v));
    }
  }
  return out;
}

/* ── context ──────────────────────────────────────────────────────────────── */

export interface I18n {
  locale: Locale;
  dir: Dir;
  /** The workspace default, before this person's override. */
  tenantLocale: Locale;
  /** null when the person is following the workspace default. */
  userLocale: Locale | null;
  t: (key: Key, vars?: Vars) => string;
  setUserLocale: (l: Locale | null) => void;
}

const I18nCtx = createContext<I18n>({
  locale: "en", dir: "ltr", tenantLocale: "en", userLocale: null,
  t: (k) => en[k] ?? k,
  setUserLocale: () => {},
});

export function useI18n(): I18n { return useContext(I18nCtx); }
/** The common case — just the translate function. */
export function useT(): (key: Key, vars?: Vars) => string { return useContext(I18nCtx).t; }

const USER_KEY = "preckon-locale";

export function readUserLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(USER_KEY);
    return isLocale(v) ? v : null;
  } catch { return null; }
}

export function I18nProvider({ tenantLocale = "en", children }: { tenantLocale?: Locale; children: ReactNode }) {
  const [userLocale, setUser] = useState<Locale | null>(null);

  useEffect(() => { setUser(readUserLocale()); }, []);

  const locale: Locale = userLocale ?? tenantLocale;
  const dir = dirOf(locale);

  // The document element carries lang + dir: `dir` drives every logical CSS
  // property in globals.css, and `lang` gets the right font shaping and
  // hyphenation from the browser.
  useEffect(() => {
    setFormattingLocale(locale);
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("dir", dir);
  }, [locale, dir]);

  const setUserLocale = useCallback((l: Locale | null) => {
    setUser(l);
    try {
      if (l) localStorage.setItem(USER_KEY, l);
      else localStorage.removeItem(USER_KEY);
    } catch { /* private mode — applies for this session only */ }
  }, []);

  const value = useMemo<I18n>(() => ({
    locale,
    dir,
    tenantLocale,
    userLocale,
    t: (key: Key, vars?: Vars) => translate(locale, key, vars),
    setUserLocale,
  }), [locale, dir, tenantLocale, userLocale, setUserLocale]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export type { Key };

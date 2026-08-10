// English, read from the workspace's own dictionary.
//
// Deliberately NOT a copy of the strings. The real `en.ts` is imported, so
// every label in this app is the label the web app uses and renaming a button
// in one renames it in both. A second dictionary would be two dictionaries
// within a week.
//
// Arabic and French are left out on purpose: they exist in the workspace, this
// build has no language switcher, and shipping two unreachable dictionaries in
// an installer is weight for nothing. Adding them later is an import.

import { en } from "@tenant/lib/i18n/en";

type Vars = Record<string, string | number>;

/** {name} → the value. Same substitution the workspace does. */
function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in vars ? String(vars[key]) : whole
  );
}

const dict = en as unknown as Record<string, string>;

/** Falls back to the key itself, which is a readable failure: a missing string
 *  shows up as "cad.redraw" on screen rather than as a blank button. */
export function t(key: string, vars?: Vars): string {
  const s = dict[key];
  return s === undefined ? key : format(s, vars);
}

export interface I18n {
  t: (key: string, vars?: Vars) => string;
  locale: "en";
  dir: "ltr";
  setLocale: (l: string) => void;
}

export const useI18n = (): I18n => ({ t, locale: "en", dir: "ltr", setLocale: () => {} });
export const useT = () => t;
export type Key = string;

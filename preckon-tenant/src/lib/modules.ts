import { ALL_PACKS } from "./pack/registry";

// Module display is DOMAIN-DRIVEN: every module comes from a pack's `modules`
// declaration (§D), not a hardcoded map. Adding a domain automatically adds its
// modules to the catalog. In the full two-plane system this metadata lives in
// the Host product catalog; here we resolve it from the compiled-in packs.
export interface ModuleDisplay {
  key: string;
  label: string;
  icon: string;
  order: number;
}

export const MODULE_DISPLAY: ModuleDisplay[] = ALL_PACKS.flatMap((p: any) => p.modules ?? [])
  .map((m: any) => ({ key: m.key, label: m.label, icon: m.icon, order: m.order }))
  .sort((a, b) => a.order - b.order);

export const moduleDisplay = (key: string): ModuleDisplay =>
  MODULE_DISPLAY.find((m) => m.key === key) ?? { key, label: key, icon: "help-circle", order: 999 };

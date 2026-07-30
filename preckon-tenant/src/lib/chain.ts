"use client";
// The chain — the spine of the tenant app. A project's tab bar *is* the
// preconstruction chain, and every stage's state is derived from real data:
// the artifacts each module produced and the runs that are producing them.
//
// Stages come from the tenant's LICENSED modules (§8 entitlements), never a
// hardcoded list — an edition without CostLogix simply has no Estimate stage.

import { MODULE_OUTPUTS } from "./catalog";
import { fmtNumber, getFormattingLocale, translate } from "./i18n";

export type ChainStatus = "pending" | "processing" | "review" | "done";

export interface LicensedModule {
  key: string;
  label: string;
  icon?: string;
  order: number;
  description?: string;
}

export interface ChainStage {
  key: string;            // module key, e.g. "quantlogix"
  label: string;          // chain label for the tab bar, e.g. "BOQ"
  full: string;           // product name, e.g. "QuantLogix"
  order: number;
  outputs: string[];      // artifact types this stage produces
  status: ChainStatus;
  pending: number;        // proposals awaiting a human
  confirmed: number;
  total: number;
}

/** Chain label (what the estimator calls the stage) per module key. */
export const STAGE_LABEL: Record<string, string> = {
  tenderlogix: "Tender",
  drawlogix: "Drawings",
  doclogix: "Specs",
  quantlogix: "BOQ",
  costlogix: "Estimate",
  schedulelogix: "Schedule",
  procurelogix: "Procurement",
  underwriting: "Underwriting",
};

/** Icon key (see lib/icons) per chain stage. */
export const STAGE_ICON: Record<string, string> = {
  tenderlogix: "tender",
  drawlogix: "drawings",
  doclogix: "specs",
  quantlogix: "boq",
  costlogix: "estimate",
  schedulelogix: "schedule",
  procurelogix: "procurement",
};

/** Which module produces a given artifact type — routes a review to its surface. */
export function moduleForType(type: string): string | null {
  const t = type.split(".").pop() ?? type;
  for (const [mod, outs] of Object.entries(MODULE_OUTPUTS)) {
    if (outs.some((o) => (o.split(".").pop() ?? o) === t)) return mod;
  }
  return null;
}

/** The order the chain actually runs in, regardless of catalog ordering. */
const CHAIN_ORDER: Record<string, number> = {
  tenderlogix: 1, drawlogix: 2, doclogix: 3, quantlogix: 4,
  costlogix: 5, schedulelogix: 6, procurelogix: 7,
};

const short = (t: string) => t.split(".").pop() ?? t;

/** Artifacts of a stage's output types (namespace-tolerant), newest first. */
export function stageArtifacts(artifacts: any[], outputs: string[]): any[] {
  const want = new Set(outputs.map(short));
  return artifacts.filter((a) => want.has(short(a.type_key)));
}

/**
 * Derive every chain stage's state from the project's artifacts and runs.
 * pending proposals win over confirmed output — an estimator's attention is
 * the scarce resource, so "needs review" is the loudest state a stage can have.
 */
export function buildChain(
  modules: LicensedModule[],
  artifacts: any[],
  runs: any[],
  workflows: { key: string; moduleKey: string }[]
): ChainStage[] {
  const running = new Set(
    runs
      .filter((r) => r.status === "running" || r.status === "awaiting_review")
      .map((r) => workflows.find((w) => w.key === r.workflow_key)?.moduleKey)
      .filter(Boolean) as string[]
  );

  return modules
    .map((m) => {
      const outputs = MODULE_OUTPUTS[m.key] ?? [];
      const rows = stageArtifacts(artifacts, outputs).filter((a) => a.status !== "superseded");
      const pending = rows.filter((a) => a.status === "pending" || a.status === "stale").length;
      const confirmed = rows.filter((a) => a.status === "confirmed").length;
      const status: ChainStatus =
        pending > 0 ? "review"
        : running.has(m.key) ? "processing"
        : confirmed > 0 ? "done"
        : "pending";
      return {
        key: m.key,
        label: STAGE_LABEL[m.key] ?? m.label,
        full: m.label,
        order: CHAIN_ORDER[m.key] ?? m.order ?? 999,
        outputs,
        status,
        pending,
        confirmed,
        total: rows.length,
      };
    })
    .sort((a, b) => a.order - b.order);
}

export const STATUS_LABEL: Record<ChainStatus, string> = {
  done: "Complete",
  review: "Needs review",
  processing: "Processing",
  pending: "Pending",
};

/** Chain progress as a percentage — completed stages over licensed stages. */
export function chainProgress(stages: ChainStage[]): number {
  if (stages.length === 0) return 0;
  const scored = stages.reduce(
    (n, s) => n + (s.status === "done" ? 1 : s.status === "review" ? 0.7 : s.status === "processing" ? 0.4 : 0),
    0
  );
  return Math.round((scored / stages.length) * 100);
}

/** The furthest stage the project has actually reached, for the list view. */
export function currentStage(stages: ChainStage[]): ChainStage | null {
  return (
    stages.find((s) => s.status === "review") ??
    stages.find((s) => s.status === "processing") ??
    [...stages].reverse().find((s) => s.status === "done") ??
    stages[0] ??
    null
  );
}

/* ── Formatting — every number in the product is mono and formatted here ────
   These are pure functions called from render paths that can't hold a hook, so
   they read the active locale the I18nProvider publishes (see lib/i18n). */

/** Money from integer minor units (§X). */
export function money(minor: number | null | undefined, ccy?: string | null): string {
  if (minor == null || Number.isNaN(Number(minor))) return "—";
  const v = Number(minor) / 100;
  return (ccy ? ccy + " " : "") + fmtNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact money for KPI tiles: CAD 2.4M. */
export function moneyShort(minor: number | null | undefined, ccy?: string | null): string {
  if (minor == null) return "—";
  const v = Number(minor) / 100;
  const a = Math.abs(v);
  const s = a >= 1e9 ? fmtNumber(v / 1e9, { maximumFractionDigits: 1 }) + "B"
    : a >= 1e6 ? fmtNumber(v / 1e6, { maximumFractionDigits: 1 }) + "M"
    : a >= 1e3 ? fmtNumber(v / 1e3, { maximumFractionDigits: 0 }) + "k"
    : fmtNumber(v, { maximumFractionDigits: 0 });
  return (ccy ? ccy + " " : "") + s;
}

export function qty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return fmtNumber(Number(n), { maximumFractionDigits: 2 });
}

/** Confidence as a percent, or null when the agent didn't report one. */
export function confPct(c: number | null | undefined): number | null {
  if (c == null) return null;
  const n = Number(c);
  return Number.isNaN(n) ? null : Math.round(n * 100);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const l = getFormattingLocale();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return translate(l, "time.justNow");
  if (s < 3600) return translate(l, "time.minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return translate(l, "time.hours", { n: Math.floor(s / 3600) });
  if (s < 172800) return translate(l, "time.yesterday");
  return translate(l, "time.days", { n: Math.floor(s / 86400) });
}

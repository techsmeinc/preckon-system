/**
 * BOQ Exemplar Library — few-shot grounding for the multi-agent pipeline.
 *
 * Each JSON file in this folder is a historical (SOW, priced BOQ) pair the
 * QS team produced, parsed into the AIGCC 4-level hierarchy:
 *   sowRef  → matches the SOW chapter (e.g. "2.4")
 *   ourRef  → our internal numbering (e.g. "4")
 *   subRef  → sub-section under ourRef (e.g. "4.1")
 *   srNo    → individual line item (e.g. "4.1.1")
 *
 * The exemplars are statically imported via data.ts so esbuild bundles them
 * into dist/index.mjs — no separate copy step is needed at build time.
 */
import { EXEMPLARS } from "./data";

export interface ExemplarItem {
  sowRef: string | null;
  ourRef: string | null;
  subRef: string | null;
  srNo: string | null;
  description: string | null;
  unit: string | null;
  quantity: number | null;
}

export interface ExemplarSection {
  sowRef: string | null;
  ourRef: string | null;
  subRef: string | null;
  srNo: string | null;
  title: string | null;
  items: ExemplarItem[];
  subtotalLabel: string | null;
}

export interface SowOutlineNode {
  ref: string;
  title: string;
}

export interface BoqExemplar {
  slug: string;
  source: { sowPdf?: string; sowDocx?: string; boq: string };
  meta: {
    refNo?: string;
    projectNumber?: string;
    projectName?: string;
    projectLocation?: string;
    submissionDate?: string;
    submittedTo?: string;
  };
  units: Record<string, number>;
  sowOutline: SowOutlineNode[];
  sections: ExemplarSection[];
  totals: { flatItemCount: number };
}

export function loadExemplars(): BoqExemplar[] {
  return EXEMPLARS;
}

/**
 * Score an exemplar against a target project context using simple keyword
 * overlap on (a) the project name + SOW outline titles and (b) the exemplar's
 * section titles + item descriptions. Higher = more relevant.
 *
 * Embeddings would be more precise, but keyword overlap is enough to pick
 * between 3–10 exemplars and avoids a round-trip on every BOQ generation.
 */
const STOP = new Set([
  "and", "the", "with", "for", "from", "into", "this", "that", "are", "was",
  "shall", "will", "all", "any", "per", "type", "supply", "installation",
  "supplied", "install", "including", "include", "kwait", "kuwait", "site",
  "project", "design", "drawings", "submittal", "submittals", "contractor",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP.has(t))
  );
}

export function scoreExemplar(target: string, exemplar: BoqExemplar): number {
  const t = tokens(target);
  if (t.size === 0) return 0;
  const haystack: string[] = [
    exemplar.meta.projectName ?? "",
    exemplar.meta.projectLocation ?? "",
    ...exemplar.sowOutline.map(o => o.title),
    ...exemplar.sections.map(s => s.title ?? ""),
    ...exemplar.sections.flatMap(s => s.items.map(i => i.description ?? "")).slice(0, 80),
  ];
  const h = tokens(haystack.join(" "));
  if (h.size === 0) return 0;
  let shared = 0;
  for (const w of t) if (h.has(w)) shared++;
  // Normalize by target size — exemplars don't get penalised for being long.
  return shared / Math.min(t.size, 60);
}

export interface PickExemplarsOptions {
  target: string;
  topK?: number;
  // If true, the best exemplar is always included even if score is 0 (so the
  // model still sees the AIGCC house-style formatting).
  alwaysIncludeFallback?: boolean;
}

export function pickExemplars(opts: PickExemplarsOptions): BoqExemplar[] {
  const lib = loadExemplars();
  if (lib.length === 0) return [];
  const topK = opts.topK ?? 1;
  const scored = lib
    .map(e => ({ e, s: scoreExemplar(opts.target, e) }))
    .sort((a, b) => b.s - a.s);
  const picked = scored.slice(0, topK).map(x => x.e);
  if (picked.length === 0 && opts.alwaysIncludeFallback !== false) {
    // No keyword match — return the smallest exemplar (cheaper to inject)
    return [lib.slice().sort((a, b) => a.totals.flatItemCount - b.totals.flatItemCount)[0]];
  }
  return picked;
}

/**
 * Render one exemplar into a compact text block that fits in ~1.5k tokens.
 * Used inside agent system/user prompts as a few-shot example.
 */
export function formatExemplarForPrompt(ex: BoqExemplar, opts?: { maxItemsPerSection?: number; maxSections?: number }): string {
  const maxItemsPerSection = opts?.maxItemsPerSection ?? 5;
  const maxSections = opts?.maxSections ?? 12;
  const lines: string[] = [];
  lines.push(`### EXEMPLAR: ${ex.meta.projectName ?? ex.slug}`);
  if (ex.meta.projectNumber) lines.push(`Project Number: ${ex.meta.projectNumber}`);
  if (ex.meta.projectLocation) lines.push(`Location: ${ex.meta.projectLocation}`);
  if (ex.meta.refNo) lines.push(`Quotation Ref: ${ex.meta.refNo}`);
  lines.push("");
  lines.push("SOW chapter→BOQ section mapping (the priced BOQ mirrors the SOW outline):");
  for (const sec of ex.sections.slice(0, maxSections)) {
    if (!sec.title) continue;
    const refBits = [sec.sowRef && `sowRef=${sec.sowRef}`, sec.ourRef && `ourRef=${sec.ourRef}`, sec.subRef && `subRef=${sec.subRef}`, sec.srNo && `srNo=${sec.srNo}`]
      .filter(Boolean)
      .join(" ");
    lines.push(`• [${refBits}] ${sec.title}`);
    for (const it of sec.items.slice(0, maxItemsPerSection)) {
      if (!it.description) continue;
      const qty = it.quantity ?? "";
      const unit = it.unit ?? "";
      const srNo = it.srNo ?? "";
      lines.push(`    - srNo=${srNo} unit=${unit} qty=${qty} :: ${it.description}`);
    }
    if (sec.subtotalLabel) lines.push(`    (subtotal: "${sec.subtotalLabel}")`);
  }
  if (ex.sections.length > maxSections) {
    lines.push(`  … (${ex.sections.length - maxSections} more sections in the source)`);
  }
  const topUnits = Object.entries(ex.units).sort((a, b) => b[1] - a[1]).slice(0, 8);
  lines.push("");
  lines.push(`Units used in this exemplar: ${topUnits.map(([u, n]) => `${u}(${n})`).join(", ")}`);
  return lines.join("\n");
}

/**
 * High-level helper for agents: pick the most relevant exemplar(s) for a
 * project and return a single formatted block suitable for prompt injection.
 */
export function buildFewShotBlock(target: string, opts?: { topK?: number }): string {
  const picked = pickExemplars({ target, topK: opts?.topK ?? 1 });
  if (picked.length === 0) return "";
  const blocks = picked.map(e => formatExemplarForPrompt(e));
  return [
    "## REFERENCE EXEMPLARS (AIGCC house-style priced BOQs from past projects)",
    "Use these to learn the layout, description style, hierarchy numbering, and subtotal pattern. Do not copy quantities or descriptions verbatim — adapt to the current project's drawings and SOW. NOTE: ignore the older unit spellings in these exemplars (Nos, m2, m3, LM, Mtrs) — follow the 8 standard unit tokens defined in your output rules instead.",
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n");
}

/**
 * Returns the canonical list of units the AIGCC team uses across all
 * exemplars. The pipeline accepts these in addition to the original
 * generic vocabulary.
 */
export function getCanonicalUnits(): string[] {
  const counts = new Map<string, number>();
  for (const ex of loadExemplars()) {
    for (const [u, n] of Object.entries(ex.units)) {
      counts.set(u, (counts.get(u) ?? 0) + n);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([u]) => u);
}

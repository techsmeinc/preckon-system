/**
 * exemplars — few-shot priced-BOQ examples, injected into the section prompts.
 *
 * Ported from AutoCAD-BOQ-Tender/artifacts/api-server/src/lib/boq-examples.
 *
 * WHAT THIS BUYS. A model asked for "a bill of quantities" writes something
 * bill-shaped: plausible descriptions, plausible hierarchy, no house style. An
 * estimator reading it can tell within three lines that no estimator wrote it.
 * Showing one real past bill fixes the things a rules list cannot express —
 * how much detail belongs in a description, where the subtotals fall, how
 * sections are numbered, what a preliminaries line actually says.
 *
 * WHOSE BILLS THESE ARE. The bundled exemplars are AIGCC projects carried over
 * with the pipeline. They teach layout, not prices, and the prompt says so —
 * but house style should be the tenant's OWN. Replace the JSON in
 * ./boq-examples with this contractor's past bills when you have them; the
 * loader picks up whatever is in the directory, so it is a file swap and no
 * code change. Until then the model is learning a competitor's conventions.
 *
 * Read from disk rather than imported: the worker runs Node 20, where JSON
 * import attributes are still experimental, and a flag that silently changes
 * between base images is not worth the elegance.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "boq-examples");

let CACHE = null;

function loadExemplars() {
  if (CACHE) return CACHE;
  CACHE = [];
  try {
    for (const name of fs.readdirSync(DIR)) {
      if (!name.endsWith(".json") || name === "manifest.json") continue;
      try {
        const ex = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
        if (ex?.sections?.length) CACHE.push(ex);
      } catch {
        // A malformed exemplar must not take the bill down with it. Losing a
        // style reference costs polish; throwing here costs the whole run.
      }
    }
  } catch {
    CACHE = [];
  }
  return CACHE;
}

const words = (s) =>
  new Set(
    String(s ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
  );

/** Keyword overlap, normalised by target size so long exemplars aren't favoured. */
function scoreExemplar(target, ex) {
  const t = words(target);
  if (!t.size) return 0;
  const h = words(
    [ex.meta?.projectName, ex.meta?.projectLocation, ...(ex.sections ?? []).map((s) => s.title)].join(" ")
  );
  let shared = 0;
  for (const w of t) if (h.has(w)) shared++;
  return shared / Math.min(t.size, 60);
}

function pickExemplars(target, topK = 1) {
  const lib = loadExemplars();
  if (!lib.length) return [];
  const scored = lib.map((e) => ({ e, s: scoreExemplar(target, e) })).sort((a, b) => b.s - a.s);
  if (scored[0].s === 0) {
    // Nothing matched. Still show one — the point is house style, not subject
    // matter — but the smallest, since it is the cheapest to carry.
    return [lib.slice().sort((a, b) => (a.totals?.flatItemCount ?? 0) - (b.totals?.flatItemCount ?? 0))[0]];
  }
  return scored.slice(0, topK).map((x) => x.e);
}

function formatExemplarForPrompt(ex, { maxItemsPerSection = 5, maxSections = 12 } = {}) {
  const out = [`### EXEMPLAR: ${ex.meta?.projectName ?? ex.slug}`];
  if (ex.meta?.projectLocation) out.push(`Location: ${ex.meta.projectLocation}`);
  out.push("", "Section → item shape (the priced bill mirrors the scope outline):");
  for (const sec of (ex.sections ?? []).slice(0, maxSections)) {
    if (!sec.title) continue;
    out.push(`• ${sec.title}`);
    for (const it of (sec.items ?? []).slice(0, maxItemsPerSection)) {
      if (!it.description) continue;
      out.push(`    - unit=${it.unit ?? ""} qty=${it.quantity ?? ""} :: ${it.description}`);
    }
    if (sec.subtotalLabel) out.push(`    (subtotal: "${sec.subtotalLabel}")`);
  }
  if ((ex.sections ?? []).length > maxSections) {
    out.push(`  … (${ex.sections.length - maxSections} more sections in the source)`);
  }
  return out.join("\n");
}

/**
 * One formatted block for prompt injection, or "" when there are no exemplars.
 *
 * @param target Free text describing this project — name, scope, division.
 */
export function buildFewShotBlock(target, { topK = 1 } = {}) {
  const picked = pickExemplars(target, topK);
  if (!picked.length) return "";
  return [
    "## REFERENCE EXEMPLAR (a real priced bill, for STYLE only)",
    "Learn the layout, description depth, section ordering and subtotal pattern from this. Do NOT copy its quantities, descriptions or scope — they belong to a different project and reusing them is how a bill ends up pricing work nobody asked for. The unit spellings here are older (Nos, m2, LM); use the standard tokens from your output rules instead.",
    "",
    picked.map((e) => formatExemplarForPrompt(e)).join("\n\n---\n\n"),
  ].join("\n");
}

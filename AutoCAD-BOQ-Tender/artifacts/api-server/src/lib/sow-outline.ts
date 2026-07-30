/**
 * SOW Outline Extractor.
 *
 * Reads the project's SOW/RFP documents and asks the LLM to produce the
 * numbered task tree that the AIGCC priced BOQ mirrors. Output is a
 * structured outline the multi-agent pipeline iterates over: one section
 * agent per top-level node, each emitting BOQ items tagged with the
 * section's sowRef/ourRef/subRef/srNo.
 *
 * This is the central piece that lets the BOQ structure follow the SOW
 * instead of being locked to seven fixed disciplines. Discipline knowledge
 * still feeds in via the completeness verifier downstream.
 */
import { extractJSON, type AIClient } from "./ai-provider";
import { buildFewShotBlock, loadExemplars } from "./boq-examples";

export interface SowSectionNode {
  /** Matches the SOW chapter numbering exactly, e.g. "2.1", "2.4", "2.4.3". */
  sowRef: string;
  /** Our internal sequential numbering for this section in the BOQ ("1", "2", "3"...). */
  ourRef: string;
  /** Section heading, e.g. "Perform Mobilization and Demobilization". */
  title: string;
  /**
   * The QS team's note on how this section is measured/paid: usually "LS" for
   * lump-sum items, "BoQ" for quantified items, or a measurement basis like
   * "per m3 of excavation". The section agent uses this to decide whether to
   * produce a single LS line or many quantified lines.
   */
  measurementBasis: string;
  /**
   * Free-text guidance for the section agent — what the SOW says this section
   * covers, key dimensions, equipment, materials, references to other docs.
   * This is what the agent grounds its quantity decisions in.
   */
  scopeNotes: string;
  /**
   * Disciplines whose knowledge is relevant when costing this section. Drives
   * which CAD layers/blocks the section agent prioritises and which exemplar
   * items it should imitate.
   */
  disciplines: string[];
  /**
   * Optional nested sub-sections (e.g. "4.1 Demolition", "4.2 New Manhole"
   * under section "2.4 Upgrade Existing System"). When present, the section
   * agent should produce sub-grouped items with these as subRef anchors.
   */
  subsections?: SowSectionNode[];
}

export interface SowOutline {
  /** All top-level sections (chapter-2 in USAF SOW templates, chapter-1 etc. elsewhere). */
  sections: SowSectionNode[];
  /** Free-text summary of project scope the LLM extracted — used as preamble. */
  projectScope: string;
  /** True if the extractor had to fall back on a generic outline because the SOW text was too thin. */
  isFallback: boolean;
}

const SOW_OUTLINE_SCHEMA = `Return ONLY a raw JSON object. No markdown fences, no commentary.

You are designing the scope-area breakdown for a priced Bill of Quantities. The breakdown is DRIVEN BY WHAT THE UPLOADED DOCUMENTS ACTUALLY SAY — not by any house template. There is no fixed list of sections, no fixed disciplines, no required preamble. You invent the structure from what you read.

Strict shape:
{
  "projectScope": "2-3 sentence factual description of what this project actually is, grounded in the uploaded documents.",
  "sections": [
    {
      "sowRef": "<a stable identifier for this scope area — use the document's own numbering if it has one (e.g. '2.4', 'Section 5', 'Lot 3', 'Phase A'), OR a sequential '1','2','3' if the documents have no numbering>",
      "ourRef": "<sequential 1-based number across top-level sections>",
      "title": "<the scope-area heading INVENTED for this project, e.g. 'Demolition of existing morgue ventilation system' or 'Supply and installation of new extraction fans'. NOT a generic template heading.>",
      "measurementBasis": "<short — 'LS', 'm3', 'Nos', 'LM', 'sq.m', or a brief phrase>",
      "scopeNotes": "<what this scope area covers per the actual documents — quote phrasing where useful>",
      "disciplines": ["<discipline tags inferred from the actual scope — invent them, don't pick from a list>"],
      "subsections": [
        { "sowRef": "...", "ourRef": "...", "title": "...", "measurementBasis": "...", "scopeNotes": "...", "disciplines": [...], "subsections": [] }
      ]
    }
  ]
}

HARD RULES:
  • Section titles are INVENTED FROM THE DOCUMENTS. Do NOT default to "Site Survey", "100% Design Drawings", "Mobilization", "As-Built", "DD Form 1354" unless the actual documents explicitly require those deliverables. Those are USAF DoD conventions that do not apply to most projects.
  • If the documents do not contain numbered headings, do NOT invent USAF-style "2.1 / 2.2 / 2.3..." numbering. Use sequential "1", "2", "3" or the documents' own numbering scheme (Lot, Phase, Part, Chapter, etc.).
  • disciplines are FREE-FORM TAGS you invent based on what the scope actually needs — e.g. ["morgue ventilation", "stainless ductwork"] not ["mechanical"] if the project is a morgue retrofit.
  • Capture every distinct scope area in the documents. If the documents are thin (a notice, a redirection, a cover letter), produce ONE section titled what the documents say the project is, rather than fabricating a multi-section breakdown.
  • Do NOT invent scope areas the documents don't support. Do NOT pad with preamble.`;

export interface ExtractOutlineOpts {
  client: AIClient;
  model: string;
  /** Concatenated text of all SOW/RFP/specification docs, trimmed for token budget. */
  sowText: string;
  projectName: string;
  /** Full inventory of uploaded documents (one line each, name + type). Each drawing
   *  name usually reveals a discipline, so this drives division COMPLETENESS even
   *  when the concatenated text is truncated. */
  documentInventory?: string;
}

/**
 * Build the few-shot block from exemplar SOWs that have a similar layout to
 * the target. The exemplars' `sowOutline` and `sections` are the gold-standard
 * mappings the model is being asked to replicate.
 */
function buildOutlineFewShot(target: string): string {
  const exemplars = loadExemplars();
  if (exemplars.length === 0) return "";

  // Find up to 2 exemplars whose SOW outline is non-trivial (>= 3 sections).
  const rich = exemplars.filter(e => e.sowOutline.length >= 3).slice(0, 2);
  if (rich.length === 0) return "";

  const blocks = rich.map(e => {
    const outlineLines = e.sowOutline.slice(0, 25).map(o => `  ${o.ref} ${o.title}`).join("\n");
    const sectionLines = e.sections
      .filter(s => s.title && (s.sowRef || s.ourRef))
      .slice(0, 15)
      .map(s => `  sowRef=${s.sowRef ?? "-"} ourRef=${s.ourRef ?? "-"} :: ${s.title}`)
      .join("\n");
    return [
      `### EXEMPLAR: ${e.meta.projectName ?? e.slug}`,
      `SOW chapter headings (raw):`,
      outlineLines,
      ``,
      `Final priced-BOQ section anchors (what we want you to produce):`,
      sectionLines,
    ].join("\n");
  });

  void target;
  return [
    "## REFERENCE EXEMPLAR SOW→BOQ MAPPINGS",
    "Below are two past projects where we already produced the outline. Note how every chapter-2 sub-section in the SOW becomes one section in the priced BOQ, with sowRef preserved verbatim and ourRef as a fresh 1-based sequence.",
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n");
}

/**
 * Document-agnostic fallback. Used when the LLM extractor fails entirely.
 *
 * Tries TWO recovery paths, neither of which assumes USAF/AIGCC conventions:
 *   1. Loose numbered-heading regex (matches "1.2 Foo", "Section 3: Bar",
 *      "Lot 2 - Baz", "Phase A:", etc.) — extracts WHATEVER the document
 *      actually contains.
 *   2. If no headings exist, produces a SINGLE catch-all section titled
 *      "Whole-project pricing" so the downstream BOQ Builder still runs.
 *      No USAF template, no preamble assumption, no DD Form 1354.
 */
const GENERIC_HEADING_RE = /^\s*(?:(\d{1,2}(?:\.\d{1,2}){0,2})|(?:Section|Part|Lot|Phase|Chapter|Item)\s+([A-Z0-9]+)[:.\-]?)\s+([A-Z][^\n]{3,150})$/gm;

/**
 * A sane ceiling on TOP-LEVEL scope areas. Real priced BOQs have ~5–30 divisions;
 * a count far above this means the extractor over-segmented — the fallback regex
 * matching every numbered spec clause (seen: 289 "sections" from a spec-heavy doc),
 * or the LLM treating sub-items as top-level. Left unchecked, the pipeline tries to
 * run one agent per "division", stalls, and produces ZERO items. Clamp so it stays
 * feasible. (Sub-sections are unaffected — only the top-level count is capped.)
 */
const MAX_TOP_SECTIONS = 40;
function clampSections<T>(sections: T[]): T[] {
  return sections.length > MAX_TOP_SECTIONS ? sections.slice(0, MAX_TOP_SECTIONS) : sections;
}

export function fallbackOutline(sowText: string, projectName: string): SowOutline {
  const seen = new Set<string>();
  const sections: SowSectionNode[] = [];
  let ourIdx = 0;
  let m: RegExpExecArray | null;
  GENERIC_HEADING_RE.lastIndex = 0;
  while ((m = GENERIC_HEADING_RE.exec(sowText)) !== null) {
    const ref = (m[1] ?? m[2] ?? "").trim();
    const title = m[3]
      .replace(/\s*\.{2,}.*$/, "")  // strip dot leaders / page numbers
      .replace(/\s+\d+$/, "")
      .trim();
    if (!title || !ref) continue;
    const key = `${ref}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ourIdx++;
    sections.push({
      sowRef: ref,
      ourRef: String(ourIdx),
      title,
      measurementBasis: "TBD",
      scopeNotes: "(heuristic fallback — LLM outline extractor did not return structured data; title and ref taken from a regex match in the uploaded documents)",
      disciplines: [],
      subsections: [],
    });
  }
  if (sections.length === 0) {
    // No headings found at all — produce ONE catch-all section so the
    // downstream pipeline still has something to dispatch on. This is
    // INTENTIONALLY generic; we do NOT pretend this is a USAF DoD project.
    sections.push({
      sowRef: "1",
      ourRef: "1",
      title: "Whole-project pricing",
      measurementBasis: "mixed",
      scopeNotes:
        "(catch-all fallback — uploaded documents did not contain extractable scope-area headings; the BOQ Builder will price the project as a single unstructured scope)",
      disciplines: [],
      subsections: [],
    });
  }
  return {
    sections: clampSections(sections),
    projectScope: `"${projectName}" — outline extracted heuristically (LLM call did not return structured data).`,
    isFallback: true,
  };
}

const SYSTEM_PROMPT = `You are a Principal Quantity Surveyor reading the uploaded documents for ONE specific project and designing the scope-area breakdown that the priced BOQ will follow.

You DO NOT generate priced items here — only the outline.

CRITICAL: the structure must come FROM THE DOCUMENTS, not from any template.
  • If the documents are a USAF DoD SOW with "2.1 Site Survey / 2.2 Design / 2.3 Mobilization" sections, mirror that numbering. Use those titles.
  • If the documents are a UN/UNOPS/UNGM ITB ("ITB/2026/62859 Refurbishment of morgue extraction at Queen Elizabeth Hospital"), produce sections that match what THAT project needs to price: "Demolition of existing ventilation system", "New extraction fans (X count)", "Ductwork & supports", "Controls & electrical", "Commissioning", etc.
  • If the documents are a fit-out tender, produce fit-out sections.
  • If the documents are a road-paving tender, produce road-works sections.
  • If you have only a tender notice + a redirection letter and no real scope text, produce ONE section that reflects what the project IS, rather than fabricating six fake sections from a USAF template.

Section titles MUST be invented from what the documents say. Discipline tags MUST be invented (free-form, not from a fixed taxonomy). Numbering MUST follow the documents' own numbering — or sequential 1,2,3 if there isn't any.

NEVER emit "Site Survey", "100% Design Drawings", "Mobilization & De-mobilization", "As-Built Drawings", or "DD Form 1354" as section titles UNLESS those phrases appear in the uploaded documents.

${SOW_OUTLINE_SCHEMA}`;

export async function extractSowOutline(opts: ExtractOutlineOpts): Promise<SowOutline> {
  const { client, model, sowText, projectName } = opts;

  // Token budget — keep the document excerpt at ~6k chars so the schema and
  // response fit comfortably even on 8k-context models.
  //
  // NOTE: we intentionally do NOT include the few-shot USAF/AIGCC exemplars
  // here. Those exemplars are all USAF Department of Defense construction
  // projects, and including them biases the model into producing "2.1 Site
  // Survey / 2.2 Design / 2.3 Mobilization" structure even when the actual
  // uploaded documents have nothing to do with USAF conventions. The
  // structure must come from the documents themselves.
  void buildOutlineFewShot;
  // The old 6.5k-char cap meant a big project (e.g. 2.9M chars across 20+ drawings)
  // had its outline built from ~0.2% of the documents — so it saw only the cover
  // letter and produced 5 shallow scope areas, dropping most disciplines. Opus is a
  // 1M-context model; give the outline a real budget (env OUTLINE_MAX_CHARS, default
  // 200k chars ≈ 50k tokens) so it sees the breadth of the scope.
  const MAX_CHARS = Math.max(6500, Number(process.env.OUTLINE_MAX_CHARS) || 45_000);
  const sowExcerpt = sowText.length > MAX_CHARS
    ? `${sowText.slice(0, MAX_CHARS)}\n[... truncated, ${sowText.length} chars total ...]`
    : sowText;

  // The document INVENTORY is the strongest completeness signal — each drawing name
  // names a discipline (fire protection, irrigation, stormwater, sanitary, water
  // supply, structural, MEP, security, …). List it and require a scope area per
  // distinct system, so divisions aren't lost even where the text is truncated.
  const inventoryBlock = opts.documentInventory?.trim()
    ? `## FULL UPLOADED DOCUMENT SET (every drawing + document for this project)
${opts.documentInventory}

Produce a scope area for EACH distinct engineering system / discipline represented above — e.g. separate areas for structural, architecture, MEP, fire protection, water supply, sanitary/foul drainage, stormwater, irrigation, grey water, external/site works, electrical & cabling, security, car-park lighting, marine works, etc. A multi-drawing civil + MEP project like this typically has 10–25 scope areas. Do NOT collapse many disciplines into a handful of generic areas; only merge two if the documents genuinely treat them as one.

`
    : "";

  const userPrompt = `Project name: "${projectName}"

${inventoryBlock}## UPLOADED PROJECT DOCUMENTS (concatenated text — may be truncated)
${sowExcerpt}

Read the documents + the full document set above and design the scope-area outline for THIS specific project. Use the documents' own numbering and terminology. Do not impose any house template. Produce a scope area for EVERY distinct discipline/system present — COMPLETENESS matters more than brevity.`;

  try {
    const response = await client.chat.completions.create({
      model,
      // Outline is bounded — typically 4-15 sections × ~250 tokens each.
      // 5000 tokens is comfortably above what any well-formed outline
      // consumes. Without this cap, providers pre-reserve the model's
      // full output budget against your credit balance, which is what
      // crashed the Butler City Park verifier with a 402 error mid-run.
      max_tokens: Math.max(5000, Number(process.env.OUTLINE_MAX_TOKENS) || 8000),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(extractJSON(raw)) as Partial<SowOutline>;
    if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      return fallbackOutline(sowText, projectName);
    }
    // Normalise: ensure required string fields exist, drop malformed nodes.
    const rawSections = (parsed.sections as Partial<SowSectionNode>[])
      .filter(s => !!(s && typeof s.sowRef === "string" && typeof s.title === "string"));
    const sections: SowSectionNode[] = rawSections
      .map((s, idx) => ({
        sowRef: s.sowRef as string,
        ourRef: typeof s.ourRef === "string" && s.ourRef.trim() ? s.ourRef : String(idx + 1),
        title: s.title as string,
        measurementBasis: typeof s.measurementBasis === "string" ? s.measurementBasis : "TBD",
        scopeNotes: typeof s.scopeNotes === "string" ? s.scopeNotes : "",
        disciplines: Array.isArray(s.disciplines) ? s.disciplines.filter(d => typeof d === "string") : [],
        subsections: Array.isArray(s.subsections)
          ? (s.subsections as Partial<SowSectionNode>[])
              .filter(ss => !!(ss && typeof ss.sowRef === "string" && typeof ss.title === "string"))
              .map((ss, j) => ({
                sowRef: ss.sowRef as string,
                ourRef: typeof ss.ourRef === "string" && ss.ourRef.trim() ? ss.ourRef : `${idx + 1}.${j + 1}`,
                title: ss.title as string,
                measurementBasis: typeof ss.measurementBasis === "string" ? ss.measurementBasis : "TBD",
                scopeNotes: typeof ss.scopeNotes === "string" ? ss.scopeNotes : "",
                disciplines: Array.isArray(ss.disciplines) ? ss.disciplines.filter(d => typeof d === "string") : [],
                subsections: [],
              }))
          : [],
      }));

    if (sections.length === 0) return fallbackOutline(sowText, projectName);

    return {
      sections: clampSections(sections),
      projectScope: typeof parsed.projectScope === "string" ? parsed.projectScope : `Outline extracted for ${projectName}.`,
      isFallback: false,
    };
  } catch {
    return fallbackOutline(sowText, projectName);
  }
}

/**
 * Helper for the agent route to grab a compact textual digest of the outline
 * (used in completeness-verifier prompts where we don't need the full tree).
 */
export function summariseOutline(outline: SowOutline): string {
  const lines: string[] = [];
  lines.push(`Project scope: ${outline.projectScope}`);
  lines.push("Sections:");
  for (const s of outline.sections) {
    lines.push(`  • ${s.sowRef} (ourRef ${s.ourRef}) ${s.title} [${s.measurementBasis}]`);
    for (const ss of s.subsections ?? []) {
      lines.push(`      ▸ ${ss.sowRef} (ourRef ${ss.ourRef}) ${ss.title} [${ss.measurementBasis}]`);
    }
  }
  if (outline.isFallback) lines.push("(NOTE: this outline is the fallback — LLM extraction did not produce a structured result.)");
  return lines.join("\n");
}

/** Re-export so callers can also reach the few-shot block builder for downstream agents. */
export { buildFewShotBlock };

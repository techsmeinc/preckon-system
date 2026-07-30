import { Router } from "express";
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { boqItemsTable, cadChunksTable, cadExtractionsTable, documentsTable, projectsTable, sowSectionsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getAIClient, extractJSON, isWeakOllamaModel, pickCapableOllamaModel, type Provider, type ProviderConfig } from "../lib/ai-provider";
import { buildExtractionDigest, createCadToolbox, type CadToolbox } from "../lib/cad-tools";
import { runAgenticLoop } from "../lib/agentic-loop";
import { ingestDocument, shouldIngestAsDrawing } from "../lib/cad-ingest";
import { extractSowOutline, type SowOutline, type SowSectionNode } from "../lib/sow-outline";
import { buildFewShotBlock, getCanonicalUnits } from "../lib/boq-examples";
import { normalizeUnit } from "../lib/boq-units";
import { formatDisciplineUnitsForPrompt } from "../lib/discipline-checklist";
import {
  ESTIMATOR_DESCRIPTION_GUIDE,
  ESTIMATOR_DECOMP_GUIDE,
  ESTIMATOR_VERIFIER_HINT,
  assessItemQuality,
  isMepSectionTitle,
  isTestingLine,
  scopeTypeRemark,
  qualityNote,
  QA_NOTE_MARKER,
  validateQuantity,
  reviewSuffix,
  quantityConfidence,
  confidenceSuffix,
} from "../lib/estimator-style";
import {
  designAgentRoster,
  pickSpecialistForSection,
  renderSpecialistContext,
  type AgentRoster,
  type DynamicSpecialist,
  type VerifierCheck,
} from "../lib/project-archetypes";
import { runVisionPass } from "../lib/vision-pass";
import { jsonrepair } from "jsonrepair";
import fs from "fs";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RawBoqItem {
  category: string;
  itemCode?: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice?: number | null;
  notes?: string | null;
  aiConfidence?: number | null;
  drawingRefs?: string[] | null;
  // AIGCC priced-BOQ hierarchy
  sowRef?: string | null;
  ourRef?: string | null;
  subRef?: string | null;
  srNo?: string | null;
  remarks?: string | null;
}

interface DrawingRefDetail {
  refId: string;
  layer: string | null;
  blockName: string | null;
  sheet: string | null;
  documentId: number | null;
  type: string;
  page: number | null;
}

interface MergedItem extends RawBoqItem {
  sourceAgent: string;
  sourceLabel: string;
  verificationStatus: "agreed" | "discrepancy" | "primary_only" | "secondary_only";
  verificationNotes: string | null;
  dbId: number;
  drawingReferences: DrawingRefDetail[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing-ref parsing (unchanged from prior version)
// ─────────────────────────────────────────────────────────────────────────────

function parseRefId(refId: string): DrawingRefDetail {
  const detail: DrawingRefDetail = {
    refId, layer: null, blockName: null, sheet: null, documentId: null, type: "unknown", page: null,
  };
  for (const p of refId.split("/")) {
    const [k, ...rest] = p.split(":");
    const v = rest.join(":");
    if (k === "doc" && v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) detail.documentId = n;
    } else if (k === "layer" && v) { detail.layer = v; detail.type = "layer"; }
    else if (k === "block" && v) { detail.blockName = v; detail.type = "block"; }
    else if (k === "text" && v) { detail.layer = v; detail.type = "text"; }
    else if (k === "schedule") { detail.type = "schedule"; }
    else if (k === "dim" && v) { detail.layer = v; detail.type = "dimension"; }
    else if (k === "title_block") { detail.type = "title_block"; }
    else if (k === "page" && v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) { detail.page = n; detail.sheet = `page ${n + 1}`; detail.type = "sheet"; }
    } else if (!v && p === "text" && detail.page !== null) {
      detail.type = "sheet_text";
    }
  }
  return detail;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit vocabulary — expanded to match the AIGCC house style in the exemplars
// ─────────────────────────────────────────────────────────────────────────────

const BASE_VALID_UNITS = new Set([
  "no.", "no", "nos", "nos.", "no.s",
  "m", "m2", "m3", "m²", "m³", "kg", "ls", "pm", "set", "sets", "hr", "hrs",
  "roll", "rolls", "lm", "l.m", "rm", "ea", "pc", "pcs", "each", "item", "lot",
  "tonne", "ton", "l", "liter", "litre", "kw", "kva", "%",
  "sq.m", "sqm", "mtrs", "mtr",
]);

// Augment with anything the exemplars actually used (case-insensitive).
const VALID_UNIT_TOKENS = (() => {
  const set = new Set(BASE_VALID_UNITS);
  for (const u of getCanonicalUnits()) set.add(u.toLowerCase());
  return set;
})();

const PLACEHOLDER_WORDS = new Set([
  "string", "number", "boolean", "null", "undefined", "your domain name",
  "be specific and technical", "your category", "string or null",
]);

function detectGarbageItem(item: RawBoqItem): string | null {
  const desc = (item.description ?? "").trim();
  const unit = (item.unit ?? "").trim();
  const cat = (item.category ?? "").trim();

  if (!desc || desc.length < 5) return "description missing or too short";
  if (PLACEHOLDER_WORDS.has(desc.toLowerCase())) return `description is placeholder ("${desc}")`;
  if (!cat || PLACEHOLDER_WORDS.has(cat.toLowerCase())) return "category missing or placeholder";

  if (unit.includes("|") || unit.length > 12) return `unit is the schema choice list, not a real unit ("${unit.slice(0, 30)}")`;
  if (!unit) return "unit missing";
  if (PLACEHOLDER_WORDS.has(unit.toLowerCase())) return `unit is placeholder ("${unit}")`;
  if (/\s/.test(unit) && unit.length > 6) return `unit contains whitespace ("${unit}")`;
  // Soft check — allow unknown but short tokens through.
  void VALID_UNIT_TOKENS;

  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "quantity not a positive number";

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB insertion (now persisting AIGCC ref fields)
// ─────────────────────────────────────────────────────────────────────────────

async function insertBoqItem(
  projectId: number,
  item: RawBoqItem,
  verificationStatus: MergedItem["verificationStatus"],
  verificationNotes: string | null,
  drawingReferences: DrawingRefDetail[],
): Promise<{ dbId: number; saved: typeof boqItemsTable.$inferSelect }> {
  const qty = Number(item.quantity) || 0;
  const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : null;
  const totalPrice = unitPrice !== null ? (qty * unitPrice).toFixed(2) : null;

  const [{ id: insertedId }] = await db
    .insert(boqItemsTable)
    .values({
      projectId,
      category: item.category,
      itemCode: item.itemCode ?? null,
      description: item.description,
      // Single guaranteed normalisation point: every persisted item carries one
      // of the standard units (m, m², m³, kg, ton, EA, Set, LS, PM), no matter
      // which code path created it. Idempotent if the caller already normalised.
      unit: normalizeUnit(item.unit),
      quantity: qty.toString(),
      unitPrice: unitPrice?.toString() ?? null,
      totalPrice,
      notes: item.notes ?? null,
      aiConfidence: item.aiConfidence?.toString() ?? null,
      verificationStatus,
      verificationNotes,
      generationMethod: "multi-agent-sow",
      drawingReferences: drawingReferences.length ? (drawingReferences as unknown) : null,
      sowRef: item.sowRef ?? null,
      ourRef: item.ourRef ?? null,
      subRef: item.subRef ?? null,
      srNo: item.srNo ?? null,
      remarks: item.remarks ?? null,
    })
    .$returningId();
  const [saved] = await db.select().from(boqItemsTable).where(eq(boqItemsTable.id, insertedId));
  return { dbId: insertedId, saved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist the extracted SOW outline so the Excel export can title each
// division/section sheet with the document's OWN headings (not a static
// discipline name). Flattens the outline tree (top-level + subsections) into
// sow_sections rows and replaces any previously-saved outline for the project.
// ─────────────────────────────────────────────────────────────────────────────

async function persistOutline(projectId: number, outline: SowOutline): Promise<void> {
  const rows: Array<typeof sowSectionsTable.$inferInsert> = [];
  let seq = 0;
  for (const section of outline.sections) {
    rows.push({
      projectId,
      seq: seq++,
      sowRef: section.sowRef,
      ourRef: section.ourRef ?? null,
      parentSowRef: null,
      title: section.title,
      measurementBasis: section.measurementBasis ?? null,
      scopeNotes: section.scopeNotes ?? null,
    });
    for (const sub of section.subsections ?? []) {
      rows.push({
        projectId,
        seq: seq++,
        sowRef: sub.sowRef,
        ourRef: sub.ourRef ?? null,
        parentSowRef: section.sowRef,
        title: sub.title,
        measurementBasis: sub.measurementBasis ?? null,
        scopeNotes: sub.scopeNotes ?? null,
      });
    }
  }
  await db.delete(sowSectionsTable).where(eq(sowSectionsTable.projectId, projectId));
  if (rows.length > 0) await db.insert(sowSectionsTable).values(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section agent — runs ONE SOW section, returns its BOQ rows
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_SCHEMA = `Return ONLY a raw JSON object. No markdown, no commentary, no preamble.

The priced BOQ uses this 4-level AIGCC hierarchy:
  • sowRef  — matches the SOW chapter number for THIS section (e.g. "2.4")
  • ourRef  — our internal numbering for the section (e.g. "4")
  • subRef  — sub-grouping under the section (e.g. "4.1" Demolition, "4.2" Manhole). Use null when the section has no sub-grouping.
  • srNo    — individual line item number ("4.1.1", "4.1.2", "4.4.10"). Always present.

Standard preamble sections (Site Survey, Design, Mobilization, As-Built, DD 1354) typically have srNo = "1.1", "1.2"... rather than nested.

Exact JSON shape:
{
  "items": [
    {
      "sowRef": "2.4",
      "ourRef": "4",
      "subRef": "4.4",
      "srNo": "4.4.5",
      "category": "Plumbing",
      "itemCode": null,
      "description": "Supply and installation of 7.5 HP capacity submersible pumps (Grinder type), pipes, fittings valves, float switch, control panel and electrical connection as required.",
      "unit": "EA",
      "quantity": 2,
      "unitPrice": null,
      "notes": "Per SOW 2.4 e) — replace 4-inch pumps with 6-inch grinder pumps.",
      "remarks": null,
      "aiConfidence": 0.85,
      "drawingRefs": ["doc:42/block:PUMP", "doc:42/page:5/text"]
    }
  ]
}

STRICT RULES:
  • sowRef, ourRef, srNo are MANDATORY on every item. subRef is optional but recommended for grouped sections.
  • UNIT — use EXACTLY one of these 9 standard tokens, matched to WHAT IS BEING MEASURED. No variants, no plurals, no trailing dots:
      m³  → volumes: excavation, backfilling, PCC/RMC/blinding concrete, filling, hardcore
      m²  → areas: formwork, blockwork/masonry walls, vapour barrier, damp-proofing, waterproof & roof membrane, foam concrete, thermal insulation, cement-sand screed, plastering / fair-face, gypsum board, ceramic/terrazzo tiling, stone cladding, acoustical & decorative ceilings, epoxy, emulsion/enamel/textured paint, acoustic lining, duct insulation, interlock paving
      m   → linear runs: water & drainage piping, cables, PVC/GI conduits, Cat-6 / RG cable, handrails, kerb stones, sheet-metal flashing, skirting, fencing
      kg  → sheet-metal AC ducting (by weight); light steelwork by weight
      ton → reinforcement steel (rebars), structural steel, and metal/steel roof sheeting, sandwich panels, purlins & roof structure — all by weight
      EA  → counted items: steel ladders, doors, windows, mirrors, plumbing fixtures (WC, wash basin, shower, sink…), floor drains, tanks, filters, heaters, coat hooks, dispensers, bins, kitchens, vanities, AC split units, grilles/diffusers, exhaust fans, DBs, isolators, switches/sockets, light fixtures, CCTV/NVR/screens, data/satellite outlets, fire extinguishers/blankets
      Set → pumps, recirculation pumps, and other plant supplied/priced as one set
      LS  → lump sum: soil tests, mobilization, general wiring, miscellaneous scope, indeterminate "as required" work
      PM  → person-month (time-priced lines): engineers, supervisors, labour, plant/equipment hire, miscellaneous staffing
    Reinforcement/structural steel may be kg OR ton (kg for small, ton for bulk). Pumps/HVAC plant may be EA OR Set. Everything else maps to exactly one token.
    PER-DISCIPLINE STANDARD UNITS — each discipline carries its OWN independent unit set (MEP do NOT share one flat list). Pick the token from the set that matches the line's discipline:
${formatDisciplineUnitsForPrompt()}
    Choose the token from the discipline whose work the line belongs to (e.g. a chiller → HVAC EA/Set; a cable run → Electrical m; a metal roof → Roofing ton; a waterproof membrane → Roofing m²). For a cross-discipline line, use the token that matches the physical measure being taken.
    Write m² and m³ with the real superscript characters ² and ³ — NEVER "m2", "Cu.Mtr", "Sq.mtr", "sqm", "cum", "Nos", "No.s", "Mtrs", "LM", or "Tons".
  • Descriptions imitate the exemplar style: specific dimensions/specs embedded, references to other sections OK ("see section 5.3").
  • QUANTITY — NEVER hallucinate or estimate a number. Every numeric quantity MUST trace to ONE of:
      (a) a CAD tool result — count_blocks (→ EA/Set); get_layer_geometry's PRE-CONVERTED metric fields: polylineLengthTotal_m / lineLengthTotal_m (→ m, for piping/conduit/kerb/cable) and largestClosedPolylineArea_m2 (→ m², for a FLOOR / SLAB / CEILING / ROOF / finish footprint — this is the single largest closed outline and is the reliable area). DO NOT use areaTotal / areaTotal_m2 as a floor area: it SUMS every overlapping outline + furniture + hatch boundary and massively over-counts (often 5–20× the true floor area). If a layer has no *_m2/*_m field its units are unknown — convert the raw value yourself (mm: area÷1e6, length÷1e3; cm: area÷1e4, length÷1e2). (Volume m³ and weight kg/ton usually need an area/length × a thickness/section from the spec or a schedule.); or
      (b) an explicit figure stated in the documents (a schedule, BoQ table, spec, or drawing note); or
      (c) a DERIVATION from stated figures using a standard QS formula — allowed ONLY when EVERY input is a real number read from the drawings/schedule (never an assumed one), with the formula and all inputs written in "notes". Examples:
          • Stair / ramp handrail run length (m) = √[(risers × riserHeight)² + ((risers − 1) × going)²] + landing/extension lengths, where riser count = flight floor-to-floor rise ÷ riserHeight. (Find the flight rise from the section/level drawing; the tread going & riser height are usually on the stair detail, e.g. "Tread 280 / Riser 171".)
          • Rectangular area (m²) = stated length × stated width; perimeter / skirting (m) = 2 × (L + W); volume (m³) = area × stated thickness.
          • BUILDING FOOTPRINT / GROSS FLOOR AREA — when the documents state a building's overall plan dimensions (any "L m × W m"), the footprint = L × W m² (× number of storeys for gross floor area). Use it (or the CAD largestClosedPolylineArea_m2, whichever you can ground) for SLAB, vapour barrier / damp-proofing, GROUND-FLOOR FINISH, suspended CEILING and ROOF area lines — these all track the footprint. State the basis in notes (e.g. "<area> m² = <L>×<W> m footprint per SOW <ref>"). Do NOT leave these provisional when overall dimensions are stated.
        Use search_drawing / get_text_on_sheet / get_schedules / vision findings to pull the input figures first. If even ONE input must be assumed, do NOT derive — leave the quantity provisional.
    State the source in "notes" (e.g. "qty 23 = count_blocks(DOOR_SINGLE)", "150 m² per Finishes Schedule sheet A-204", or "qty 6.2 m = √((16×0.171)²+(15×0.280)²)+0.6 landing; 16 risers from GF→L1 rise 2.736/0.171"). If you CANNOT ground or derive a quantity, do NOT guess a number — set quantity to 1 and add "(provisional quantity — not yet measured; verify from drawings)" to notes.
    CRUCIAL — the UNIT is chosen by the item's PHYSICAL MEASURE, INDEPENDENTLY of whether you could compute the quantity: pavement / paving / finishes / waterproofing / glazing area → m²; curb / kerb / pipe / cable / flashing / fencing → m; concrete / excavation / backfill → m³; doors / windows / fixtures / fittings → EA; rebar / structural steel → ton. NEVER downgrade a measurable item to LS just because its quantity is unknown — keep m²/m/m³/EA/ton and leave the quantity provisional. Use LS ONLY for genuinely non-measurable lump deliverables (mobilization, design, submittals, testing & commissioning, making-good, "as-required" allowances).
  • **quantity MUST be a positive number (> 0). Never emit 0.** Indeterminate submittal/deliverable items are quantity 1 with unit LS. A zero quantity will be rejected.
  • If a section has only a single deliverable (e.g. a submittal or report), emit exactly one item with quantity 1 unit LS — don't try to break it into sub-items.`;

const AGENTIC_PREAMBLE = `Before generating items you MUST ground yourself in BOTH the project's drawings AND its text documents (SOW, specifications, addenda) using the available tools.

WORKFLOW
1. Call list_documents to see every uploaded document and its type.
2. Read the SOW passage(s) for your section:    search_documents("<your section title>", documentTypes=["sow", "rfp"])
3. Read any specification for your section:     search_documents("<your section title>", documentTypes=["specification"])
4. Check for addenda that modify your scope:    search_documents("<your section title>", documentTypes=["addendum"])
5. For DXF drawings: list_layers / count_blocks / get_layer_geometry / get_schedules.
6. For PDF drawings: list_sheets / get_text_on_sheet for relevant sheets.
7. For both: search_drawing for free-text grounding.

For every item, include in "drawingRefs" the refId(s) of any chunks you actually used.

PRIORITY RULE: when the SOW gives an exact value (size, count, material grade), use it verbatim. Drawings refine the SOW with spatial quantities.`;

function buildSectionSystemPrompt(
  section: SowSectionNode,
  isStandardPreamble: boolean,
  roster: AgentRoster,
  specialist: DynamicSpecialist | null,
): string {
  const specialistContext = renderSpecialistContext(specialist, roster.projectDescription);
  return `${specialist
    ? `You are the ${specialist.label} on a ${roster.projectType} project.`
    : `You are a Senior Quantity Surveyor on a ${roster.projectType} project.`} Your scope is ONE SOW section only: ${section.sowRef} ${section.title}.

PROJECT CONTEXT (designed dynamically from the uploaded documents)
${roster.projectDescription}
Scope areas: ${roster.scopeAreas.join(", ") || "(none listed)"}

${specialistContext}

What this section covers (per the project's SOW): ${section.scopeNotes}
Measurement basis: ${section.measurementBasis}.
${section.disciplines.length > 0 ? `Relevant disciplines: ${section.disciplines.join(", ")}.` : ""}

You produce ONLY items that belong inside this section. Do NOT spill into adjacent SOW sections (a different specialist owns those). Every item you emit must carry sowRef="${section.sowRef}" and ourRef="${section.ourRef}".

${isStandardPreamble
  ? `This section reads like a standard preamble/deliverable bucket (site survey, design submittal, mobilization, closeout, etc.). Produce a small number of LS sub-items — one per distinct deliverable the documents mention.`
  : `This is project-specific scope. Read the uploaded documents carefully and produce quantified items grounded in the drawings + spec.`}

${AGENTIC_PREAMBLE}

CRITICAL OUTPUT RULES — violating any of these means the run fails:
  • Use the tool-call interface to call tools. NEVER write {"name":"...", "parameters":{...}} in your text reply — that is invalid and will be parsed as your final answer.
  • Your FINAL reply (when you're done calling tools) MUST be ONE raw JSON object that starts with { and ends with } — no preamble, no markdown fence, no explanation.
  • All JSON string values MUST be wrapped in double quotes. Write "unit": "LS" — NEVER write "unit": LS (unquoted).
  • Arrays MUST use [ and ] only. NEVER write ArraysContains[...], Set(...), List(...), or any function-call wrapper around an array literal.
  • Do not include trailing commas. The last element of an object or array MUST NOT be followed by a comma.

${ESTIMATOR_DESCRIPTION_GUIDE}

${ESTIMATOR_DECOMP_GUIDE}

${ITEM_SCHEMA}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The route
// ─────────────────────────────────────────────────────────────────────────────

router.post("/projects/:id/generate-boq-multi", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // SERVER-AUTHORITATIVE provider/model/key — so a BOQ generates IDENTICALLY no
  // matter WHO clicks Generate or from WHERE. Otherwise these come from the clicking
  // user's BROWSER (model preference + API key are localStorage, per Settings), so
  // "colleague uploads, I generate from another machine" would run whatever model/
  // key THAT browser has — often the fallback openai/gpt-4.1-mini or an empty/rate-
  // limited key → wrong or incomplete BOQ. When the server has an Anthropic key
  // (production), it WINS: everyone gets Claude Opus on the server's funded account.
  // The browser picker is only honoured in local dev where no server key is set.
  const serverAnthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const provider: Provider = serverAnthropicKey ? "anthropic" : (req.body?.provider ?? "openai");
  let model: string = serverAnthropicKey
    ? (process.env.BOQ_MODEL?.trim() || "claude-opus-4-8")
    : (req.body?.model ?? "gpt-4.1-mini");
  const providerConfig: ProviderConfig = {
    ollamaUrl: req.body?.providerConfig?.ollamaUrl,
    openrouterKey: req.body?.providerConfig?.openrouterKey,
    groqKey: req.body?.providerConfig?.groqKey,
    // Prefer the SERVER key so every user generates on the same account, not their
    // personal browser key.
    anthropicKey: serverAnthropicKey ?? req.body?.providerConfig?.anthropicKey,
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Surface the provider/model in human language so connection failures aren't
  // anonymous "Request timed out" messages.
  const providerLabel = describeProvider(provider, providerConfig, model);
  const explainProviderError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    if (/timed out|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(raw)) {
      return `${raw} — looks like a connection issue with ${providerLabel}. Confirm the endpoint is reachable, or switch provider in Settings (OpenAI/Groq/OpenRouter need an API key).`;
    }
    if (/401|unauthorized|invalid.*api.*key/i.test(raw)) {
      return `${raw} — ${providerLabel} rejected the request. Set the API key in Settings.`;
    }
    return raw;
  };

  // Transient provider failures worth retrying: rate limits (429), server/
  // overload errors (5xx incl. Anthropic's 529 "overloaded_error"), and
  // connection/timeout blips. Auth/4xx (except 429) are NOT retryable.
  const isRetryableProviderError = (err: unknown): boolean => {
    const status = (err as { status?: number } | null)?.status;
    if (typeof status === "number") {
      if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
      return false; // other 4xx (401/403/400) won't get better on retry
    }
    const raw = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return /overloaded|529|rate.?limit|\b50\d\b|timed out|etimedout|econn|eai_again|fetch failed|temporarily/.test(raw);
  };

  // Run `fn`, retrying on transient/overload errors with exponential backoff +
  // jitter. This sits ON TOP of the SDK's own per-call retries, so a section
  // whose call exhausts the SDK retries still gets another chance instead of
  // collapsing to an empty section. `label` is the agent key for SSE messages.
  const withOverloadRetry = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const MAX_ATTEMPTS = 4;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS || !isRetryableProviderError(err)) throw err;
        const delayMs = Math.min(45_000, 3_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1_000);
        send({
          type: "agent",
          agent: label,
          status: "warning",
          message: `${providerLabel} overloaded — waiting ${Math.round(delayMs / 1000)}s then retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`,
        });
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  };

  try {
    // ── Load project & documents ──────────────────────────────────────────
    send({ type: "pipeline", stage: "loading", message: "Loading project and documents..." });

    // Auto-upgrade weak Ollama models. The multi-agent pipeline needs structured
    // JSON + reliable tool-calling, and llama3.2:3b et al. just can't do either.
    // We probe /api/tags and silently swap to qwen2.5:14b (or whichever capable
    // model is installed). The user sees the swap in the SSE log so it's not magic.
    if (provider === "ollama" && isWeakOllamaModel(model)) {
      const ollamaUrl = providerConfig.ollamaUrl ?? "http://localhost:11434";
      const upgraded = await pickCapableOllamaModel(ollamaUrl);
      if (upgraded) {
        send({
          type: "pipeline",
          stage: "model-upgrade",
          message: `Auto-upgrading model: "${model}" → "${upgraded}". The 3B-class model can't reliably do structured JSON + tool-calling for the multi-agent flow. Found "${upgraded}" installed on your Ollama server; using it instead.`,
        });
        model = upgraded;
      } else {
        send({
          type: "pipeline",
          stage: "model-warning",
          message: `Heads-up: "${model}" is below the bar for structured tool-calling and no capable replacement was found on your Ollama server. The route will repair what it can but expect "0 items" results. Run "ollama pull qwen2.5:14b" and retry for usable BOQs.`,
        });
      }
    }

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { send({ type: "error", message: "Project not found" }); res.end(); return; }

    await db.update(projectsTable).set({ status: "processing", updatedAt: new Date() }).where(eq(projectsTable.id, id));

    let documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));

    // ── Auto-recover stuck drawing ingests (unchanged) ───────────────────
    const stuck = documents.filter(d =>
      shouldIngestAsDrawing(d.originalName, d.documentType)
      && (d.cadExtractionStatus === "pending" || d.cadExtractionStatus === "failed" || !d.cadExtractionStatus)
    );
    if (stuck.length > 0) {
      send({ type: "pipeline", stage: "cad-recover", message: `Re-running CAD ingest for ${stuck.length} drawing(s)...` });
      const ingestPromises = stuck.map(d => ingestDocument(d.id).catch(err => { req.log.warn({ err, documentId: d.id }, "auto-recover ingest crashed"); return null; }));
      const settled = await Promise.race([
        Promise.all(ingestPromises),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 45_000)),
      ]);
      send({ type: "pipeline", stage: "cad-recover", message: settled === null ? "Ingest still running after 45s — proceeding." : "CAD ingest complete." });
      documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
    }

    // ── Result cache — return the SAME BOQ when the inputs haven't changed ─────
    // The multi-agent pipeline is non-deterministic (the LLM samples), so clicking
    // "Multi-Agent BOQ" again used to re-roll a different BOQ every time. We now
    // fingerprint the INPUTS (model + document set + extraction/chunk state); if it
    // matches the last successful run AND a BOQ already exists, we return that same
    // BOQ instead of regenerating. `force` (from the Regenerate button) bypasses it.
    const force = req.body?.force === true || req.body?.regenerate === true;
    const [{ chunkCount = 0 } = {}] = await db
      .select({ chunkCount: sql<number>`COUNT(*)` })
      .from(cadChunksTable)
      .where(eq(cadChunksTable.projectId, id));
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        v: "ma-v1",                       // bump to invalidate every cache on a pipeline change
        provider, model,
        chunks: Number(chunkCount) || 0,
        docs: documents
          .map(d => `${d.id}:${d.cadExtractionStatus ?? ""}:${d.documentType ?? ""}`)
          .sort(),
      }))
      .digest("hex")
      .slice(0, 64);

    if (!force && project.boqFingerprint && project.boqFingerprint === fingerprint) {
      const [{ n = 0 } = {}] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(boqItemsTable)
        .where(eq(boqItemsTable.projectId, id));
      // Only serve the cache if the last BOQ was COMPLETE — every SOW-outline
      // division actually produced items. If it was missing divisions (a section
      // agent failed last time), DON'T lock that incomplete result in: fall through
      // and regenerate so the retry pass can fill the gaps. This is why re-clicking
      // "kept giving the same incomplete result" — the cache was returning it.
      const [{ secN = 0 } = {}] = await db
        .select({ secN: sql<number>`COUNT(*)` })
        .from(sowSectionsTable)
        .where(eq(sowSectionsTable.projectId, id));
      const [{ divN = 0 } = {}] = await db
        .select({ divN: sql<number>`COUNT(DISTINCT ${boqItemsTable.sowRef})` })
        .from(boqItemsTable)
        .where(and(eq(boqItemsTable.projectId, id), sql`${boqItemsTable.sowRef} IS NOT NULL`));
      const complete = Number(secN) === 0 || Number(divN) >= Number(secN);
      if (Number(n) > 0 && complete) {
        await db.update(projectsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(projectsTable.id, id));
        send({ type: "pipeline", stage: "cached", message: `Inputs unchanged since the last COMPLETE run — returning the SAME ${n}-item BOQ across ${divN} division(s) (cached). Use Regenerate to force a fresh run.` });
        send({ done: true, cached: true });
        res.end();
        return;
      }
      if (Number(n) > 0 && !complete) {
        send({ type: "pipeline", stage: "cache-skip", message: `Last BOQ was missing divisions (${divN}/${secN}) — regenerating to fill the gaps instead of returning the incomplete cached result.` });
      }
    }

    // ── Collect text from EVERY uploaded document ────────────────────────
    // We read the PROPERLY EXTRACTED text from cad_chunks (PyMuPDF parsed text
    // by section/page), NOT fs.readFileSync(doc.filePath) — PDFs read as utf-8
    // are binary garbage and were tripping the SOW outline extractor into
    // fallback mode. The text-document chunks are stored with chunkType
    // "document_section" and carry section headings + page ranges in their
    // body, which is ideal for both the outline extractor and the agents.
    let hasDrawingDocs = false;
    let hasParsedDocs = false;
    const hasAnyDocs = documents.length > 0;
    let sowText = "";
    let rawContent = "";
    const docInventoryLines: string[] = [];

    for (const doc of documents) {
      if (doc.documentType === "drawing" && doc.cadExtractionStatus === "succeeded") hasDrawingDocs = true;
      if (doc.cadExtractionStatus === "succeeded") hasParsedDocs = true;
      docInventoryLines.push(
        `  • [${doc.documentType}] ${doc.originalName} (cad_status=${doc.cadExtractionStatus ?? "none"})`,
      );
    }

    // Measured quantities (m / m² / m³ / kg / ton) can only be DERIVED from true
    // CAD geometry (DXF/DWG) via the measuring tools. A drawing uploaded as a PDF
    // yields text/labels + vision findings only — there is no geometry to measure,
    // so its lengths/areas/counts fall back to LS. Surface this up front so an
    // all-PDF drawing set isn't a silent mystery ("why is everything LS?").
    const pdfDrawings = documents.filter(
      d => d.documentType === "drawing" && !/\.(dxf|dwg)$/i.test(d.originalName),
    );
    const cadDrawings = documents.filter(
      d => d.documentType === "drawing" && /\.(dxf|dwg)$/i.test(d.originalName),
    );
    if (pdfDrawings.length > 0 && cadDrawings.length === 0) {
      send({
        type: "pipeline",
        stage: "preflight",
        message:
          `⚠ Measured quantities (m / m² / m³ / kg / ton) require a CAD drawing (.dxf/.dwg). ` +
          `This project's drawing(s) are PDF only (${pdfDrawings.map(d => d.originalName).join(", ")}), ` +
          `so lengths/areas/counts cannot be measured — those lines will be priced LS or need a manual quantity. ` +
          `Upload the .dxf/.dwg to get measured quantities.`,
      });
    } else if (pdfDrawings.length > 0) {
      send({
        type: "pipeline",
        stage: "preflight",
        message:
          `Note: ${pdfDrawings.length} drawing(s) are PDF (no measurable geometry); ` +
          `measured quantities come only from the ${cadDrawings.length} CAD (.dxf/.dwg) drawing(s) or printed figures.`,
      });
    }

    // NOTE: the actual text-from-chunks collection happens AFTER the vision
    // pre-pass below (see collectDocumentText), because the vision pass writes
    // "vision_finding" chunks we want the outline + designer to read. Drawings
    // contribute their vision findings + title block + schedules + page text;
    // a drawing-only project must NOT reach the outline stage with empty text.

    const client = getAIClient(provider, providerConfig);

    // ── Fail-fast connectivity probe ─────────────────────────────────────
    // Before kicking off 6+ section agents, confirm the provider's HTTP
    // endpoint is reachable. We deliberately use models.list() (the cheap
    // /v1/models endpoint) rather than a chat completion: it tells us the
    // server is up without waiting 30+ seconds for Ollama to cold-load a
    // 14B model into RAM. The section agents themselves can take as long
    // as they need — we only want to fail fast on connection-level errors.
    send({ type: "pipeline", stage: "probe", message: `Pinging ${providerLabel} before dispatching agents...` });
    try {
      // 15s connection-level probe. Way more than enough for a healthy
      // /v1/models call (typically <500ms); short enough that a dead VPS
      // surfaces before the user gives up.
      await client.models.list({ timeout: 15_000 });
      send({ type: "pipeline", stage: "probe", message: `Provider reachable — proceeding.` });
    } catch (probeErr) {
      // Don't fail the whole pipeline on probe error — some Ollama setups
      // gate /v1/models behind auth even when chat works. Log it and let the
      // first real section agent surface any persistent error with a clearer
      // message than "Request timed out".
      const probeMsg = probeErr instanceof Error ? probeErr.message : String(probeErr);
      if (/timed out|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(probeMsg)) {
        // Network-level failure — bail with one clear error, save 18+ minutes.
        send({ type: "error", message: `Provider unreachable — ${explainProviderError(probeErr)}` });
        res.end();
        return;
      }
      // Other errors (auth, 404 on /v1/models, etc.) are advisory. Continue.
      send({
        type: "pipeline",
        stage: "probe",
        message: `Probe to /v1/models returned ${probeMsg.slice(0, 100)} — proceeding anyway; section agents will use chat completions directly.`,
      });
    }

    // ── Multimodal vision pre-pass ───────────────────────────────────────
    // Rasterize each ingested PDF page (drawings AND tender/RFP/SOW/spec) and
    // have a vision model describe what's on it. Tender PDFs frequently embed
    // photos, image-only tables, or scanned schedules that the text extractor
    // loses entirely — the VLM pass recovers them. Findings land as
    // "vision_finding" chunks tagged with the source document's actual type,
    // so search_drawing (drawings) and search_documents (tender/RFP/SOW/spec)
    // both surface them correctly in the agentic loop.
    //
    // Provider routing happens inside runVisionPass:
    //   • Ollama → local VLM (qwen2.5vl / moondream / etc.)
    //   • OpenRouter → google/gemini-2.5-flash-lite by default, or reuses the
    //     user's main model if it's vision-capable (Claude / Gemini / GPT-4o)
    //   • OpenAI → gpt-4o-mini by default, or reuses if vision-capable
    //   • Groq → skipped (no production vision endpoint)
    // This is the fix for the KFH RFP failure: previously the pre-pass was
    // gated `provider === "ollama"` so an OpenRouter+llama-3.3 run silently
    // skipped vision entirely and the scanned PDF produced 0% completeness.
    if (hasDrawingDocs || hasParsedDocs) {
      try {
        await runVisionPass({
          projectId: id,
          provider,
          providerConfig,
          modelHint: model,
          ollamaBaseUrl: providerConfig.ollamaUrl ?? "http://localhost:11434",
          // Reuse cached vision findings by default; the client can force a
          // fresh re-analysis with { refreshVision: true } in the request body.
          forceRefresh: req.body?.refreshVision === true,
          onProgress: m => send({ type: "pipeline", stage: m.stage, message: m.message }),
        });
      } catch (visionErr) {
        req.log.warn({ err: visionErr }, "vision pass crashed; continuing without it");
        send({ type: "pipeline", stage: "vision-pass", message: `Vision pre-pass failed: ${visionErr instanceof Error ? visionErr.message : String(visionErr)} — continuing without multimodal findings.` });
      }
    }

    // ── Collect text from EVERY succeeded document (drawings INCLUDED) ────
    // Runs AFTER the vision pass so this run's "vision_finding" chunks are
    // visible. Previously this only pulled sow/rfp/spec/addendum/tender/other
    // docs — a drawing-only project (e.g. a single AC-00.pdf) reached the
    // outline + designer stages with ZERO text and fell back to "no documents
    // uploaded", even though the drawing and its vision findings were sitting
    // in cad_chunks. We now gather:
    //   • text docs  → their section / schedule / vision chunks
    //   • drawings   → their vision findings + title block + schedules + page text
    // and order the highest-signal chunks first so truncated excerpts keep them.
    {
      const succeededDocIds = documents
        .filter(d => d.cadExtractionStatus === "succeeded")
        .map(d => d.id);

      if (succeededDocIds.length > 0) {
        const chunks = await db
          .select({
            documentId: cadChunksTable.documentId,
            chunkType: cadChunksTable.chunkType,
            section: cadChunksTable.section,
            page: cadChunksTable.page,
            text: cadChunksTable.text,
          })
          .from(cadChunksTable)
          .where(and(
            inArray(cadChunksTable.documentId, succeededDocIds),
            inArray(cadChunksTable.chunkType, [
              "vision_finding", "document_section", "title_block", "schedule", "text", "sheet_summary",
            ]),
          ));

        // Higher = read first. Vision findings + title block + schedules are the
        // natural-language scope signal; raw page-text-label dumps and per-page
        // "summary" lines are noisier, so they sink to the bottom and get
        // truncated away first when an excerpt is sliced.
        const CHUNK_PRIORITY: Record<string, number> = {
          vision_finding: 5, document_section: 4, title_block: 3, schedule: 2, text: 1, sheet_summary: 0,
        };
        // Drawing scope text only needs the high-signal chunks — not every tag label.
        const DRAWING_SCOPE_TYPES = new Set(["vision_finding", "title_block", "schedule"]);
        const SCOPE_BEARING_DOC_TYPES = new Set(["sow", "rfp", "specification", "addendum"]);

        const byDoc = new Map<number, typeof chunks>();
        for (const c of chunks) {
          const arr = byDoc.get(c.documentId) ?? [];
          arr.push(c);
          byDoc.set(c.documentId, arr);
        }

        for (const doc of documents) {
          const docChunks = byDoc.get(doc.id);
          if (!docChunks || docChunks.length === 0) continue;
          const docType = doc.documentType ?? "other";
          const ordered = [...docChunks].sort(
            (a, b) => (CHUNK_PRIORITY[b.chunkType] ?? 0) - (CHUNK_PRIORITY[a.chunkType] ?? 0),
          );
          const stitched = ordered.map(c => c.text).join("\n\n");
          rawContent += `\n\n========= ${doc.originalName} (${docType}) =========\n${stitched}`;

          // Scope text for the outline + designer. Text docs contribute
          // everything; drawings contribute only their high-signal chunks so a
          // drawing-only project still produces a meaningful scope breakdown.
          if (SCOPE_BEARING_DOC_TYPES.has(docType)) {
            sowText += `\n\n========= ${doc.originalName} (${docType}) =========\n${stitched}`;
          } else if (docType === "drawing") {
            const scopeChunks = ordered.filter(c => DRAWING_SCOPE_TYPES.has(c.chunkType));
            if (scopeChunks.length > 0) {
              sowText += `\n\n========= ${doc.originalName} (drawing) =========\n${scopeChunks.map(c => c.text).join("\n\n")}`;
            }
          }
        }
      }

      // Surface the inventory + a per-doc parsed-chunk count so the user can
      // see exactly what each agent will have access to.
      if (docInventoryLines.length > 0) {
        send({
          type: "pipeline",
          stage: "doc-inventory",
          message: `Documents available to section agents (${documents.length}):\n${docInventoryLines.join("\n")}\n  Parsed text chars (from cad_chunks, incl. vision findings): ${rawContent.length}`,
        });
      }
    }

    const extractionDigest = await buildExtractionDigest(id);

    // ── Pre-Stage — Announce the preamble cards so they appear immediately ──
    // Outline + Designer render in the UI as soon as the run starts. The
    // section cards are added in a second pipeline-init once the outline
    // produces them AND the designer has assigned specialists to them.
    send({
      type: "pipeline-init",
      stage: "agents",
      agents: [
        { key: "outline", label: "SOW Outline Extractor", subtitle: "Builds the section tree", role: "preamble" },
        { key: "designer", label: "Agent Designer", subtitle: "Invents the specialist roster", role: "preamble" },
        { key: "verifier", label: "Completeness Verifier", subtitle: "Checks project-specific items", role: "verifier" },
      ],
    });

    // ── Stage 1 — Project Outline Extractor ───────────────────────────────
    // We feed the analyzer ALL uploaded document text (rawContent), not just
    // docs tagged "sow"/"rfp"/"spec". This way an ITB notice, a tender
    // redirection letter, a DOCX scope brief, etc. all reach the analyzer
    // regardless of how the user tagged them at upload time. The analyzer's
    // prompt is now document-agnostic — it invents the section structure
    // from whatever the documents say, with no USAF template fallback.
    const allDocText = rawContent.trim().length > 0 ? rawContent : sowText;
    send({ type: "agent", agent: "outline", status: "running", message: "Reading uploaded documents and building the project's scope-area breakdown (no house template)..." });

    let outline: SowOutline;
    try {
      outline = await extractSowOutline({
        client,
        model,
        sowText: allDocText || `Project name: ${project.name}\n(No document text was uploaded.)`,
        projectName: project.name,
        // The full doc inventory (each drawing names a discipline) drives division
        // completeness even when the concatenated text is truncated.
        documentInventory: docInventoryLines.join("\n"),
      });
      send({
        type: "agent",
        agent: "outline",
        status: outline.isFallback ? "warning" : "complete",
        message: `${outline.sections.length} scope area(s) detected${outline.isFallback ? " (heuristic fallback — LLM did not return structured data)" : ""}. ${outline.projectScope.slice(0, 200)}`,
      });
    } catch (err) {
      req.log.warn({ err }, "project outline extraction failed");
      outline = (await import("../lib/sow-outline")).fallbackOutline(allDocText, project.name);
      send({ type: "agent", agent: "outline", status: "warning", message: "SOW outline extraction failed — using fallback template." });
    }

    // ── Stage 1.5 — Agent Designer ────────────────────────────────────────
    // Reads the SOW + outline + docs and INVENTS the specialist roster for
    // THIS specific project. No fixed list of specialists or disciplines —
    // the LLM picks names, expertise, vocabulary, and section ownership
    // tailored to the actual uploaded documents.
    send({
      type: "agent",
      agent: "designer",
      status: "running",
      message: "Reading the SOW + outline + uploaded documents to invent the specialist roster for this specific project...",
    });

    let roster: AgentRoster;
    try {
      roster = await designAgentRoster(
        client,
        model,
        project.name,
        allDocText,
        outline.sections.map(s => ({
          sowRef: s.sowRef,
          title: s.title,
          scopeNotes: s.scopeNotes,
          disciplines: s.disciplines,
          measurementBasis: s.measurementBasis,
        })),
        docInventoryLines,
      );
      send({
        type: "agent",
        agent: "designer",
        status: roster.isFallback ? "warning" : "complete",
        message: `${roster.projectType} — designed ${roster.specialists.length} specialist(s) and ${roster.verifierChecks.length} verifier check(s). ${roster.reasoning.slice(0, 240)}`,
      });
    } catch (err) {
      req.log.warn({ err }, "agent designer failed");
      // Build a minimal fallback roster inline so the pipeline can still run.
      roster = {
        projectDescription: `Project "${project.name}" — designer crashed; running with a single generic specialist.`,
        projectType: "Construction Project (fallback)",
        scopeAreas: [],
        specialists: [
          {
            key: "generic-quantity-surveyor",
            label: "Quantity Surveyor (generic)",
            expertise: "Generic QS fallback used when the dynamic agent designer crashed.",
            vocabulary: [],
            measurementGuide: "Use whichever unit the SOW implies.",
            typicalItems: [],
            ownedSectionRefs: outline.sections.map(s => s.sowRef),
          },
        ],
        verifierChecks: [],
        reasoning: "Designer crashed; using single generic specialist.",
        isFallback: true,
      };
      send({ type: "agent", agent: "designer", status: "warning", message: roster.reasoning });
    }

    // ── Announce all section agents up-front so the UI can render their cards ──
    // Each section card is labelled with the dynamically-designed specialist
    // that owns it (e.g. "Submersible Pump Specialist — 2.4 Repair MWD
    // Obedience Area") so the user sees that agents were invented for this
    // specific project.
    const sectionAgentKeys = outline.sections.map(s => `section-${s.sowRef}`);
    const sectionSpecialists = new Map<string, DynamicSpecialist | null>();
    for (const s of outline.sections) {
      sectionSpecialists.set(s.sowRef, pickSpecialistForSection(roster, s.sowRef));
    }
    send({
      type: "pipeline-init",
      stage: "agents",
      agents: [
        { key: "outline", label: "SOW Outline Extractor", subtitle: "Builds the section tree", role: "preamble" },
        { key: "designer", label: "Agent Designer", subtitle: roster.projectType, role: "preamble" },
        ...outline.sections.map(s => {
          const persona = sectionSpecialists.get(s.sowRef);
          return {
            key: `section-${s.sowRef}`,
            label: persona
              ? `${persona.label} — ${s.sowRef} ${s.title}`
              : `${s.sowRef} ${s.title}`,
            subtitle: persona ? `${persona.label} · ${s.measurementBasis}` : s.measurementBasis,
            role: "section",
            sowRef: s.sowRef,
            ourRef: s.ourRef,
            disciplines: s.disciplines,
          };
        }),
        { key: "verifier", label: "Completeness Verifier", subtitle: `Checks ${roster.verifierChecks.length} project-specific item(s)`, role: "verifier" },
      ],
    });

    // ── Wipe previous BOQ for this project ────────────────────────────────
    await db.delete(boqItemsTable).where(eq(boqItemsTable.projectId, id));

    // ── Persist the SOW outline so the export can title sheets/sections with
    //    the document's own division headings (replaces any prior outline). ──
    try {
      await persistOutline(id, outline);
    } catch (err) {
      req.log.warn({ err }, "failed to persist SOW outline (export will fall back to category titles)");
    }

    // ── Stage 2 — One section agent per top-level SOW section ─────────────
    for (const key of sectionAgentKeys) {
      send({ type: "agent", agent: key, status: "queued", message: "Queued — waiting for a slot..." });
    }

    interface SectionResult { sowRef: string; ourRef: string; title: string; items: MergedItem[]; toolCalls: number; groundedCount: number; }

    const STANDARD_PREAMBLE_TITLES = /site survey|comprehensive site|design.*drawings|design contract|mobilization|demobilization|as.?built|dd.*1354|dd form/i;
    const fewShotBlock = buildFewShotBlock(`${project.name} ${outline.projectScope}`, { topK: 1 });

    const SECTION_CONCURRENCY = 3;

    const runSection = async (section: (typeof outline.sections)[number]): Promise<SectionResult> => {
        const agentKey = `section-${section.sowRef}`;
        const isStandardPreamble = STANDARD_PREAMBLE_TITLES.test(section.title);

        // Pick the most evocative starting message for the user given what's parsed.
        const startMsg = hasDrawingDocs
          ? `Starting ${section.sowRef} ${section.title} — grounding in drawings + text documents...`
          : hasParsedDocs
            ? `Starting ${section.sowRef} ${section.title} — grounding in uploaded RFP/SOW/spec text (no drawings parsed yet)...`
            : hasAnyDocs
              ? `Starting ${section.sowRef} ${section.title} — documents still ingesting; using text fallback...`
              : `Starting ${section.sowRef} ${section.title} — no documents uploaded, using project-typical priors...`;
        send({ type: "agent", agent: agentKey, status: "running", message: startMsg });

        let toolbox: CadToolbox;
        try {
          toolbox = await createCadToolbox(id);
        } catch (err) {
          req.log.warn({ err, agent: agentKey }, "failed to build toolbox");
          toolbox = { toolDefinitions: [], handlers: {}, trace: [], groundedRefIds: new Set() };
        }

        const specialist = sectionSpecialists.get(section.sowRef) ?? null;
        const systemPrompt = buildSectionSystemPrompt(section, isStandardPreamble, roster, specialist);
        const userPrompt = `Project: "${project.name}"
SOW outline (your section is highlighted in CAPS):
${formatOutlineWithHighlight(outline, section.sowRef)}

YOUR SECTION SCOPE (from the SOW):
${section.scopeNotes}

${section.subsections && section.subsections.length > 0
  ? `This section has sub-groupings. Produce items grouped under each sub-section's subRef:\n${section.subsections.map(ss => `  • subRef ${ss.ourRef}: ${ss.title} (${ss.measurementBasis})\n      ${ss.scopeNotes}`).join("\n")}`
  : ""}

Documents uploaded for THIS project (call list_documents / search_documents to drill in):
${docInventoryLines.join("\n")}

CAD drawing summary (if drawings were parsed):
${extractionDigest.slice(0, 1500)}

Direct text excerpt (head of each uploaded text document, for models that can't tool-call):
${rawContent.slice(0, 4000)}

${fewShotBlock}

Now produce items for SOW section ${section.sowRef} ONLY. Output JSON only.`;

        let content = "";
        let toolCallsMade = 0;
        try {
          // Use the agentic tool-using loop whenever we have ANY parsed
          // document the agent could query (drawing OR text doc). Even when
          // only RFP/SOW PDFs are parsed, the agent benefits from being able
          // to call search_documents to drill into spec clauses.
          // Skip the loop entirely only when literally nothing is parsed and
          // nothing is uploaded — single-shot completion with the priors.
          const useAgenticLoop = hasParsedDocs;
          // Retry the whole section on transient provider overload (429/5xx/529)
          // so an "Overloaded" blip no longer drops the entire section to 0 items.
          content = await withOverloadRetry(agentKey, async () => {
            if (!useAgenticLoop) {
              // max_tokens=4096 ensures small models (llama3.2:3b) don't truncate
              // mid-JSON-array on sections with 8+ items. Larger models cap at
              // their own context anyway.
              const fallbackResp = await client.chat.completions.create({
                model,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
                max_tokens: 4096,
              });
              return fallbackResp.choices[0]?.message?.content ?? "";
            }
            const result = await runAgenticLoop({
              client,
              model,
              systemPrompt,
              userPrompt,
              toolbox,
              iterCap: 6,
              onToolCall: (name, _args, ok) => {
                toolCallsMade++;
                send({ type: "tool", agent: agentKey, tool: name, ok });
              },
              onToolUseUnsupported: () => {
                send({ type: "agent", agent: agentKey, status: "warning", message: "Provider doesn't support tool-calling — falling back to digest-only context." });
              },
            });
            return result.content;
          });
        } catch (callErr) {
          const msg = explainProviderError(callErr);
          req.log.warn({ err: callErr, agent: agentKey }, "section agent failed");
          send({ type: "agent", agent: agentKey, status: "warning", message: `Section ${section.sowRef} failed: ${msg.slice(0, 300)}` });
          return { sowRef: section.sowRef, ourRef: section.ourRef, title: section.title, items: [], toolCalls: toolCallsMade, groundedCount: toolbox.groundedRefIds.size };
        }

        let rawItems: RawBoqItem[] = [];
        let parseError: string | null = null;
        try {
          const extracted = extractJSON(content);
          const parsed = JSON.parse(extracted);
          if (parsed && Array.isArray(parsed.items)) rawItems = parsed.items;
          else parseError = `Top-level keys: ${Object.keys(parsed ?? {}).join(", ") || "(none)"}.`;
        } catch (parseErr) {
          // Ladder of recovery attempts, ordered cheapest → most destructive:
          //   1. jsonrepair — fixes unquoted strings, trailing commas, single
          //      quotes, missing brackets, JS-style identifiers etc. Catches
          //      the bulk of weak-model output errors like `"unit": LS,`
          //      → `"unit": "LS",` or `ArraysContains[...]` → `[...]`.
          //   2. salvagePartialItems — for genuinely truncated arrays, pull
          //      out the cleanly-closed inner objects.
          let recovered: RawBoqItem[] = [];
          let recoveryNote = "";
          try {
            const extracted = extractJSON(content);
            const repaired = jsonrepair(extracted);
            const parsed = JSON.parse(repaired);
            if (parsed && Array.isArray(parsed.items)) {
              recovered = parsed.items;
              recoveryNote = `jsonrepair fixed the JSON; recovered ${recovered.length} item(s)`;
            }
          } catch {
            // jsonrepair couldn't make it valid; fall through to partial salvage.
          }
          if (recovered.length === 0) {
            recovered = salvagePartialItems(content);
            if (recovered.length > 0) {
              recoveryNote = `JSON truncated — partial salvage recovered ${recovered.length} item(s) from incomplete output`;
            }
          }
          if (recovered.length > 0) {
            rawItems = recovered;
            parseError = recoveryNote;
          } else {
            parseError = `JSON parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
          }
          req.log.warn(
            { err: parseErr, agent: agentKey, sample: content.slice(0, 400), recovered: recovered.length },
            "section agent JSON parse failed",
          );
        }
        if (parseError) {
          send({ type: "agent", agent: agentKey, status: "warning", message: `Parse issue: ${parseError} | Output snippet: "${content.slice(0, 250).replace(/\s+/g, " ")}"` });
        }

        const persisted: MergedItem[] = [];
        let rejectedCount = 0;
        const rejectedReasons: string[] = [];
        let srAuto = 1;
        for (const item of rawItems) {
          // Normalise: ensure section refs are present even if the model forgot.
          const normalised: RawBoqItem = {
            ...item,
            category: item.category || section.title,
            unit: normalizeUnit(item.unit),
            sowRef: item.sowRef ?? section.sowRef,
            ourRef: item.ourRef ?? section.ourRef,
            subRef: item.subRef ?? null,
            srNo: item.srNo ?? `${section.ourRef}.${srAuto++}`,
          };
          const garbageReason = detectGarbageItem(normalised);
          if (garbageReason) {
            rejectedCount++;
            if (rejectedReasons.length < 3) rejectedReasons.push(garbageReason);
            continue;
          }
          const drawingReferences = resolveDrawingRefs(normalised.drawingRefs, toolbox.groundedRefIds);
          try {
            const { dbId, saved } = await insertBoqItem(id, normalised, "primary_only", null, drawingReferences);
            persisted.push({
              ...normalised,
              sourceAgent: agentKey,
              sourceLabel: `${section.sowRef} ${section.title}`,
              verificationStatus: "primary_only",
              verificationNotes: null,
              dbId,
              drawingReferences,
            });
            send({ type: "item", item: saved });
          } catch (err) {
            req.log.warn({ err, agent: agentKey }, "failed to persist section item");
          }
        }

        if (rejectedCount > 0) {
          send({ type: "agent", agent: agentKey, status: "warning", message: `Rejected ${rejectedCount} item(s): ${rejectedReasons.join(" | ")}` });
        }
        send({
          type: "agent",
          agent: agentKey,
          status: "complete",
          message: `${persisted.length} items · ${toolCallsMade} tool call(s) · ${toolbox.groundedRefIds.size} CAD ref(s).`,
        });
        return { sowRef: section.sowRef, ourRef: section.ourRef, title: section.title, items: persisted, toolCalls: toolCallsMade, groundedCount: toolbox.groundedRefIds.size };
    };

    const sectionResults: SectionResult[] = await runWithConcurrency(outline.sections, SECTION_CONCURRENCY, runSection);

    // ── Retry EMPTY divisions — the fix for "a few divisions are missing" ──────
    // A section agent that timed out, hit a rate limit after retries, or returned
    // unparseable JSON yields items:[] *silently*, so that division drops out of
    // the BOQ. An empty division persisted NOTHING (insertBoqItem never ran), so
    // re-running it can't create duplicates — it simply gives transient failures a
    // second chance instead of leaving a hole. One extra pass at lower concurrency
    // to ease provider load; only truly-empty divisions are retried.
    const needRetry = outline.sections.filter((s) => {
      const r = sectionResults.find((x) => x.sowRef === s.sowRef);
      return !r || r.items.length === 0;
    });
    if (needRetry.length > 0) {
      send({ type: "pipeline", stage: "section-retry", message: `Retrying ${needRetry.length} empty division(s) so none are dropped from the BOQ...` });
      const retried = await runWithConcurrency(needRetry, 2, runSection);
      for (const rr of retried) {
        if (rr.items.length === 0) continue; // still empty — nothing to merge
        const idx = sectionResults.findIndex((x) => x.sowRef === rr.sowRef);
        if (idx >= 0) sectionResults[idx] = rr;
        else sectionResults.push(rr);
      }
      const stillEmpty = sectionResults.filter((r) => r.items.length === 0).length;
      send({ type: "pipeline", stage: "section-retry", message: stillEmpty > 0 ? `${needRetry.length - stillEmpty} recovered; ${stillEmpty} division(s) still empty (provider unavailable or genuinely no scope).` : `All ${needRetry.length} recovered — no missing divisions.` });
    }

    const allItems: MergedItem[] = sectionResults.flatMap(r => r.items);

    // ── Stage 3 — Completeness Verifier (dynamic, per-check) ─────────────
    // The verifier iterates roster.verifierChecks — these were INVENTED by
    // the Agent Designer per project, so they're SOW-specific (e.g. "Is
    // synthetic turf installation present?" for a kennel-repair project,
    // "Is raised-floor underdeck cabling included?" for a data-centre fit-
    // out). No static discipline checklist. If the designer produced zero
    // checks (fallback path) we report a trivial completeness summary and
    // skip the per-check loop.
    const totalToolCalls = sectionResults.reduce((s, r) => s + r.toolCalls, 0);
    const totalGrounded = sectionResults.reduce((s, r) => s + r.groundedCount, 0);

    if (roster.verifierChecks.length === 0) {
      send({
        type: "agent",
        agent: "verifier",
        status: roster.isFallback ? "warning" : "complete",
        message: roster.isFallback
          ? "Verifier skipped — Agent Designer fell back, so no project-specific checks were generated."
          : "Verifier had no checks to run — the designer judged the section agents alone were sufficient.",
      });
    }

    send({
      type: "agent",
      agent: "verifier",
      status: "running",
      message: `Auditing ${roster.verifierChecks.length} project-specific check(s) designed for this ${roster.projectType} project — ${allItems.length} items produced so far.`,
    });

    // Shared project context block — same for every check so the LLM can
    // judge against the actual SOW, not just bullet-point titles.
    const sectionListing = outline.sections
      .map(s => `  • ${s.sowRef} (ourRef ${s.ourRef}) ${s.title}`)
      .join("\n");
    const verifierProjectContext = `Project: "${project.name}"

Project type (from Agent Designer): ${roster.projectType}
Project description: ${roster.projectDescription}
Scope areas: ${roster.scopeAreas.join(", ") || "(none listed)"}

SOW EXCERPT (truncated to fit context):
${rawContent.slice(0, 2500)}

SOW SECTIONS (use these refs verbatim if you propose a missing item):
${sectionListing}`;

    // Loose keyword match so the LLM sees what's already produced that touches
    // each check's topic. Builds the haystack from the check topic + description.
    const checkMatchesItem = (check: VerifierCheck, item: MergedItem): boolean => {
      const tokens = `${check.topic} ${check.description}`
        .toLowerCase()
        .split(/[\s,/&()]+/)
        .filter(t => t.length > 3)
        .slice(0, 12);
      const haystack = `${item.category ?? ""} ${item.description ?? ""}`.toLowerCase();
      return tokens.some(t => haystack.includes(t));
    };

    interface CheckDecision {
      key: string;
      topic: string;
      satisfied: boolean;
      reason: string;
      existing: number;
      added: number;
      parseError: string | null;
    }
    const decisions: CheckDecision[] = [];

    for (const check of roster.verifierChecks) {
      send({
        type: "agent",
        agent: "verifier",
        status: "running",
        message: `Checking: ${check.topic}...`,
      });

      const relevantItems = allItems.filter(i => checkMatchesItem(check, i));
      const existingDigest = relevantItems.length > 0
        ? relevantItems.slice(0, 15)
            .map(i => `  [${i.sowRef ?? "?"}] ${i.category}: ${(i.description ?? "").slice(0, 160)}`)
            .join("\n")
        : "(none — no items so far touch this check's topic)";

      const checkSystem = `You are a BOQ scope auditor running ONE project-specific completeness check at a time.

The Agent Designer invented this check based on the SOW for this project. Your job:
1. Is this check satisfied by items the section agents already produced?
2. If NOT satisfied, propose 1-3 missing items grounded in the SOW that would satisfy it.

BE CONSERVATIVE. Only propose missing items when the SOW actually implies them. Do NOT pad the BOQ with generic boilerplate. If the existing items already satisfy the check, set "satisfied": true and return missingItems=[].

Return ONLY a raw JSON object — no markdown, no preamble. Schema:
{
  "satisfied": true | false,
  "reason": "1-2 sentence justification, quoting SOW phrasing where possible",
  "missingItems": [
    {
      "sowRef": "<reuse an existing SOW section ref from the outline>",
      "ourRef": "<corresponding ourRef>",
      "subRef": null,
      "srNo": "<auto-numbered, e.g. 4.99>",
      "category": "<topic of the check>",
      "description": "<specific, technical, grounded in the SOW; include sizes/specs from the SOW where given>",
      "unit": "m | m² | m³ | kg | ton | EA | Set | LS | PM",
      "quantity": <positive number>,
      "unitPrice": null,
      "notes": "<why this was missed — quote the SOW phrase if possible>",
      "remarks": null,
      "aiConfidence": 0.6,
      "drawingRefs": []
    }
  ]
}

Rules:
  • Return missingItems=[] if satisfied=true.
  • Max 3 missingItems.
  • quantity MUST be > 0. If a quantity can't be grounded, use quantity 1 but KEEP the item's true measured unit (pavement→m², curb→m, concrete→m³, doors→EA, rebar→ton); {unit:"LS"} is ONLY for genuine lump deliverables (mobilization, design, submittals, testing, making-good) — NEVER for a measurable item with an unknown quantity.
  • sowRef MUST match one of the existing SOW section refs listed in the prompt. Do not invent new section numbers.
  • Every description must reference something the SOW actually says — no generic boilerplate.
  • ${ESTIMATOR_VERIFIER_HINT}
  • UNIT must match the item's discipline. Each discipline has its OWN independent standard unit set (MEP do NOT share one list):
${formatDisciplineUnitsForPrompt()}`;

      const checkPrompt = `${verifierProjectContext}

CHECK TO AUDIT (designed by the Agent Designer for THIS project)
  Topic: ${check.topic}
  Description: ${check.description}
  Rationale (why this matters here): ${check.rationale}
  ${check.measurementHint ? `Measurement hint: ${check.measurementHint}` : ""}

ITEMS ALREADY PRODUCED THAT MAY TOUCH THIS CHECK (${relevantItems.length}):
${existingDigest}

Now decide and respond.`;

      type CheckResponse = { satisfied?: boolean; reason?: string; missingItems?: RawBoqItem[] };
      let parsed: CheckResponse | null = null;
      let parseError: string | null = null;
      let llmContent = "";
      try {
        const resp = await client.chat.completions.create({
          model,
          // Verifier response is a tiny JSON object (at most 3 missingItems,
          // each ~150 tokens). Without a cap, OpenRouter/OpenAI pre-reserves
          // the model's full output budget (typically 16K tokens) against
          // your credit balance — which is what blew up the Butler City Park
          // run with "You requested up to 16384 tokens, but can only afford
          // 811". 1500 tokens is comfortably above what any well-formed
          // response actually consumes here.
          max_tokens: 1500,
          messages: [
            { role: "system", content: checkSystem },
            { role: "user", content: checkPrompt },
          ],
        });
        llmContent = resp.choices[0]?.message?.content ?? "";
        try {
          parsed = JSON.parse(extractJSON(llmContent)) as CheckResponse;
        } catch (firstParseErr) {
          try {
            parsed = JSON.parse(jsonrepair(extractJSON(llmContent))) as CheckResponse;
            parseError = "jsonrepair fixed malformed JSON";
          } catch {
            parseError = `parse failed: ${firstParseErr instanceof Error ? firstParseErr.message.slice(0, 140) : String(firstParseErr)}`;
            req.log.warn(
              { check: check.key, snippet: llmContent.slice(0, 300) },
              "verifier check parse failed",
            );
          }
        }
      } catch (err) {
        parseError = `LLM call failed: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`;
        req.log.warn({ err, check: check.key }, "verifier check LLM call failed");
      }

      const satisfied = parsed?.satisfied === true;
      const reason = ((parsed?.reason ?? parseError ?? "no response from model") as string).slice(0, 240);
      let addedThis = 0;

      if (!satisfied && Array.isArray(parsed?.missingItems)) {
        const validSowRefs = new Set<string>(outline.sections.map(s => s.sowRef));
        for (const mi of parsed.missingItems.slice(0, 3)) {
          const matchingSection = mi.sowRef && validSowRefs.has(mi.sowRef)
            ? outline.sections.find(s => s.sowRef === mi.sowRef)
            : null;
          const normalised: RawBoqItem = {
            ...mi,
            category: mi.category || check.topic,
            unit: normalizeUnit(mi.unit),
            sowRef: matchingSection?.sowRef ?? null,
            ourRef: matchingSection?.ourRef ?? mi.ourRef ?? null,
            subRef: mi.subRef ?? null,
            srNo: mi.srNo ?? null,
          };
          if (!normalised.sowRef) {
            req.log.warn(
              { check: check.key, rejected: mi.sowRef ?? "(none)" },
              "verifier item rejected — sowRef does not match any outline section",
            );
            continue;
          }
          if (detectGarbageItem(normalised)) continue;
          const verificationNotes = (mi as { notes?: string }).notes
            ?? `Added by completeness verifier — check "${check.topic}"`;
          try {
            const { dbId, saved } = await insertBoqItem(id, normalised, "secondary_only", verificationNotes, []);
            allItems.push({
              ...normalised,
              sourceAgent: "verifier",
              sourceLabel: `Completeness Verifier (${check.topic})`,
              verificationStatus: "secondary_only",
              verificationNotes,
              dbId,
              drawingReferences: [],
            });
            send({ type: "item", item: saved });
            addedThis++;
          } catch (err) {
            req.log.warn({ err, check: check.key }, "failed to persist verifier item");
          }
        }
      }

      decisions.push({
        key: check.key,
        topic: check.topic,
        satisfied,
        reason,
        existing: relevantItems.length,
        added: addedThis,
        parseError,
      });

      send({
        type: "agent",
        agent: "verifier",
        status: "running",
        message: satisfied
          ? `${check.topic}: satisfied — ${reason.slice(0, 140)}`
          : (addedThis > 0
              ? `${check.topic}: gap filled — added ${addedThis} item(s). ${reason.slice(0, 120)}`
              : `${check.topic}: gap — no items added. ${reason.slice(0, 140)}`),
      });
    }

    const totalChecks = decisions.length;
    const satisfiedCount = decisions.filter(d => d.satisfied || d.added > 0).length;
    const completenessScore = totalChecks === 0 ? 1.0 : satisfiedCount / totalChecks;
    const totalAdded = decisions.reduce((s, d) => s + d.added, 0);
    const parseFails = decisions.filter(d => d.parseError).length;

    const finalSummary = decisions
      .map(d => {
        const tag = d.satisfied ? "[satisfied]" : d.added > 0 ? "[gap filled]" : "[gap]";
        const stats = `${d.existing} existing + ${d.added} added`;
        return `  ${tag} ${d.topic} (${stats}) — ${d.reason.slice(0, 140)}`;
      })
      .join("\n");

    if (roster.verifierChecks.length > 0) {
      send({
        type: "agent",
        agent: "verifier",
        status: parseFails > 0 ? "warning" : "complete",
        message: `Completeness ${Math.round(completenessScore * 100)}% — ${satisfiedCount}/${totalChecks} checks satisfied. Added ${totalAdded} missing item(s).${parseFails > 0 ? ` ${parseFails} check(s) failed to parse.` : ""}\n${finalSummary}`,
      });
    }

    // ── Stage 4 — Estimator QA pass (pure code, ZERO model tokens) ───────
    // Score every produced line against the human-estimator quality rules,
    // tag it with a scope type, and surface the weak lines so the QS knows
    // exactly which descriptions still read "consultant-generic". We also
    // write the scope-type tag into the AIGCC "Remarks" column and append a
    // compact QA note to the item's provenance notes (no schema change —
    // existing fields only). Nothing here touches a quantity or a unit.
    send({
      type: "agent",
      agent: "verifier",
      status: "running",
      message: `Running estimator QA on ${allItems.length} line(s) (description quality, scope-type tagging, MEP testing coverage)...`,
    });

    const scopeCounts: Record<string, number> = {};
    const flagCounts: Record<string, number> = {};
    const confCounts: Record<string, number> = { High: 0, Medium: 0, Low: 0, TBD: 0 };
    const weakItems: Array<{ srNo: string | null; sowRef: string | null; score: number; flags: string[]; description: string }> = [];
    const reviewItems: Array<{ srNo: string | null; sowRef: string | null; severity: string; reasons: string[]; description: string }> = [];
    let qualityTotal = 0;

    // Group by SOW section so we can spot MEP sections with no testing line.
    const itemsBySection = new Map<string, MergedItem[]>();
    for (const it of allItems) {
      const key = it.sowRef ?? "?";
      const arr = itemsBySection.get(key) ?? [];
      arr.push(it);
      itemsBySection.set(key, arr);
    }

    for (const it of allItems) {
      const qa = assessItemQuality(it);
      qualityTotal += qa.score;
      scopeCounts[qa.scopeType] = (scopeCounts[qa.scopeType] ?? 0) + 1;
      for (const f of qa.flags) flagCounts[f.code] = (flagCounts[f.code] ?? 0) + 1;

      if (qa.score < 0.6) {
        weakItems.push({
          srNo: it.srNo ?? null,
          sowRef: it.sowRef ?? null,
          score: qa.score,
          flags: qa.flags.map(f => f.code),
          description: (it.description ?? "").slice(0, 120),
        });
      }

      // Evidence confidence (High/Medium/Low/TBD) — the design's Primary Position.
      const conf = quantityConfidence({ ...it, drawingRefCount: it.drawingReferences.length });
      confCounts[conf] = (confCounts[conf] ?? 0) + 1;

      // Quantity Validator — flag lines whose quantity a human must check
      // (measurable item left provisional, priced LS, or unit↔method mismatch).
      const qv = validateQuantity(it);
      if (qv.needsReview) {
        reviewItems.push({
          srNo: it.srNo ?? null,
          sowRef: it.sowRef ?? null,
          severity: qv.severity ?? "low",
          reasons: qv.reasons,
          description: (it.description ?? "").slice(0, 120),
        });
      }

      // Persist scope-type → remarks (the AIGCC "Remarks" column; only when
      // empty, never clobber model-set text) and the scope-type + QA + review
      // tag → notes (the field the BOQ edit dialog + CSV export show). The
      // QA_NOTE_MARKER makes the notes append idempotent across re-runs. Items
      // needing review also get verificationStatus="needs_review" so a QS can
      // filter them — the approval gate (approvalStatus) is untouched.
      const scopeTag = scopeTypeRemark(qa.scopeType);
      const qNote = `${qualityNote(qa)}${reviewSuffix(qv)}${confidenceSuffix(conf)}`;
      const newRemarks = !it.remarks && scopeTag ? scopeTag : it.remarks ?? null;
      const newNotes = (it.notes ?? "").includes(QA_NOTE_MARKER)
        ? it.notes ?? null
        : `${it.notes ? `${it.notes} ` : ""}${qNote}`;
      const setObj: Partial<typeof boqItemsTable.$inferInsert> = { remarks: newRemarks, notes: newNotes };
      if (qv.needsReview) setObj.verificationStatus = "needs_review";
      if (newRemarks !== (it.remarks ?? null) || newNotes !== (it.notes ?? null) || qv.needsReview) {
        try {
          await db.update(boqItemsTable).set(setObj).where(eq(boqItemsTable.id, it.dbId));
        } catch (err) {
          req.log.warn({ err, dbId: it.dbId }, "failed to persist QA enrichment");
        }
      }
    }

    // MEP / commissioned-system sections (by their own SOW title — NOT by stray
    // per-line keyword hits) that produced lines but no testing & commissioning
    // line. A Civil/Architectural section with one incidental "pipe" line is not
    // flagged; HVAC/Plumbing/Electrical/Fire/Telecom are.
    const mepSectionsMissingTesting: string[] = [];
    for (const section of outline.sections) {
      if (!isMepSectionTitle(section.title)) continue;
      const items = itemsBySection.get(section.sowRef);
      if (!items || items.length === 0) continue;
      if (!items.some(isTestingLine)) {
        mepSectionsMissingTesting.push(`${section.sowRef} ${section.title}`.trim());
      }
    }

    const avgQuality = allItems.length > 0 ? qualityTotal / allItems.length : 1;
    const weakCount = weakItems.length;
    const scopeSummary = Object.entries(scopeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}: ${n}`)
      .join(" · ");
    const flagSummary = Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(", ") || "none";
    const weakSummary = weakItems
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map(w => `  • [${w.sowRef ?? "?"} ${w.srNo ?? ""}] ${Math.round(w.score * 100)}% (${w.flags.join(", ")}) — ${w.description}`)
      .join("\n");

    // Sort review items high → low so the most urgent show first.
    const SEV_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };
    reviewItems.sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));
    const reviewCount = reviewItems.length;
    const reviewHigh = reviewItems.filter(r => r.severity === "high").length;
    const reviewSummary = reviewItems
      .slice(0, 15)
      .map(r => `  • [${r.sowRef ?? "?"} ${r.srNo ?? ""}] (${r.severity}) ${r.reasons.join("; ")} — ${r.description}`)
      .join("\n");

    // Structured event the UI can use later; current frontend ignores unknown
    // event types harmlessly (same pattern as the narrative `context` events).
    // Evidence coverage (design success metric): share of lines that are NOT TBD.
    const tbdCount = confCounts.TBD ?? 0;
    const evidenceCoverage = allItems.length > 0 ? (allItems.length - tbdCount) / allItems.length : 1;
    const confSummary = `High ${confCounts.High} · Medium ${confCounts.Medium} · Low ${confCounts.Low} · TBD ${tbdCount}`;

    send({
      type: "quality",
      avgQuality,
      weakCount,
      scopeCounts,
      flagCounts,
      confidenceCounts: confCounts,
      evidenceCoverage,
      tbdCount,
      weakItems: weakItems.slice(0, 50),
      mepSectionsMissingTesting,
      reviewCount,
      reviewHigh,
      reviewItems: reviewItems.slice(0, 60),
    });

    send({
      type: "agent",
      agent: "verifier",
      status: weakCount > 0 || reviewCount > 0 || mepSectionsMissingTesting.length > 0 ? "warning" : "complete",
      message:
        `Estimator QA: avg description quality ${Math.round(avgQuality * 100)}% · ${weakCount} weak line(s).\n` +
        `Evidence coverage ${Math.round(evidenceCoverage * 100)}% — confidence: ${confSummary} (TBD = no evidence, shows "TBD" in the BOQ).\n` +
        `⚠ Quantity Validator: ${reviewCount} line(s) need human review (${reviewHigh} high-priority).\n` +
        `Scope mix — ${scopeSummary || "n/a"}.\n` +
        `Flags — ${flagSummary}.` +
        (mepSectionsMissingTesting.length > 0
          ? `\n⚠ MEP section(s) with no testing & commissioning line: ${mepSectionsMissingTesting.join("; ")}.`
          : "") +
        (reviewCount > 0 ? `\nLines flagged for review (verificationStatus=needs_review):\n${reviewSummary}` : "") +
        (weakCount > 0 ? `\nWeakest descriptions:\n${weakSummary}` : ""),
    });

    const verificationSummary = {
      totalItems: allItems.length,
      agreedCount: allItems.filter(i => i.verificationStatus === "primary_only" || i.verificationStatus === "agreed").length,
      discrepancyCount: 0,
      primaryOnlyCount: allItems.filter(i => i.verificationStatus === "primary_only").length,
      secondaryOnlyCount: allItems.filter(i => i.verificationStatus === "secondary_only").length,
      overallConfidence: completenessScore,
      domainsRepresented: roster.verifierChecks.length,
      cadToolCalls: totalToolCalls,
      cadReferencesUsed: totalGrounded,
      itemsWithDrawingRefs: allItems.filter(i => i.drawingReferences.length > 0).length,
      sectionsCovered: sectionResults.length,
      // Estimator QA (pure-code Pass 7)
      avgDescriptionQuality: avgQuality,
      weakLineCount: weakCount,
      mepSectionsMissingTesting,
      // Quantity Validator
      itemsNeedingReview: reviewCount,
      highPriorityReview: reviewHigh,
      // Evidence confidence (design Primary Position)
      confidenceCounts: confCounts,
      evidenceCoverage,
      tbdQuantityCount: tbdCount,
    };

    // Store the input fingerprint so an unchanged re-click returns THIS same BOQ.
    await db.update(projectsTable).set({ status: "completed", boqFingerprint: fingerprint, updatedAt: new Date() }).where(eq(projectsTable.id, id));

    send({
      type: "pipeline",
      stage: "complete",
      message: `Done — ${allItems.length} items across ${sectionResults.length} SOW section(s). ${verificationSummary.itemsWithDrawingRefs} grounded in CAD.`,
      summary: verificationSummary,
    });
    send({ done: true });
    res.end();
  } catch (err) {
    req.log.error(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const stackHead = err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 4).join(" ↩ ") : "";
    send({ type: "error", message: `Multi-agent pipeline failed: ${message}${stackHead ? ` || at ${stackHead}` : ""}` });
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

function resolveDrawingRefs(
  modelRefs: string[] | undefined | null,
  toolboxGrounded: Set<string>,
): DrawingRefDetail[] {
  const all = new Set<string>();
  for (const r of modelRefs ?? []) {
    if (typeof r === "string" && r.trim().length > 0) all.add(r.trim());
  }
  if (all.size === 0) {
    for (const r of toolboxGrounded) all.add(r);
  }
  return Array.from(all).map(parseRefId).slice(0, 12);
}

/**
 * Recover a partial items[] array from a JSON response that was truncated
 * mid-output (common when small models hit max_tokens before closing brackets).
 * Walks the text after `"items":[` character-by-character tracking brace depth
 * and string state; emits each top-level object that closed cleanly. The
 * malformed tail is silently dropped.
 */
function salvagePartialItems(text: string): RawBoqItem[] {
  const itemsKey = text.search(/"items"\s*:\s*\[/);
  if (itemsKey === -1) return [];
  // Position after the opening "[" of the items array
  const start = text.indexOf("[", itemsKey) + 1;
  if (start <= 0) return [];

  const out: RawBoqItem[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const slice = text.slice(objStart, i + 1);
        try {
          out.push(JSON.parse(slice) as RawBoqItem);
        } catch {
          // Skip — malformed inner object, move on to the next.
        }
        objStart = -1;
      }
    } else if (c === "]" && depth === 0) {
      // Clean end of array
      break;
    }
  }
  return out;
}

function describeProvider(provider: Provider, config: ProviderConfig, model: string): string {
  if (provider === "ollama") return `Ollama at ${config.ollamaUrl ?? "(default URL)"} (model "${model}")`;
  if (provider === "openrouter") return `OpenRouter (model "${model}")`;
  if (provider === "groq") return `Groq (model "${model}")`;
  if (provider === "anthropic") return `Anthropic (model "${model}")`;
  return `OpenAI (model "${model}")`;
}

function formatOutlineWithHighlight(outline: SowOutline, focusRef: string): string {
  const lines: string[] = [];
  for (const s of outline.sections) {
    const marker = s.sowRef === focusRef ? "▶▶▶" : "   ";
    const tag = s.sowRef === focusRef ? `[${s.sowRef} ${s.title.toUpperCase()}]` : `${s.sowRef} ${s.title}`;
    lines.push(`${marker} ${tag}`);
  }
  return lines.join("\n");
}

export default router;

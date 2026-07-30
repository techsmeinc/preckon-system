/**
 * Multimodal vision pre-pass — adds a layer of "what the PDF actually
 * looks like" intelligence on top of the text-only extraction.
 *
 * Flow:
 *   1. Pick the project's successfully-ingested PDFs. Both drawings AND
 *      tender/RFP/SOW/spec documents are eligible — many tender PDFs embed
 *      photographs, image-only tables, scanned schedules, or floor-plan
 *      thumbnails that the text-mode extractor completely loses.
 *   2. Ask the Python sidecar to rasterize each page (capped) to base64 PNGs.
 *   3. For each page, call a vision model with a prompt tailored to the
 *      source document type:
 *        • drawings → "list fixtures/doors/equipment/dimensions/schedules"
 *        • tender/RFP/SOW/spec → "extract scope items, quantities, tables,
 *          equipment specs, room schedules, and any text in images"
 *      Vision models return free-text.
 *   4. Persist each page's findings as a `vision_finding` cad_chunk tagged
 *      with the source document's actual sourceDocumentType so the existing
 *      search_drawing / search_documents tools route them correctly in the
 *      agentic loop — no plumbing change needed in cad-tools.ts.
 *
 * Provider routing (the gate that broke the KFH RFP run):
 *   - Ollama → calls /api/generate with images[]; picks a locally-installed
 *     VLM via pickVisionOllamaModel(); warms it up to absorb cold-load.
 *   - OpenAI / OpenRouter → calls chat.completions with image_url content;
 *     picks a cheap vision-capable model on the same provider (gemini-2.5-flash
 *     on OpenRouter, gpt-4o-mini on OpenAI) UNLESS the user's main model is
 *     itself vision-capable (Claude / GPT-4o / Gemini), in which case it reuses
 *     the user's model so they don't pay for two.
 *   - Groq → currently skipped (no production-grade vision endpoint; the few
 *     vision models on Groq are preview and frequently rate-limit out).
 *   - When no VLM is reachable, the pre-pass is a no-op and the rest of the
 *     pipeline runs as before.
 */
import { db } from "@workspace/db";
import { cadChunksTable, cadExtractionsTable, documentsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { embedTexts, EMBEDDING_MODEL, isEmbeddingsEnabled } from "./embeddings";
import { invalidateProjectIndex } from "./hybrid-retrieval";
import { getAIClient, pickVisionOllamaModel, type Provider, type ProviderConfig, type AIClient } from "./ai-provider";

const SIDECAR_URL = (process.env.CAD_EXTRACTOR_URL ?? "http://127.0.0.1:7400").replace(/\/$/, "");

interface RenderedPage { page: number; width: number; height: number; b64: string }
interface RenderResponse { file: string; pageCount: number; rendered: RenderedPage[]; renderedCount: number; truncated: boolean }

/**
 * Per-page prompts sent to the vision model. We deliberately ask for STRUCTURED
 * bullet output so the resulting chunk text is easy to retrieve and read.
 * The vision model only sees ONE page at a time — keeps context small and
 * keeps the cost per page low.
 */
const DRAWING_VISION_PROMPT = `You are a Senior Quantity Surveyor examining ONE sheet of a construction drawing PDF.
List every BOQ-relevant detail you can see on this sheet. Be specific and precise. Use bullet points.

Cover (when visible):
  • Sheet title, sheet number, scale, project name
  • Equipment, fixtures, doors, windows, partitions visible — with counts and sizes
  • Layer or system labels (LIGHTING, POWER, HVAC, PLUMBING, FIRE, etc.)
  • Schedules / tables (door schedule, finish schedule, equipment schedule) — list rows
  • Dimensions called out on the sheet (e.g. "5400mm", "120 m²")
  • Room names / area labels
  • Notes the contractor needs to know

Do NOT invent items the sheet does not show. Output bullet points only — no preamble, no JSON.`;

const DOCUMENT_VISION_PROMPT = `You are a Senior Quantity Surveyor reading ONE page of a tender / RFP / SOW / specification PDF.
This page may contain text, images, photos, diagrams, scanned tables, or any combination.
Extract every BOQ-relevant fact visible on this page. Be exhaustive and precise. Use bullet points.

Cover (when visible):
  • The page heading / section number (e.g. "2.4 Main Works", "Section 3 – Electrical")
  • Scope-of-work items, deliverables, milestones, mandatory clauses
  • Any TABLE — transcribe rows verbatim, in pipe-delimited format:
        "Header1 | Header2 | ... → Row1Cell1 | Row1Cell2 | ..."
    This includes BOQ-style tables, price schedules, quantity tables,
    door schedules, finish schedules, room data sheets, equipment lists,
    specification grids — anything that looks like a grid of cells.
  • Quantities and units (e.g. "120 m²", "5400mm", "6 nos.", "1 lot")
  • Equipment / fixture / material specs (make, model, rating, capacity)
  • Room names, floor levels, area numbers, drawing references
  • ANY text visible in an image, photo, screenshot, or scanned region
  • Any drawings, plans, sketches, or photos — describe what they show
    (e.g. "site plan showing 3 buildings labelled A/B/C with dimensions
    18m × 12m each", "photo of equipment skid with 4 pumps")
  • Notes, exclusions, assumptions the contractor must respect

Do NOT invent items the page does not show. Do NOT skip image content — if it
is an image, describe or transcribe everything visible inside it. Output bullet
points only — no preamble, no JSON.`;

function pickPromptFor(sourceDocumentType: string): string {
  return sourceDocumentType === "drawing" ? DRAWING_VISION_PROMPT : DOCUMENT_VISION_PROMPT;
}

// Document types eligible for the vision pre-pass. Drawings are the original
// use case (vector PDFs with sheet content); the tender/RFP/SOW/spec types
// are included because real-world tender packages embed photos, scanned
// schedules, and image-only tables that the text-mode extractor loses.
const VISION_ELIGIBLE_DOC_TYPES = ["drawing", "tender", "rfp", "sow", "specification", "addendum", "other"] as const;

// ── Large-document caps ──────────────────────────────────────────────────────
// The vision pre-pass is the ONLY thing that turns scanned/image-only pages
// (tables, schedules, stamped drawings) into searchable text. The old caps
// (4 docs × 30 pages) silently dropped everything past page 30 / the 4th doc,
// so big tenders (100+ page PDFs) lost most of their content invisibly.
//
// Defaults raised for real tender sets. A TOTAL-page budget across all docs
// stops a "many big PDFs" project from exploding into hundreds of paid VLM
// calls. All three are env-tunable on the VPS without a code change:
//   VISION_MAX_DOCS           (default 8)
//   VISION_MAX_PAGES_PER_DOC  (default 80)
//   VISION_MAX_TOTAL_PAGES    (default 240)  — hard ceiling across the whole run
function visionEnvInt(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
}
const DEFAULT_MAX_DOCS = visionEnvInt("VISION_MAX_DOCS", 8);
const DEFAULT_MAX_PAGES_PER_DOC = visionEnvInt("VISION_MAX_PAGES_PER_DOC", 80);
const MAX_TOTAL_PAGES = visionEnvInt("VISION_MAX_TOTAL_PAGES", 240);
// Pages rendered per sidecar call. Rendering a whole big PDF at once returns a
// ~100MB+ blob (OOM/timeout); small batches keep each response + the in-memory
// image set bounded, so 100–400 page tenders process reliably.
const RENDER_BATCH = visionEnvInt("VISION_RENDER_BATCH", 12);
// How many cloud VLM page-calls to run at once. The pre-pass used to be strictly
// sequential (5-15s × pages = 30-100 min on a big PDF). Cloud providers handle a
// few concurrent calls fine, so this cuts wall-clock ~Nx. Ollama is forced to 1
// (single local GPU can't run concurrent VLM inferences). Env-tunable.
const VISION_CONCURRENCY = visionEnvInt("VISION_CONCURRENCY", 4);
// Skip the per-page VLM call on tender/spec (NON-drawing) pages whose text the
// extractor already captured well — those pages add no new info and were the
// bulk of the wasted spend on born-digital PDFs. Drawings are ALWAYS vision-ed
// (their content is graphical, not extractable text). A page is "text-rich" if
// its extracted text ≥ VISION_TEXT_PAGE_MIN_CHARS. Set VISION_SKIP_TEXT_PAGES=0
// to vision every page regardless.
const SKIP_TEXT_PAGES = (process.env.VISION_SKIP_TEXT_PAGES ?? "1") !== "0";
const TEXT_PAGE_MIN_CHARS = visionEnvInt("VISION_TEXT_PAGE_MIN_CHARS", 400);

interface VisionPassOpts {
  projectId: number;
  // The provider the user picked for this run. We honour it for the vision
  // pre-pass so the user only needs to configure one provider/key end-to-end.
  provider: Provider;
  providerConfig: ProviderConfig;
  // The user's main text model — if it already supports vision (Claude /
  // GPT-4o / Gemini), the pre-pass reuses it instead of routing through a
  // separate cheap vision model. Keeps the bill to one model when possible.
  modelHint?: string;
  // Ollama-only: the base URL of the Ollama server. Ignored on cloud providers.
  ollamaBaseUrl?: string;
  // Cap how many documents we visualise per run. The cost is per-page,
  // per-VLM-call (≈3-10s each on local GPU, ~1-3s each on cloud). Defaults to
  // VISION_MAX_DOCS (8); a run-wide page budget (MAX_TOTAL_PAGES) caps total cost.
  maxDocsToProcess?: number;
  // Cap how many pages per document. Defaults to VISION_MAX_PAGES_PER_DOC (80).
  maxPagesPerDoc?: number;
  // When false (default), a document that ALREADY has vision_finding chunks is
  // skipped — the pre-pass is the slowest, most expensive stage and its output
  // doesn't change unless the document is re-ingested (which wipes the doc's
  // chunks, including vision_finding, so the cache self-invalidates). Set true
  // to force a fresh re-analysis of every eligible document.
  forceRefresh?: boolean;
  // Optional callback so the route can stream progress to SSE.
  onProgress?: (msg: { stage: string; message: string }) => void;
}

/**
 * Vision-capable models on each cloud provider that we route the pre-pass to
 * when the user's main model doesn't support vision (e.g. llama-3.3-70b on
 * OpenRouter — exactly what surfaced the KFH RFP failure).
 *
 * Ordered cheapest-first. We deliberately default to small/cheap vision models
 * because the pre-pass produces searchable text chunks for downstream agents —
 * we don't need frontier reasoning to read a scanned schedule.
 */
const OPENROUTER_VISION_FALLBACK = "google/gemini-2.5-flash-lite";
const OPENAI_VISION_FALLBACK = "gpt-4o-mini";
// Haiku is the cheap Claude vision model — page transcription does NOT need
// Sonnet/Opus reasoning, and a big PDF is one VLM call PER PAGE, so the model
// choice dominates the bill. (Was claude-sonnet-4-6.)
const ANTHROPIC_VISION_FALLBACK = "claude-haiku-4-5";

/**
 * Substrings that mark a model as already vision-capable. When the user's
 * main model matches one of these we skip the fallback and use their model
 * directly — Claude/Gemini/GPT-4o-class models all read images natively.
 */
const VISION_CAPABLE_PATTERNS: RegExp[] = [
  /claude/i,                          // any Claude (Sonnet/Haiku/Opus, 3.x/4.x)
  /gpt-4o/i, /gpt-4\.1/i, /gpt-5/i,   // OpenAI multimodal families
  /gemini/i,                          // any Gemini model on OpenRouter/Google
  /llama-3\.2-(\d+b-)?vision/i,       // Meta vision variants
  /qwen[-\.]?2\.?5?[-]?vl/i,          // Qwen2.5-VL variants
  /pixtral/i, /mistral.*vision/i,     // Mistral vision
];

function isVisionCapableModel(model: string | undefined | null): boolean {
  if (!model) return false;
  return VISION_CAPABLE_PATTERNS.some(re => re.test(model));
}

/**
 * Pick the model the cloud vision pre-pass should call.
 *
 * Policy (changed): ALWAYS prefer the cheap per-provider vision model, even
 * when the user's main model is itself vision-capable. A big PDF is one VLM
 * call per page, so reusing a premium main model (Sonnet/Opus/GPT-4o) for 100s
 * of page-reads was ~10-20× more expensive for zero quality gain — reading text
 * and tables off a page needs OCR-grade vision, not frontier reasoning.
 *
 * Override with VISION_MODEL=<id> to force a specific model (e.g. to use a
 * stronger VLM on an unusually dense scanned set). If a cheap fallback isn't
 * defined for the provider we fall back to the user's main model so the pass
 * still runs rather than silently skipping.
 */
function pickCloudVisionModel(provider: Provider, modelHint?: string): string | null {
  const override = process.env.VISION_MODEL?.trim();
  if (override) return override;
  if (provider === "openai") return OPENAI_VISION_FALLBACK;
  if (provider === "openrouter") return OPENROUTER_VISION_FALLBACK;
  if (provider === "anthropic") return ANTHROPIC_VISION_FALLBACK;
  // Unknown provider with no cheap fallback: reuse the main model only if it
  // can see, else skip.
  return isVisionCapableModel(modelHint) ? modelHint! : null;
}

export interface VisionPassResult {
  visionModel: string | null;
  documentsProcessed: number;
  // Documents skipped because they already had vision findings cached.
  documentsCached?: number;
  pagesProcessed: number;
  chunksAdded: number;
  skippedReason?: string;
}

async function callOllamaVision(
  baseUrl: string,
  model: string,
  prompt: string,
  imageB64: string,
  // 6 minutes — first call to a freshly-loaded VLM (cold model + first image)
  // can easily be 60-180s. Subsequent calls are 5-15s. 6 minutes covers both
  // the worst-case cold load and a complex multi-element drawing page.
  timeoutMs = 360_000,
): Promise<string> {
  // Ollama's native /api/generate endpoint accepts an "images" array of
  // base64-encoded PNGs alongside the prompt — the OpenAI-compatible /v1
  // endpoint also supports this via content-array messages, but /api/generate
  // is simpler and well-supported across all VLMs (qwen2.5vl, llava, minicpm-v).
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageB64],
        stream: false,
        // keep_alive: keep the model loaded across multiple calls so we only
        // pay cold-load once per pre-pass. 10m is plenty for a 30-page pass.
        keep_alive: "10m",
        options: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Ollama vision call ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const body = (await resp.json()) as { response?: string };
    return body.response ?? "";
  } finally {
    clearTimeout(t);
  }
}

/** Thrown when the VLM is too big to load on this machine — caller bails the pass. */
class VlmResourceError extends Error {}

/**
 * Send a single tiny image + 1-token prompt to force the VLM to load into
 * RAM before the per-page loop kicks off. Eats the cold-load cost ONCE so
 * the per-page calls don't trip their individual timeouts on the first try.
 *
 * Crucially: this also catches the "model runner has unexpectedly stopped"
 * Ollama OOM response — so we know upfront whether the chosen VLM fits in
 * available RAM/VRAM, instead of starting a 30-page loop that 500s on every page.
 */
async function warmupVisionModel(baseUrl: string, model: string, onProgress?: (s: string) => void): Promise<void> {
  // 1×1 white PNG, base64 — smallest valid input we can feed.
  const TINY_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  onProgress?.(`Pre-warming "${model}" (loading into RAM, takes 30-90s on first run)...`);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 240_000); // 4 minutes for cold load
  try {
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "ok",
        images: [TINY_PNG],
        stream: false,
        keep_alive: "10m",
        options: { temperature: 0.0, num_predict: 1 },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 400);
      // Ollama's classic OOM signature. The runner crashes on the first
      // forward pass when the model + activations + KV cache exceed VRAM
      // (falls back to CPU) AND free RAM (then the runner process dies).
      if (resp.status === 500 && /unexpectedly stopped|resource limitations/i.test(detail)) {
        throw new VlmResourceError(
          `"${model}" can't fit in available RAM/VRAM on this machine. ` +
          `Pull a smaller VLM (e.g. \`ollama pull moondream\` ~2GB, or \`ollama pull qwen2.5vl:3b\` ~3GB) ` +
          `and either \`ollama rm ${model}\` or restart so the smaller model is picked.`,
        );
      }
      throw new Error(`Ollama warmup ${resp.status}: ${detail}`);
    }
    onProgress?.(`"${model}" warmed up — per-page calls will be ~5-15s each now.`);
  } catch (err) {
    if (err instanceof VlmResourceError) throw err;
    onProgress?.(`Warmup hit an issue (${err instanceof Error ? err.message : String(err)}) — first real page call will absorb the cold-load.`);
  } finally {
    clearTimeout(t);
  }
}

/**
 * OpenAI-compatible vision call. Used for OpenAI direct AND for OpenRouter,
 * both of which speak the same chat.completions schema with image_url content
 * parts. The image is sent inline as a data: URL — vision models on OpenRouter
 * (Gemini Flash, Claude, GPT-4o) all accept this exact format.
 *
 * Why this exists: the original vision pre-pass was hardcoded to Ollama's
 * /api/generate. Users on OpenRouter (the actual production path for paying
 * customers) saw the pre-pass silently skipped, which manifested as the KFH
 * RFP run producing 1 item with 0% completeness — the scanned PDF's content
 * was completely invisible because nothing ever turned its pages into text.
 */
async function callOpenAICompatibleVision(
  client: AIClient,
  model: string,
  prompt: string,
  imageB64: string,
  // 2 minutes — cloud vision models respond in 1-5s typically; 2 minutes
  // covers the long tail (queue depth on busy free-tier endpoints).
  timeoutMs = 120_000,
): Promise<string> {
  const resp = await client.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                // data: URL with the inline PNG. base64 here is already raw
                // (no "data:image/png;base64," prefix from the sidecar) so we
                // wrap it ourselves.
                url: `data:image/png;base64,${imageB64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      // Free-text bullet output; no JSON-mode (the prompt explicitly asks for
      // bullets, and JSON-mode is provider-flaky per project_provider_quirks).
      max_tokens: 1500,
    },
    { timeout: timeoutMs },
  );
  return resp.choices[0]?.message?.content ?? "";
}

// Rasterise a SPECIFIC set of 0-based page indices to base64 PNGs. We request
// pages in small batches (RENDER_BATCH) rather than a whole big PDF at once so
// the render response and the in-memory image set stay small — essential for
// 100–400 page tenders. The sidecar returns the document's full pageCount and
// silently drops any indices past the end, so an over-range final batch comes
// back empty (our caller's stop signal).
async function renderPageBatch(filePath: string, dpi: number, pages: number[]): Promise<RenderResponse> {
  const resp = await fetch(`${SIDECAR_URL}/render-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, dpi, pages, maxPages: pages.length }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`render-pages ${resp.status}: ${detail.slice(0, 200)}`);
  }
  return (await resp.json()) as RenderResponse;
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving the
 * INPUT order in the returned results. JS is single-threaded between awaits, so
 * shared counters mutated inside `fn` are race-free. `limit = 1` ⇒ sequential.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Decide which 0-based page indices of a document need a VLM call.
 *
 * Drawings → every page (their content is graphical; text extraction misses it).
 * Tender/spec docs with SKIP_TEXT_PAGES on → only the pages whose extracted text
 * is below TEXT_PAGE_MIN_CHARS (i.e. image-only / scanned / sparse pages); the
 * text-rich pages were already captured verbatim by the extractor, so a VLM
 * call on them is pure waste. Falls back to "every page" when the stored summary
 * has no usable per-page text signal (conservative — never silently drops).
 */
function planVisionPages(
  summary: unknown,
  isDrawing: boolean,
  docPageCap: number,
): { pages: number[]; totalPages: number | null; skippedTextPages: number; cappedByLimit: boolean } {
  const s = summary as { kind?: string; pageCount?: number; chunks?: Array<{ page_start?: number; page_end?: number; text?: string }> } | null;
  const totalPages = s && Number.isFinite(s.pageCount) && (s.pageCount as number) > 0 ? Math.floor(s.pageCount as number) : null;
  const rangeUpTo = (n: number) => Array.from({ length: n }, (_, i) => i);

  // Per-page text signal only available for document-mode payloads (chunks[]).
  const canSkip = SKIP_TEXT_PAGES && !isDrawing && s?.kind === "document" && Array.isArray(s.chunks) && totalPages !== null;

  let candidate: number[];
  let skippedTextPages = 0;
  if (canSkip) {
    const chars = new Array(totalPages as number).fill(0);
    for (const c of s!.chunks!) {
      const start = Math.max(0, Math.floor(c.page_start ?? 0));
      const end = Math.min((totalPages as number) - 1, Math.floor(c.page_end ?? start));
      const span = Math.max(1, end - start + 1);
      const per = (c.text?.length ?? 0) / span;
      for (let p = start; p <= end; p++) chars[p] += per;
    }
    candidate = [];
    for (let p = 0; p < (totalPages as number); p++) {
      if (chars[p] < TEXT_PAGE_MIN_CHARS) candidate.push(p);
      else skippedTextPages++;
    }
  } else {
    // No usable signal → every page up to the known count (or the cap, letting
    // the over-range render batch come back empty as the natural stop).
    candidate = rangeUpTo(totalPages ?? docPageCap);
  }

  const cappedByLimit = candidate.length > docPageCap;
  return { pages: candidate.slice(0, docPageCap), totalPages, skippedTextPages, cappedByLimit };
}

export async function runVisionPass(opts: VisionPassOpts): Promise<VisionPassResult> {
  const {
    projectId,
    provider,
    providerConfig,
    modelHint,
    ollamaBaseUrl,
    maxDocsToProcess = DEFAULT_MAX_DOCS,
    maxPagesPerDoc = DEFAULT_MAX_PAGES_PER_DOC,
    forceRefresh = false,
    onProgress,
  } = opts;

  // Unconditional entry message — if you don't see this in the UI, the route
  // never called runVisionPass at all. This catches the case where the API
  // server is running stale code (browser cache, build mismatch, etc.).
  onProgress?.({
    stage: "vision-pass",
    message: `Vision pre-pass starting — provider=${provider}, mainModel=${modelHint ?? "(none)"}, project=${projectId}.`,
  });

  // ── 1. Select vision model + execution path based on provider ───────────
  // Ollama → local VLM via /api/generate, with warmup.
  // OpenAI / OpenRouter → OpenAI-compatible chat.completions with image_url.
  // Groq / unknown → skip (no production vision endpoint).
  let visionModel: string | null = null;
  let cloudClient: AIClient | null = null;
  let isOllamaPath = false;

  if (provider === "ollama") {
    isOllamaPath = true;
    if (!ollamaBaseUrl) {
      onProgress?.({ stage: "vision-pass", message: "Ollama provider selected but no base URL supplied — skipping vision pre-pass." });
      return { visionModel: null, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "no-ollama-url" };
    }
    visionModel = await pickVisionOllamaModel(ollamaBaseUrl);
    if (!visionModel) {
      onProgress?.({
        stage: "vision-pass",
        message: `No vision model installed on Ollama (${ollamaBaseUrl}). Skipping multimodal pre-pass. Install one with: ollama pull qwen2.5vl:3b`,
      });
      return { visionModel: null, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "no-vision-model" };
    }
  } else if (provider === "openai" || provider === "openrouter" || provider === "anthropic") {
    visionModel = pickCloudVisionModel(provider, modelHint);
    if (!visionModel) {
      onProgress?.({ stage: "vision-pass", message: `No vision model available on provider "${provider}". Skipping pre-pass.` });
      return { visionModel: null, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "no-vision-model" };
    }
    try {
      cloudClient = getAIClient(provider, providerConfig);
    } catch (err) {
      onProgress?.({ stage: "vision-pass", message: `Cannot build ${provider} client for vision pass: ${err instanceof Error ? err.message : String(err)} — skipping.` });
      return { visionModel: null, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "no-client" };
    }
    const overridden = !!process.env.VISION_MODEL?.trim();
    onProgress?.({
      stage: "vision-pass",
      message: overridden
        ? `Routing vision pre-pass to "${visionModel}" on ${provider} (VISION_MODEL override).`
        : `Routing vision pre-pass to cheap vision model "${visionModel}" on ${provider} (your main model "${modelHint ?? "?"}" is kept for the BOQ reasoning; page-reading uses the cheaper model to cut cost). Override with VISION_MODEL.`,
    });
  } else {
    onProgress?.({ stage: "vision-pass", message: `Provider "${provider}" has no supported vision endpoint — skipping pre-pass. (Tender PDFs with images won't be analysed visually.)` });
    return { visionModel: null, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "provider-no-vision" };
  }

  // Pay the cold-load cost ONCE, up front, before the per-page loop. Without
  // this the first 1-2 page calls trip their individual timeouts while Ollama
  // loads the 5GB VLM into RAM. Cloud providers don't have cold-loads.
  if (isOllamaPath && ollamaBaseUrl && visionModel) {
    onProgress?.({ stage: "vision-pass", message: `Vision model "${visionModel}" detected on Ollama. Starting multimodal pre-pass...` });
    try {
      await warmupVisionModel(ollamaBaseUrl, visionModel, msg =>
        onProgress?.({ stage: "vision-pass", message: msg }),
      );
    } catch (warmupErr) {
      if (warmupErr instanceof VlmResourceError) {
        onProgress?.({ stage: "vision-pass", message: warmupErr.message });
        return { visionModel, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "vlm-too-large" };
      }
      onProgress?.({ stage: "vision-pass", message: `Warmup failed (${warmupErr instanceof Error ? warmupErr.message : String(warmupErr)}); proceeding anyway.` });
    }
  }

  // 2. Pick ALL successfully-parsed PDFs (drawings + tender/RFP/SOW/spec).
  // Tender PDFs with embedded images, scanned tables, or photo schedules are
  // just as important to analyse visually as drawings — text-mode extraction
  // misses everything inside an image.
  const eligibleDocs = await db
    .select({
      id: documentsTable.id,
      filePath: documentsTable.filePath,
      originalName: documentsTable.originalName,
      mimeType: documentsTable.mimeType,
      documentType: documentsTable.documentType,
      extractionId: cadExtractionsTable.id,
      // The raw extractor payload — carries per-page / per-section text so we
      // can skip vision on pages whose text was already fully extracted.
      summary: cadExtractionsTable.summary,
    })
    .from(documentsTable)
    .leftJoin(cadExtractionsTable, eq(cadExtractionsTable.documentId, documentsTable.id))
    .where(and(
      eq(documentsTable.projectId, projectId),
      inArray(documentsTable.documentType, VISION_ELIGIBLE_DOC_TYPES as unknown as string[]),
      eq(documentsTable.cadExtractionStatus, "succeeded"),
    ))
    .limit(maxDocsToProcess);

  if (eligibleDocs.length === 0) {
    onProgress?.({ stage: "vision-pass", message: "No parsed PDFs to analyse — skipping vision pre-pass." });
    return { visionModel, documentsProcessed: 0, pagesProcessed: 0, chunksAdded: 0, skippedReason: "no-eligible-docs" };
  }

  const drawingCount = eligibleDocs.filter(d => d.documentType === "drawing").length;
  const docCount = eligibleDocs.length - drawingCount;
  onProgress?.({
    stage: "vision-pass",
    message: `Will analyse ${eligibleDocs.length} PDF(s): ${drawingCount} drawing(s), ${docCount} tender/spec doc(s). Each page = one VLM call.`,
  });

  let pagesProcessed = 0;
  let chunksAdded = 0;
  let documentsCached = 0;
  // Run-wide page budget so a project with several big PDFs can't explode into
  // hundreds of paid VLM calls. Decremented by each doc's rendered page count.
  let pagesRemaining = MAX_TOTAL_PAGES;

  for (const doc of eligibleDocs) {
    if (!doc.filePath) continue;
    if (!doc.extractionId) continue;
    if ((doc.mimeType ?? "").toLowerCase() !== "application/pdf") continue;

    // Cache: if this document already has vision findings, skip the whole
    // (slow, paid) re-analysis. Re-ingesting the document deletes all of its
    // chunks — vision_finding included — so the cache invalidates itself when
    // the source actually changes. forceRefresh overrides this.
    if (!forceRefresh) {
      const existing = await db
        .select({ id: cadChunksTable.id })
        .from(cadChunksTable)
        .where(and(
          eq(cadChunksTable.documentId, doc.id),
          eq(cadChunksTable.chunkType, "vision_finding"),
        ))
        .limit(1);
      if (existing.length > 0) {
        documentsCached++;
        onProgress?.({ stage: "vision-pass", message: `"${doc.originalName}": using cached vision findings (already analysed). Re-upload/re-ingest the doc, or pass refreshVision=true, to re-run.` });
        continue;
      }
    }

    if (pagesRemaining <= 0) {
      onProgress?.({ stage: "vision-pass", message: `Reached the ${MAX_TOTAL_PAGES}-page vision budget — remaining document(s) were NOT vision-analysed. Raise VISION_MAX_TOTAL_PAGES to cover more.` });
      break;
    }

    const sourceDocumentType = doc.documentType ?? "other";
    const isDrawing = sourceDocumentType === "drawing";
    const visionPrompt = pickPromptFor(sourceDocumentType);
    const extractionId = doc.extractionId; // narrowed non-null by the guard above
    // Never process more pages than the run budget still allows.
    const docPageCap = Math.min(maxPagesPerDoc, pagesRemaining);

    // Decide WHICH page indices actually need a VLM call. Drawings → all pages;
    // tender/spec docs → only image/sparse pages (text-rich pages were already
    // captured by the extractor — skipping them is the big token + time saver).
    const plan = planVisionPages(doc.summary, isDrawing, docPageCap);
    let plannedPages = plan.pages;
    if (plannedPages.length > pagesRemaining) plannedPages = plannedPages.slice(0, pagesRemaining);

    const concurrency = isOllamaPath ? 1 : VISION_CONCURRENCY;
    onProgress?.({
      stage: "vision-pass",
      message: plan.skippedTextPages > 0
        ? `Analysing "${doc.originalName}" [${sourceDocumentType}] — ${plannedPages.length} image/sparse page(s) need vision; skipping ${plan.skippedTextPages} text page(s) already extracted (${concurrency} concurrent, ${pagesRemaining} left in budget).`
        : `Analysing "${doc.originalName}" [${sourceDocumentType}] — up to ${plannedPages.length} page(s) (${RENDER_BATCH}/render @130 DPI, ${concurrency} concurrent, ${pagesRemaining} left in budget). ~5-15s per page.`,
    });

    if (plannedPages.length === 0) {
      onProgress?.({ stage: "vision-pass", message: `"${doc.originalName}": all pages' text was already extracted — no vision needed. (Set VISION_SKIP_TEXT_PAGES=0 to force every page.)` });
      continue;
    }

    // Clear any prior vision_finding chunks for this doc so re-runs don't accumulate dupes.
    await db.delete(cadChunksTable).where(and(
      eq(cadChunksTable.documentId, doc.id),
      eq(cadChunksTable.chunkType, "vision_finding"),
    ));

    // Render + analyse + persist in BATCHES of planned page indices. Each render
    // response stays small AND findings are written incrementally, so a big PDF
    // makes steady progress instead of buffering everything in memory.
    let docPagesSeen = 0;       // pages actually rasterised + sent to the VLM
    let docFindingsStored = 0;  // pages that produced a usable finding
    let renderFailed = false;

    for (let bstart = 0; bstart < plannedPages.length && pagesRemaining > 0; bstart += RENDER_BATCH) {
      const sliceIdx = plannedPages.slice(bstart, bstart + RENDER_BATCH).slice(0, pagesRemaining);
      if (sliceIdx.length === 0) break;

      let batch: RenderResponse;
      try {
        batch = await renderPageBatch(doc.filePath, 130, sliceIdx);
      } catch (err) {
        onProgress?.({ stage: "vision-pass", message: `Render failed for "${doc.originalName}" pages ${sliceIdx[0] + 1}-${sliceIdx[sliceIdx.length - 1] + 1}: ${err instanceof Error ? err.message : String(err)} — stopping this doc.` });
        renderFailed = true;
        break;
      }
      if (batch.rendered.length === 0) break; // past the end of the PDF (contiguous fallback)

      // Per-page vision calls — concurrent on cloud (Ollama forced to 1: a single
      // local GPU can't run concurrent VLM inferences). Order is preserved.
      const results = await mapWithConcurrency(batch.rendered, concurrency, async (pageImg) => {
        if (pagesRemaining <= 0) return null;
        try {
          const text = isOllamaPath
            ? await callOllamaVision(ollamaBaseUrl!, visionModel, visionPrompt, pageImg.b64)
            : await callOpenAICompatibleVision(cloudClient!, visionModel, visionPrompt, pageImg.b64);
          pagesRemaining--;
          pagesProcessed++;
          docPagesSeen++;
          const trimmed = text.trim();
          if (!trimmed) return null;
          const refId = `doc:${doc.id}/page:${pageImg.page}/vision`;
          const chunkText = `[Vision analysis of ${doc.originalName} (${sourceDocumentType}) · page ${pageImg.page + 1}]\n${trimmed}`;
          return { page: pageImg.page, text: chunkText, refId };
        } catch (err) {
          onProgress?.({ stage: "vision-pass", message: `Vision call failed on page ${pageImg.page + 1} of "${doc.originalName}": ${err instanceof Error ? err.message : String(err)}` });
          return null; // one bad page shouldn't tank the whole pass
        }
      });
      const batchFindings = results.filter(
        (f): f is { page: number; text: string; refId: string } => f !== null,
      );

      // Embed + persist THIS batch's findings immediately (bounded memory).
      if (batchFindings.length > 0) {
        const texts = batchFindings.map(f => f.text);
        const embeddings = isEmbeddingsEnabled() ? await embedTexts(texts) : batchFindings.map(() => null);
        await db.insert(cadChunksTable).values(batchFindings.map((f, i) => ({
          extractionId,
          documentId: doc.id,
          projectId,
          chunkType: "vision_finding",
          sourceDocumentType,
          section: null,
          page: f.page,
          layer: null,
          blockName: null,
          sheet: `p${f.page + 1}`,
          refId: f.refId,
          text: f.text,
          embedding: embeddings[i] as unknown,
          embeddingModel: embeddings[i] ? EMBEDDING_MODEL : null,
        })));
        chunksAdded += batchFindings.length;
        docFindingsStored += batchFindings.length;
      }
      onProgress?.({ stage: "vision-pass", message: `"${doc.originalName}": ${docPagesSeen}/${plannedPages.length} planned page(s) analysed, ${docFindingsStored} findings so far...` });
    }

    if (docFindingsStored > 0) invalidateProjectIndex(projectId);

    // Flag only a real CAP truncation (not the intentional text-page skip), so
    // nothing is dropped silently.
    if (!renderFailed && plan.cappedByLimit) {
      onProgress?.({ stage: "vision-pass", message: `"${doc.originalName}" needed more than ${docPageCap} vision page(s); analysed ${plannedPages.length} (cap). Raise VISION_MAX_PAGES_PER_DOC / VISION_MAX_TOTAL_PAGES to include the rest.` });
    }
    onProgress?.({ stage: "vision-pass", message: `"${doc.originalName}": stored ${docFindingsStored} vision finding(s) as searchable chunks.` });
  }

  onProgress?.({ stage: "vision-pass", message: `Multimodal pre-pass complete: ${pagesProcessed} pages analysed across ${eligibleDocs.length} PDF(s)${documentsCached > 0 ? ` (${documentsCached} doc(s) used cached findings — instant)` : ""}, ${chunksAdded} findings indexed.` });
  return { visionModel, documentsProcessed: eligibleDocs.length, documentsCached, pagesProcessed, chunksAdded };
}

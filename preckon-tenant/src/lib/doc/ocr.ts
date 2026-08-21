// Scanned documents: knowing when there is nothing to read.
//
// The upload route extracts PDF text with pdf-parse and records the file as
// `ingested`. A scanned drawing set — photographs of paper, no text layer —
// extracts to nothing, and is recorded as ingested anyway.
//
// That is the same failure the route already warns about one branch over: "a
// drawing we couldn't parse is 'failed', not 'ingested' … that is how a BOQ ends
// up quietly missing a discipline." A scan takes the other branch and gets no
// such treatment. Nothing errors. The file appears in the register, the agents
// read an empty document, and the specification section it contained is simply
// absent from everything downstream.
//
// ── THIS MODULE IS THE DETECTION, NOT THE OCR ────────────────────────────────
//
// Most construction PDFs have a perfectly good text layer and need no OCR at
// all; running it over them would be slow, expensive and worse than the text
// already there. The valuable, engine-independent half is knowing WHICH pages
// need it — and refusing to call a file ingested when it holds no readable
// text.
//
// So the engine sits behind an interface with no implementation chosen here.
// That is a real decision with a cost (a WASM bundle, or a binary in the worker
// image) and it belongs to whoever maintains the deployment.
//
// ── OCR TEXT IS NOT THE SAME AS EXTRACTED TEXT ───────────────────────────────
//
// A text layer is what the author typed. OCR output is a guess about pixels,
// and on construction drawings — small type, hatching, rotated text, dimension
// strings over linework — it is a poor one. "300" and "800" confuse regularly.
//
// So OCR text is marked as such all the way through, and anything that cites it
// carries that provenance. A quantity read off an OCR'd dimension string is not
// the same evidence as one read from a text layer, and a system that presents
// them identically is lying by omission.

/** One page as the extractor produced it. */
export interface ExtractedPage {
  page: number;
  text: string;
}

export type PageKind =
  /** A real text layer with usable content. */
  | "text_layer"
  /** Effectively no text: almost certainly a scan or a pure-image page. */
  | "scanned"
  /** Some text, but far too little for the page — a scan with a stamped title
   *  block, or a drawing whose only text layer is the border. */
  | "sparse"
  /** Genuinely blank: a separator or an intentionally empty page. */
  | "blank";

export interface PageAssessment {
  page: number;
  kind: PageKind;
  characters: number;
  /** Distinct word-like tokens. Catches a page whose "text" is one repeated glyph. */
  words: number;
  needsOcr: boolean;
  why: string;
}

export interface DocumentAssessment {
  pages: PageAssessment[];
  /** True where no page has a usable text layer. */
  entirelyScanned: boolean;
  /** True for a mixed set — some vector sheets, some scans. */
  mixed: boolean;
  pagesNeedingOcr: number[];
  /** What the ingest status should be. */
  ingestStatus: "ingested" | "needs_ocr" | "unreadable";
  warnings: string[];
  summary: string;
}

export interface AssessOptions {
  /** Below this many characters a page is treated as having no text layer. */
  minCharacters?: number;
  /** Below this many distinct words a page is sparse rather than readable. */
  minWords?: number;
}

/* A title block alone runs to a few dozen characters. A drawing sheet with real
   annotation runs to hundreds. The gap between them is where "sparse" lives, and
   it is deliberately generous: calling a readable page scanned costs an OCR run,
   while calling a scan readable costs a missing section nobody notices. */
const MIN_CHARACTERS = 40;
const MIN_WORDS = 8;

const wordsOf = (text: string): string[] =>
  String(text ?? "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/**
 * Assess one page's text layer.
 *
 * Counts DISTINCT words as well as characters. A page whose extraction produced
 * the same ligature four hundred times has plenty of characters and no content,
 * and that is a real pdf-parse failure mode on drawings with embedded subset
 * fonts.
 */
export function assessPage(p: ExtractedPage, opts: AssessOptions = {}): PageAssessment {
  const minChars = opts.minCharacters ?? MIN_CHARACTERS;
  const minWords = opts.minWords ?? MIN_WORDS;

  const text = String(p.text ?? "");
  const characters = text.replace(/\s+/g, "").length;
  const words = new Set(wordsOf(text).map((w) => w.toLowerCase())).size;

  if (characters === 0) {
    return {
      page: p.page, kind: "blank", characters, words, needsOcr: true,
      why: "No text at all. Either a scanned page or a blank one — the two are indistinguishable from the text layer, so it is treated as needing OCR.",
    };
  }
  if (characters < minChars || words < minWords) {
    return {
      page: p.page, kind: characters < minChars ? "scanned" : "sparse", characters, words, needsOcr: true,
      why: `Only ${characters} character(s) across ${words} distinct word(s) — consistent with a scan whose only text layer is a stamped title block or a drawing border. The content of the page is not in the file.`,
    };
  }
  return {
    page: p.page, kind: "text_layer", characters, words, needsOcr: false,
    why: `${characters} characters across ${words} distinct words: a usable text layer.`,
  };
}

/**
 * Assess a whole document, and say what its ingest status should be.
 *
 * The status is the point. `ingested` on a file holding no readable text is the
 * lie that makes everything downstream wrong quietly, so a document with no
 * usable text layer gets `needs_ocr` — visible in the register, and not
 * mistakable for a document that was read.
 */
export function assessDocument(pages: ExtractedPage[], opts: AssessOptions = {}): DocumentAssessment {
  const warnings: string[] = [];

  if (!pages.length) {
    return {
      pages: [], entirelyScanned: false, mixed: false, pagesNeedingOcr: [],
      ingestStatus: "unreadable",
      warnings: ["No pages were extracted from this file at all."],
      summary: "Nothing was extracted from this file.",
    };
  }

  const assessed = pages.map((p) => assessPage(p, opts));
  const readable = assessed.filter((a) => !a.needsOcr);
  const needing = assessed.filter((a) => a.needsOcr);
  const entirelyScanned = readable.length === 0;
  const mixed = readable.length > 0 && needing.length > 0;

  if (entirelyScanned) {
    warnings.push(
      `None of the ${assessed.length} page(s) has a usable text layer. This file has been stored but not read — every agent downstream would see an empty document, and whatever it contains would simply be missing from the bill, the risk register and the compliance check.`,
    );
  } else if (mixed) {
    warnings.push(
      `${needing.length} of ${assessed.length} page(s) have no usable text layer. A mixed set usually means scanned sheets bound in with vector ones — the scanned pages are invisible to everything downstream while the rest read normally, which is the hardest version of this to notice.`,
    );
  }

  const sparse = assessed.filter((a) => a.kind === "sparse");
  if (sparse.length && !entirelyScanned) {
    warnings.push(
      `${sparse.length} page(s) carry a little text but not enough to be the page's content — typically a title block on a scan. Treat their apparent text as a label, not as the drawing.`,
    );
  }

  const ingestStatus = entirelyScanned ? "needs_ocr" : "ingested";

  return {
    pages: assessed,
    entirelyScanned,
    mixed,
    pagesNeedingOcr: needing.map((a) => a.page),
    ingestStatus,
    warnings,
    summary: summarise(assessed.length, readable.length, needing.length, entirelyScanned, mixed),
  };
}

function summarise(total: number, readable: number, needing: number, entirely: boolean, mixed: boolean): string {
  if (entirely) return `${total} page(s), none readable. This file needs OCR before anything can use it.`;
  if (mixed) return `${total} page(s): ${readable} readable, ${needing} needing OCR.`;
  return `${total} page(s), all with a usable text layer.`;
}

/* ────────────────────────────────────────────────────────────────────────────
   The engine seam
   ──────────────────────────────────────────────────────────────────────────── */

export interface OcrResult {
  page: number;
  text: string;
  /** 0–1, as reported by the engine. Null where it does not report one. */
  confidence: number | null;
  engine: string;
}

/**
 * What an OCR engine has to provide.
 *
 * No implementation is chosen here on purpose. The options differ in ways that
 * are a deployment decision rather than a code one: a WASM engine bundles into
 * the worker and keeps the on-prem promise of one compose file, a native binary
 * is several times faster and adds something to the image, and a cloud API is
 * ruled out for confidential data by the tenant policy regardless of its
 * accuracy.
 */
export interface OcrEngine {
  name: string;
  /** Recognise one page. Rejects rather than returning empty text on failure. */
  recognise(input: { fileId: string; page: number; image?: Uint8Array }): Promise<OcrResult>;
}

/** Marker prepended to OCR'd page text, so its origin survives into storage. */
export const OCR_MARKER = "[ocr]";

/** Confidence below which OCR output is worth less than saying nothing. */
export const LOW_CONFIDENCE = 0.6;

export interface OcrPage {
  page: number;
  text: string;
  source: "text_layer" | "ocr";
  confidence: number | null;
  /** True where the text is too uncertain to be treated as evidence. */
  lowConfidence: boolean;
}

/**
 * Fold OCR results back in beside the pages that did not need it.
 *
 * OCR'd text is MARKED, both in the returned structure and in the text itself.
 * The marker matters because page text gets inlined into agent prompts and
 * copied into artifact provenance, where the structure does not follow it: an
 * agent reading a dimension string needs to know it was recognised from pixels
 * rather than read from a text layer, because "300" and "800" confuse regularly
 * at drawing type sizes.
 */
export function merge(
  extracted: ExtractedPage[], results: OcrResult[], opts: { minConfidence?: number } = {},
): { pages: OcrPage[]; lowConfidencePages: number[]; warnings: string[] } {
  const min = opts.minConfidence ?? LOW_CONFIDENCE;
  const byPage = new Map(results.map((r) => [r.page, r] as const));
  const warnings: string[] = [];
  const lowConfidencePages: number[] = [];

  const pages: OcrPage[] = extracted.map((p) => {
    const r = byPage.get(p.page);
    if (!r) {
      return { page: p.page, text: p.text, source: "text_layer", confidence: null, lowConfidence: false };
    }
    const low = r.confidence != null && r.confidence < min;
    if (low) lowConfidencePages.push(p.page);
    return {
      page: p.page,
      text: `${OCR_MARKER} ${r.text}`.trim(),
      source: "ocr",
      confidence: r.confidence,
      lowConfidence: low,
    };
  });

  if (lowConfidencePages.length) {
    warnings.push(
      `${lowConfidencePages.length} page(s) were recognised below ${Math.round(min * 100)}% confidence. Figures read from these should not be used as evidence for a quantity without someone checking the original — at drawing type sizes an engine confuses 3 with 8 routinely.`,
    );
  }
  return { pages, lowConfidencePages, warnings };
}

/**
 * Whether text came from OCR, judged from the stored text alone.
 *
 * Needed by anything reading page text back out of the store, where the
 * structured `source` field did not travel with it — retrieval, prompt
 * assembly, the traceback. That is exactly why the marker is in the text and
 * not only in the record.
 */
export const isOcrText = (text: string): boolean =>
  String(text ?? "").trimStart().startsWith(OCR_MARKER);

/** The text without its marker, for display. */
export const stripMarker = (text: string): string =>
  isOcrText(text) ? String(text).trimStart().slice(OCR_MARKER.length).trimStart() : String(text ?? "");

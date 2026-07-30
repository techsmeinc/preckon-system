import path from "path";
import { db } from "@workspace/db";
import {
  cadChunksTable,
  cadExtractionsTable,
  documentsTable,
  type CadExtraction,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { embedTexts, EMBEDDING_MODEL, isEmbeddingsEnabled } from "./embeddings";
import { invalidateProjectIndex } from "./hybrid-retrieval";

// Calls the Python CAD extractor sidecar, persists the summary + per-element
// retrieval chunks, and runs embeddings. Designed to be fired-and-forgotten
// from the document upload handler — never throws to the caller; all error
// state is reported through the cad_extractions row.

export const CAD_EXTRACTOR_URL =
  process.env.CAD_EXTRACTOR_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:7400";

// Ingestable file modes:
//   .dxf / .dwg   → ezdxf (drawing mode), full CAD semantics
//   .pdf, type=drawing      → PyMuPDF drawing mode: per-page text spans
//   .pdf, type=tender/rfp/sow/spec/addendum → PyMuPDF document mode:
//                                              section-aware text chunking
//
// "other" PDFs are still ingested in document mode so their text is available
// for retrieval. Anything that isn't a .pdf/.dxf/.dwg is skipped.
const DXF_EXTENSIONS = new Set([".dxf", ".dwg"]);
const PDF_EXTENSION = ".pdf";

// Document types that should be parsed in "document" mode (text/sections).
const DOCUMENT_MODE_TYPES = new Set(["tender", "rfp", "sow", "addendum", "specification", "other"]);

export function isCadFile(filename: string): boolean {
  return DXF_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function isPdfFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === PDF_EXTENSION;
}

export type IngestMode = "drawing" | "document";

/** Returns null when the doc shouldn't be ingested; otherwise the mode. */
export function ingestModeFor(filename: string, documentType: string | null | undefined): IngestMode | null {
  if (isCadFile(filename)) return "drawing";
  if (!isPdfFile(filename)) return null;
  if (documentType === "drawing") return "drawing";
  if (documentType && DOCUMENT_MODE_TYPES.has(documentType)) return "document";
  return null;
}

/** Back-compat shim used by older callers — true if this doc gets any ingest at all. */
export function shouldIngestAsDrawing(filename: string, documentType: string | null | undefined): boolean {
  return ingestModeFor(filename, documentType) !== null;
}

interface DxfExtractionPayload {
  kind?: undefined;
  file: string;
  dxfVersion: string | null;
  units: string | null;
  sheets: string[];
  layers: Array<{
    layer: string;
    line_count: number;
    line_length_total: number;
    polyline_count: number;
    polyline_length_total: number;
    // Area take-off (drawing units²) — optional so older sidecars still parse.
    closed_polyline_count?: number;
    polyline_area_total?: number;
    hatch_area_total?: number;
    circle_count: number;
    arc_count: number;
    hatch_count: number;
    insert_count: number;
    text_count: number;
    dim_count: number;
    other_count: number;
  }>;
  blockDefinitions: string[];
  blockInstanceCounts: Record<string, {
    total: number;
    byLayer: Record<string, number>;
    sheets: string[];
    sampleAttributes: Record<string, string>;
  }>;
  blockInstances: Array<{
    name: string; layer: string; x: number; y: number; rotation: number;
    sheet: string; attributes: Record<string, string>;
  }>;
  textAnnotations: Array<{ layer: string; text: string; x: number; y: number; height: number; sheet: string }>;
  dimensions: Array<{ layer: string; measurement: number | null; text: string | null; sheet: string }>;
  titleBlockFields: Record<string, string>;
  schedules: Array<{ layer: string; header: string[]; rows: string[][]; rowCount: number }>;
  warnings: string[];
}

interface PdfExtractionPayload {
  kind: "pdf";
  file: string;
  pageCount: number;
  pages: Array<{
    page: number;
    width: number;
    height: number;
    text_span_count: number;
    distinct_text_count: number;
    is_likely_scan: boolean;
    sheet_label: string | null;
  }>;
  textSpans: Array<{ page: number; text: string; x0: number; y0: number; x1: number; y1: number; font_size: number }>;
  textByPage: Record<string, string[]>;
  titleBlockFields: Record<string, string>;
  schedules: Array<{ page: number; header: string[]; rows: string[][]; row_count: number }>;
  warnings: string[];
}

interface DocumentExtractionPayload {
  kind: "document";
  file: string;
  pageCount: number;
  textTotalChars: number;
  medianFontSize: number;
  headingThreshold: number;
  chunks: Array<{
    heading: string;
    page_start: number;
    page_end: number;
    text: string;
  }>;
  // Tables extracted from document-mode PDFs via PyMuPDF.find_tables().
  // Same shape as the schedules field on PdfExtractionPayload so chunk
  // building can be unified. Optional because older Python sidecars
  // (pre-table-extraction) won't emit this field.
  schedules?: Array<{ page: number; header: string[]; rows: string[][]; row_count: number }>;
  warnings: string[];
}

type ExtractionPayload = DxfExtractionPayload | PdfExtractionPayload | DocumentExtractionPayload;

function isPdfPayload(p: ExtractionPayload): p is PdfExtractionPayload {
  return (p as PdfExtractionPayload).kind === "pdf";
}

function isDocumentPayload(p: ExtractionPayload): p is DocumentExtractionPayload {
  return (p as DocumentExtractionPayload).kind === "document";
}

async function callExtractor(filePath: string, mode: IngestMode): Promise<ExtractionPayload> {
  const res = await fetch(`${CAD_EXTRACTOR_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, mode }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`extractor ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as ExtractionPayload;
}

interface PreChunk {
  chunkType: string;
  // Origin tag: which uploaded-document type produced this chunk. Defaults
  // to "drawing" for backward compat — the ingest function fills it in for
  // text-document chunks ("tender", "rfp", "sow", etc.).
  sourceDocumentType?: string;
  // Section heading (text-document chunks) or page index (PDF drawing chunks).
  section?: string | null;
  page?: number | null;
  layer: string | null;
  blockName: string | null;
  sheet: string | null;
  refId: string | null;
  text: string;
}

// Turn the extraction payload into retrieval chunks. We aim for chunks that
// each carry one piece of *quantifiable* information so a single retrieval hit
// is actionable for a domain specialist.
function buildChunks(
  extraction: ExtractionPayload,
  documentId: number,
  sourceDocumentType: string,
): PreChunk[] {
  if (isDocumentPayload(extraction)) return buildDocumentChunks(extraction, documentId, sourceDocumentType);
  if (isPdfPayload(extraction)) return buildPdfChunks(extraction, documentId, sourceDocumentType);
  return buildDxfChunks(extraction, documentId, sourceDocumentType);
}

function buildDxfChunks(
  extraction: DxfExtractionPayload,
  documentId: number,
  _sourceDocumentType: string,
): PreChunk[] {
  const chunks: PreChunk[] = [];
  const docTag = `doc:${documentId}`;

  // Layers: one chunk per layer with its geometry tallies and full name.
  for (const layer of extraction.layers) {
    const parts: string[] = [`Layer "${layer.layer}" in drawing ${extraction.file}.`];
    if (layer.insert_count) parts.push(`${layer.insert_count} block instances on this layer.`);
    if (layer.text_count) parts.push(`${layer.text_count} text annotations on this layer.`);
    if (layer.polyline_count) {
      parts.push(`${layer.polyline_count} polylines totalling ${layer.polyline_length_total.toFixed(2)} ${extraction.units ?? "units"}.`);
    }
    // Area signal for m² take-off (paving, glazing, slabs, finishes, hatched fills).
    const u = extraction.units ?? "units";
    if (layer.closed_polyline_count && (layer.polyline_area_total ?? 0) > 0) {
      parts.push(`${layer.closed_polyline_count} closed polylines enclosing ${(layer.polyline_area_total ?? 0).toFixed(2)} ${u}² total area.`);
    }
    if ((layer.hatch_area_total ?? 0) > 0) {
      parts.push(`Hatched fills totalling ${(layer.hatch_area_total ?? 0).toFixed(2)} ${u}² area.`);
    }
    if (layer.line_count) {
      parts.push(`${layer.line_count} lines totalling ${layer.line_length_total.toFixed(2)} ${extraction.units ?? "units"}.`);
    }
    if (layer.circle_count) parts.push(`${layer.circle_count} circles.`);
    if (layer.arc_count) parts.push(`${layer.arc_count} arcs.`);
    if (layer.hatch_count) parts.push(`${layer.hatch_count} hatched regions.`);
    if (layer.dim_count) parts.push(`${layer.dim_count} dimension lines.`);
    chunks.push({
      chunkType: "layer",
      layer: layer.layer,
      blockName: null,
      sheet: null,
      refId: `${docTag}/layer:${layer.layer}`,
      text: parts.join(" "),
    });
  }

  // Block instance counts: one chunk per block name, summarising counts.
  for (const [blockName, agg] of Object.entries(extraction.blockInstanceCounts)) {
    const layerBreakdown = Object.entries(agg.byLayer)
      .sort((a, b) => b[1] - a[1])
      .map(([l, c]) => `${c} on layer ${l}`)
      .join(", ");
    const attrSample = Object.entries(agg.sampleAttributes ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const text =
      `Block "${blockName}" has ${agg.total} instances in drawing ${extraction.file}` +
      (layerBreakdown ? ` (${layerBreakdown})` : "") +
      (agg.sheets?.length ? ` on sheets ${agg.sheets.join(", ")}` : "") +
      (attrSample ? `. Sample attributes: ${attrSample}.` : ".");
    chunks.push({
      chunkType: "block_count",
      layer: null,
      blockName,
      sheet: agg.sheets?.[0] ?? null,
      refId: `${docTag}/block:${blockName}`,
      text,
    });
  }

  // Title block: a single chunk, very high-signal for project context.
  if (Object.keys(extraction.titleBlockFields).length > 0) {
    const text = Object.entries(extraction.titleBlockFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    chunks.push({
      chunkType: "title_block",
      layer: null,
      blockName: null,
      sheet: null,
      refId: `${docTag}/title_block`,
      text: `Title block of drawing ${extraction.file}: ${text}`,
    });
  }

  // Schedules: one chunk per schedule (max ~20 rows of content per chunk).
  for (let i = 0; i < extraction.schedules.length; i++) {
    const sched = extraction.schedules[i];
    const rowsText = sched.rows
      .slice(0, 20)
      .map(r => r.join(" | "))
      .join("\n");
    chunks.push({
      chunkType: "schedule",
      layer: sched.layer,
      blockName: null,
      sheet: null,
      refId: `${docTag}/schedule:${i}`,
      text: `Schedule on layer ${sched.layer} (${sched.rowCount} rows). Header: ${sched.header.join(" | ")}\n${rowsText}`,
    });
  }

  // Text annotations: group by layer to keep chunk count manageable. Each
  // group becomes one chunk with up to ~40 short labels concatenated.
  const textByLayer = new Map<string, typeof extraction.textAnnotations>();
  for (const t of extraction.textAnnotations) {
    const arr = textByLayer.get(t.layer) ?? [];
    arr.push(t);
    textByLayer.set(t.layer, arr);
  }
  for (const [layer, annotations] of textByLayer.entries()) {
    // Filter out near-duplicates (e.g. the same tag repeated many times).
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const a of annotations) {
      const norm = a.text.replace(/\s+/g, " ").trim();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      unique.push(norm);
      if (unique.length >= 60) break;
    }
    if (unique.length === 0) continue;
    chunks.push({
      chunkType: "text",
      layer,
      blockName: null,
      sheet: annotations[0]?.sheet ?? null,
      refId: `${docTag}/text:${layer}`,
      text: `Text labels on layer "${layer}" (${annotations.length} total): ${unique.join(" | ")}`,
    });
  }

  // Dimensions: one chunk per layer.
  const dimsByLayer = new Map<string, typeof extraction.dimensions>();
  for (const d of extraction.dimensions) {
    const arr = dimsByLayer.get(d.layer) ?? [];
    arr.push(d);
    dimsByLayer.set(d.layer, arr);
  }
  for (const [layer, dims] of dimsByLayer.entries()) {
    const sample = dims
      .slice(0, 30)
      .map(d => (d.text && d.text.trim() ? d.text : d.measurement?.toFixed(1) ?? "?"))
      .join(" | ");
    chunks.push({
      chunkType: "dimension",
      layer,
      blockName: null,
      sheet: null,
      refId: `${docTag}/dim:${layer}`,
      text: `Dimensions on layer "${layer}" (${dims.length} total). Sample values: ${sample}`,
    });
  }

  return chunks;
}

// PDF chunk builder. Each PDF page is treated as one "sheet". We emit:
//   - one summary chunk per page  (sheet metadata + a sample of its text)
//   - one detailed text chunk per page (the actual text labels, deduped)
//   - one chunk per detected schedule
//   - one chunk for the title-block fields (across all pages)
function buildPdfChunks(
  extraction: PdfExtractionPayload,
  documentId: number,
  _sourceDocumentType: string,
): PreChunk[] {
  const chunks: PreChunk[] = [];
  const docTag = `doc:${documentId}`;

  // Title block — high-signal project metadata.
  if (Object.keys(extraction.titleBlockFields).length > 0) {
    const tbText = Object.entries(extraction.titleBlockFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    chunks.push({
      chunkType: "title_block",
      layer: null,
      blockName: null,
      sheet: null,
      refId: `${docTag}/title_block`,
      text: `Title block of PDF ${extraction.file}: ${tbText}`,
    });
  }

  // Per-page chunks. We dedupe text within a page (tag labels like "D-01"
  // often appear many times) and cap each chunk so embeddings stay cheap.
  for (const page of extraction.pages) {
    const sheetTag = page.sheet_label ? `sheet ${page.sheet_label}` : `page ${page.page + 1}`;
    const rawTexts = extraction.textByPage[String(page.page)] ?? [];
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const t of rawTexts) {
      const norm = t.replace(/\s+/g, " ").trim();
      if (!norm || norm.length < 2) continue;
      if (seen.has(norm.toLowerCase())) continue;
      seen.add(norm.toLowerCase());
      unique.push(norm);
      if (unique.length >= 80) break;
    }

    // Sheet summary chunk (low-detail, always present so search has a hit)
    const summaryParts = [
      `PDF drawing "${extraction.file}" — ${sheetTag}.`,
      page.is_likely_scan
        ? `This page appears to be a scanned image with no embedded text (OCR would be needed for full extraction).`
        : `Page contains ${page.text_span_count} text element(s), ${page.distinct_text_count} unique.`,
    ];
    chunks.push({
      chunkType: "sheet_summary",
      layer: null,
      blockName: null,
      sheet: page.sheet_label ?? `p${page.page + 1}`,
      refId: `${docTag}/page:${page.page}`,
      text: summaryParts.join(" "),
    });

    // Detailed text chunk — the meat of what the agentic specialists query.
    if (unique.length > 0) {
      chunks.push({
        chunkType: "text",
        layer: null,
        blockName: null,
        sheet: page.sheet_label ?? `p${page.page + 1}`,
        refId: `${docTag}/page:${page.page}/text`,
        text: `Text labels on ${sheetTag} of ${extraction.file}: ${unique.join(" | ")}`,
      });
    }
  }

  // Schedules — one chunk per detected schedule.
  for (let i = 0; i < extraction.schedules.length; i++) {
    const s = extraction.schedules[i];
    const rowsText = s.rows
      .slice(0, 20)
      .map(r => r.join(" | "))
      .join("\n");
    chunks.push({
      chunkType: "schedule",
      layer: null,
      blockName: null,
      sheet: `p${s.page + 1}`,
      refId: `${docTag}/schedule:${i}`,
      text: `Schedule on page ${s.page + 1} of ${extraction.file} (${s.row_count} rows). Header: ${s.header.join(" | ")}\n${rowsText}`,
    });
  }

  return chunks;
}

// Document-mode chunk builder for non-drawing PDFs (RFP/SOW/spec/addendum).
// Each chunk represents one section of the document, keyed by heading. The
// section heading + page range stay on the chunk so retrieval results stay
// interpretable ("from page 12 under '3.4 Lighting Requirements'").
function buildDocumentChunks(
  extraction: DocumentExtractionPayload,
  documentId: number,
  _sourceDocumentType: string,
): PreChunk[] {
  const out: PreChunk[] = [];
  const docTag = `doc:${documentId}`;
  for (let i = 0; i < extraction.chunks.length; i++) {
    const c = extraction.chunks[i];
    const headingShort = c.heading.length > 80 ? `${c.heading.slice(0, 80)}…` : c.heading;
    const pageRange = c.page_start === c.page_end
      ? `page ${c.page_start + 1}`
      : `pages ${c.page_start + 1}–${c.page_end + 1}`;
    out.push({
      chunkType: "document_section",
      section: c.heading,
      page: c.page_start,
      layer: null,
      blockName: null,
      sheet: null,
      refId: `${docTag}/section:${i}`,
      text: `[${extraction.file} · ${pageRange} · §${headingShort}]\n${c.text}`,
    });
  }
  // Tables — one chunk per detected schedule. These are the highest-value
  // chunks for BOQ work: a quantity table, price schedule, or specs grid
  // maps almost 1:1 to BOQ line items. The Python extractor reconstructs
  // the cell grid via PyMuPDF.find_tables(); we serialise it as a pipe-
  // delimited table so the section agents can read it back.
  const schedules = extraction.schedules ?? [];
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    const rowsText = s.rows
      .slice(0, 30)
      .map(r => r.join(" | "))
      .join("\n");
    const more = s.rows.length > 30 ? `\n[... ${s.rows.length - 30} more rows truncated]` : "";
    out.push({
      chunkType: "schedule",
      section: `table p${s.page + 1}`,
      page: s.page,
      layer: null,
      blockName: null,
      sheet: `p${s.page + 1}`,
      refId: `${docTag}/page:${s.page}/schedule:${i}`,
      text:
        `[${extraction.file} · page ${s.page + 1} · table ${i + 1} (${s.row_count} rows)]\n` +
        `Header: ${s.header.join(" | ")}\n` +
        `${rowsText}${more}`,
    });
  }
  return out;
}

// Produce a storage-safe copy of the extraction payload for the `summary`
// JSON column. A large multi-sheet drawing PDF (300–400 pages) returns several
// MB of text data; if the serialised summary exceeds MySQL's max_allowed_packet
// the whole UPDATE fails and the document is stuck "running" forever (and this
// server's packet limit was found to be just 1 MB). So we trim the summary down
// to a byte budget, dropping ONLY data that is redundant with the per-chunk
// rows we already persist in cad_chunks (so nothing is actually lost — it just
// has to be reached through retrieval rather than the raw summary):
//   PDF:      textSpans (never read from summary), then textByPage (mirrored by
//             the per-page `text` chunks; only get_text_on_sheet reads it here).
//   document: chunk text (the full text lives in document_section chunks; the
//             summary only needs the chunk COUNT).
//   DXF:      blockInstances + dimensions (raw per-element arrays; the CAD tools
//             read the aggregated blockInstanceCounts / schedules instead).
// Each drop is recorded in `warnings` so the trim is visible, not silent.
const SUMMARY_BUDGET_BYTES = (() => {
  const v = Number(process.env.CAD_SUMMARY_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 800_000;
})();

function jsonBytes(o: unknown): number {
  return Buffer.byteLength(JSON.stringify(o));
}

function slimSummaryForStorage(payload: ExtractionPayload): ExtractionPayload {
  if (jsonBytes(payload) <= SUMMARY_BUDGET_BYTES) return payload;

  if (isPdfPayload(payload)) {
    let slim: PdfExtractionPayload = payload.textSpans.length > 0
      ? { ...payload, textSpans: [] }
      : payload;
    if (jsonBytes(slim) <= SUMMARY_BUDGET_BYTES) return slim;
    slim = {
      ...slim,
      textByPage: {},
      warnings: [...slim.warnings, "summary trimmed to fit DB packet limit: textByPage dropped (page text still searchable via chunks)"],
    };
    return slim;
  }

  if (isDocumentPayload(payload)) {
    return {
      ...payload,
      chunks: payload.chunks.map(c => ({ ...c, text: "" })),
      warnings: [...payload.warnings, "summary trimmed to fit DB packet limit: chunk text dropped (full text still searchable via chunks)"],
    } satisfies DocumentExtractionPayload;
  }

  // DXF: shed the bulky raw per-element arrays the tools don't read.
  return {
    ...payload,
    blockInstances: [],
    dimensions: [],
    warnings: [...payload.warnings, "summary trimmed to fit DB packet limit: raw blockInstances/dimensions dropped (aggregates retained)"],
  } satisfies DxfExtractionPayload;
}

export async function ingestDocument(documentId: number): Promise<CadExtraction | null> {
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId));
  if (!doc) return null;

  // Determine the right extractor mode based on file + documentType.
  // - DXF/DWG always → drawing mode
  // - PDF + drawing type → drawing mode (per-page text + schedules)
  // - PDF + tender/rfp/sow/spec/addendum/other → document mode (sections)
  // Other extensions are skipped entirely.
  const mode = ingestModeFor(doc.originalName, doc.documentType);
  if (mode === null) {
    await db
      .update(documentsTable)
      .set({ cadExtractionStatus: "skipped" })
      .where(eq(documentsTable.id, documentId));
    return null;
  }
  const sourceDocumentType = doc.documentType || (isCadFile(doc.originalName) ? "drawing" : "other");

  // Create or reset the extraction row in "running" state.
  const existing = await db
    .select()
    .from(cadExtractionsTable)
    .where(eq(cadExtractionsTable.documentId, documentId));

  let extractionId: number;
  if (existing.length > 0) {
    extractionId = existing[0].id;
    await db
      .update(cadExtractionsTable)
      .set({ status: "running", errorMessage: null })
      .where(eq(cadExtractionsTable.id, extractionId));
    // Wipe previous chunks if re-ingesting.
    await db.delete(cadChunksTable).where(eq(cadChunksTable.extractionId, extractionId));
  } else {
    const [{ id: insertedId }] = await db
      .insert(cadExtractionsTable)
      .values({
        documentId,
        projectId: doc.projectId,
        status: "running",
      })
      .$returningId();
    extractionId = insertedId;
  }

  await db
    .update(documentsTable)
    .set({ cadExtractionStatus: "running" })
    .where(eq(documentsTable.id, documentId));

  try {
    const payload = await callExtractor(doc.filePath, mode);
    const chunks = buildChunks(payload, documentId, sourceDocumentType);

    // Embed chunks in batches (embedTexts handles batching internally).
    const embeddings = isEmbeddingsEnabled()
      ? await embedTexts(chunks.map(c => c.text))
      : chunks.map(() => null);

    // Persist chunks in batched multi-row inserts. The previous code issued one
    // INSERT per chunk, so a 400-page tender (thousands of chunks) meant
    // thousands of sequential DB round-trips — a large slice of the "taking so
    // long after upload" time. One insert per CHUNK_INSERT_BATCH rows collapses
    // that to a handful of round-trips.
    const CHUNK_INSERT_BATCH = 100;
    const rows = chunks.map((c, i) => ({
      extractionId,
      documentId,
      projectId: doc.projectId,
      chunkType: c.chunkType,
      sourceDocumentType,
      section: c.section ?? null,
      page: c.page ?? null,
      layer: c.layer,
      blockName: c.blockName,
      sheet: c.sheet,
      refId: c.refId,
      text: c.text,
      embedding: embeddings[i] as unknown,
      embeddingModel: embeddings[i] ? EMBEDDING_MODEL : null,
    }));
    for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
      await db.insert(cadChunksTable).values(rows.slice(i, i + CHUNK_INSERT_BATCH));
    }

    // Branch-aware summary stats. Each shape reuses the same column set in
    // different ways so the cad_extractions row is informative for all three.
    let stats: {
      layerCount: number;
      blockDefinitionCount: number;
      blockInstanceTotal: number;
      textAnnotationCount: number;
      scheduleCount: number;
    };
    if (isDocumentPayload(payload)) {
      stats = {
        layerCount: payload.pageCount,           // page count
        blockDefinitionCount: 0,
        blockInstanceTotal: 0,
        textAnnotationCount: payload.textTotalChars, // total text chars
        scheduleCount: payload.chunks.length,    // number of sections
      };
    } else if (isPdfPayload(payload)) {
      stats = {
        layerCount: payload.pageCount,
        blockDefinitionCount: 0,
        blockInstanceTotal: 0,
        textAnnotationCount: payload.textSpans.length,
        scheduleCount: payload.schedules.length,
      };
    } else {
      stats = {
        layerCount: payload.layers.length,
        blockDefinitionCount: payload.blockDefinitions.length,
        blockInstanceTotal: Object.values(payload.blockInstanceCounts).reduce((s, b) => s + b.total, 0),
        textAnnotationCount: payload.textAnnotations.length,
        scheduleCount: payload.schedules.length,
      };
    }

    await db
      .update(cadExtractionsTable)
      .set({
        status: "succeeded",
        summary: slimSummaryForStorage(payload) as unknown,
        ...stats,
        chunkCount: chunks.length,
      })
      .where(eq(cadExtractionsTable.id, extractionId));

    await db
      .update(documentsTable)
      .set({ cadExtractionStatus: "succeeded", status: "processed" })
      .where(eq(documentsTable.id, documentId));

    invalidateProjectIndex(doc.projectId);

    const [saved] = await db
      .select()
      .from(cadExtractionsTable)
      .where(eq(cadExtractionsTable.id, extractionId));
    return saved ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(cadExtractionsTable)
      .set({ status: "failed", errorMessage: message.slice(0, 1000) })
      .where(eq(cadExtractionsTable.id, extractionId));
    await db
      .update(documentsTable)
      .set({ cadExtractionStatus: "failed" })
      .where(eq(documentsTable.id, documentId));
    return null;
  }
}


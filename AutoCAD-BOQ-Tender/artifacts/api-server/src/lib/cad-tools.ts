import { db } from "@workspace/db";
import { cadExtractionsTable, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { retrieve } from "./hybrid-retrieval";

// Agentic tools the LLM specialists can call during BOQ generation.
//
// Design:
// - Each tool returns a *compact, structured* JSON object the model can chain
//   on. We avoid dumping full extractions into prompts.
// - Every tool result is project-scoped: callers pass the projectId once when
//   constructing the toolbox, the model never sees it.
// - Tools always succeed (never throw); errors are returned in-band so the
//   model can recover.

// Two payload shapes flow through here. DXF carries real CAD semantics
// (layers, blocks, dimensions); PDFs are per-page text + heuristic schedules.
interface DxfExtractionSummary {
  kind?: undefined;
  file: string;
  units: string | null;
  sheets: string[];
  layers: Array<{
    layer: string;
    insert_count: number;
    text_count: number;
    polyline_length_total: number;
    line_length_total: number;
    dim_count: number;
    [k: string]: unknown;
  }>;
  blockDefinitions: string[];
  blockInstanceCounts: Record<string, {
    total: number;
    byLayer: Record<string, number>;
    sheets: string[];
    sampleAttributes: Record<string, string>;
  }>;
  textAnnotations: Array<{ layer: string; text: string; sheet: string }>;
  dimensions: Array<{ layer: string; measurement: number | null; text: string | null }>;
  titleBlockFields: Record<string, string>;
  schedules: Array<{ layer: string; header: string[]; rows: string[][]; rowCount: number }>;
}

interface PdfExtractionSummary {
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
}

interface DocumentExtractionSummary {
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
  warnings: string[];
}

type ExtractionSummary = DxfExtractionSummary | PdfExtractionSummary | DocumentExtractionSummary;

function isPdfSummary(s: ExtractionSummary): s is PdfExtractionSummary {
  return (s as PdfExtractionSummary).kind === "pdf";
}

function isDocumentSummary(s: ExtractionSummary): s is DocumentExtractionSummary {
  return (s as DocumentExtractionSummary).kind === "document";
}

interface ProjectExtractions {
  documentId: number;
  documentName: string;
  summary: ExtractionSummary;
}

async function loadProjectExtractions(projectId: number): Promise<ProjectExtractions[]> {
  const rows = await db
    .select({
      extractionId: cadExtractionsTable.id,
      documentId: cadExtractionsTable.documentId,
      summary: cadExtractionsTable.summary,
      documentName: documentsTable.originalName,
      status: cadExtractionsTable.status,
    })
    .from(cadExtractionsTable)
    .leftJoin(documentsTable, eq(documentsTable.id, cadExtractionsTable.documentId))
    .where(eq(cadExtractionsTable.projectId, projectId));

  return rows
    .filter(r => r.status === "succeeded" && r.summary)
    .map(r => ({
      documentId: r.documentId,
      documentName: r.documentName ?? `doc:${r.documentId}`,
      summary: r.summary as ExtractionSummary,
    }));
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<unknown>;
}

export interface CadToolbox {
  /** OpenAI/Anthropic-compatible tool definitions for chat.completions.tools. */
  toolDefinitions: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  handlers: Record<string, ToolHandler>;
  /** Trace of every tool call this loop made; useful for SSE telemetry and
   *  for attaching drawingReferences to the resulting BOQ items. */
  trace: ToolCallRecord[];
  /** Convenience: did the agent actually ground itself in any CAD data? */
  groundedRefIds: Set<string>;
}

// ── Schemas (JSON Schema, OpenAI-style) ─────────────────────────────────────
const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "list_layers",
      description:
        "List all CAD layers across all uploaded drawings for this project, with entity counts. Use first to discover what's in the drawings before drilling in.",
      parameters: {
        type: "object",
        properties: {
          filterLike: {
            type: "string",
            description: "Optional case-insensitive substring to filter layer names (e.g. 'LIGHT', 'DOOR', 'HVAC').",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "count_blocks",
      description:
        "Get exact instance counts for block definitions in the drawings. Block instances are the most reliable BOQ quantity for fixtures, doors, windows, sockets, sanitary fittings, etc.",
      parameters: {
        type: "object",
        properties: {
          blockNameLike: {
            type: "string",
            description: "Case-insensitive substring of block names to match (e.g. 'DOOR', 'LIGHT', 'SOCKET').",
          },
          layerLike: {
            type: "string",
            description: "Restrict to blocks present on layers matching this substring.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_text_on_layer",
      description:
        "Return text annotations (TEXT/MTEXT) on layers matching the given substring. Useful for room tags, equipment IDs, schedule cells.",
      parameters: {
        type: "object",
        properties: {
          layerLike: { type: "string", description: "Case-insensitive layer substring." },
          limit: { type: "integer", description: "Max annotations to return (default 50)." },
        },
        required: ["layerLike"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_schedules",
      description:
        "Return all schedules detected in the drawings (door schedule, window schedule, room finishes, equipment lists, etc.). Each schedule has a header row and data rows.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_drawing_metadata",
      description:
        "Return per-drawing metadata: file name, units, sheets/layouts present, and title-block fields (project name, drawn-by, scale, etc.).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_drawing",
      description:
        "Hybrid (vector + keyword + structural) search over DRAWING data for this project (DXF/DWG/drawing-PDF only). Use this for drawing labels, block names, sheet text. For RFP/SOW/spec content use search_documents.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query." },
          k: { type: "integer", description: "Top-K to return (default 8, max 20)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_layer_geometry",
      description:
        "Return per-layer geometry for layers matching a substring — the primary quantity signal for measured BOQ lines. KEY FIELDS (all pre-converted to metric when the layer's units are known): polylineLengthTotal_m / lineLengthTotal_m (for m items: piping, conduit, kerb, cable, fencing); largestClosedPolylineArea_m2 = the SINGLE biggest closed outline on the layer = the building footprint / floor / slab / roof boundary — USE THIS for a floor/ceiling/roof/finish m² take-off. AVOID areaTotal_m2 as a floor area: it SUMS every overlapping outline, furniture polygon and hatch boundary and badly over-counts. topClosedPolylineAreas shows the biggest few outlines so you can sanity-check. If the *_m2/*_m fields are absent the units are unknown (raw values are in drawing units²/units). Only applies to DXF/DWG drawings — PDFs carry no layer geometry.",
      parameters: {
        type: "object",
        properties: {
          layerLike: { type: "string", description: "Case-insensitive layer substring." },
        },
        required: ["layerLike"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_documents",
      description:
        "Hybrid (vector + keyword) search over uploaded TEXT documents — RFP, tender, SOW, specification, addendum, and 'other' PDFs. Use this to look up scope requirements, specification clauses, equipment standards, exclusions, deliverables, etc. Use search_drawing for drawings.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query (e.g. 'fire-rated door requirements', 'lighting fixture specifications', 'scope exclusions')." },
          documentTypes: {
            type: "array",
            items: { type: "string", enum: ["tender", "rfp", "sow", "specification", "addendum", "other"] },
            description: "Optional: restrict search to these document types only.",
          },
          k: { type: "integer", description: "Top-K to return (default 8, max 20)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_documents",
      description:
        "List every uploaded document for this project with its type, page count, and whether it's been parsed. Use this first if you're unsure what tender/RFP/SOW/spec documents are available.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_sheets",
      description:
        "List every PDF page (sheet) across all uploaded PDF drawings for this project. Each sheet has a page index, optional sheet label (e.g. 'A-101'), and text-density indicators. Use this to discover the structure of multi-sheet PDF drawing sets.",
      parameters: {
        type: "object",
        properties: {
          filterLike: {
            type: "string",
            description: "Optional case-insensitive substring to filter by sheet label.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_text_on_sheet",
      description:
        "Return the text labels (annotations, tags, equipment IDs, room names) on one or more PDF sheets matching the given page index or sheet label substring. Use this to read what a specific sheet of a PDF drawing says.",
      parameters: {
        type: "object",
        properties: {
          pageIndex: { type: "integer", description: "Zero-based page index to fetch text for." },
          sheetLike: { type: "string", description: "Case-insensitive substring of sheet label (e.g. 'A-101')." },
          limit: { type: "integer", description: "Max text labels to return (default 100)." },
        },
      },
    },
  },
];

function includesI(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// Drawing-unit → metre factor, so the geometry tool can pre-convert lengths/
// areas to m/m² itself (the agents repeatedly got the ÷1e6 / ÷1e3 conversion
// wrong, leaving measurable lines at qty 1). Unknown/unitless → null (no
// conversion offered; the agent must treat the raw number with care).
const UNIT_TO_M: Record<string, number> = {
  mm: 0.001, cm: 0.01, dm: 0.1, m: 1, inches: 0.0254, feet: 0.3048,
};
function unitLenFactor(u?: string | null): number | null {
  return u && UNIT_TO_M[u] != null ? UNIT_TO_M[u] : null;
}
function unitAreaFactor(u?: string | null): number | null {
  const f = unitLenFactor(u);
  return f == null ? null : f * f;
}
function round2(n: number): number {
  return Number(n.toFixed(2));
}

// Annotation / tag / dimension / title layers carry huge bounding outlines (a
// notes box can be 30,000 m²) that are NOT the building footprint. Exclude them
// when picking a footprint candidate so the real floor/wall outline wins.
const NON_STRUCTURAL_LAYER = /note|tag|anno|level|\blvl\b|title|\btb[-_ ]|dim|text|txt|hatch|furn|legend|grid|north|scale|key ?plan|symbol/i;

function strOr<T>(args: Record<string, unknown>, key: string, fallback: T): string | T {
  const v = args[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

function intOr(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return fallback;
}

export async function createCadToolbox(projectId: number): Promise<CadToolbox> {
  const extractions = await loadProjectExtractions(projectId);
  const trace: ToolCallRecord[] = [];
  const groundedRefIds = new Set<string>();

  function recordRef(refId: string | null | undefined): void {
    if (refId) groundedRefIds.add(refId);
  }

  // Pre-split extractions by payload kind so handlers don't have to repeat
  // the discrimination logic.
  const dxfExtractions = extractions.filter(e => !isPdfSummary(e.summary) && !isDocumentSummary(e.summary)) as Array<ProjectExtractions & { summary: DxfExtractionSummary }>;
  const pdfExtractions = extractions.filter(e => isPdfSummary(e.summary)) as Array<ProjectExtractions & { summary: PdfExtractionSummary }>;
  // documentExtractions aren't used directly by tools (search_documents goes
  // through the chunk index instead), but they're useful for list_documents.

  const handlers: Record<string, ToolHandler> = {
    async list_layers(args) {
      const like = strOr(args, "filterLike", "");
      type Agg = { layer: string; documents: Set<string>; insertCount: number; textCount: number; polylineLength: number; lineLength: number; dimCount: number };
      const layerAggs = new Map<string, Agg>();
      for (const ex of dxfExtractions) {
        for (const l of (ex.summary.layers ?? [])) {
          if (like && !includesI(l.layer, like)) continue;
          const a = layerAggs.get(l.layer) ?? {
            layer: l.layer,
            documents: new Set<string>(),
            insertCount: 0, textCount: 0, polylineLength: 0, lineLength: 0, dimCount: 0,
          };
          a.documents.add(ex.documentName);
          a.insertCount += l.insert_count ?? 0;
          a.textCount += l.text_count ?? 0;
          a.polylineLength += l.polyline_length_total ?? 0;
          a.lineLength += l.line_length_total ?? 0;
          a.dimCount += l.dim_count ?? 0;
          layerAggs.set(l.layer, a);
        }
      }
      const layers = Array.from(layerAggs.values())
        .map(a => ({
          layer: a.layer,
          documents: Array.from(a.documents),
          insertCount: a.insertCount,
          textCount: a.textCount,
          polylineLength: Number(a.polylineLength.toFixed(2)),
          lineLength: Number(a.lineLength.toFixed(2)),
          dimCount: a.dimCount,
        }))
        .sort((a, b) => (b.insertCount + b.textCount) - (a.insertCount + a.textCount))
        .slice(0, 80);
      const hasOnlyPdfs = dxfExtractions.length === 0 && pdfExtractions.length > 0;
      return {
        layers,
        totalLayersAcrossDrawings: layerAggs.size,
        ...(hasOnlyPdfs ? { note: "No DXF/DWG drawings — only PDFs. Use list_sheets and get_text_on_sheet for PDF drawings." } : {}),
      };
    },

    async count_blocks(args) {
      const nameLike = strOr(args, "blockNameLike", "");
      const layerLike = strOr(args, "layerLike", "");
      type Entry = {
        blockName: string;
        total: number;
        byLayer: Record<string, number>;
        byDocument: Record<string, number>;
        sheets: Set<string>;
        sampleAttributes: Record<string, string>;
      };
      const merged = new Map<string, Entry>();
      for (const ex of dxfExtractions) {
        for (const [name, agg] of Object.entries(ex.summary.blockInstanceCounts ?? {})) {
          if (nameLike && !includesI(name, nameLike)) continue;
          let total = agg.total;
          const byLayer: Record<string, number> = {};
          for (const [layer, count] of Object.entries(agg.byLayer)) {
            if (layerLike && !includesI(layer, layerLike)) continue;
            byLayer[layer] = (byLayer[layer] ?? 0) + count;
          }
          if (layerLike) {
            total = Object.values(byLayer).reduce((s, n) => s + n, 0);
            if (total === 0) continue;
          }
          const entry = merged.get(name) ?? {
            blockName: name, total: 0, byLayer: {}, byDocument: {}, sheets: new Set<string>(), sampleAttributes: {},
          };
          entry.total += total;
          for (const [l, c] of Object.entries(byLayer)) {
            entry.byLayer[l] = (entry.byLayer[l] ?? 0) + c;
          }
          entry.byDocument[ex.documentName] = (entry.byDocument[ex.documentName] ?? 0) + total;
          for (const s of agg.sheets ?? []) entry.sheets.add(s);
          if (Object.keys(entry.sampleAttributes).length === 0) {
            entry.sampleAttributes = agg.sampleAttributes ?? {};
          }
          recordRef(`doc:${ex.documentId}/block:${name}`);
          merged.set(name, entry);
        }
      }
      const blocks = Array.from(merged.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 60)
        .map(e => ({
          blockName: e.blockName,
          total: e.total,
          byLayer: e.byLayer,
          byDocument: e.byDocument,
          sheets: Array.from(e.sheets),
          sampleAttributes: e.sampleAttributes,
        }));
      const hasOnlyPdfs = dxfExtractions.length === 0 && pdfExtractions.length > 0;
      return {
        blocks,
        matchedDefinitions: merged.size,
        ...(hasOnlyPdfs ? { note: "No DXF/DWG drawings — only PDFs. PDF drawings do not carry block-instance semantics; use list_sheets + get_text_on_sheet + search_drawing instead." } : {}),
      };
    },

    async get_text_on_layer(args) {
      const layerLike = strOr(args, "layerLike", "");
      const limit = Math.min(intOr(args, "limit", 50), 200);
      if (!layerLike) return { annotations: [], message: "layerLike required" };
      const annotations: Array<{ layer: string; text: string; document: string; sheet: string }> = [];
      outer: for (const ex of dxfExtractions) {
        for (const t of (ex.summary.textAnnotations ?? [])) {
          if (!includesI(t.layer, layerLike)) continue;
          recordRef(`doc:${ex.documentId}/text:${t.layer}`);
          annotations.push({ layer: t.layer, text: t.text, document: ex.documentName, sheet: t.sheet });
          if (annotations.length >= limit) break outer;
        }
      }
      return { annotations };
    },

    async get_schedules() {
      // Unified result shape across DXF (layer-tagged) and PDF (page-tagged).
      const schedules: Array<{
        document: string;
        source: "dxf" | "pdf";
        layer: string | null;
        page: number | null;
        rowCount: number;
        header: string[];
        rows: string[][];
      }> = [];
      for (const ex of dxfExtractions) {
        const list = ex.summary.schedules ?? [];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          recordRef(`doc:${ex.documentId}/schedule:${i}`);
          schedules.push({
            document: ex.documentName,
            source: "dxf",
            layer: s.layer,
            page: null,
            rowCount: s.rowCount ?? 0,
            header: s.header ?? [],
            rows: (s.rows ?? []).slice(0, 30),
          });
        }
      }
      for (const ex of pdfExtractions) {
        const list = ex.summary.schedules ?? [];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          recordRef(`doc:${ex.documentId}/schedule:${i}`);
          schedules.push({
            document: ex.documentName,
            source: "pdf",
            layer: null,
            page: s.page,
            rowCount: s.row_count ?? 0,
            header: s.header ?? [],
            rows: (s.rows ?? []).slice(0, 30),
          });
        }
      }
      return { schedules };
    },

    async get_drawing_metadata() {
      return {
        drawings: extractions.map(ex => {
          if (isDocumentSummary(ex.summary)) {
            return {
              documentId: ex.documentId,
              document: ex.documentName,
              kind: "document",
              units: null,
              sheets: [],
              pageCount: ex.summary.pageCount,
              titleBlockFields: {},
              sectionCount: ex.summary.chunks.length,
            };
          }
          if (isPdfSummary(ex.summary)) {
            return {
              documentId: ex.documentId,
              document: ex.documentName,
              kind: "pdf",
              units: null,
              sheets: ex.summary.pages.map(p => p.sheet_label ?? `page ${p.page + 1}`),
              pageCount: ex.summary.pageCount,
              titleBlockFields: ex.summary.titleBlockFields,
              sectionCount: null,
            };
          }
          const dxf = ex.summary as DxfExtractionSummary;
          return {
            documentId: ex.documentId,
            document: ex.documentName,
            kind: "dxf",
            units: dxf.units,
            sheets: dxf.sheets,
            pageCount: null,
            titleBlockFields: dxf.titleBlockFields,
            sectionCount: null,
          };
        }),
      };
    },

    async search_drawing(args) {
      const query = strOr(args, "query", "");
      const k = Math.min(intOr(args, "k", 8), 20);
      if (!query) return { results: [], message: "query required" };
      // Restrict to drawing-origin chunks. RFP/SOW/spec text lives in search_documents.
      const hits = await retrieve(projectId, query, { k, sourceDocumentTypes: ["drawing"] });
      for (const h of hits) recordRef(h.refId);
      return {
        results: hits.map(h => ({
          score: Number(h.score.toFixed(4)),
          chunkType: h.chunkType,
          layer: h.layer,
          blockName: h.blockName,
          sheet: h.sheet,
          refId: h.refId,
          text: h.text.slice(0, 800),
          vectorRank: h.vectorRank,
          bm25Rank: h.bm25Rank,
          structuralMatch: h.structuralMatch,
        })),
      };
    },

    async search_documents(args) {
      const query = strOr(args, "query", "");
      const k = Math.min(intOr(args, "k", 8), 20);
      if (!query) return { results: [], message: "query required" };
      const rawTypes = (args.documentTypes as unknown);
      let documentTypes: string[] | undefined;
      if (Array.isArray(rawTypes) && rawTypes.length > 0) {
        documentTypes = rawTypes.filter((t): t is string => typeof t === "string");
      } else {
        // Default: all non-drawing types.
        documentTypes = ["tender", "rfp", "sow", "specification", "addendum", "other"];
      }
      const hits = await retrieve(projectId, query, { k, sourceDocumentTypes: documentTypes });
      for (const h of hits) recordRef(h.refId);
      return {
        results: hits.map(h => ({
          score: Number(h.score.toFixed(4)),
          documentType: h.sourceDocumentType,
          section: h.section,
          page: h.page,
          refId: h.refId,
          text: h.text.slice(0, 1500),
          vectorRank: h.vectorRank,
          bm25Rank: h.bm25Rank,
        })),
      };
    },

    async list_documents() {
      // Reads the documents table directly so it includes docs that haven't
      // been ingested yet (which the extractions-only loader would miss).
      const rows = await db
        .select({
          documentId: documentsTable.id,
          name: documentsTable.originalName,
          documentType: documentsTable.documentType,
          mimeType: documentsTable.mimeType,
          status: documentsTable.cadExtractionStatus,
        })
        .from(documentsTable)
        .where(eq(documentsTable.projectId, projectId));
      // Enrich with chunk-equivalent counts via the existing extractions cache.
      const chunkCountByDoc = new Map<number, number>();
      for (const ex of extractions) {
        if (isDocumentSummary(ex.summary)) {
          chunkCountByDoc.set(ex.documentId, ex.summary.chunks.length);
        } else if (isPdfSummary(ex.summary)) {
          chunkCountByDoc.set(ex.documentId, ex.summary.pageCount);
        } else {
          chunkCountByDoc.set(ex.documentId, ex.summary.layers?.length ?? 0);
        }
      }
      return {
        documents: rows.map(r => ({
          documentId: r.documentId,
          name: r.name,
          documentType: r.documentType,
          parsed: r.status === "succeeded",
          ingestStatus: r.status,
          isDrawing: r.documentType === "drawing",
        })),
      };
    },

    async get_layer_geometry(args) {
      const layerLike = strOr(args, "layerLike", "");
      if (!layerLike) return { layers: [], message: "layerLike required" };
      type Agg = {
        layer: string; documents: Set<string>; units: Set<string>;
        polylineLength: number; lineLength: number; polylineCount: number; lineCount: number;
        closedPolylineCount: number; polylineArea: number; hatchArea: number; topAreas: number[];
      };
      const agg = new Map<string, Agg>();
      for (const ex of dxfExtractions) {
        for (const l of (ex.summary.layers ?? [])) {
          if (!includesI(l.layer, layerLike)) continue;
          const a = agg.get(l.layer) ?? {
            layer: l.layer, documents: new Set<string>(), units: new Set<string>(),
            polylineLength: 0, lineLength: 0, polylineCount: 0, lineCount: 0,
            closedPolylineCount: 0, polylineArea: 0, hatchArea: 0, topAreas: [],
          };
          a.documents.add(ex.documentName);
          if (ex.summary.units) a.units.add(ex.summary.units);
          a.polylineLength += l.polyline_length_total ?? 0;
          a.lineLength += l.line_length_total ?? 0;
          a.polylineCount += (l as { polyline_count?: number }).polyline_count ?? 0;
          a.lineCount += (l as { line_count?: number }).line_count ?? 0;
          a.closedPolylineCount += (l as { closed_polyline_count?: number }).closed_polyline_count ?? 0;
          a.polylineArea += (l as { polyline_area_total?: number }).polyline_area_total ?? 0;
          a.hatchArea += (l as { hatch_area_total?: number }).hatch_area_total ?? 0;
          const tops = (l as { closed_polyline_top_areas?: number[] }).closed_polyline_top_areas;
          if (Array.isArray(tops)) a.topAreas.push(...tops);
          recordRef(`doc:${ex.documentId}/layer:${l.layer}`);
          agg.set(l.layer, a);
        }
      }
      const layers = Array.from(agg.values()).map(a => {
        const unit = a.units.size === 1 ? Array.from(a.units)[0] : null;
        const af = unitAreaFactor(unit);
        const lf = unitLenFactor(unit);
        const tops = a.topAreas.sort((x, y) => y - x).slice(0, 5);
        const largest = tops[0] ?? 0;
        const out: Record<string, unknown> = {
          layer: a.layer,
          documents: Array.from(a.documents),
          units: Array.from(a.units),
          unitsResolved: unit ?? "mixed/unknown",
          polylineLengthTotal: round2(a.polylineLength),
          lineLengthTotal: round2(a.lineLength),
          polylineCount: a.polylineCount,
          lineCount: a.lineCount,
          closedPolylineCount: a.closedPolylineCount,
          closedPolylineAreaTotal: round2(a.polylineArea),
          hatchAreaTotal: round2(a.hatchArea),
          areaTotal: round2(a.polylineArea + a.hatchArea),
          // The reliable footprint signal: the single largest closed outline.
          largestClosedPolylineAreaTotal: round2(largest),
          topClosedPolylineAreas: tops.map(round2),
        };
        // Pre-converted to metric so the agent never has to do (and mis-do) the
        // unit maths. Only emitted when the layer has ONE known unit.
        if (af != null) {
          out.areaTotal_m2 = round2((a.polylineArea + a.hatchArea) * af);
          out.closedPolylineAreaTotal_m2 = round2(a.polylineArea * af);
          out.hatchAreaTotal_m2 = round2(a.hatchArea * af);
          out.largestClosedPolylineArea_m2 = round2(largest * af);
        }
        if (lf != null) {
          out.polylineLengthTotal_m = round2(a.polylineLength * lf);
          out.lineLengthTotal_m = round2(a.lineLength * lf);
        }
        return out;
      });
      return {
        layers,
        guidance:
          "For an m² floor/slab/ceiling/roof/finish take-off, the footprint is the largestClosedPolylineArea_m2 on a STRUCTURAL layer (wall/floor/slab/plan/outline) — IGNORE note/tag/level/title/dim layers (their bounding boxes can be 30,000+ m²) and furniture layers. " +
          "Do NOT use areaTotal/areaTotal_m2 as a floor area — it SUMS every overlapping outline, furniture polygon and hatch boundary and massively over-counts. " +
          "ALWAYS cross-check the candidate against the building's stated overall dimensions (L×W from the SOW/title) and prefer the stated dimension when they diverge — exploded walls can double-count. " +
          "The *_m2 and *_m fields are already converted to metres; if absent, the layer's units are unknown.",
      };
    },

    async list_sheets(args) {
      const like = strOr(args, "filterLike", "");
      const sheets: Array<{
        document: string;
        documentId: number;
        page: number;
        sheetLabel: string | null;
        textSpanCount: number;
        distinctTextCount: number;
        isLikelyScan: boolean;
      }> = [];
      for (const ex of pdfExtractions) {
        for (const p of (ex.summary.pages ?? [])) {
          if (like) {
            const label = (p.sheet_label ?? "").toLowerCase();
            if (!label.includes(like.toLowerCase())) continue;
          }
          recordRef(`doc:${ex.documentId}/page:${p.page}`);
          sheets.push({
            document: ex.documentName,
            documentId: ex.documentId,
            page: p.page,
            sheetLabel: p.sheet_label,
            textSpanCount: p.text_span_count ?? 0,
            distinctTextCount: p.distinct_text_count ?? 0,
            isLikelyScan: p.is_likely_scan ?? false,
          });
        }
      }
      const hasOnlyDxf = pdfExtractions.length === 0 && dxfExtractions.length > 0;
      return {
        sheets,
        totalSheets: sheets.length,
        ...(hasOnlyDxf ? { note: "No PDF drawings — only DXF/DWG. Use list_layers and count_blocks for DXF drawings." } : {}),
      };
    },

    async get_text_on_sheet(args) {
      const pageIndex = intOr(args, "pageIndex", -1);
      const sheetLike = strOr(args, "sheetLike", "");
      const limit = Math.min(intOr(args, "limit", 100), 400);
      if (pageIndex < 0 && !sheetLike) {
        return { texts: [], message: "Provide pageIndex or sheetLike." };
      }
      const texts: Array<{ document: string; page: number; sheetLabel: string | null; text: string }> = [];
      outer: for (const ex of pdfExtractions) {
        for (const p of (ex.summary.pages ?? [])) {
          if (pageIndex >= 0 && p.page !== pageIndex) continue;
          if (sheetLike) {
            const label = (p.sheet_label ?? "").toLowerCase();
            if (!label.includes(sheetLike.toLowerCase())) continue;
          }
          recordRef(`doc:${ex.documentId}/page:${p.page}/text`);
          const pageTexts = (ex.summary.textByPage ?? {})[String(p.page)] ?? [];
          // Dedupe within a page — drawing tags often repeat.
          const seen = new Set<string>();
          for (const t of pageTexts) {
            const norm = t.replace(/\s+/g, " ").trim();
            if (!norm || seen.has(norm.toLowerCase())) continue;
            seen.add(norm.toLowerCase());
            texts.push({ document: ex.documentName, page: p.page, sheetLabel: p.sheet_label, text: norm });
            if (texts.length >= limit) break outer;
          }
        }
      }
      return { texts, count: texts.length };
    },
  };

  // Wrap every handler to record the call into the trace.
  const tracedHandlers: Record<string, ToolHandler> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    tracedHandlers[name] = async (args) => {
      const result = await handler(args);
      trace.push({ name, args, result });
      return result;
    };
  }

  return {
    toolDefinitions: TOOL_DEFS,
    handlers: tracedHandlers,
    trace,
    groundedRefIds,
  };
}

/**
 * Light-weight, deterministic snapshot the orchestrator can drop into the
 * specialist's first user message so the model knows what's actually in the
 * project's drawings before its first tool call. Keeps token cost predictable.
 */
export async function buildExtractionDigest(projectId: number, maxChars = 3000): Promise<string> {
  const extractions = await loadProjectExtractions(projectId);
  if (extractions.length === 0) return "No drawings or documents have been processed yet for this project.";

  // Split by extractor kind so the digest is legible per source.
  const realDrawings: typeof extractions = [];
  const realDocuments: typeof extractions = [];
  for (const ex of extractions) {
    if ((ex.summary as { kind?: string }).kind === "document") realDocuments.push(ex);
    else realDrawings.push(ex);
  }

  const lines: string[] = [];
  lines.push(`Project has ${realDrawings.length} processed drawing(s) and ${realDocuments.length} processed text document(s).`);
  for (const ex of extractions) {
    try {
    if (isDocumentSummary(ex.summary)) {
      const doc = ex.summary;
      const chunks = doc.chunks ?? [];
      const warnings = doc.warnings ?? [];
      lines.push(`\n— Text document "${ex.documentName}" (${doc.pageCount ?? 0} page(s), ${chunks.length} sections, ${(doc.textTotalChars ?? 0).toLocaleString()} chars)`);
      const topSections = chunks.slice(0, 8).map(c => {
        const heading = (c.heading ?? "").length > 60 ? `${(c.heading ?? "").slice(0, 60)}…` : (c.heading ?? "(unnamed)");
        return `"${heading}" (p${(c.page_start ?? 0) + 1})`;
      }).join("; ");
      if (topSections) lines.push(`  Top sections: ${topSections}`);
      if (warnings.length) lines.push(`  Warnings: ${warnings.slice(0, 2).join("; ")}`);
      continue;
    }
    if (isPdfSummary(ex.summary)) {
      const pdf = ex.summary;
      const pages = pdf.pages ?? [];
      const titleBlockFields = pdf.titleBlockFields ?? {};
      const schedules = pdf.schedules ?? [];
      lines.push(`\n— PDF drawing "${ex.documentName}" (${pdf.pageCount ?? 0} page(s))`);
      if (Object.keys(titleBlockFields).length) {
        const tb = Object.entries(titleBlockFields).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`  Title block: ${tb}`);
      }
      const topSheets = pages.slice(0, 10).map(p =>
        `${p.sheet_label ?? `p${(p.page ?? 0) + 1}`} (${p.text_span_count ?? 0} texts${p.is_likely_scan ? ", scan" : ""})`
      ).join("; ");
      if (topSheets) lines.push(`  Sheets: ${topSheets}`);
      if (schedules.length) lines.push(`  ${schedules.length} schedule(s) detected.`);
      const scanPages = pages.filter(p => p.is_likely_scan).length;
      if (scanPages > 0) lines.push(`  ${scanPages} page(s) appear to be scanned images — text not extractable without OCR.`);
    } else {
      // DXF — but tolerate stale/partial summaries by defaulting every field.
      const dxf = ex.summary as DxfExtractionSummary;
      const sheets = dxf.sheets ?? [];
      const layers = dxf.layers ?? [];
      const titleBlockFields = dxf.titleBlockFields ?? {};
      const blockInstanceCounts = dxf.blockInstanceCounts ?? {};
      const schedules = dxf.schedules ?? [];
      lines.push(`\n— DXF drawing "${ex.documentName}" (units: ${dxf.units ?? "?"}, ${sheets.length} sheet(s))`);
      if (Object.keys(titleBlockFields).length) {
        const tb = Object.entries(titleBlockFields).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`  Title block: ${tb}`);
      }
      const topLayers = layers.slice(0, 10).map(l =>
        `${l.layer} (${l.insert_count ?? 0} inserts, ${l.text_count ?? 0} texts)`).join("; ");
      if (topLayers) lines.push(`  Top layers: ${topLayers}`);
      // Surface the single largest closed outline (= footprint/floor/roof) so the
      // agent has a trustworthy m² anchor without distrusting the noisy totals.
      let bestArea = 0;
      let bestLayer = "";
      for (const l of layers) {
        if (NON_STRUCTURAL_LAYER.test(l.layer)) continue; // skip note/tag/dim boxes
        const tops = (l as { closed_polyline_top_areas?: number[] }).closed_polyline_top_areas;
        if (Array.isArray(tops) && tops.length) {
          const m = Math.max(...tops);
          if (m > bestArea) { bestArea = m; bestLayer = l.layer; }
        }
      }
      if (bestArea > 0) {
        const af = unitAreaFactor(dxf.units);
        const shown = af != null ? `${round2(bestArea * af)} m²` : `${Math.round(bestArea)} ${dxf.units ?? "units"}²`;
        lines.push(`  Footprint candidate ≈ ${shown} (largest closed outline on a structural layer "${bestLayer}") — cross-check against stated building dimensions before using for slab/floor/ceiling/roof areas.`);
      }
      const topBlocks = Object.entries(blockInstanceCounts)
        .sort((a, b) => (b[1]?.total ?? 0) - (a[1]?.total ?? 0))
        .slice(0, 8)
        .map(([name, agg]) => `${name}×${agg?.total ?? 0}`)
        .join(", ");
      if (topBlocks) lines.push(`  Top blocks: ${topBlocks}`);
      if (schedules.length) lines.push(`  ${schedules.length} schedule(s) detected.`);
    }
    } catch (err) {
      // Defensive: if one extraction's summary has an unexpected shape, skip
      // it but don't kill the whole digest. Visible in server logs.
      lines.push(`\n— (skipped "${ex.documentName}" — summary parse failed: ${err instanceof Error ? err.message : "unknown"})`);
    }
  }
  const out = lines.join("\n");
  return out.length > maxChars ? out.slice(0, maxChars) + "\n… (truncated)" : out;
}

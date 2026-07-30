import { db } from "@workspace/db";
import { cadChunksTable, type CadChunk } from "@workspace/db";
import { eq } from "drizzle-orm";
import { cosineSimilarity, embedQuery, isEmbeddingsEnabled } from "./embeddings";

// Hybrid retrieval over CAD chunks for a single project. We combine:
//   1. Cosine similarity over OpenAI embeddings (semantic).
//   2. BM25 over the chunk text (keyword / tag).
//   3. Structural boost when the query mentions a known layer or block name.
//
// Vector results and BM25 results are fused via Reciprocal Rank Fusion (RRF),
// which is dimensionless and avoids tuning weights against absolute scores.
// Then the structural boost is added on top (rank-independent).

const RRF_K = 60; // standard RRF constant
const STRUCTURAL_BOOST = 0.05; // ~ 1/RRF_K * 3, small but tie-breaking
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "to", "in", "on", "at",
  "is", "are", "be", "by", "as", "from", "this", "that", "it", "its", "into",
  "per", "type", "all", "any", "each", "no", "yes",
]);

export interface RetrievedChunk {
  id: number;
  documentId: number;
  chunkType: string;
  sourceDocumentType: string | null;
  section: string | null;
  page: number | null;
  layer: string | null;
  blockName: string | null;
  sheet: string | null;
  refId: string | null;
  text: string;
  score: number;          // fused RRF + boost score
  vectorRank: number | null;
  bm25Rank: number | null;
  structuralMatch: boolean;
}

export interface RetrievalOptions {
  k?: number;             // final top-K
  vectorPool?: number;    // how deep to go in each modality before fusion
  bm25Pool?: number;
  // Optional pre-filter — when a domain specialist already knows it only cares
  // about chunks tagged with one of these layers/block names, we can avoid
  // pulling the whole corpus into Node memory.
  layerLike?: string[];   // case-insensitive substring match against layer
  blockLike?: string[];   // case-insensitive substring match against blockName
  chunkTypes?: string[];  // restrict by chunkType
  sourceDocumentTypes?: string[]; // restrict by originating documentType (drawing/tender/rfp/sow/specification/addendum/other)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _\-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexedChunk {
  chunk: CadChunk;
  tokens: string[];
  tokenCounts: Map<string, number>;
  length: number;
}

interface ProjectIndex {
  projectId: number;
  loadedAt: number;
  chunks: IndexedChunk[];
  avgLength: number;
  docFrequency: Map<string, number>; // token -> # of chunks containing it
}

// Module-level cache. Rebuilt whenever a new chunk is added (cache key is
// projectId + chunkCount). Cheap to rebuild — BM25 stats are O(N * avgLen).
const CACHE = new Map<number, ProjectIndex>();

async function loadProjectIndex(projectId: number): Promise<ProjectIndex> {
  const rows = await db.select().from(cadChunksTable).where(eq(cadChunksTable.projectId, projectId));
  const cached = CACHE.get(projectId);
  if (cached && cached.chunks.length === rows.length) return cached;

  const indexed: IndexedChunk[] = rows.map(chunk => {
    const tokens = tokenize(chunk.text);
    const tokenCounts = new Map<string, number>();
    for (const t of tokens) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
    return { chunk, tokens, tokenCounts, length: tokens.length };
  });

  const docFrequency = new Map<string, number>();
  for (const ic of indexed) {
    for (const token of ic.tokenCounts.keys()) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const totalLen = indexed.reduce((s, ic) => s + ic.length, 0);
  const avgLength = indexed.length > 0 ? totalLen / indexed.length : 0;

  const idx: ProjectIndex = {
    projectId,
    loadedAt: Date.now(),
    chunks: indexed,
    avgLength,
    docFrequency,
  };
  CACHE.set(projectId, idx);
  return idx;
}

export function invalidateProjectIndex(projectId: number): void {
  CACHE.delete(projectId);
}

function bm25Score(
  query: string[],
  ic: IndexedChunk,
  docFrequency: Map<string, number>,
  N: number,
  avgLength: number,
): number {
  let score = 0;
  for (const term of query) {
    const df = docFrequency.get(term) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const tf = ic.tokenCounts.get(term) ?? 0;
    if (tf === 0) continue;
    const lengthNorm = 1 - BM25_B + BM25_B * (ic.length / (avgLength || 1));
    score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm));
  }
  return score;
}

function matchesFilters(ic: IndexedChunk, options: RetrievalOptions): boolean {
  const { layerLike, blockLike, chunkTypes, sourceDocumentTypes } = options;
  if (chunkTypes && chunkTypes.length > 0 && !chunkTypes.includes(ic.chunk.chunkType)) return false;
  if (sourceDocumentTypes && sourceDocumentTypes.length > 0) {
    const sdt = ic.chunk.sourceDocumentType ?? "";
    if (!sourceDocumentTypes.includes(sdt)) return false;
  }
  if (layerLike && layerLike.length > 0) {
    const layer = (ic.chunk.layer ?? "").toLowerCase();
    if (!layerLike.some(l => layer.includes(l.toLowerCase()))) return false;
  }
  if (blockLike && blockLike.length > 0) {
    const block = (ic.chunk.blockName ?? "").toLowerCase();
    if (!blockLike.some(b => block.includes(b.toLowerCase()))) return false;
  }
  return true;
}

function structuralBoostFor(query: string, ic: IndexedChunk): boolean {
  // If the query string mentions the layer or block name (case-insensitive),
  // flag a structural hit. Cheap and high-signal.
  const q = query.toLowerCase();
  const layer = (ic.chunk.layer ?? "").toLowerCase();
  const block = (ic.chunk.blockName ?? "").toLowerCase();
  if (layer && layer.length > 2 && q.includes(layer)) return true;
  if (block && block.length > 2 && q.includes(block)) return true;
  return false;
}

export async function retrieve(
  projectId: number,
  query: string,
  options: RetrievalOptions = {},
): Promise<RetrievedChunk[]> {
  const k = options.k ?? 8;
  const vectorPool = options.vectorPool ?? 25;
  const bm25Pool = options.bm25Pool ?? 25;

  const index = await loadProjectIndex(projectId);
  if (index.chunks.length === 0) return [];

  const filtered = index.chunks.filter(ic => matchesFilters(ic, options));
  if (filtered.length === 0) return [];

  // ---- BM25 ranking ----
  const queryTokens = tokenize(query);
  const bm25Scored = filtered.map(ic => ({
    ic,
    score: bm25Score(queryTokens, ic, index.docFrequency, index.chunks.length, index.avgLength),
  }));
  bm25Scored.sort((a, b) => b.score - a.score);
  const bm25Top = bm25Scored.slice(0, bm25Pool);
  const bm25RankById = new Map<number, number>();
  bm25Top.forEach((entry, idx) => {
    if (entry.score > 0) bm25RankById.set(entry.ic.chunk.id, idx + 1);
  });

  // ---- Vector ranking ----
  let vectorRankById = new Map<number, number>();
  if (isEmbeddingsEnabled()) {
    const qvec = await embedQuery(query);
    if (qvec) {
      const cosines = filtered
        .map(ic => {
          const emb = ic.chunk.embedding as unknown;
          if (!Array.isArray(emb) || emb.length === 0) return { ic, score: -1 };
          return { ic, score: cosineSimilarity(qvec, emb as number[]) };
        })
        .filter(e => e.score >= 0);
      cosines.sort((a, b) => b.score - a.score);
      cosines.slice(0, vectorPool).forEach((entry, idx) => {
        vectorRankById.set(entry.ic.chunk.id, idx + 1);
      });
    }
  }

  // ---- Fuse via Reciprocal Rank Fusion + structural boost ----
  const allIds = new Set<number>([...bm25RankById.keys(), ...vectorRankById.keys()]);
  const fused: RetrievedChunk[] = [];

  for (const id of allIds) {
    const ic = filtered.find(c => c.chunk.id === id);
    if (!ic) continue;
    const vr = vectorRankById.get(id) ?? null;
    const br = bm25RankById.get(id) ?? null;
    let score = 0;
    if (vr !== null) score += 1 / (RRF_K + vr);
    if (br !== null) score += 1 / (RRF_K + br);
    const structural = structuralBoostFor(query, ic);
    if (structural) score += STRUCTURAL_BOOST;

    fused.push({
      id: ic.chunk.id,
      documentId: ic.chunk.documentId,
      chunkType: ic.chunk.chunkType,
      sourceDocumentType: ic.chunk.sourceDocumentType,
      section: ic.chunk.section,
      page: ic.chunk.page,
      layer: ic.chunk.layer,
      blockName: ic.chunk.blockName,
      sheet: ic.chunk.sheet,
      refId: ic.chunk.refId,
      text: ic.chunk.text,
      score,
      vectorRank: vr,
      bm25Rank: br,
      structuralMatch: structural,
    });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, k);
}

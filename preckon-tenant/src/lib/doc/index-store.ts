/**
 * The retrieval index — finally writing to the `chunk` table.
 *
 * Indexing is idempotent per (revision, index_version): re-indexing a revision
 * replaces its own chunks and touches nothing else. That matters because
 * chunking rules will change, and a re-index under new rules must not orphan the
 * old rows or duplicate evidence.
 *
 * ── REVISION AWARENESS IS THE SAFETY PROPERTY ────────────────────────────────
 *
 * Search defaults to current revisions only. Answering from a superseded
 * revision is worse than not answering: the document said that once, and saying
 * it again now is a statement about the project that is no longer true. History
 * is available, but it has to be asked for.
 */

import { query } from "@/lib/db";
import { newId } from "@/lib/ids";
import { chunkDocument, rank, packToBudget, type Candidate, type Page } from "./retrieval";

export const INDEX_VERSION = "v1";

export interface IndexResult {
  revisionId: string;
  chunks: number;
  replaced: number;
  why: string;
}

/**
 * Index one revision's extracted text.
 *
 * The delete-then-insert runs in one statement pair rather than a transaction
 * spanning the chunking: chunking is CPU work with no database involvement, so
 * holding a transaction across it would pin a connection for no reason.
 */
export async function indexRevision(
  tenantId: string, projectId: string, revisionId: string, pages: Page[],
): Promise<IndexResult> {
  const chunks = chunkDocument(pages);

  const existing = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chunk
      WHERE tenant_id = ? AND revision_id = ? AND index_version = ?`,
    [tenantId, revisionId, INDEX_VERSION],
  );
  const replaced = Number(existing[0]?.n ?? 0);

  await query(
    `DELETE FROM chunk WHERE tenant_id = ? AND revision_id = ? AND index_version = ?`,
    [tenantId, revisionId, INDEX_VERSION],
  );

  for (const c of chunks) {
    await query(
      `INSERT INTO chunk
         (id, tenant_id, project_id, source_kind, source_id, revision_id, page_number,
          ordinal, text, token_count, index_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), tenantId, projectId, "file_page", revisionId, revisionId,
       c.page ?? null, c.ordinal, c.text, c.tokens, INDEX_VERSION],
    );
  }

  return {
    revisionId,
    chunks: chunks.length,
    replaced,
    why: replaced
      ? `Re-indexed ${chunks.length} passages, replacing ${replaced}.`
      : `Indexed ${chunks.length} passages.`,
  };
}

/** Remove a revision's chunks — used when a revision is deleted. */
export async function dropIndex(tenantId: string, revisionId: string): Promise<number> {
  const res = await query<any>(
    "DELETE FROM chunk WHERE tenant_id = ? AND revision_id = ?",
    [tenantId, revisionId],
  );
  return Number((res as any)?.affectedRows ?? 0);
}

export interface SearchOptions {
  /** Include superseded revisions. Off by default, deliberately. */
  includeHistory?: boolean;
  /** Candidate pool before ranking. */
  poolSize?: number;
  /** Token budget for the evidence returned. */
  budgetTokens?: number;
}

export interface SearchHit {
  id: string;
  text: string;
  page?: number;
  documentNumber?: string;
  revisionCode?: string;
  score: number;
  why: string;
}

export interface SearchResult {
  hits: SearchHit[];
  tokensUsed: number;
  dropped: number;
  searchedHistory: boolean;
  why: string;
}

/**
 * Find evidence for a question.
 *
 * MySQL FULLTEXT in NATURAL LANGUAGE MODE supplies the candidate pool and a
 * relevance score; the ranking in retrieval.ts then decides the order, because
 * FULLTEXT has no idea that "A-201" appearing literally beats a passage that is
 * merely about the same lobby.
 *
 * Falls back to a LIKE scan when the query has no indexable terms — FULLTEXT
 * ignores very short tokens, and "A-201" alone would otherwise return nothing
 * at all, which is the single most likely thing somebody types.
 */
export async function search(
  tenantId: string, projectId: string, question: string, opts: SearchOptions = {},
): Promise<SearchResult> {
  const pool = Math.min(Math.max(10, opts.poolSize ?? 60), 300);
  const budget = Math.min(Math.max(200, opts.budgetTokens ?? 2000), 20000);
  const includeHistory = !!opts.includeHistory;

  const q = String(question ?? "").trim();
  if (!q) {
    return { hits: [], tokensUsed: 0, dropped: 0, searchedHistory: includeHistory, why: "No question given." };
  }

  const stateClause = includeHistory ? "" : " AND v.state = 'current'";

  let rows = await query<any>(
    `SELECT c.id, c.text, c.page_number AS page,
            d.document_number, v.revision_code,
            MATCH(c.text) AGAINST (? IN NATURAL LANGUAGE MODE) AS lexical
       FROM chunk c
       JOIN document_revision v ON v.id = c.revision_id AND v.tenant_id = c.tenant_id
       JOIN document_register d ON d.id = v.document_id AND d.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND c.project_id = ?
        AND c.index_version = ?${stateClause}
        AND MATCH(c.text) AGAINST (? IN NATURAL LANGUAGE MODE)
      ORDER BY lexical DESC
      LIMIT ?`,
    [q, tenantId, projectId, INDEX_VERSION, q, pool],
  );

  if (!rows.length) {
    // FULLTEXT drops short tokens, so an identifier-only question finds nothing.
    // A LIKE scan is slower and entirely correct for the case that matters most.
    rows = await query<any>(
      `SELECT c.id, c.text, c.page_number AS page,
              d.document_number, v.revision_code, 0 AS lexical
         FROM chunk c
         JOIN document_revision v ON v.id = c.revision_id AND v.tenant_id = c.tenant_id
         JOIN document_register d ON d.id = v.document_id AND d.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.project_id = ?
          AND c.index_version = ?${stateClause}
          AND (c.text LIKE ? OR d.document_number LIKE ?)
        LIMIT ?`,
      [tenantId, projectId, INDEX_VERSION, `%${q}%`, `%${q}%`, pool],
    );
  }

  const candidates: Candidate[] = rows.map((r) => ({
    id: r.id,
    text: r.text,
    page: r.page ?? undefined,
    lexical: Number(r.lexical ?? 0),
    documentNumber: r.document_number ?? undefined,
    revisionCode: r.revision_code ?? undefined,
  }));

  const packed = packToBudget(rank(q, candidates), budget);

  return {
    hits: packed.chosen.map((c) => ({
      id: c.id,
      text: c.text,
      page: c.page,
      documentNumber: c.documentNumber,
      revisionCode: c.revisionCode,
      score: Number(c.score.toFixed(4)),
      why: c.why,
    })),
    tokensUsed: packed.tokensUsed,
    dropped: packed.dropped,
    searchedHistory: includeHistory,
    why: includeHistory
      ? `${packed.why} Searched all revisions including superseded.`
      : `${packed.why} Current revisions only.`,
  };
}

/** How much of a project is indexed — the answer to "why did it find nothing". */
export async function indexStatus(tenantId: string, projectId: string) {
  const rows = await query<any>(
    `SELECT COUNT(DISTINCT c.revision_id) AS revisions_indexed,
            COUNT(*) AS chunks,
            COALESCE(SUM(c.token_count), 0) AS tokens
       FROM chunk c
      WHERE c.tenant_id = ? AND c.project_id = ? AND c.index_version = ?`,
    [tenantId, projectId, INDEX_VERSION],
  );
  const total = await query<any>(
    `SELECT COUNT(*) AS n FROM document_revision
      WHERE tenant_id = ? AND project_id = ? AND state = 'current'`,
    [tenantId, projectId],
  );
  const indexed = Number(rows[0]?.revisions_indexed ?? 0);
  const current = Number(total[0]?.n ?? 0);
  return {
    revisionsIndexed: indexed,
    currentRevisions: current,
    chunks: Number(rows[0]?.chunks ?? 0),
    tokens: Number(rows[0]?.tokens ?? 0),
    indexVersion: INDEX_VERSION,
    why: current === 0
      ? "Nothing to index yet."
      : indexed >= current
        ? "Every current revision is indexed."
        : `${indexed} of ${current} current revisions indexed — the rest cannot be searched.`,
  };
}

/**
 * Retrieval — turning documents into evidence a model can be given.
 *
 * The `chunk` table has existed since the beginning, with an embedding column
 * and a FULLTEXT index, and nothing has ever written to it. Every AI answer has
 * therefore been produced from whatever the caller happened to put in the
 * envelope. This is the layer the AI Fabric blueprint calls P-04 — retrieval
 * before long context — and without it the alternative is sending whole tender
 * packages to a model on every question.
 *
 * ── CHUNKING ON MEANING, NOT ON LENGTH ───────────────────────────────────────
 *
 * The naive approach cuts every N characters. That splits "the partition shall
 * achieve a fire rating of" from "120 minutes", and the retrieved chunk then
 * says the opposite of the document. Boundaries here fall on paragraphs first,
 * then sentences, and only cut mid-sentence when a single sentence exceeds the
 * budget on its own.
 *
 * Chunks overlap for the same reason: a fact that straddles a boundary must
 * survive in at least one chunk whole.
 *
 * ── WHY HYBRID, NOT VECTORS ALONE ────────────────────────────────────────────
 *
 * Construction questions are full of exact identifiers — "what does A-201 say
 * about the lobby", "is BOQ 09-2216 priced", "which RFI covers this". Embeddings
 * are good at meaning and bad at identifiers: "A-201" and "A-210" sit almost on
 * top of each other in vector space and are entirely different drawings.
 *
 * So lexical matching leads and similarity refines. A chunk containing the
 * literal identifier outranks one that is merely about the same topic, which is
 * the opposite of what a pure vector store does.
 *
 * ── REVISION AWARENESS IS THE SAFETY PROPERTY ────────────────────────────────
 *
 * Answering from a superseded revision is worse than not answering. The default
 * is current revisions only; history requires asking for it explicitly.
 */

export interface Chunk {
  text: string;
  /** 1-based page the chunk starts on, when the source is paginated. */
  page?: number;
  /** Position within the document, for stable ordering. */
  ordinal: number;
  tokens: number;
}

export interface ChunkOptions {
  /** Target size in tokens. */
  target?: number;
  /** Hard ceiling — a chunk is never emitted above this. */
  max?: number;
  /** Tokens repeated from the end of the previous chunk. */
  overlap?: number;
}

const DEFAULT_TARGET = 350;
const DEFAULT_MAX = 600;
const DEFAULT_OVERLAP = 40;

/**
 * Token estimate.
 *
 * Deliberately an estimate. The real count depends on the tokeniser of whichever
 * model the router picks, which is not known at ingest time, and being exactly
 * right is not what this is for — it exists to keep a context budget honest.
 * ~4 characters per token is close enough for English and conservative for the
 * mixed English/Arabic content these projects carry.
 */
export function estimateTokens(text: string): number {
  const t = String(text ?? "");
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / 4));
}

/** Split into sentences without breaking on decimals or abbreviations. */
function sentences(text: string): string[] {
  // Guard the cases that actually occur in specifications: 150.5 mm, No. 3,
  // Fig. 2, section numbers like 09.22.16.
  const guarded = text
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/\b(No|Fig|Ref|Dwg|Sec|Cl|Approx|Min|Max|etc|e\.g|i\.e)\.\s/gi, (m) => m.replace(".", ""));

  return guarded
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(//g, ".").trim())
    .filter(Boolean);
}

/**
 * Break one page into chunks.
 *
 * Paragraph boundaries first — in a specification a paragraph is usually one
 * clause, which is exactly the unit somebody wants cited back at them.
 */
export function chunkText(text: string, page: number | undefined, startOrdinal: number, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.target ?? DEFAULT_TARGET;
  const max = opts.max ?? DEFAULT_MAX;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;

  const paragraphs = String(text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const p of paragraphs) {
    if (estimateTokens(p) <= max) { units.push(p); continue; }
    // Too big to keep whole: fall to sentences.
    let buf = "";
    for (const s of sentences(p)) {
      if (estimateTokens(s) > max) {
        // A single sentence over the ceiling — the only place a hard cut is
        // justified, and it is rare enough to be worth doing badly.
        if (buf) { units.push(buf); buf = ""; }
        const size = max * 4;
        for (let i = 0; i < s.length; i += size) units.push(s.slice(i, i + size));
        continue;
      }
      if (estimateTokens(buf + " " + s) > max) { units.push(buf); buf = s; }
      else buf = buf ? `${buf} ${s}` : s;
    }
    if (buf) units.push(buf);
  }

  const chunks: Chunk[] = [];
  let current = "";
  let ordinal = startOrdinal;
  /**
   * Units appended since the last flush.
   *
   * After a flush `current` holds only the carried overlap — text that has
   * already been emitted. Flushing again before anything new arrives would
   * publish that overlap as a chunk in its own right: a duplicate fragment,
   * cited as if it were a distinct passage. The counter is what distinguishes
   * "a chunk in progress" from "the tail of the one just emitted".
   */
  let sinceFlush = 0;

  const flush = () => {
    if (!current.trim() || sinceFlush === 0) return;
    chunks.push({ text: current.trim(), page, ordinal: ordinal++, tokens: estimateTokens(current) });
    sinceFlush = 0;

    if (overlap <= 0) { current = ""; return; }

    // Carry the tail forward so a fact spanning the seam survives whole
    // somewhere.
    const words = current.trim().split(/\s+/);
    const keep = Math.min(words.length, Math.ceil(overlap / 0.75));
    let tail = words.slice(-keep).join(" ");

    // Extracted text is not guaranteed to contain spaces — a scanned table or a
    // mangled PDF can yield one enormous "word". Counting words alone would then
    // carry the entire chunk forward as overlap, so the budget is enforced in
    // characters as well.
    if (estimateTokens(tail) > overlap) tail = tail.slice(-Math.max(1, overlap * 4));
    current = tail;
  };

  for (const u of units) {
    const candidate = current ? `${current} ${u}` : u;
    if (current && estimateTokens(candidate) > target) {
      flush();
      // `max` is a ceiling, not a target. After a flush `current` holds the
      // carried overlap, and overlap-plus-unit can exceed the ceiling on its
      // own — in which case the overlap is dropped for this chunk. Losing a
      // seam is recoverable; emitting a chunk the caller was promised would fit
      // is not, because the budget it was measured against is now wrong.
      current = current && estimateTokens(`${current} ${u}`) <= max ? `${current} ${u}` : u;
    } else {
      current = candidate;
    }
    sinceFlush++;
    if (estimateTokens(current) >= max) flush();
  }
  if (current.trim() && sinceFlush > 0) {
    chunks.push({ text: current.trim(), page, ordinal: ordinal++, tokens: estimateTokens(current) });
  }

  // The overlap tail can leave a final chunk that is only the carried text.
  return chunks.filter((c, i) => i === 0 || c.text !== chunks[i - 1].text);
}

export interface Page { page?: number; text: string }

/** Chunk a whole document, keeping ordinals continuous across pages. */
export function chunkDocument(pages: Page[], opts: ChunkOptions = {}): Chunk[] {
  const out: Chunk[] = [];
  for (const p of pages) {
    out.push(...chunkText(p.text, p.page, out.length, opts));
  }
  return out.map((c, i) => ({ ...c, ordinal: i }));
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  text: string;
  page?: number;
  /** MySQL FULLTEXT relevance, or any lexical score. Higher is better. */
  lexical?: number;
  /** Cosine similarity in [-1,1], when an embedding exists on both sides. */
  similarity?: number;
  documentNumber?: string;
  revisionCode?: string;
}

export interface Scored extends Candidate {
  score: number;
  /** Identifiers from the question found verbatim in the chunk. */
  matchedIdentifiers: string[];
  why: string;
}

/**
 * Identifiers worth matching literally.
 *
 * Drawing numbers, spec sections, BOQ codes, RFI numbers, room numbers. The
 * shapes are deliberately loose because every project invents its own, and a
 * missed identifier is far more costly than an extra literal match.
 */
export function extractIdentifiers(question: string): string[] {
  const q = String(question ?? "");
  const out = new Set<string>();

  // A-201, MEP-HVAC-L04-103, DXB01-ABC-ZZ-04-DR-M-0103.
  //
  // The first segment must START with a letter but may then contain digits —
  // project codes like DXB01 are extremely common, and requiring letters only
  // made the match begin at the second segment, silently returning a different
  // (and wrong) identifier. Starting with a letter is also what keeps "150-200"
  // from being read as a document number.
  for (const m of q.matchAll(/\b[A-Z][A-Z0-9]{0,9}(?:[-\/][A-Z0-9]{1,8})+\b/g)) out.add(m[0]);
  // 09 22 16 / 09.22.16 — MasterFormat sections
  for (const m of q.matchAll(/\b\d{2}[\s.]\d{2}[\s.]\d{2}\b/g)) out.add(m[0]);
  // Bare sheet-ish tokens: A201, M103
  for (const m of q.matchAll(/\b[A-Z]{1,3}\d{2,5}\b/g)) out.add(m[0]);
  // Room / level references: L04, Level 4
  for (const m of q.matchAll(/\bL\d{1,3}\b/gi)) out.add(m[0].toUpperCase());

  return [...out];
}

const normalise = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ");

/**
 * Score a candidate against the question.
 *
 * A literal identifier match dominates. This is the whole reason retrieval here
 * is not a vector store: "A-201" and "A-210" are neighbours in embedding space
 * and completely different drawings, and answering about the wrong one with
 * confidence is worse than not answering.
 */
export function scoreCandidate(question: string, c: Candidate, identifiers?: string[]): Scored {
  const ids = identifiers ?? extractIdentifiers(question);
  const hay = normalise(c.text) + " " + normalise(c.documentNumber ?? "");
  const matched = ids.filter((id) => hay.includes(normalise(id)));

  const lexical = Math.max(0, c.lexical ?? 0);
  // FULLTEXT relevance is unbounded; squash it so one enormous score cannot
  // swamp the identifier bonus.
  const lexicalPart = lexical > 0 ? Math.min(1, lexical / (lexical + 4)) : 0;
  const simPart = typeof c.similarity === "number" ? Math.max(0, c.similarity) : 0;

  const score = matched.length * 10 + lexicalPart * 3 + simPart * 2;

  const why = matched.length
    ? `Names ${matched.join(", ")} directly.`
    : simPart > 0 && lexicalPart > 0
      ? "Matches the wording and the meaning."
      : lexicalPart > 0
        ? "Matches the wording."
        : simPart > 0
          ? "Related in meaning."
          : "Weak match.";

  return { ...c, score, matchedIdentifiers: matched, why };
}

/**
 * Rank candidates, best first.
 *
 * Ties break on page then id, so the order is stable: the same question against
 * the same corpus must return the same evidence in the same order, or a cached
 * answer and a fresh one disagree for reasons nobody can explain.
 */
export function rank(question: string, candidates: Candidate[]): Scored[] {
  const ids = extractIdentifiers(question);
  return candidates
    .map((c) => scoreCandidate(question, c, ids))
    .sort((a, b) =>
      b.score - a.score ||
      (a.page ?? 0) - (b.page ?? 0) ||
      String(a.id).localeCompare(String(b.id)));
}

export interface PackResult {
  chosen: Scored[];
  tokensUsed: number;
  dropped: number;
  why: string;
}

/**
 * Fill the evidence budget, best first, without exceeding it.
 *
 * Near-duplicates are skipped: tender documents repeat boilerplate across
 * sections, and three copies of the same clause crowd out the one paragraph
 * that would actually have answered the question.
 *
 * Never silently exceeds the budget — AI Fabric §10 is explicit that going over
 * is not an option, and quietly truncating inside the model is worse than
 * returning less evidence and saying so.
 */
export function packToBudget(scored: Scored[], budgetTokens: number): PackResult {
  const chosen: Scored[] = [];
  const seen: string[] = [];
  let used = 0;
  let dropped = 0;

  for (const c of scored) {
    const tokens = estimateTokens(c.text);
    if (used + tokens > budgetTokens) { dropped++; continue; }

    const key = normalise(c.text).slice(0, 160);
    if (seen.some((s) => s === key)) { dropped++; continue; }

    chosen.push(c);
    seen.push(key);
    used += tokens;
  }

  const why = !scored.length
    ? "No evidence found."
    : dropped
      ? `${chosen.length} passage${chosen.length === 1 ? "" : "s"} within the ${budgetTokens}-token budget; ${dropped} left out.`
      : `${chosen.length} passage${chosen.length === 1 ? "" : "s"}, ${used} tokens.`;

  return { chosen, tokensUsed: used, dropped, why };
}

/** Cosine similarity, for when both sides carry an embedding. */
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

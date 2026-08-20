/**
 * Revision intelligence — what actually changed between two revisions.
 *
 * When Rev C supersedes Rev B, somebody has to work out what moved. Doing that
 * by eye across a 200-page specification is how a changed fire rating reaches
 * site unnoticed, and it is the single most common way a document control
 * system that "works" still lets a project down.
 *
 * ── WHY THE DIFF IS DETERMINISTIC ────────────────────────────────────────────
 *
 * A model asked "what changed between these two specs" produces a fluent summary
 * nobody can check, and it will quietly omit things. The comparison here is
 * arithmetic: an LCS line diff over extracted text. The AI's job is to explain
 * the result and judge significance — never to compute it.
 *
 * That split matters commercially. A contractor claiming an addendum changed the
 * scope needs to point at the line, not at a paraphrase.
 *
 * ── CLASSIFICATION IS A HINT, NOT A VERDICT ──────────────────────────────────
 *
 * Each change is tagged by what it looks like — a dimension, a requirement, a
 * money figure. These are lexical patterns, not comprehension, and they are
 * deliberately generous: a false "possible quantity impact" costs somebody a
 * minute, and a missed one costs a variation nobody priced. So the tagging errs
 * toward flagging, and every tag carries the line that triggered it.
 */

/** What a changed line appears to be about. Lexical, not semantic. */
export type ChangeKind =
  | "dimension"
  | "requirement"
  | "commercial"
  | "reference"
  | "note"
  | "text";

export type ChangeOp = "added" | "removed" | "modified";

export interface TextChange {
  op: ChangeOp;
  kind: ChangeKind;
  /** 1-based page, when the source is paginated. */
  page?: number;
  /** 1-based line within the page. */
  line: number;
  before?: string;
  after?: string;
  /**
   * Whether this could move a quantity, a price or an obligation. Drives what a
   * reviewer looks at first.
   */
  significant: boolean;
  why: string;
}

export interface ComparePage {
  page: number;
  lines: string[];
}

export interface CompareResult {
  changes: TextChange[];
  added: number;
  removed: number;
  modified: number;
  significant: number;
  byKind: Record<ChangeKind, number>;
  /** Pages that contain at least one change, in order. */
  pagesAffected: number[];
  summary: string;
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * A number followed by a unit, or a scale/ratio.
 *
 * Deliberately broad: mm, m, m2, m3, kg, kN, MPa, hours, degrees, percentages
 * and bare dimension strings like 150x150. A changed dimension is the highest-
 * value thing this can catch.
 */
const DIMENSION = /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|m2|m²|m3|m³|km|kg|t|kn|kpa|mpa|n\/mm2|%|deg|°|hr|hrs|min|minutes|hours|mins?)\b|\b\d+\s*[x×]\s*\d+\b|\b1\s*:\s*\d+\b/i;

/** Obligation language. BS/ISO drafting uses these deliberately. */
const REQUIREMENT = /\b(shall|must|is to be|are to be|required to|no less than|not less than|minimum of|maximum of|shall not|must not)\b/i;

/** Money, rates and contractual/commercial language. */
const COMMERCIAL = /\b(aed|usd|sar|qar|kwd|omr|bhd|gbp|eur|\$|£|€)\s?\d|\bprovisional sum\b|\bprime cost\b|\bpc sum\b|\bliquidated damages\b|\bretention\b|\bvariation\b|\bcontract sum\b|\brate\b|\blump sum\b/i;

/** Cross-references to other controlled information. */
const REFERENCE = /\b(?:drawing|dwg|sheet|spec(?:ification)?|section|clause|appendix|annex|schedule|detail|rfi|submittal)\s*(?:no\.?|number|ref\.?)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9.\-\/]{1,}\b|\b\d{2}\s\d{2}\s\d{2}\b/i;

/** Marginal notes and drawing annotations. */
const NOTE = /^\s*(?:note|notes|nb|n\.b\.|general note|typ\.?|typical)\b/i;

/** What a line looks like it is about. First match wins, most costly first. */
export function classifyLine(text: string): ChangeKind {
  const t = String(text ?? "");
  if (DIMENSION.test(t)) return "dimension";
  if (COMMERCIAL.test(t)) return "commercial";
  if (REQUIREMENT.test(t)) return "requirement";
  if (REFERENCE.test(t)) return "reference";
  if (NOTE.test(t)) return "note";
  return "text";
}

/**
 * Which kinds are worth a reviewer's attention first.
 *
 * A changed note is worth recording and rarely worth stopping for. A changed
 * dimension, obligation or money figure can move a quantity, a price or a
 * liability, and those are the three things a variation is made of.
 */
const SIGNIFICANT_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  "dimension", "requirement", "commercial",
]);

export function isSignificant(kind: ChangeKind): boolean {
  return SIGNIFICANT_KINDS.has(kind);
}

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * Collapse differences that are not changes.
 *
 * Two extractions of the same untouched page routinely differ in whitespace and
 * in how the extractor broke lines. Reporting those as content changes buries
 * the real ones, which is the failure mode that makes people stop reading diffs
 * at all.
 *
 * Case is preserved: "SHALL" becoming "shall" is noise, but "Fire rated"
 * becoming "FIRE RATED" on a drawing note can be a deliberate emphasis change.
 * So case-only differences are compared insensitively for MATCHING but the
 * original text is what gets reported.
 */
export function normalise(line: string): string {
  return String(line ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── Diff ─────────────────────────────────────────────────────────────────────

type Pair = { a?: number; b?: number };

/**
 * Longest common subsequence over normalised lines, walked back into an
 * add/remove/keep script.
 *
 * O(n·m) in time and memory, which is fine for a page and would not be for a
 * whole document at once — hence the page-at-a-time API. A 200-page spec
 * compares as 200 small problems rather than one enormous one, and pages that
 * are byte-identical are skipped before any of this runs.
 */
function lcsPairs(a: string[], b: string[]): Pair[] {
  const n = a.length, m = b.length;
  const na = a.map(normalise), nb = b.map(normalise);

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: Pair[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) { out.push({ a: i, b: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ a: i }); i++; }
    else { out.push({ b: j }); j++; }
  }
  while (i < n) out.push({ a: i++ });
  while (j < m) out.push({ b: j++ });
  return out;
}

/**
 * Pair an adjacent removal and addition into one "modified".
 *
 * Without this a reworded sentence reports as two unrelated changes and the
 * reviewer cannot see that it is one edit. Only adjacent pairs are joined —
 * looking further afield starts inventing relationships between lines that have
 * nothing to do with each other.
 */
function coalesce(pairs: Pair[], a: string[], b: string[], page: number | undefined): TextChange[] {
  const changes: TextChange[] = [];
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k];
    if (p.a !== undefined && p.b !== undefined) continue;      // unchanged

    const next = pairs[k + 1];
    if (p.a !== undefined && next && next.b !== undefined && next.a === undefined) {
      const before = a[p.a], after = b[next.b];
      const kind = classifyLine(after) === "text" ? classifyLine(before) : classifyLine(after);
      changes.push({
        op: "modified", kind, page, line: (p.a ?? 0) + 1,
        before, after,
        significant: isSignificant(kind),
        why: describeChange("modified", kind, before, after),
      });
      k++;                                                     // consume the addition
      continue;
    }

    if (p.a !== undefined) {
      const before = a[p.a];
      const kind = classifyLine(before);
      changes.push({
        op: "removed", kind, page, line: p.a + 1, before,
        significant: isSignificant(kind),
        why: describeChange("removed", kind, before),
      });
    } else if (p.b !== undefined) {
      const after = b[p.b];
      const kind = classifyLine(after);
      changes.push({
        op: "added", kind, page, line: p.b + 1, after,
        significant: isSignificant(kind),
        why: describeChange("added", kind, undefined, after),
      });
    }
  }
  return changes;
}

const KIND_LABEL: Record<ChangeKind, string> = {
  dimension: "a dimension or quantity",
  requirement: "an obligation",
  commercial: "a commercial figure",
  reference: "a cross-reference",
  note: "a note",
  text: "text",
};

function describeChange(op: ChangeOp, kind: ChangeKind, before?: string, after?: string): string {
  const what = KIND_LABEL[kind];
  if (op === "added") return `Added ${what}.`;
  if (op === "removed") return `Removed ${what}.`;

  // For a modification, say what the numbers did — that is the thing a reviewer
  // is actually looking for, and it is cheap to extract.
  if (kind === "dimension") {
    const nb = (before ?? "").match(/\d+(?:[.,]\d+)?/g) ?? [];
    const na = (after ?? "").match(/\d+(?:[.,]\d+)?/g) ?? [];
    if (nb.length && na.length && nb.join() !== na.join()) {
      return `Changed ${what}: ${nb.join(", ")} became ${na.join(", ")}. Worth checking before this is priced.`;
    }
  }
  return `Changed ${what}.`;
}

/** Compare one page of extracted text. */
export function comparePage(
  before: string[], after: string[], page?: number,
): TextChange[] {
  return coalesce(lcsPairs(before, after), before, after, page);
}

/**
 * Compare two revisions, page by page.
 *
 * Pages present in only one revision are reported wholesale — a page that has
 * been inserted or deleted is a change to the document even if no line within it
 * can be paired with anything.
 */
export function compareRevisionText(
  before: ComparePage[], after: ComparePage[],
): CompareResult {
  const byPageBefore = new Map(before.map((p) => [p.page, p.lines]));
  const byPageAfter = new Map(after.map((p) => [p.page, p.lines]));
  const pages = [...new Set([...byPageBefore.keys(), ...byPageAfter.keys()])].sort((x, y) => x - y);

  const changes: TextChange[] = [];
  for (const page of pages) {
    const a = byPageBefore.get(page) ?? [];
    const b = byPageAfter.get(page) ?? [];

    // Identical pages are the common case in a revision — skip the O(n·m) walk.
    if (a.length === b.length && a.every((l, i) => normalise(l) === normalise(b[i]))) continue;

    changes.push(...comparePage(a, b, page));
  }

  const byKind = { dimension: 0, requirement: 0, commercial: 0, reference: 0, note: 0, text: 0 } as Record<ChangeKind, number>;
  for (const c of changes) byKind[c.kind]++;

  const added = changes.filter((c) => c.op === "added").length;
  const removed = changes.filter((c) => c.op === "removed").length;
  const modified = changes.filter((c) => c.op === "modified").length;
  const significant = changes.filter((c) => c.significant).length;
  const pagesAffected = [...new Set(changes.map((c) => c.page).filter((p): p is number => p !== undefined))].sort((x, y) => x - y);

  const summary = !changes.length
    ? "No text changes detected."
    : `${changes.length} change${changes.length === 1 ? "" : "s"} across ${pagesAffected.length} page${pagesAffected.length === 1 ? "" : "s"}` +
      (significant ? ` — ${significant} could affect quantity, cost or obligation.` : ".");

  return { changes, added, removed, modified, significant, byKind, pagesAffected, summary };
}

/**
 * The changes a reviewer should look at first.
 *
 * Significant first, then by page, so the order matches how somebody reads.
 */
export function reviewOrder(result: CompareResult): TextChange[] {
  return [...result.changes].sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1;
    if ((a.page ?? 0) !== (b.page ?? 0)) return (a.page ?? 0) - (b.page ?? 0);
    return a.line - b.line;
  });
}

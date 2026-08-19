/**
 * Formal document revisions.
 *
 * Construction revision control is not file versioning, and conflating the two
 * is the single most common way a document system becomes untrustworthy. Four
 * different things are involved and each moves independently:
 *
 *   binary file version   somebody re-uploaded the PDF because page 3 was blank
 *   formal revision       Rev C — a contractual statement about the content
 *   workflow status       where it sits in review right now
 *   purpose of issue      what the recipient is allowed to do with it
 *
 * A drawing can gain three file versions without its revision changing, and a
 * revision can sit at four different workflow statuses over its life. Modelling
 * only "version" loses the distinction a contract depends on.
 *
 * ── THE RULES THAT MAKE IT TRUSTWORTHY ───────────────────────────────────────
 *
 * 1. Exactly one revision is current within a status context.
 * 2. A superseded revision is immutable and stays retrievable — forever. It is
 *    the evidence of what was issued at the time.
 * 3. A transmitted revision is frozen. The recipient holds a copy; changing what
 *    the register says was sent turns the record into a lie.
 * 4. Links capture the revision used at the time, not "latest".
 *
 * Rule 3 is why `freeze` exists separately from supersession: a revision can be
 * superseded and still be the thing that was formally issued last Tuesday.
 */

/** How revision codes advance on this project. */
export type RevisionScheme =
  /** A, B, C … skipping I and O. */
  | "alpha"
  /** 01, 02, 03 … */
  | "numeric"
  /** P01…P99 while preliminary, C01…C99 once accepted for construction. */
  | "iso19650";

/**
 * I and O are skipped.
 *
 * Not decoration: on a printed title block at drawing scale, a revision "I" is
 * indistinguishable from "1" and "O" from "0". BS 1192 omits them and so does
 * most GCC employer documentation, because the ambiguity is resolved on site by
 * guessing.
 */
export const ALPHA_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

export interface ParsedRevision {
  /** "" for alpha and numeric; "P" or "C" for ISO 19650. */
  family: string;
  /** 1-based position within the family. */
  ordinal: number;
}

/** ISO 19650 suitability (purpose of issue) codes. */
export const SUITABILITY: Record<string, { label: string; published: boolean }> = {
  S0: { label: "Work in progress", published: false },
  S1: { label: "Suitable for coordination", published: false },
  S2: { label: "Suitable for information", published: false },
  S3: { label: "Suitable for review and comment", published: false },
  S4: { label: "Suitable for stage approval", published: false },
  S6: { label: "Suitable for PIM authorisation", published: false },
  S7: { label: "Suitable for AIM authorisation", published: false },
  A1: { label: "Authorised and accepted", published: true },
  A2: { label: "Authorised and accepted", published: true },
  A3: { label: "Authorised and accepted", published: true },
  A4: { label: "Authorised and accepted", published: true },
  A5: { label: "Authorised and accepted", published: true },
  B1: { label: "Partial sign-off, with comments", published: true },
  B2: { label: "Partial sign-off, with comments", published: true },
  B3: { label: "Partial sign-off, with comments", published: true },
  B4: { label: "Partial sign-off, with comments", published: true },
  B5: { label: "Partial sign-off, with comments", published: true },
  D1: { label: "Published for construction", published: true },
  D2: { label: "Published for construction", published: true },
  D3: { label: "Published for construction", published: true },
  D4: { label: "Published for construction", published: true },
  CR: { label: "As-constructed record", published: true },
};

/** Whether this purpose of issue puts the document in someone else's hands. */
export function isPublishedSuitability(code: string): boolean {
  return SUITABILITY[String(code ?? "").toUpperCase()]?.published ?? false;
}

/** Read a revision code into a comparable shape, or null if it is not valid. */
export function parseRevision(scheme: RevisionScheme, code: string): ParsedRevision | null {
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) return null;

  if (scheme === "alpha") {
    // Multi-letter continues past Z: Z -> AA -> AB, base-24 over the safe set.
    if (!/^[A-Z]+$/.test(c)) return null;
    let n = 0;
    for (const ch of c) {
      const i = ALPHA_LETTERS.indexOf(ch);
      if (i < 0) return null;                       // an I or an O
      n = n * ALPHA_LETTERS.length + (i + 1);
    }
    return { family: "", ordinal: n };
  }

  if (scheme === "numeric") {
    if (!/^\d+$/.test(c)) return null;
    const n = Number(c);
    return n >= 1 ? { family: "", ordinal: n } : null;
  }

  const m = /^([PC])(\d{2,})$/.exec(c);
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 ? { family: m[1], ordinal: n } : null;
}

/** Render a parsed revision back to its code. */
export function formatRevision(scheme: RevisionScheme, r: ParsedRevision): string {
  if (scheme === "alpha") {
    let n = r.ordinal;
    let out = "";
    const base = ALPHA_LETTERS.length;
    while (n > 0) {
      const rem = (n - 1) % base;
      out = ALPHA_LETTERS[rem] + out;
      n = Math.floor((n - 1) / base);
    }
    return out;
  }
  if (scheme === "numeric") return String(r.ordinal).padStart(2, "0");
  return `${r.family || "P"}${String(r.ordinal).padStart(2, "0")}`;
}

export function isValidRevision(scheme: RevisionScheme, code: string): boolean {
  return parseRevision(scheme, code) !== null;
}

/**
 * Order two revision codes.
 *
 * For ISO 19650 the family dominates the ordinal: C01 supersedes P99, because
 * accepting a document for construction is a promotion, not a further draft.
 * Comparing on the number alone would put P99 above C01 and make "latest" wrong
 * at exactly the moment it matters most.
 */
export function compareRevisions(scheme: RevisionScheme, a: string, b: string): number {
  const pa = parseRevision(scheme, a);
  const pb = parseRevision(scheme, b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (scheme === "iso19650" && pa.family !== pb.family) {
    return pa.family === "C" ? 1 : -1;
  }
  return pa.ordinal - pb.ordinal;
}

/** The next code in sequence. With no current revision, the first one. */
export function nextRevision(scheme: RevisionScheme, current?: string | null): string {
  if (!current) {
    if (scheme === "alpha") return "A";
    if (scheme === "numeric") return "01";
    return "P01";
  }
  const p = parseRevision(scheme, current);
  if (!p) throw new Error(`"${current}" is not a valid ${scheme} revision code.`);
  return formatRevision(scheme, { family: p.family, ordinal: p.ordinal + 1 });
}

/**
 * Promote a preliminary revision to the contractual series.
 *
 * ISO 19650 only. The count restarts at 01: C01 is the first construction
 * issue whatever the drafting history was, and carrying P07 across to C07 would
 * imply six construction issues that never happened.
 */
export function promoteRevision(scheme: RevisionScheme, current: string): string {
  if (scheme !== "iso19650") {
    throw new Error("Promotion applies to the ISO 19650 scheme only.");
  }
  const p = parseRevision(scheme, current);
  if (!p) throw new Error(`"${current}" is not a valid ISO 19650 revision code.`);
  if (p.family === "C") return formatRevision(scheme, { family: "C", ordinal: p.ordinal + 1 });
  return "C01";
}

/** Highest revision by scheme order — not by upload time. */
export function latestRevision(scheme: RevisionScheme, codes: string[]): string | null {
  const valid = codes.filter((c) => isValidRevision(scheme, c));
  if (!valid.length) return null;
  return valid.reduce((best, c) => (compareRevisions(scheme, c, best) > 0 ? c : best));
}

export type RevisionState = "draft" | "current" | "superseded";

export interface RevisionRow {
  code: string;
  state: RevisionState;
  /** Set once transmitted or formally issued. Frozen rows never change again. */
  frozen?: boolean;
}

export interface SupersessionPlan {
  current: string;
  superseded: string[];
  unchanged: string[];
  why: string;
}

/**
 * Decide which revision is current once `incoming` is issued.
 *
 * Returned as a plan rather than applied, so the caller can show it before
 * committing and so the decision is testable without a database.
 *
 * Drafts are left alone. A draft is somebody's unfinished work, and superseding
 * it because a colleague issued a later revision would delete work in progress
 * that was never in the contractual series to begin with.
 */
export function planSupersession(
  scheme: RevisionScheme,
  rows: RevisionRow[],
  incoming: string,
): SupersessionPlan {
  if (!isValidRevision(scheme, incoming)) {
    throw new Error(`"${incoming}" is not a valid ${scheme} revision code.`);
  }

  const superseded: string[] = [];
  const unchanged: string[] = [];

  for (const r of rows) {
    if (r.code === incoming) continue;
    if (r.state === "draft") {
      unchanged.push(r.code);
      continue;
    }
    if (r.state === "current") {
      superseded.push(r.code);
      continue;
    }
    unchanged.push(r.code);        // already superseded
  }

  const behind = superseded.filter((c) => compareRevisions(scheme, c, incoming) > 0);
  const why = behind.length
    ? `${incoming} becomes current, but ${behind.join(", ")} ranks above it — check the revision code before issuing.`
    : superseded.length
      ? `${incoming} becomes current; ${superseded.join(", ")} superseded.`
      : `${incoming} becomes the first current revision.`;

  return { current: incoming, superseded, unchanged, why };
}

/**
 * Why a revision may not be edited, or null if it may.
 *
 * Two independent locks. A superseded revision is the historical record. A
 * frozen one was put in somebody else's hands — and the register saying
 * something different from the copy the consultant is holding is worse than
 * having no register at all.
 */
export function editBlockedReason(row: RevisionRow): string | null {
  if (row.frozen) {
    return "This revision has been issued or transmitted. Create a new revision instead — the recipient holds this one.";
  }
  if (row.state === "superseded") {
    return "This revision is superseded and is the record of what was issued at the time. Create a new revision instead.";
  }
  return null;
}

export function canEdit(row: RevisionRow): boolean {
  return editBlockedReason(row) === null;
}

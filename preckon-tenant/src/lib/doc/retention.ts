/**
 * Retention and legal hold.
 *
 * Two rules that look alike and mean opposite things.
 *
 *   retention   how long a record MUST be kept before it MAY be destroyed
 *   legal hold  this record MUST NOT be destroyed, whatever retention permits
 *
 * A hold always wins. Getting that precedence backwards destroys evidence in a
 * live dispute, which is a legal problem rather than a data one — so it is
 * decided here, once, with a test on it, rather than left to whoever writes the
 * next archiving job.
 *
 * ── WHY DELETION IS A QUESTION, NOT A COMMAND ────────────────────────────────
 *
 * Nothing in this module deletes anything. It answers whether deletion is
 * permitted and says why not. The actual removal is a separate, audited act, and
 * keeping the two apart means a bug in a cleanup script cannot destroy records
 * on its own — it has to get past an explicit answer first.
 */

export interface RetainableRecord {
  id: string;
  /** When the retention clock starts — usually issue, sometimes handover. */
  retentionFrom?: string | Date | null;
  /** Years to keep. Absent means no policy has been set. */
  retentionYears?: number | null;
  legalHold?: boolean;
  legalHoldReason?: string | null;
  /** Blocks destruction: the record is cited by something still live. */
  referencedBy?: string[];
}

export type Verdict =
  /** Retention has run and nothing objects. */
  | "may_delete"
  /** Retention has not run yet. */
  | "retained"
  /** Under legal hold. */
  | "on_hold"
  /** No retention policy has been set, so nothing has been decided. */
  | "undecided"
  /** Still referenced by live records. */
  | "referenced";

export interface RetentionDecision {
  verdict: Verdict;
  mayDelete: boolean;
  /** When retention expires, when that is knowable. */
  expiresAt: Date | null;
  why: string;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When retention runs out, or null if that cannot be worked out. */
export function retentionExpiry(r: RetainableRecord): Date | null {
  const from = toDate(r.retentionFrom);
  if (!from || r.retentionYears == null || r.retentionYears < 0) return null;
  const out = new Date(from.getTime());
  out.setFullYear(out.getFullYear() + r.retentionYears);
  return out;
}

/**
 * May this record be destroyed?
 *
 * The order of these checks IS the policy, so it is written to be read:
 *
 *   1. legal hold      — outranks everything, including expired retention
 *   2. live references — deleting something still cited leaves a dangling claim
 *   3. no policy       — absence of a rule is not permission
 *   4. retention       — the ordinary case
 */
export function canDelete(r: RetainableRecord, now = new Date()): RetentionDecision {
  if (r.legalHold) {
    return {
      verdict: "on_hold",
      mayDelete: false,
      expiresAt: retentionExpiry(r),
      why: r.legalHoldReason
        ? `Under legal hold: ${r.legalHoldReason}. A hold outranks retention.`
        : "Under legal hold. A hold outranks retention, including expired retention.",
    };
  }

  const refs = r.referencedBy ?? [];
  if (refs.length) {
    return {
      verdict: "referenced",
      mayDelete: false,
      expiresAt: retentionExpiry(r),
      why: `Still referenced by ${refs.length} live record${refs.length === 1 ? "" : "s"} (${refs.slice(0, 3).join(", ")}${refs.length > 3 ? "…" : ""}).`,
    };
  }

  const expiry = retentionExpiry(r);
  if (!expiry) {
    // Silence is not consent. A record with no policy stays.
    return {
      verdict: "undecided",
      mayDelete: false,
      expiresAt: null,
      why: "No retention policy is set for this record, so nothing has decided it may go.",
    };
  }

  if (expiry.getTime() > now.getTime()) {
    return {
      verdict: "retained",
      mayDelete: false,
      expiresAt: expiry,
      why: `Retained until ${expiry.toISOString().slice(0, 10)}.`,
    };
  }

  return {
    verdict: "may_delete",
    mayDelete: true,
    expiresAt: expiry,
    why: `Retention expired on ${expiry.toISOString().slice(0, 10)} and nothing else objects.`,
  };
}

/** Records eligible for destruction — the input to any archiving job. */
export function eligibleForDeletion<T extends RetainableRecord>(records: T[], now = new Date()): T[] {
  return records.filter((r) => canDelete(r, now).mayDelete);
}

export interface HoldChange {
  applied: boolean;
  why: string;
}

/**
 * Place a hold.
 *
 * Always permitted, including on a record whose retention has already run —
 * that is the case a hold exists for. A reason is required, because a hold with
 * no stated basis cannot be reviewed or lifted by anybody except the person who
 * set it.
 */
export function placeHold(r: RetainableRecord, reason: string): HoldChange {
  const clean = String(reason ?? "").trim();
  if (!clean) {
    return { applied: false, why: "A legal hold needs a stated reason before it can be placed." };
  }
  if (r.legalHold) {
    return { applied: false, why: "This record is already under legal hold." };
  }
  return { applied: true, why: `Legal hold placed: ${clean}.` };
}

/**
 * Lift a hold.
 *
 * Lifting only removes the hold. It never deletes and never implies deletion —
 * once lifted the record falls back to ordinary retention, which may or may not
 * have expired.
 */
export function liftHold(r: RetainableRecord, now = new Date()): HoldChange {
  if (!r.legalHold) {
    return { applied: false, why: "This record is not under legal hold." };
  }
  const after = canDelete({ ...r, legalHold: false }, now);
  return {
    applied: true,
    why: `Legal hold lifted. ${after.why}`,
  };
}

/** Retention categories a project can pick from. Years are typical GCC practice. */
export const RETENTION_CATEGORIES: { key: string; label: string; years: number }[] = [
  { key: "contract", label: "Contract and commercial", years: 12 },
  { key: "design", label: "Design and drawings", years: 10 },
  { key: "quality", label: "Quality and inspection records", years: 10 },
  { key: "safety", label: "Health and safety records", years: 40 },
  { key: "correspondence", label: "Correspondence", years: 6 },
  { key: "transient", label: "Transient working documents", years: 2 },
];

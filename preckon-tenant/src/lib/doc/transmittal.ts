/**
 * Transmittals — the record of what was formally issued, to whom, and when.
 *
 * A transmittal is a business object, not a generated PDF. The PDF is a
 * rendering of it. This matters because the transmittal is frequently the
 * evidence in a dispute: it is how a contractor demonstrates the consultant had
 * the revised drawing on the 14th, or that a design change arrived after the
 * work was already built.
 *
 * ── IT CARRIES REVISIONS, NOT DOCUMENTS ──────────────────────────────────────
 *
 * The single most important rule here. A transmittal line points at
 * `document_revision`, never at `document`. If it pointed at the document, then
 * issuing Rev D next month would silently rewrite history: the transmittal sent
 * in March would start claiming it had sent Rev D, which nobody had in March.
 *
 * That is not a hypothetical filing error. It is the difference between an
 * auditable issue record and a document that actively misleads.
 *
 * ── SENDING FREEZES ──────────────────────────────────────────────────────────
 *
 * Once sent, the transmittal and every revision on it become immutable. The
 * recipient holds a copy; a register that disagrees with the copy on someone
 * else's desk is worse than no register.
 */

export type TransmittalStatus =
  /** Being assembled. The only state in which contents may change. */
  | "draft"
  /** Issued. Frozen. Awaiting acknowledgement. */
  | "sent"
  /** Every recipient who owed an acknowledgement has given one. */
  | "acknowledged"
  /** Closed off — responses received or no longer expected. */
  | "closed"
  /** Withdrawn after sending. Never deleted. */
  | "recalled";

export type Acknowledgement = "pending" | "acknowledged" | "declined";

export interface TransmittalItem {
  /** Points at a specific revision. Never at the document. */
  revisionId: string;
  documentNumber: string;
  revisionCode: string;
  /** State of that revision at the moment of sending. */
  revisionState?: "draft" | "current" | "superseded";
}

export interface Recipient {
  party: string;
  /** Whether this recipient owes an acknowledgement. */
  requiresAck: boolean;
  ack: Acknowledgement;
  ackAt?: string | null;
}

export interface Transmittal {
  id: string;
  number: string;
  status: TransmittalStatus;
  purpose: string;
  items: TransmittalItem[];
  recipients: Recipient[];
  sentAt?: string | null;
  requiredResponseAt?: string | null;
}

export interface Issue {
  field: string;
  message: string;
}

/**
 * Whether this transmittal can be sent, and what is wrong if not.
 *
 * Checked as a list rather than a boolean because a document controller
 * assembling an issue wants every problem at once — the alternative is
 * discovering the fourth blocker after fixing the third.
 */
export function validateForSending(t: Transmittal): Issue[] {
  const issues: Issue[] = [];

  if (t.status !== "draft") {
    issues.push({ field: "status", message: `Only a draft transmittal can be sent; this one is ${t.status}.` });
  }

  if (!t.items.length) {
    issues.push({ field: "items", message: "A transmittal must carry at least one document revision." });
  }

  if (!t.recipients.length) {
    issues.push({ field: "recipients", message: "A transmittal must have at least one recipient." });
  }

  if (!String(t.purpose ?? "").trim()) {
    // Without a purpose the recipient does not know what they may do with it —
    // review it, build from it, or file it.
    issues.push({ field: "purpose", message: "A purpose of issue is required." });
  }

  // Issuing work in progress is how unapproved design reaches site. If it is
  // genuinely meant to go out, it should be issued at a WIP suitability as a
  // real revision, not sent as a draft.
  for (const item of t.items) {
    if (item.revisionState === "draft") {
      issues.push({
        field: "items",
        message: `${item.documentNumber} Rev ${item.revisionCode} is still a draft. Issue the revision before transmitting it.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const item of t.items) {
    if (seen.has(item.revisionId)) {
      issues.push({ field: "items", message: `${item.documentNumber} Rev ${item.revisionCode} is on this transmittal twice.` });
    }
    seen.add(item.revisionId);
  }

  // Two revisions of the same document on one transmittal is nearly always a
  // mistake, and the recipient cannot tell which one governs.
  const byDoc = new Map<string, string[]>();
  for (const item of t.items) {
    byDoc.set(item.documentNumber, [...(byDoc.get(item.documentNumber) ?? []), item.revisionCode]);
  }
  for (const [doc, revs] of byDoc) {
    if (new Set(revs).size > 1) {
      issues.push({
        field: "items",
        message: `${doc} appears at more than one revision (${[...new Set(revs)].join(", ")}). Send one.`,
      });
    }
  }

  const dupes = new Set<string>();
  for (const r of t.recipients) {
    const k = r.party.trim().toLowerCase();
    if (dupes.has(k)) {
      issues.push({ field: "recipients", message: `${r.party} is listed twice.` });
    }
    dupes.add(k);
  }

  return issues;
}

export function canSend(t: Transmittal): boolean {
  return validateForSending(t).length === 0;
}

/** Why the contents may not be changed, or null if they may. */
export function editBlockedReason(t: Transmittal): string | null {
  if (t.status === "draft") return null;
  if (t.status === "recalled") {
    return "This transmittal was recalled. It stays as a record of what was issued; raise a new one.";
  }
  return "This transmittal has been sent and the recipients hold copies. Raise a new transmittal instead.";
}

export function canEdit(t: Transmittal): boolean {
  return editBlockedReason(t) === null;
}

/**
 * Status implied by the acknowledgements received so far.
 *
 * Derived rather than stored, so it cannot drift out of step with the
 * acknowledgement rows that justify it. A stored status that disagrees with its
 * own evidence is the kind of thing nobody notices until an audit.
 *
 * Terminal states are returned unchanged: closing or recalling is a decision a
 * person made, and later acknowledgements do not undo it.
 */
export function derivedStatus(t: Transmittal): TransmittalStatus {
  if (t.status === "draft" || t.status === "recalled" || t.status === "closed") return t.status;

  const owed = t.recipients.filter((r) => r.requiresAck);
  if (!owed.length) return "sent";

  return owed.every((r) => r.ack === "acknowledged") ? "acknowledged" : "sent";
}

export interface AckSummary {
  required: number;
  acknowledged: number;
  declined: number;
  pending: number;
  outstanding: string[];
  summary: string;
}

/** Who still owes an acknowledgement — the question a document controller asks. */
export function acknowledgementSummary(t: Transmittal): AckSummary {
  const owed = t.recipients.filter((r) => r.requiresAck);
  const acknowledged = owed.filter((r) => r.ack === "acknowledged").length;
  const declined = owed.filter((r) => r.ack === "declined").length;
  const pending = owed.filter((r) => r.ack === "pending");

  const summary = !owed.length
    ? "No acknowledgement required."
    : pending.length === 0
      ? `All ${owed.length} acknowledged.`
      : `${acknowledged} of ${owed.length} acknowledged; ${pending.length} outstanding.`;

  return {
    required: owed.length,
    acknowledged,
    declined,
    pending: pending.length,
    outstanding: pending.map((r) => r.party),
    summary,
  };
}

/** Whether the response date has passed with acknowledgements still outstanding. */
export function isOverdue(t: Transmittal, now = new Date()): boolean {
  if (!t.requiredResponseAt) return false;
  if (derivedStatus(t) !== "sent") return false;
  const due = new Date(t.requiredResponseAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime() && acknowledgementSummary(t).pending > 0;
}

/**
 * Why this transmittal may not be recalled, or null if it may.
 *
 * Recall withdraws an issue that should not have gone out. It never deletes:
 * the recipient received it, and pretending otherwise is exactly the falsehood
 * the transmittal record exists to prevent. It marks the issue as withdrawn so
 * anyone reading the history sees both that it was sent and that it was pulled.
 */
export function recallBlockedReason(t: Transmittal): string | null {
  if (t.status === "draft") return "A draft has not been issued, so there is nothing to recall. Delete it instead.";
  if (t.status === "recalled") return "This transmittal has already been recalled.";
  if (t.status === "closed") return "This transmittal is closed. Raise a new one rather than recalling a closed record.";
  return null;
}

export function canRecall(t: Transmittal): boolean {
  return recallBlockedReason(t) === null;
}

/** One-line description for a register row. */
export function describe(t: Transmittal): string {
  const docs = t.items.length === 1 ? "1 document" : `${t.items.length} documents`;
  const to = t.recipients.length === 1
    ? t.recipients[0].party
    : `${t.recipients.length} recipients`;
  const status = derivedStatus(t);
  return `${t.number} — ${docs} to ${to} (${status})`;
}

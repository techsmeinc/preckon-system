// Addendum intelligence and impact.
//
// An addendum arrives eight days before submission, is eleven pages long, and
// changes four things that matter among sixty that do not. The bid team reads
// it once, notes the deadline extension, and misses that clause 6.4 now
// requires a performance bond at 10% instead of 5%.
//
// Two obligations follow from an addendum and both are commonly missed:
//
//   ACKNOWLEDGE it. Most forms require the addendum to be signed and returned,
//   and an unacknowledged addendum is grounds for rejecting an otherwise
//   winning bid. This is the cheapest possible way to lose.
//
//   PROPAGATE it. Every requirement, quantity and price the addendum touches is
//   now measured against a document that has changed. What was priced under the
//   old clause is priced wrong.
//
// So this maps each addendum item to what it hits, classifies the impact, and
// keeps the acknowledgement as a state rather than a note somebody wrote.

export type ItemKind =
  | "requirement_change"
  | "requirement_new"
  | "requirement_withdrawn"
  | "drawing_revision"
  | "quantity_change"
  | "deadline_change"
  | "clarification_answer"
  | "administrative";

export type Impact = "critical" | "significant" | "minor" | "none";

export interface AddendumItem {
  id: string;
  /** The addendum's own numbering, so it can be cited back. */
  ref: string;
  kind: ItemKind;
  description: string;
  /** Requirement refs, drawing numbers or BOQ codes this touches. */
  affects: string[];
  /** Set for a deadline change. */
  newDeadline?: string | null;
}

export interface Addendum {
  id: string;
  number: number;
  issuedAt: string;
  receivedAt?: string | null;
  /** Most forms require this signed and returned. */
  acknowledgementRequired: boolean;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  items: AddendumItem[];
}

export interface ImpactedEntity {
  ref: string;
  kind: ItemKind;
  impact: Impact;
  addendumNumber: number;
  itemRef: string;
  action: string;
}

export interface AddendumAssessment {
  addendumNumber: number;
  acknowledged: boolean;
  /** The one that loses bids on a technicality. */
  acknowledgementOverdue: boolean;
  deadlineMoved: string | null;
  impacted: ImpactedEntity[];
  critical: number;
  requiresRepricing: boolean;
  summary: string;
}

/* Priced work changing is critical because money is already committed to a
   number that is now wrong; a withdrawn requirement is merely significant,
   because the risk is doing work nobody will pay for rather than under-pricing
   work that must be done. */
const IMPACT_OF: Record<ItemKind, Impact> = {
  quantity_change: "critical",
  requirement_change: "critical",
  requirement_new: "critical",
  drawing_revision: "significant",
  requirement_withdrawn: "significant",
  deadline_change: "significant",
  clarification_answer: "minor",
  administrative: "none",
};

const ACTION_OF: Record<ItemKind, string> = {
  quantity_change: "Remeasure and reprice the affected items.",
  requirement_change: "Re-answer the requirement against the new wording and check the price still holds.",
  requirement_new: "Extract as a new requirement and answer it.",
  requirement_withdrawn: "Remove the response and any price carried for it.",
  drawing_revision: "Re-issue the takeoff against the revised drawing.",
  deadline_change: "Update the programme for the bid itself.",
  clarification_answer: "Fold the answer into the assumption it settles.",
  administrative: "Note it.",
};

export function assess(addendum: Addendum, now: string): AddendumAssessment {
  const impacted: ImpactedEntity[] = [];
  let deadlineMoved: string | null = null;

  for (const item of addendum.items) {
    if (item.kind === "deadline_change" && item.newDeadline) deadlineMoved = item.newDeadline;
    const impact = IMPACT_OF[item.kind];
    // An item that names nothing still gets a row, or an addendum item with no
    // mapping would vanish entirely from the assessment.
    const refs = item.affects.length ? item.affects : ["(unmapped)"];
    for (const ref of refs) {
      impacted.push({
        ref, kind: item.kind, impact,
        addendumNumber: addendum.number, itemRef: item.ref,
        action: ACTION_OF[item.kind],
      });
    }
  }

  const order: Record<Impact, number> = { critical: 0, significant: 1, minor: 2, none: 3 };
  impacted.sort((a, b) => order[a.impact] - order[b.impact]);

  const acknowledged = !!addendum.acknowledgedAt;
  const overdue =
    addendum.acknowledgementRequired && !acknowledged &&
    Date.parse(now) > Date.parse(addendum.receivedAt ?? addendum.issuedAt);
  const critical = impacted.filter((i) => i.impact === "critical").length;
  const requiresRepricing = addendum.items.some(
    (i) => i.kind === "quantity_change" || i.kind === "requirement_change" || i.kind === "requirement_new",
  );

  const parts: string[] = [];
  if (overdue) parts.push("NOT ACKNOWLEDGED — an unacknowledged addendum is grounds for rejecting the bid");
  if (critical) parts.push(`${critical} critical impact(s)`);
  if (requiresRepricing) parts.push("repricing required");
  if (deadlineMoved) parts.push(`deadline now ${deadlineMoved}`);

  return {
    addendumNumber: addendum.number,
    acknowledged,
    acknowledgementOverdue: overdue,
    deadlineMoved,
    impacted,
    critical,
    requiresRepricing,
    summary: parts.length
      ? `Addendum ${addendum.number}: ${parts.join("; ")}.`
      : `Addendum ${addendum.number}: administrative only.`,
  };
}

export interface Refusal { ok: false; reason: string }
export type Result<T> = { ok: true; value: T } | Refusal;

/** Sign and return. Recorded with who, because that is what is being certified. */
export function acknowledge(a: Addendum, at: string, by: string): Result<Addendum> {
  if (!by?.trim()) return { ok: false, reason: "Record who acknowledged it — that is what is being certified." };
  if (a.acknowledgedAt) return { ok: false, reason: `Already acknowledged ${a.acknowledgedAt}.` };
  return { ok: true, value: { ...a, acknowledgedAt: at, acknowledgedBy: by } };
}

export interface AddendaPosition {
  count: number;
  unacknowledged: number[];
  criticalOutstanding: number;
  latestDeadline: string | null;
  clearToSubmit: boolean;
  summary: string;
}

/**
 * Every addendum at once, which is how they should be read.
 *
 * Addendum 3 routinely changes what addendum 1 said. Assessing them one at a
 * time answers "what did this one do" and never "what is true now", and the
 * second question is the one being priced.
 */
export function position(addenda: Addendum[], now: string): AddendaPosition {
  const assessments = addenda.map((a) => assess(a, now));
  const unacknowledged = assessments.filter((a) => a.acknowledgementOverdue).map((a) => a.addendumNumber);
  const deadlines = assessments.map((a) => a.deadlineMoved).filter((d): d is string => !!d).sort();

  return {
    count: addenda.length,
    unacknowledged,
    criticalOutstanding: assessments.reduce((s, a) => s + a.critical, 0),
    latestDeadline: deadlines.length ? deadlines[deadlines.length - 1] : null,
    clearToSubmit: unacknowledged.length === 0,
    summary: unacknowledged.length
      ? `Addend${unacknowledged.length > 1 ? "a" : "um"} ${unacknowledged.join(", ")} not acknowledged — the bid can be rejected on that alone.`
      : `${addenda.length} addend${addenda.length === 1 ? "um" : "a"}, all acknowledged.`,
  };
}

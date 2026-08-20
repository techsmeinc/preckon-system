// Requirements with clause citation, and the compliance matrix built from them.
//
// A tender is a list of obligations scattered across a hundred pages, and the
// bid is scored on whether you met them. Two failures are routine and both are
// fatal in the same quiet way:
//
//   a requirement nobody extracted, so nobody answered it
//   an answer with no citation, so the evaluator cannot find what it responds to
//
// The citation is not decoration. An evaluator marking a compliance matrix
// checks the clause; a response that says "complied" against clause 4.2.1 when
// 4.2.1 says something else is worse than an honest deviation, because it reads
// as either careless or misleading.
//
// So a requirement here cannot exist without its source, and a response cannot
// be recorded as compliant without evidence. Both rules are enforced rather
// than encouraged, because on the night before submission the difference
// between "encouraged" and "enforced" is the whole thing.

export type Obligation = "mandatory" | "desirable" | "informational";

export interface Citation {
  /** The document it came from: the ITT, a spec section, an addendum. */
  document: string;
  /** Clause number, section, or page. */
  clause: string;
  page?: number | null;
  /** The words themselves. Paraphrase is how requirements drift. */
  quote: string;
}

export interface Requirement {
  id: string;
  ref: string;
  /** What must be done, in our words — the quote stays in the citation. */
  statement: string;
  obligation: Obligation;
  citation: Citation;
  category?: string | null;
  /** Requirements this one depends on or restates. */
  relatedIds?: string[];
  /** Set when an addendum changed or withdrew it. */
  supersededBy?: string | null;
}

export type ComplianceState =
  | "comply"
  | "comply_with_comment"
  | "partial"
  | "deviate"
  | "not_comply"
  | "not_addressed";

export interface Response {
  requirementId: string;
  state: ComplianceState;
  /** Where in our submission the evaluator will find the answer. */
  evidenceRef?: string | null;
  narrative?: string | null;
  /** A deviation must say what we are offering instead. */
  alternativeOffered?: string | null;
  owner?: string | null;
}

export interface Issue {
  requirementId: string;
  ref: string;
  severity: "disqualifying" | "serious" | "minor";
  message: string;
}

const STATE_LABEL: Record<ComplianceState, string> = {
  comply: "Comply",
  comply_with_comment: "Comply with comment",
  partial: "Partial",
  deviate: "Deviation",
  not_comply: "Does not comply",
  not_addressed: "Not addressed",
};

/** A requirement is only usable if its source can be checked. */
export function validateRequirement(r: Requirement): string[] {
  const problems: string[] = [];
  if (!r.statement?.trim()) problems.push("No statement.");
  if (!r.citation?.document?.trim()) problems.push("No source document — the requirement cannot be checked.");
  if (!r.citation?.clause?.trim()) problems.push("No clause reference — an evaluator cannot locate it.");
  if (!r.citation?.quote?.trim()) {
    problems.push("No quoted text. A paraphrased requirement drifts from what was actually asked.");
  }
  return problems;
}

export interface Matrix {
  rows: MatrixRow[];
  total: number;
  mandatory: number;
  addressed: number;
  complying: number;
  deviations: number;
  /** Mandatory requirements with no acceptable response. Bid-losing. */
  disqualifying: Issue[];
  issues: Issue[];
  /** 0..1 over mandatory requirements only. */
  complianceRate: number;
  submittable: boolean;
  summary: string;
}

export interface MatrixRow {
  ref: string;
  requirement: string;
  obligation: Obligation;
  citation: string;
  state: ComplianceState;
  stateLabel: string;
  evidenceRef: string | null;
  narrative: string | null;
}

/**
 * Build the matrix an evaluator will actually read.
 *
 * Ordered by the requirement's own reference rather than by our internal ids,
 * because the evaluator reads it alongside their own document and anything else
 * makes them hunt.
 */
export function complianceMatrix(requirements: Requirement[], responses: Response[]): Matrix {
  const byId = new Map(responses.map((r) => [r.requirementId, r] as const));
  const live = requirements.filter((r) => !r.supersededBy);
  const issues: Issue[] = [];
  const rows: MatrixRow[] = [];

  for (const req of live) {
    const res = byId.get(req.id);
    const state: ComplianceState = res?.state ?? "not_addressed";

    rows.push({
      ref: req.ref,
      requirement: req.statement,
      obligation: req.obligation,
      citation: `${req.citation.document} ${req.citation.clause}${req.citation.page ? ` p.${req.citation.page}` : ""}`,
      state,
      stateLabel: STATE_LABEL[state],
      evidenceRef: res?.evidenceRef ?? null,
      narrative: res?.narrative ?? null,
    });

    const mandatory = req.obligation === "mandatory";

    if (state === "not_addressed") {
      issues.push({
        requirementId: req.id, ref: req.ref,
        severity: mandatory ? "disqualifying" : "minor",
        message: mandatory
          ? `Mandatory requirement ${req.ref} has no response at all.`
          : `${req.ref} is unanswered.`,
      });
      continue;
    }
    if (state === "not_comply" && mandatory) {
      issues.push({
        requirementId: req.id, ref: req.ref, severity: "disqualifying",
        message: `${req.ref} is mandatory and the bid does not comply. Expect rejection unless it is negotiated before submission.`,
      });
      continue;
    }
    if ((state === "deviate" || state === "partial") && !res?.alternativeOffered) {
      issues.push({
        requirementId: req.id, ref: req.ref,
        severity: mandatory ? "serious" : "minor",
        message: `${req.ref} deviates without saying what is offered instead — a deviation with no alternative reads as a refusal.`,
      });
    }
    // A compliance claim with nothing to point at is the one an evaluator
    // marks down hardest, because it cannot be verified.
    if ((state === "comply" || state === "comply_with_comment") && !res?.evidenceRef) {
      issues.push({
        requirementId: req.id, ref: req.ref,
        severity: mandatory ? "serious" : "minor",
        message: `${req.ref} claims compliance with no evidence reference — the evaluator has nowhere to look.`,
      });
    }
  }

  rows.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true, sensitivity: "base" }));

  const mandatoryReqs = live.filter((r) => r.obligation === "mandatory");
  const complyingMandatory = mandatoryReqs.filter((r) => {
    const s = byId.get(r.id)?.state;
    return s === "comply" || s === "comply_with_comment";
  }).length;
  const disqualifying = issues.filter((i) => i.severity === "disqualifying");

  const order = { disqualifying: 0, serious: 1, minor: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    rows,
    total: live.length,
    mandatory: mandatoryReqs.length,
    addressed: live.filter((r) => byId.has(r.id)).length,
    complying: rows.filter((r) => r.state === "comply" || r.state === "comply_with_comment").length,
    deviations: rows.filter((r) => r.state === "deviate" || r.state === "partial").length,
    disqualifying,
    issues,
    complianceRate: mandatoryReqs.length ? complyingMandatory / mandatoryReqs.length : 1,
    submittable: disqualifying.length === 0,
    summary: disqualifying.length
      ? `${disqualifying.length} disqualifying issue(s): the bid is not submittable as it stands.`
      : `${complyingMandatory}/${mandatoryReqs.length} mandatory requirements complied with, ` +
        `${rows.filter((r) => r.state === "deviate").length} deviation(s) declared.`,
  };
}

/**
 * Requirements nobody has extracted a response for, ordered by what they cost.
 *
 * The working list for the last week before submission.
 */
export function outstanding(requirements: Requirement[], responses: Response[]): Requirement[] {
  const answered = new Set(responses.filter((r) => r.state !== "not_addressed").map((r) => r.requirementId));
  const weight: Record<Obligation, number> = { mandatory: 0, desirable: 1, informational: 2 };
  return requirements
    .filter((r) => !r.supersededBy && !answered.has(r.id))
    .sort((a, b) => weight[a.obligation] - weight[b.obligation]);
}

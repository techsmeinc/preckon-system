// Risk register and commercial positions.
//
// Every bid carries risk that somebody priced, risk that somebody qualified,
// and risk that nobody did either with. The third kind is the one that shows up
// as a loss, and it is invisible precisely because nothing was written down.
//
// The distinction this file keeps is between a risk that has been PRICED and
// one that has been QUALIFIED. They are different promises:
//
//   priced      we carry it and have money for it
//   qualified   we have told the client we are not carrying it
//
// A risk treated as both is double-counted; a risk treated as neither is
// uncovered. And a qualification that never makes it into the submitted
// document is not a qualification at all — it is a note in a spreadsheet that
// the contract does not know about, which is why `inSubmission` is tracked
// separately from the position existing.

export type Treatment = "priced" | "qualified" | "excluded" | "accepted" | "untreated";
export type PositionKind = "qualification" | "assumption" | "exclusion" | "clarification_sought";

export interface Risk {
  id: string;
  ref: string;
  title: string;
  /** 1..5 */
  likelihood: number;
  /** 1..5 */
  impact: number;
  treatment: Treatment;
  /** Money carried in the bid for it, when priced. */
  allowanceMinor?: number;
  /** The commercial position that covers it, when qualified or excluded. */
  positionId?: string | null;
  owner?: string | null;
}

export interface CommercialPosition {
  id: string;
  ref: string;
  kind: PositionKind;
  statement: string;
  /** True once it appears in the submitted document, not merely in the register. */
  inSubmission: boolean;
  /** Where in the submission it appears. */
  reference?: string | null;
}

export const score = (r: Risk): number => r.likelihood * r.impact;

export type Band = "extreme" | "high" | "medium" | "low";
export const band = (r: Risk): Band => {
  const s = score(r);
  return s >= 20 ? "extreme" : s >= 12 ? "high" : s >= 6 ? "medium" : "low";
};

export interface RiskIssue {
  ref: string;
  severity: "critical" | "warning";
  message: string;
}

export interface RiskPosition {
  risks: number;
  pricedMinor: number;
  /** Score-weighted exposure that nothing covers. */
  uncovered: Risk[];
  uncoveredScore: number;
  /** Qualified on paper but absent from the submission. */
  unstatedPositions: CommercialPosition[];
  doubleCounted: Risk[];
  issues: RiskIssue[];
  summary: string;
}

/**
 * What the bid is actually exposed to.
 *
 * Three failure modes are reported rather than left to be noticed: risk with no
 * treatment, a qualification that never reached the submitted document, and a
 * risk both priced and qualified — which means the client is being told we do
 * not carry something we have charged for.
 */
export function assess(risks: Risk[], positions: CommercialPosition[]): RiskPosition {
  const byId = new Map(positions.map((p) => [p.id, p] as const));
  const issues: RiskIssue[] = [];

  const uncovered = risks.filter((r) => r.treatment === "untreated" || (r.treatment === "accepted" && band(r) !== "low"));
  for (const r of uncovered) {
    issues.push({
      ref: r.ref,
      severity: band(r) === "extreme" || band(r) === "high" ? "critical" : "warning",
      message: r.treatment === "untreated"
        ? `${r.ref} (${band(r)}) has no treatment — it is neither priced nor qualified, so the bid carries it for nothing.`
        : `${r.ref} is accepted at ${band(r)} severity with no allowance and no qualification.`,
    });
  }

  const doubleCounted = risks.filter(
    (r) => r.treatment === "priced" && r.positionId && byId.get(r.positionId)?.kind === "exclusion",
  );
  for (const r of doubleCounted) {
    issues.push({
      ref: r.ref, severity: "critical",
      message: `${r.ref} is priced AND excluded — the client is being told we do not carry something the bid has charged for.`,
    });
  }

  const referenced = new Set(risks.map((r) => r.positionId).filter(Boolean) as string[]);
  const unstated = positions.filter((p) => !p.inSubmission);
  for (const p of unstated) {
    issues.push({
      ref: p.ref,
      severity: referenced.has(p.id) ? "critical" : "warning",
      message: referenced.has(p.id)
        ? `${p.ref} covers a risk but does not appear in the submission — the contract will not know about it.`
        : `${p.ref} is not in the submission.`,
    });
  }

  const pricedMinor = risks
    .filter((r) => r.treatment === "priced")
    .reduce((s, r) => s + (r.allowanceMinor ?? 0), 0);
  const uncoveredScore = uncovered.reduce((s, r) => s + score(r), 0);

  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  return {
    risks: risks.length,
    pricedMinor,
    uncovered,
    uncoveredScore,
    unstatedPositions: unstated,
    doubleCounted,
    issues,
    summary:
      `${risks.length} risks; ${money(pricedMinor)} carried in the price` +
      (uncovered.length ? `; ${uncovered.length} untreated (score ${uncoveredScore})` : "") +
      (unstated.length ? `; ${unstated.length} position(s) not in the submission` : "") + ".",
  };
}

/** The register, worst first — how it should be read in a bid review. */
export function register(risks: Risk[]): (Risk & { score: number; band: Band })[] {
  return risks
    .map((r) => ({ ...r, score: score(r), band: band(r) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Every position in the words that will be submitted.
 *
 * Grouped by kind because that is how they appear in a bid: assumptions
 * together, exclusions together. An exclusion buried among assumptions gets
 * read as an assumption, and assumptions are much easier for a client to
 * dismiss later.
 */
export function statement(positions: CommercialPosition[]): { kind: PositionKind; label: string; lines: string[] }[] {
  const LABEL: Record<PositionKind, string> = {
    qualification: "Qualifications",
    assumption: "Assumptions",
    exclusion: "Exclusions",
    clarification_sought: "Clarifications sought",
  };
  const order: PositionKind[] = ["exclusion", "qualification", "assumption", "clarification_sought"];
  return order
    .map((kind) => ({
      kind,
      label: LABEL[kind],
      lines: positions.filter((p) => p.kind === kind).map((p) => `${p.ref}. ${p.statement}`),
    }))
    .filter((g) => g.lines.length);
}

const money = (m: number) => (m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

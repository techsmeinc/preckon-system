// Configurable document workflow.
//
// Who has to look at a drawing before it goes out is not a Preckon decision. On
// one job it is the lead architect; on the next it is architect, then structural
// engineer, then the client's technical adviser, in that order, with five
// working days each. Hard-coding either version means the other one is done in
// email and the register stops being the record.
//
// So a workflow is DATA: an ordered list of stages, each naming the parties it
// asks and how many of them must approve. The engine is review.ts, unchanged —
// this decides which cycles to open and in what order, never what an outcome
// means.
//
// Sequential by default, because that is what a discipline chain actually is:
// the structural engineer reviewing a drawing the architect has already rejected
// is wasted work, and worse, it produces two conflicting positions on a document
// that is about to be superseded anyway.

import type { Decision } from "./review";

export interface WorkflowStage {
  key: string;
  label: string;
  /** Parties asked at this stage. */
  parties: string[];
  /** How many must approve. 0 = all of them. */
  minApprovals?: number;
  /** Working days allowed before it is overdue. */
  durationDays?: number;
  /** Run alongside the previous stage instead of after it. */
  parallelWithPrevious?: boolean;
  /** Skip when the document does not match. Absent = always runs. */
  appliesTo?: { docTypes?: string[]; disciplines?: string[]; confidentiality?: string[] };
}

export interface DocumentWorkflow {
  key: string;
  name: string;
  stages: WorkflowStage[];
  /** Issue is refused unless every applicable stage has approved. */
  gatesIssue?: boolean;
}

export interface DocumentFacts {
  docType?: string | null;
  discipline?: string | null;
  confidentiality?: string | null;
}

export interface WorkflowIssue { stage: string; message: string }

/**
 * Structural problems with a workflow, checked before it is stored.
 *
 * A workflow with a stage nobody is assigned to blocks every document that
 * reaches it, permanently, and the person who configured it is rarely the
 * person who discovers that.
 */
export function validateWorkflow(wf: DocumentWorkflow): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (!wf.stages.length) issues.push({ stage: "-", message: "A workflow with no stages approves nothing and blocks nothing." });

  const seen = new Set<string>();
  for (const s of wf.stages) {
    if (seen.has(s.key)) issues.push({ stage: s.key, message: "Duplicate stage key." });
    seen.add(s.key);
    if (!s.parties.length) {
      issues.push({ stage: s.key, message: "No parties assigned — every document would stop here forever." });
    }
    if (s.minApprovals != null && s.minApprovals > s.parties.length) {
      issues.push({
        stage: s.key,
        message: `Needs ${s.minApprovals} approvals from ${s.parties.length} parties, which can never be satisfied.`,
      });
    }
    if (s.durationDays != null && s.durationDays <= 0) {
      issues.push({ stage: s.key, message: "Duration must be at least a day." });
    }
  }
  if (wf.stages[0]?.parallelWithPrevious) {
    issues.push({ stage: wf.stages[0].key, message: "The first stage has nothing to run in parallel with." });
  }
  return issues;
}

/** Whether a stage applies to this document. Absent filters mean "always". */
export function stageApplies(stage: WorkflowStage, facts: DocumentFacts): boolean {
  const a = stage.appliesTo;
  if (!a) return true;
  const inList = (list: string[] | undefined, value: string | null | undefined) =>
    !list || !list.length || (value != null && list.includes(value));
  return inList(a.docTypes, facts.docType)
    && inList(a.disciplines, facts.discipline)
    && inList(a.confidentiality, facts.confidentiality);
}

export interface PlannedStage {
  key: string;
  label: string;
  parties: string[];
  minApprovals: number;
  durationDays?: number;
  /** Stages sharing an order run at the same time. */
  order: number;
}

/**
 * The stages this particular document has to pass, in order.
 *
 * Returns the plan rather than opening anything, so it can be shown to whoever
 * is about to submit for review. "This will go to three people over ten working
 * days" is worth knowing BEFORE it is sent, not after.
 */
export function planStages(wf: DocumentWorkflow, facts: DocumentFacts): PlannedStage[] {
  const out: PlannedStage[] = [];
  let order = 0;
  for (const s of wf.stages) {
    if (!stageApplies(s, facts)) continue;
    if (!out.length || !s.parallelWithPrevious) order += 1;
    out.push({
      key: s.key,
      label: s.label,
      parties: s.parties,
      minApprovals: s.minApprovals ?? s.parties.length,
      durationDays: s.durationDays,
      order,
    });
  }
  return out;
}

/** The stages that should be open right now, given what has already settled. */
export function nextStages(
  plan: PlannedStage[], settled: { key: string; outcome: Decision | null }[],
): PlannedStage[] {
  const done = new Map(settled.map((s) => [s.key, s.outcome]));
  // A rejection stops the chain. Sending a rejected drawing further down the
  // review chain asks people to comment on something that is going to be
  // withdrawn.
  if (settled.some((s) => s.outcome === "rejected" || s.outcome === "revise_and_resubmit")) return [];

  for (let order = 1; ; order++) {
    const atOrder = plan.filter((s) => s.order === order);
    if (!atOrder.length) return [];
    const outstanding = atOrder.filter((s) => !done.has(s.key));
    if (outstanding.length) return outstanding;
  }
}

export const totalDurationDays = (plan: PlannedStage[]): number => {
  const byOrder = new Map<number, number>();
  for (const s of plan) {
    byOrder.set(s.order, Math.max(byOrder.get(s.order) ?? 0, s.durationDays ?? 0));
  }
  return [...byOrder.values()].reduce((a, b) => a + b, 0);
};

/** A conventional consultant chain, used when a project configures nothing. */
export const DEFAULT_WORKFLOW: DocumentWorkflow = {
  key: "default",
  name: "Internal check, then discipline lead",
  gatesIssue: true,
  stages: [
    { key: "internal", label: "Internal check", parties: ["Originator's checker"], minApprovals: 1, durationDays: 2 },
    { key: "discipline", label: "Discipline lead", parties: ["Discipline lead"], minApprovals: 1, durationDays: 3 },
  ],
};

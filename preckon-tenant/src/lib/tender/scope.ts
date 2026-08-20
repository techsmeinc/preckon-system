// Scope breakdown and gap detection.
//
// Every bid loses money in one of two places, and both are absences rather than
// mistakes:
//
//   a requirement in the documents that nothing in the bill prices  (a GAP)
//   the same work priced in two packages                            (an OVERLAP)
//
// Neither shows up by reading the bill, because both are invisible from inside
// it — a gap looks like a shorter bill and an overlap looks like a thorough
// one. They are only findable by walking the REQUIREMENTS against the priced
// scope, which is what this does.
//
// The third case is quieter and worse: scope that is priced but belongs to
// nobody — no package, no subcontractor, no self-perform decision. It survives
// the estimate, gets awarded, and turns up as a claim.

export interface Requirement {
  id: string;
  /** Where it came from — spec clause, drawing, tender condition. */
  source: string;
  reference: string;
  text: string;
  /** Work sections/trades this requirement implies. */
  disciplines?: string[];
  mandatory?: boolean;
}

export interface ScopeItem {
  id: string;
  description: string;
  /** Requirements this item is priced against. The link that makes gaps findable. */
  requirementIds: string[];
  packageId?: string | null;
  discipline?: string | null;
  valueMinor?: number;
  /** self-perform, subcontract, provisional sum, excluded */
  delivery?: "self" | "subcontract" | "provisional" | "excluded" | null;
}

export type FindingKind = "gap" | "overlap" | "unassigned" | "excluded_mandatory" | "provisional";
export type FindingSeverity = "critical" | "high" | "medium";

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  requirementId?: string;
  scopeItemIds: string[];
  message: string;
  valueMinor: number;
}

export interface ScopeReport {
  requirements: number;
  covered: number;
  /** 0..1 — requirements with at least one scope item priced against them. */
  coverage: number;
  findings: Finding[];
  gapCount: number;
  overlapValueMinor: number;
  unassignedValueMinor: number;
  summary: string;
}

/**
 * Walk requirements against priced scope.
 *
 * Coverage is counted from the requirement side deliberately. Counting from the
 * scope side answers "is everything we priced needed", which is a much less
 * expensive question than "is everything needed priced".
 */
export function analyseScope(requirements: Requirement[], scope: ScopeItem[]): ScopeReport {
  const findings: Finding[] = [];
  const byRequirement = new Map<string, ScopeItem[]>();
  for (const item of scope) {
    for (const rid of item.requirementIds) {
      const list = byRequirement.get(rid) ?? [];
      list.push(item);
      byRequirement.set(rid, list);
    }
  }

  let covered = 0;
  for (const req of requirements) {
    const items = byRequirement.get(req.id) ?? [];
    const priced = items.filter((i) => i.delivery !== "excluded");
    if (priced.length) covered += 1;

    if (!items.length) {
      findings.push({
        kind: "gap",
        severity: req.mandatory === false ? "high" : "critical",
        requirementId: req.id,
        scopeItemIds: [],
        message: `Nothing prices ${req.reference} (${req.source}): "${clip(req.text)}"`,
        valueMinor: 0,
      });
      continue;
    }

    if (!priced.length) {
      findings.push({
        kind: "excluded_mandatory",
        severity: req.mandatory === false ? "medium" : "critical",
        requirementId: req.id,
        scopeItemIds: items.map((i) => i.id),
        message: `${req.reference} is covered only by excluded scope — it is a requirement the bid declines to meet.`,
        valueMinor: 0,
      });
      continue;
    }

    // Two items against one requirement is normal when they are different
    // trades; it is an overlap when they sit in different PACKAGES with the
    // same discipline, because then two subcontractors have both priced it.
    const packages = new Set(priced.map((i) => i.packageId ?? "none"));
    const disciplines = new Set(priced.map((i) => i.discipline ?? "none"));
    if (packages.size > 1 && disciplines.size === 1) {
      findings.push({
        kind: "overlap",
        severity: "high",
        requirementId: req.id,
        scopeItemIds: priced.map((i) => i.id),
        message:
          `${req.reference} is priced in ${packages.size} packages for the same discipline ` +
          `(${[...disciplines][0]}) — the same work is likely bought twice.`,
        valueMinor: priced.reduce((s, i) => s + (i.valueMinor ?? 0), 0),
      });
    }
  }

  for (const item of scope) {
    if (item.delivery === "provisional") {
      findings.push({
        kind: "provisional",
        severity: "medium",
        scopeItemIds: [item.id],
        message: `${item.description} is a provisional sum — carried at risk until it is defined.`,
        valueMinor: item.valueMinor ?? 0,
      });
    }
    if (!item.packageId && item.delivery !== "excluded") {
      findings.push({
        kind: "unassigned",
        severity: "high",
        scopeItemIds: [item.id],
        message: `${item.description} is priced but belongs to no package — nobody is nominated to deliver it.`,
        valueMinor: item.valueMinor ?? 0,
      });
    }
  }

  const order: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.valueMinor - a.valueMinor);

  const gapCount = findings.filter((f) => f.kind === "gap").length;
  const overlapValueMinor = findings.filter((f) => f.kind === "overlap").reduce((s, f) => s + f.valueMinor, 0);
  const unassignedValueMinor = findings.filter((f) => f.kind === "unassigned").reduce((s, f) => s + f.valueMinor, 0);

  return {
    requirements: requirements.length,
    covered,
    coverage: requirements.length ? covered / requirements.length : 1,
    findings,
    gapCount,
    overlapValueMinor,
    unassignedValueMinor,
    summary:
      `${covered}/${requirements.length} requirements priced. ` +
      `${gapCount} unpriced requirement(s)` +
      (overlapValueMinor ? `, ${money(overlapValueMinor)} possibly bought twice` : "") +
      (unassignedValueMinor ? `, ${money(unassignedValueMinor)} with no package` : "") + ".",
  };
}

/**
 * The work breakdown, rolled up by whatever dimension is being reviewed.
 *
 * Same scope, three readings: by package for procurement, by discipline for the
 * technical review, by delivery route for the commercial one. Kept as one
 * function because the moment they are three, they disagree.
 */
export function breakdown(
  scope: ScopeItem[], by: "packageId" | "discipline" | "delivery",
): { key: string; items: number; valueMinor: number; share: number }[] {
  const total = scope.reduce((s, i) => s + (i.valueMinor ?? 0), 0);
  const groups = new Map<string, { items: number; valueMinor: number }>();
  for (const item of scope) {
    const key = String(item[by] ?? "unassigned");
    const g = groups.get(key) ?? { items: 0, valueMinor: 0 };
    g.items += 1;
    g.valueMinor += item.valueMinor ?? 0;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...g, share: total ? g.valueMinor / total : 0 }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);
const money = (minor: number) => (minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

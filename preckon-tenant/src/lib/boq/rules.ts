// Configurable measurement rules.
//
// Two quantity surveyors measuring the same wall get different numbers, and
// both are right, because they are measuring under different rules. NRM2 says
// openings under a threshold are not deducted; CESMM says something else; a
// client's own preambles override both. Measurement logic living in code means
// Preckon measures one way and the contract measures another, and the
// difference surfaces as a claim.
//
// So a rule set is DATA: a named standard, a version, and an ordered list of
// rules that each say what they do to a measured quantity and why. The engine
// applies them in order and returns the working — not just the answer — because
// a quantity a QS cannot audit is a quantity they will re-measure by hand.
//
// Deliberately arithmetic only. Nothing here decides WHAT to measure; it takes
// a raw geometric quantity and turns it into a billable one.

export type RuleKind =
  | "deduct_openings"     // subtract voids, usually above a threshold
  | "minimum_quantity"    // bill at least this much
  | "round"               // to a stated increment
  | "waste_factor"        // add a percentage for cutting and waste
  | "convert_unit"        // m2 -> m3 via a thickness, and so on
  | "threshold_exclude";  // ignore items below a size

export interface MeasurementRule {
  key: string;
  kind: RuleKind;
  label: string;
  /** The clause this comes from. Without it a rule is an opinion. */
  reference?: string;
  /** m2 below which an opening is not deducted, minimum billable, etc. */
  threshold?: number;
  /** Percentage for waste, factor for conversion, increment for rounding. */
  value?: number;
  /** Only applies to these work sections. Absent = all. */
  appliesTo?: string[];
}

export interface RuleSet {
  key: string;
  name: string;
  /** NRM2, POMI, CESMM4, or a project's own preambles. */
  standard: string;
  version: number;
  rules: MeasurementRule[];
}

export interface Opening { id?: string; area: number }

export interface RawQuantity {
  /** As measured off the model or drawing, before any rule is applied. */
  gross: number;
  unit: string;
  workSection?: string;
  openings?: Opening[];
  /** For unit conversion — a wall's thickness, a slab's depth. */
  thickness?: number;
}

export interface Step {
  rule: string;
  label: string;
  reference?: string;
  from: number;
  to: number;
  note: string;
}

export interface MeasuredQuantity {
  gross: number;
  net: number;
  unit: string;
  steps: Step[];
  /** True when a rule excluded it entirely. */
  excluded: boolean;
  /** One line a QS can check without opening the model. */
  working: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Apply a rule set to a raw quantity.
 *
 * Order is the rule set's own, not a fixed one, because the standards disagree
 * about it: deducting openings before or after a waste factor changes the
 * answer, and which is correct is a property of the standard rather than of
 * this function.
 */
export function measure(raw: RawQuantity, set: RuleSet): MeasuredQuantity {
  const steps: Step[] = [];
  let value = raw.gross;
  let unit = raw.unit;
  let excluded = false;

  for (const rule of set.rules) {
    if (rule.appliesTo?.length && raw.workSection && !rule.appliesTo.includes(raw.workSection)) continue;
    const from = value;

    switch (rule.kind) {
      case "deduct_openings": {
        const threshold = rule.threshold ?? 0;
        const deducted = (raw.openings ?? []).filter((o) => o.area > threshold);
        const total = deducted.reduce((a, o) => a + o.area, 0);
        value = round2(value - total);
        steps.push({
          rule: rule.key, label: rule.label, reference: rule.reference, from, to: value,
          note: deducted.length
            ? `deducted ${deducted.length} opening(s) over ${threshold} (${round2(total)})`
            : `no opening over ${threshold} to deduct`,
        });
        break;
      }
      case "threshold_exclude": {
        if (value < (rule.threshold ?? 0)) {
          excluded = true;
          steps.push({
            rule: rule.key, label: rule.label, reference: rule.reference, from, to: 0,
            note: `below the ${rule.threshold} minimum, not billed separately`,
          });
          value = 0;
        }
        break;
      }
      case "minimum_quantity": {
        const min = rule.threshold ?? 0;
        if (value > 0 && value < min) {
          value = min;
          steps.push({
            rule: rule.key, label: rule.label, reference: rule.reference, from, to: value,
            note: `billed at the ${min} minimum`,
          });
        }
        break;
      }
      case "waste_factor": {
        const pct = rule.value ?? 0;
        value = round2(value * (1 + pct / 100));
        steps.push({
          rule: rule.key, label: rule.label, reference: rule.reference, from, to: value,
          note: `${pct}% added for waste`,
        });
        break;
      }
      case "convert_unit": {
        // A thickness of zero would silently produce a zero quantity, which
        // reads as "there is none of this" rather than "nobody said how thick".
        const factor = rule.value ?? raw.thickness;
        if (factor == null || factor <= 0) {
          steps.push({
            rule: rule.key, label: rule.label, reference: rule.reference, from, to: value,
            note: "SKIPPED — no thickness or factor given, so the conversion was not applied",
          });
          break;
        }
        value = round2(value * factor);
        unit = rule.label.includes("->") ? rule.label.split("->")[1].trim() : unit;
        steps.push({
          rule: rule.key, label: rule.label, reference: rule.reference, from, to: value,
          note: `x ${factor}`,
        });
        break;
      }
      case "round": {
        const inc = rule.value ?? 1;
        value = Math.ceil(value / inc) * inc;
        steps.push({
          rule: rule.key, label: rule.label, reference: rule.reference, from, to: value,
          note: `rounded up to the nearest ${inc}`,
        });
        break;
      }
    }
  }

  return {
    gross: raw.gross,
    net: round2(value),
    unit,
    steps,
    excluded,
    working: [
      `${round2(raw.gross)} ${raw.unit} gross`,
      ...steps.map((s) => `${s.label}: ${round2(s.from)} → ${round2(s.to)} (${s.note})`),
      `${round2(value)} ${unit} net`,
    ].join("; "),
  };
}

export interface RuleIssue { rule: string; message: string }

/** Structural problems, checked before a rule set is stored. */
export function validateRuleSet(set: RuleSet): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const seen = new Set<string>();
  for (const r of set.rules) {
    if (seen.has(r.key)) issues.push({ rule: r.key, message: "Duplicate rule key." });
    seen.add(r.key);
    if (r.kind === "waste_factor" && (r.value == null || r.value < 0)) {
      issues.push({ rule: r.key, message: "A waste factor needs a percentage of zero or more." });
    }
    if (r.kind === "round" && (r.value == null || r.value <= 0)) {
      issues.push({ rule: r.key, message: "Rounding needs an increment greater than zero." });
    }
    if ((r.kind === "minimum_quantity" || r.kind === "threshold_exclude") && r.threshold == null) {
      issues.push({ rule: r.key, message: "This rule needs a threshold to compare against." });
    }
    if (!r.reference) {
      // Not an error: a project's own preamble is a legitimate source. But an
      // unreferenced rule is one nobody can defend in a measurement dispute.
      issues.push({ rule: r.key, message: "No standard reference — this rule cannot be cited in a dispute." });
    }
  }
  return issues;
}

/** NRM2's common rules, as a starting point a project can copy and narrow. */
export const NRM2_MASONRY: RuleSet = {
  key: "nrm2-masonry",
  name: "NRM2 — masonry",
  standard: "NRM2",
  version: 1,
  rules: [
    { key: "openings", kind: "deduct_openings", label: "Deduct openings over 1.00 m2",
      reference: "NRM2 14.2", threshold: 1.0 },
    { key: "minimum", kind: "minimum_quantity", label: "Minimum billable area",
      reference: "NRM2 3.3.2", threshold: 0.5 },
  ],
};

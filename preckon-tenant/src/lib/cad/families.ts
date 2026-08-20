// Smart components and families.
//
// A door is not a rectangle. It is a family with parameters — width, height,
// fire rating, handing — and a set of rules about which combinations exist. A
// model built from rectangles carries none of that, so a schedule generated
// from it cannot say how many FD60 doors are needed, and a takeoff cannot tell
// a 900 mm leaf from an 1100 mm one except by measuring it.
//
// The rules that make a family "smart" rather than a template:
//
//   Parameters have TYPES and constraints, so an invalid instance is caught
//   when it is placed rather than when somebody tries to order it.
//
//   Derived parameters are computed, never stored. A door's structural opening
//   is leaf width plus frame; storing both means they disagree the first time
//   somebody edits one.
//
//   Type parameters belong to the TYPE and instance parameters to the instance.
//   Changing an FD60's fire rating should change every FD60 in the model; that
//   is the entire point of a type, and getting it backwards produces a model
//   where a global change has to be made three hundred times.

export type ParamKind = "length" | "number" | "text" | "boolean" | "choice";
export type Scope = "type" | "instance";

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  scope: Scope;
  unit?: string | null;
  required?: boolean;
  min?: number;
  max?: number;
  choices?: string[];
  /** An expression over other parameters — makes this parameter derived. */
  formula?: string;
  default?: string | number | boolean;
}

export interface Family {
  key: string;
  name: string;
  category: string;
  params: ParamDef[];
}

export interface FamilyType {
  key: string;
  familyKey: string;
  name: string;
  /** Values for the family's `type`-scoped parameters. */
  values: Record<string, string | number | boolean>;
}

export interface Instance {
  id: string;
  typeKey: string;
  /** Values for `instance`-scoped parameters only. */
  values: Record<string, string | number | boolean>;
}

export interface Issue {
  where: string;
  param?: string;
  message: string;
}

/** Structural problems with the family itself, checked before it is published. */
export function validateFamily(family: Family): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const p of family.params) {
    if (seen.has(p.key)) issues.push({ where: family.key, param: p.key, message: "Duplicate parameter key." });
    seen.add(p.key);
    if (p.kind === "choice" && !p.choices?.length) {
      issues.push({ where: family.key, param: p.key, message: "A choice parameter with no choices can never be given a valid value." });
    }
    if (p.formula && p.scope === "type") {
      // A derived value that lives on the type cannot vary per instance, which
      // is almost always a modelling mistake rather than an intent.
      issues.push({
        where: family.key, param: p.key,
        message: "A derived parameter on the type cannot vary per instance — it probably belongs on the instance.",
      });
    }
    if (p.min != null && p.max != null && p.min > p.max) {
      issues.push({ where: family.key, param: p.key, message: "Minimum exceeds maximum." });
    }
  }
  return issues;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Evaluate a derived parameter.
 *
 * A deliberately small expression language: parameter names, numbers, + - * /
 * and parentheses. Not a general evaluator — a family definition is data that
 * can arrive from a library, and data that can execute arbitrary code is a way
 * in. Anything it cannot parse returns null and is reported, rather than
 * silently evaluating to zero.
 */
export function evaluate(formula: string, values: Record<string, unknown>): number | null {
  const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(\.\d+)?|[()+\-*/]/g);
  if (!tokens) return null;

  /* Tracked as a flag, not as a null in the token list.
     Array.join renders null as an EMPTY STRING, so "process.exit(1)" tokenised
     to [process, exit, (, 1, )], both identifiers resolved to null, and the
     join produced " ( 1 )" — which is valid arithmetic and evaluated to 1. An
     unknown identifier has to fail the whole expression, not disappear from
     it. */
  let unresolved = false;
  const expr = tokens
    .map((t) => {
      if (/^[A-Za-z_]/.test(t)) {
        const v = num(values[t]);
        if (v == null) { unresolved = true; return "0"; }
        return String(v);
      }
      return t;
    })
    .join(" ");
  if (unresolved) return null;
  if (!/^[\d\s.()+\-*/]+$/.test(expr)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr});`)() as unknown;
    return typeof result === "number" && Number.isFinite(result) ? Number(result.toFixed(6)) : null;
  } catch {
    return null;
  }
}

export interface Resolved {
  id: string;
  familyKey: string;
  typeKey: string;
  typeName: string;
  values: Record<string, string | number | boolean | null>;
  issues: Issue[];
  valid: boolean;
}

/**
 * Resolve an instance: type values, then instance values, then derived.
 *
 * Order matters and is fixed. Instance overrides type — that is what an
 * instance parameter is for — and derived values are computed last so they
 * always reflect what was actually resolved rather than what was stored.
 */
export function resolve(family: Family, type: FamilyType, instance: Instance): Resolved {
  const issues: Issue[] = [];
  const values: Record<string, string | number | boolean | null> = {};

  for (const p of family.params) {
    if (p.formula) continue;
    const supplied = p.scope === "type" ? type.values[p.key] : instance.values[p.key];
    const value = supplied ?? p.default ?? null;

    // An instance carrying a value for a type parameter is a real modelling
    // error: it looks like it worked and does not propagate when the type
    // changes, which is the whole reason to use a type.
    if (p.scope === "type" && instance.values[p.key] !== undefined) {
      issues.push({
        where: instance.id, param: p.key,
        message: `${p.label} is a type parameter; setting it on the instance will not follow when the type changes.`,
      });
    }

    if (value == null) {
      if (p.required) issues.push({ where: instance.id, param: p.key, message: `${p.label} is required.` });
      values[p.key] = null;
      continue;
    }
    if (p.kind === "choice" && !p.choices?.includes(String(value))) {
      issues.push({ where: instance.id, param: p.key, message: `${value} is not one of: ${(p.choices ?? []).join(", ")}.` });
    }
    if ((p.kind === "length" || p.kind === "number")) {
      const n = num(value);
      if (n == null) issues.push({ where: instance.id, param: p.key, message: `${p.label} must be a number.` });
      else {
        if (p.min != null && n < p.min) issues.push({ where: instance.id, param: p.key, message: `${p.label} ${n} is below the minimum ${p.min}.` });
        if (p.max != null && n > p.max) issues.push({ where: instance.id, param: p.key, message: `${p.label} ${n} is above the maximum ${p.max}.` });
      }
    }
    values[p.key] = value;
  }

  for (const p of family.params) {
    if (!p.formula) continue;
    const computed = evaluate(p.formula, values);
    if (computed == null) {
      issues.push({ where: instance.id, param: p.key, message: `Could not evaluate "${p.formula}" — a parameter it needs is missing or not numeric.` });
    }
    values[p.key] = computed;
  }

  return {
    id: instance.id,
    familyKey: family.key,
    typeKey: type.key,
    typeName: type.name,
    values,
    issues,
    valid: issues.every((i) => !/required|must be|not one of|below the minimum|above the maximum/.test(i.message)),
  };
}

export interface ScheduleRow {
  typeName: string;
  count: number;
  values: Record<string, string | number | boolean | null>;
}

/**
 * A door/window schedule, which is what families are FOR.
 *
 * Grouped by type, because that is what gets ordered: nobody buys 40 individual
 * doors, they buy 40 of type FD60-900.
 */
export function schedule(resolved: Resolved[]): ScheduleRow[] {
  const byType = new Map<string, { count: number; sample: Resolved }>();
  for (const r of resolved) {
    const cur = byType.get(r.typeKey);
    if (cur) cur.count += 1;
    else byType.set(r.typeKey, { count: 1, sample: r });
  }
  return [...byType.values()]
    .map(({ count, sample }) => ({ typeName: sample.typeName, count, values: sample.values }))
    .sort((a, b) => b.count - a.count);
}

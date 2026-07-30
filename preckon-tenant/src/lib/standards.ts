import type { AuditSpec } from "./audit";
import { query } from "./db";
import { newId } from "./ids";
import { emitArtifact, type Artifact } from "./store";

// ── Standards & Rules capability (v2) — the domain-neutral Core mechanism.
// Rule CONTENT lives as Library data (collection 'standard_rule'); this file is
// pure mechanism: tier precedence + predicate evaluation. It contains no
// construction term (§5 of the capability doc). Same move as the §1.6 lifecycle:
// the machine is Core, the content is pack data.

export interface StandardRule {
  rule_id: string; standard: string; category: string;
  tier: "statutory" | "industry" | "client" | "company" | "project";
  binding: "mandatory" | "default";
  jurisdiction?: string; subject?: string;
  applies_when?: { type_key: string; match?: Record<string, { contains?: string; equals?: string; prefix?: string }> };
  result?: Record<string, any>;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  reference?: string; recommendation?: string; source_ref?: string;
  status?: string;
}

// Broadest → most specific (§2). Mandatory conflicts resolve to the broadest;
// default conflicts resolve to the most specific.
const TIER_INDEX: Record<string, number> = { statutory: 0, industry: 1, client: 2, company: 3, project: 4 };

/** Load the tenant's active standard rules (Library data). */
export async function getRules(tenantId: string): Promise<StandardRule[]> {
  const rows = await query<{ payload: any }>(
    "SELECT payload FROM library_entry WHERE tenant_id = ? AND collection = 'standard_rule' AND status = 'active'",
    [tenantId]
  );
  return rows.map((r) => r.payload as StandardRule);
}

export interface Resolution {
  subject: string;
  winner: StandardRule | null;
  ranked: { rule: StandardRule; rank: number; note: string }[];
}

/**
 * §2 tier precedence — deterministic conflict resolution for a subject.
 * Mandatory beats default. Among mandatory, the broadest authority wins
 * (statutory over a project mandate). Among defaults, most-specific wins.
 */
export function resolveStandards(rules: StandardRule[], subject: string): Resolution {
  const s = subject.toLowerCase();
  const matching = rules.filter((r) => (r.subject ?? "").toLowerCase().includes(s) || s.includes((r.subject ?? "").toLowerCase()));
  const mandatory = matching.filter((r) => r.binding === "mandatory");
  const defaults = matching.filter((r) => r.binding !== "mandatory");

  // mandatory first, broadest-authority order; then defaults, most-specific first.
  const rankedRules = [
    ...mandatory.sort((a, b) => TIER_INDEX[a.tier] - TIER_INDEX[b.tier]),
    ...defaults.sort((a, b) => TIER_INDEX[b.tier] - TIER_INDEX[a.tier]),
  ];
  const winner = rankedRules[0] ?? null;
  const ranked = rankedRules.map((rule, i) => ({
    rule,
    rank: i + 1,
    note:
      i === 0
        ? "wins"
        : rule.binding === "mandatory"
        ? `overridden — broader mandatory (${winner!.tier}) governs`
        : winner?.binding === "mandatory"
        ? "void — a mandatory rule dictates"
        : "less specific",
  }));
  return { subject, winner, ranked };
}

function short(t: string) { return t.split(".").pop(); }

function matches(rule: StandardRule, a: Artifact): boolean {
  const aw = rule.applies_when;
  if (!aw) return false;
  if (short(aw.type_key) !== short(a.type_key)) return false;
  for (const [field, pred] of Object.entries(aw.match ?? {})) {
    const v = String((a.payload as any)?.[field] ?? "");
    if (pred.contains && !v.includes(pred.contains)) return false;
    if (pred.equals && v !== pred.equals) return false;
    if (pred.prefix && !v.startsWith(pred.prefix)) return false;
  }
  return true;
}

/** Evaluate a mandatory rule's `result` against an artifact; return the failing field or null. */
function evaluate(rule: StandardRule, a: Artifact): { field: string; observed: any; expected: any } | null {
  for (const [key, expected] of Object.entries(rule.result ?? {})) {
    if (typeof expected === "object" || key.endsWith("_template")) continue; // non-check fields
    if (key.startsWith("min_")) {
      const field = key.slice(4);
      const observed = Number((a.payload as any)?.[field]);
      if (!Number.isNaN(observed) && observed < Number(expected))
        return { field, observed, expected: `>= ${expected}` };
    } else {
      const observed = (a.payload as any)?.[key];
      if (observed !== undefined && observed !== expected)
        return { field: key, observed, expected };
    }
  }
  return null;
}

/**
 * §4 validation mode — run applicable MANDATORY rules against confirmed
 * artifacts and emit `standard_violation` proposals. Deterministic, no LLM.
 * Returns the count emitted.
 */
export async function validateStandards(
  tenantId: string,
  projectId: string,
  audit?: (spec: AuditSpec) => void
): Promise<{ emitted: number; checked: number }> {
  const rules = (await getRules(tenantId)).filter((r) => r.binding === "mandatory" && r.applies_when);
  const artifacts = await query<Artifact>(
    "SELECT * FROM artifact WHERE tenant_id = ? AND project_id = ? AND status = 'confirmed'",
    [tenantId, projectId]
  );
  // Avoid duplicate open violations for the same (rule, artifact).
  const existing = await query<{ rule_id: string; subject: string }>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.rule_id')) AS rule_id,
            JSON_UNQUOTE(JSON_EXTRACT(payload,'$.subject_artifact_id')) AS subject
       FROM artifact WHERE tenant_id = ? AND project_id = ? AND type_key = 'standard_violation' AND status <> 'superseded'`,
    [tenantId, projectId]
  );
  const seen = new Set(existing.map((e) => `${e.rule_id}:${e.subject}`));

  let emitted = 0;
  for (const a of artifacts) {
    for (const rule of rules) {
      if (!matches(rule, a)) continue;
      const fail = evaluate(rule, a);
      if (!fail) continue;
      if (seen.has(`${rule.rule_id}:${a.id}`)) continue;
      await emitArtifact(
        {
          tenantId, projectId, typeKey: "standard_violation",
          payload: {
            rule_id: rule.rule_id,
            subject_artifact_id: a.id,
            observed: { [fail.field]: fail.observed },
            expected: { [fail.field]: fail.expected },
            severity: rule.severity ?? "medium",
            reference: rule.reference ?? rule.standard,
            recommendation: rule.recommendation ?? "Review against the cited standard.",
            status: "open",
          },
          source: "agent",
          sourceAgentKey: "agent.standards",
          provenance: [a.id],
          confidence: null,
        },
        audit
      );
      seen.add(`${rule.rule_id}:${a.id}`);
      emitted++;
    }
  }
  return { emitted, checked: artifacts.length };
}

/** Seed a tenant's standard-rule Library from pack data (idempotent by rule_id). */
export async function seedStandardRules(tenantId: string, rules: StandardRule[]): Promise<void> {
  for (const rule of rules) {
    const dup = await query<{ id: string }>(
      "SELECT id FROM library_entry WHERE tenant_id = ? AND collection = 'standard_rule' AND entry_key = ?",
      [tenantId, rule.rule_id]
    );
    if (dup[0]) continue;
    await query(
      "INSERT INTO library_entry (id, tenant_id, collection, entry_key, payload, status) VALUES (?,?, 'standard_rule', ?, ?, 'active')",
      [newId(), tenantId, rule.rule_id, JSON.stringify(rule)]
    );
  }
}

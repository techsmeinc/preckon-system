import type { AuditSpec } from "./audit";
import { query, queryOne } from "./db";
import type { Artifact } from "./store";

// §1.6 — the generic project-lifecycle field. Core stores an opaque state and
// validates transitions against a PACK-declared machine; it never learns what a
// state means. The machine lives in the domain manifest (domain.manifest.lifecycles).

export interface LifecycleTransition {
  from: string;
  trigger_type: string; // artifact type key that gates the move
  trigger_match?: Record<string, unknown>; // payload selectors (e.g. {decision:'go'})
  required_permission: string;
  to: string;
  terminal?: boolean;
}

export interface Lifecycle {
  key: string;
  start: string;
  transitions: LifecycleTransition[];
}

/** Load a pack lifecycle for a tenant by key (from its bound domain manifest). */
export async function getLifecycle(
  tenantId: string,
  lifecycleKey: string
): Promise<Lifecycle | null> {
  const boot = await queryOne<{ domain_key: string }>(
    "SELECT domain_key FROM tenant_bootstrap WHERE tenant_id = ?",
    [tenantId]
  );
  if (!boot) return null;
  const dom = await queryOne<{ manifest: any }>(
    "SELECT manifest FROM domain WHERE `key` = ?",
    [boot.domain_key]
  );
  const lifecycles: Lifecycle[] = dom?.manifest?.lifecycles ?? [];
  return lifecycles.find((l) => l.key === lifecycleKey) ?? null;
}

function matchShort(typeA: string, typeB: string): boolean {
  return typeA === typeB || typeA.split(".").pop() === typeB.split(".").pop();
}

function payloadMatches(match: Record<string, unknown> | undefined, payload: any): boolean {
  if (!match) return true;
  return Object.entries(match).every(([k, v]) => payload?.[k] === v);
}

/** Ordered state list (BFS from `start`) — for a generic, domain-agnostic stepper. */
export function orderedStates(lc: Lifecycle): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [lc.start];
  while (queue.length) {
    const s = queue.shift()!;
    if (seen.has(s)) continue;
    seen.add(s); order.push(s);
    for (const t of lc.transitions) if (t.from === s && !seen.has(t.to)) queue.push(t.to);
  }
  return order;
}

/** Transitions available FROM the current state (for GET /lifecycle). */
export async function availableTransitions(
  tenantId: string,
  lifecycleKey: string,
  state: string
): Promise<LifecycleTransition[]> {
  const lc = await getLifecycle(tenantId, lifecycleKey);
  if (!lc) return [];
  return lc.transitions.filter((t) => t.from === state);
}

/**
 * §1.6 — advance a project's lifecycle when a human confirms a gating artifact.
 * Human-driven and audited: if the pack declares a transition from the current
 * state whose trigger matches the confirmed artifact (type + payload) and the
 * actor holds `required_permission`, set the new state. No match → no-op (the
 * confirm still lands). Core validates transition VALIDITY, never meaning.
 */
export async function advanceLifecycle(
  tenantId: string,
  project: { id: string; lifecycle_key: string | null; lifecycle_state: string },
  artifact: Artifact,
  actorPermissions: Set<string>,
  audit?: (spec: AuditSpec) => void
): Promise<{ advanced: boolean; to?: string }> {
  if (!project.lifecycle_key) return { advanced: false };
  const lc = await getLifecycle(tenantId, project.lifecycle_key);
  if (!lc) return { advanced: false };

  const t = lc.transitions.find(
    (tr) =>
      tr.from === project.lifecycle_state &&
      matchShort(tr.trigger_type, artifact.type_key) &&
      payloadMatches(tr.trigger_match, artifact.payload)
  );
  if (!t) return { advanced: false };
  if (!actorPermissions.has(t.required_permission)) return { advanced: false };

  await query(
    "UPDATE project SET lifecycle_state = ?, lifecycle_state_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [t.to, tenantId, project.id]
  );
  audit?.({
    action: "pursuit.transitioned",
    targetKind: "project",
    targetId: project.id,
    projectId: project.id,
    summary: { from: project.lifecycle_state, to: t.to, trigger: artifact.type_key },
  });
  return { advanced: true, to: t.to };
}

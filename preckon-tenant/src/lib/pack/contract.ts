// ── The Domain-Pack contract (§D). This is the ONE interface every vertical
// implements. Core (store, ABI, runtime, audit, entitlements) knows nothing
// about construction or underwriting — it only knows this shape. Adding a domain
// = writing one file that satisfies DomainPack + one line in registry.ts.

import { validateWorkflow } from "../runtime";

// ── Core pack vocabulary. These types are the shared language every domain pack
// speaks; they live in Core (here), NOT in any one domain. A vertical imports
// them FROM this contract — Core never depends on a domain. (Construction and
// underwriting both import the shapes below.)

/** AI cost/quality tier an agent's job runs at (§5.5). */
export type Tier = "routing" | "standard" | "deep";

/** One enqueueable job an agent can produce, with its tier + prompt reference. */
export interface PackJobType {
  type: string;
  tier: Tier;
  prompt_ref: string;
}

/** An artifact type the domain defines, with its JSON payload schema (§2.1). */
export interface PackArtifactType {
  key: string;
  name: string;
  payload_schema: any;
  is_reviewable: boolean;
}

/** A typed agent: what it consumes/produces + the jobs it enqueues (§3). */
export interface PackAgent {
  key: string;
  name: string;
  kind: "worker" | "service" | "supervisor";
  consumes: string[];
  produces: string[];
  job_types: PackJobType[];
  permission_keys: string[];
  entitlement_key: string | null;
}

/** A workflow DAG over the domain's agents, mapped to a licensable module (§4). */
export interface PackWorkflow {
  key: string;
  name: string;
  module_key: string;
  definition: { nodes: any[]; edges: any[] };
  entitlement_key: string;
}

/** A supervisor persona binding: the agent + its review scope (§6). */
export interface PackPersona {
  agent_key: string;
  scope: { module_keys?: string[]; workflow_keys?: string[]; artifact_types?: string[] };
  deviation_kinds: string[];
  is_default: boolean;
  sort_order: number;
}

/** A seeded role in the tenant's role template, with concrete permission keys (§1). */
export interface PackRole {
  key: string;
  name: string;
  tier: "owner_admin" | "delivery" | "review" | "view";
  permissions: string[]; // concrete permission keys (wildcards pre-expanded)
}

/** A licensable capability inside a domain (the Host edition gates these). */
export interface PackModule {
  key: string; // bare, unique across domains (e.g. "quantlogix", "underwriting")
  label: string;
  icon: string;
  order: number;
  description: string;
}

export interface LifecycleTransition {
  from: string;
  trigger_type: string;
  trigger_match?: Record<string, unknown>;
  required_permission: string;
  to: string;
  terminal?: boolean;
}
export interface PackLifecycle {
  key: string;
  start: string;
  transitions: LifecycleTransition[];
}

export interface PackPermission {
  key: string;
  domain: string;
  description: string;
}

/** The complete declaration of a vertical. Everything Core treats as data. */
export interface DomainPack {
  key: string; // domain key, e.g. "construction"
  name: string;
  version: string;
  manifest: any;
  modules: PackModule[];
  artifactTypes: PackArtifactType[];
  agents: PackAgent[];
  workflows: PackWorkflow[];
  personas: PackPersona[];
  lifecycle: PackLifecycle;
  roles: PackRole[];
  packPermissions: PackPermission[];
  settings: { default_tier: Tier; auto_accept_threshold: number };
  standardRules?: any[];
}

const short = (k: string) => k.split(".").pop() ?? k;

/**
 * validatePack — the domain resolver. Structurally verifies a pack is internally
 * consistent so Core can host it: workflows are acyclic and reference known
 * agents; every agent I/O + gate + lifecycle trigger references a declared type;
 * personas are supervisor agents; workflows map to declared modules. If this
 * passes, the pack runs on Core with zero kernel change. Returns [] when valid.
 */
export function validatePack(pack: DomainPack): string[] {
  const errors: string[] = [];
  const typeKeys = new Set(pack.artifactTypes.map((t) => short(t.key)));
  const agentByKey = new Map(pack.agents.map((a) => [short(a.key), a]));
  const moduleKeys = new Set(pack.modules.map((m) => m.key));

  const knownType = (k: string) => k === "*" || typeKeys.has(short(k));

  // agents: I/O references declared types
  for (const a of pack.agents) {
    for (const c of a.consumes) if (!knownType(c)) errors.push(`agent ${a.key} consumes unknown type '${c}'`);
    for (const p of a.produces) if (!knownType(p)) errors.push(`agent ${a.key} produces unknown type '${p}'`);
  }

  // workflows: acyclic, known agents, gate types declared, mapped to a module
  for (const w of pack.workflows) {
    for (const e of validateWorkflow(w.definition)) errors.push(`workflow ${w.key}: ${e}`);
    if (!moduleKeys.has(w.module_key)) errors.push(`workflow ${w.key} maps to unknown module '${w.module_key}'`);
    for (const n of w.definition.nodes) {
      if (n.kind === "agent" && !agentByKey.has(short(n.agent_key)))
        errors.push(`workflow ${w.key} node ${n.id} references unknown agent '${n.agent_key}'`);
      for (const g of n.gate_types ?? []) if (!knownType(g)) errors.push(`workflow ${w.key} gate ${n.id} references unknown type '${g}'`);
      if (n.over && !knownType(n.over)) errors.push(`workflow ${w.key} map ${n.id} over unknown type '${n.over}'`);
    }
  }

  // personas: supervisor agents; scoped types declared
  for (const p of pack.personas) {
    const a = agentByKey.get(short(p.agent_key));
    if (!a) errors.push(`persona ${p.agent_key} is not a declared agent`);
    else if (a.kind !== "supervisor") errors.push(`persona ${p.agent_key} must be a supervisor agent`);
    for (const t of p.scope.artifact_types ?? []) if (!knownType(t)) errors.push(`persona ${p.agent_key} scopes unknown type '${t}'`);
  }

  // lifecycle: triggers reference declared types
  for (const tr of pack.lifecycle?.transitions ?? [])
    if (!knownType(tr.trigger_type)) errors.push(`lifecycle ${pack.lifecycle.key} trigger references unknown type '${tr.trigger_type}'`);

  return errors;
}

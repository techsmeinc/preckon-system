// ── Industry template library. Each template is a compact, bare-key blueprint of
// a domain "assistant" for one industry. A tenant PICKS one at setup; it is then
// cloned (re-keyed) into that tenant's OWN editable domain (lib/domains.ts) — so
// Preckon is not construction-based, and not a generic engine only a developer can
// extend: a business user configures the product to their industry, no code.
//
// A template is authored as a tiny spec; makeTemplate() expands it into a full
// DomainPack (Core's data contract). Add an industry = add one spec below.

import type { DomainPack, PackAgent, PackArtifactType, PackWorkflow } from "./contract";
import { ALL_CORE_KEYS } from "./core";

export interface FieldSpec {
  name: string;
  kind?: "string" | "text" | "number" | "money" | "date" | "enum" | "bool";
  enum?: string[];
  required?: boolean;
}
interface StageSpec {
  key: string;
  label: string;
  icon: string;
  description: string;
  output: { type: string; label: string; fields: FieldSpec[]; reviewable?: boolean };
}
export interface TemplateSpec {
  key: string;
  name: string;
  industry: string;
  icon: string;
  blurb: string;
  record: { type: string; label: string; fields: FieldSpec[] };
  stages: StageSpec[];
  assistant: { name: string; blurb: string };
}

const fieldSchema = (f: FieldSpec): any => {
  switch (f.kind) {
    case "number": case "money": return { type: "integer" };
    case "bool": return { type: "boolean" };
    case "date": return { type: "string", format: "date-time" };
    case "enum": return { type: "string", enum: f.enum ?? ["a", "b"] };
    default: return { type: "string" };
  }
};
const objSchema = (fields: FieldSpec[]): any => ({
  type: "object",
  additionalProperties: true, // lenient: user domains + generic worker samples always validate
  required: fields.filter((f) => f.required).map((f) => f.name),
  properties: Object.fromEntries(fields.map((f) => [f.name, fieldSchema(f)])),
});

/** Expand a compact industry spec into a full bare-key DomainPack. */
export function makeTemplate(spec: TemplateSpec): DomainPack {
  const DOC = "document";
  const jt = (type: string) => ({ type, tier: "deep" as const, prompt_ref: `${type}@v1` });

  // Artifact types: a generic uploaded document, the intake record, one per stage.
  const types: PackArtifactType[] = [
    { key: DOC, name: "Document", is_reviewable: false, payload_schema: {
        type: "object", additionalProperties: true, required: ["file_id"],
        properties: { file_id: { type: "string", format: "uuid" }, title: { type: "string" }, doc_type: { type: "string" } } } },
    { key: spec.record.type, name: spec.record.label, is_reviewable: true, payload_schema: objSchema(spec.record.fields) },
    ...spec.stages.map((s) => ({ key: s.output.type, name: s.output.label, is_reviewable: s.output.reviewable ?? true, payload_schema: objSchema(s.output.fields) })),
  ];

  // Agents: intake (doc+record), one worker per stage, one supervisor assistant.
  const agents: PackAgent[] = [
    { key: "agent.intake", name: "Intake", kind: "worker", consumes: [], produces: [DOC, spec.record.type], job_types: [jt("intake.capture")], permission_keys: ["artifact.read"], entitlement_key: null },
    ...spec.stages.map((s, i): PackAgent => ({
      key: `agent.${s.key}`, name: s.label, kind: "worker",
      consumes: [i === 0 ? spec.record.type : spec.stages[i - 1].output.type],
      produces: [s.output.type], job_types: [jt(`${s.key}.run`)], permission_keys: [], entitlement_key: null,
    })),
    { key: "agent.assistant", name: spec.assistant.name, kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("assistant.respond"), jt("assistant.review_run")], permission_keys: [], entitlement_key: null },
  ];

  // Workflows: intake, then one per stage. Each = agent → gate(output).
  const gate = (id: string, types: string[]) => ({ id, kind: "gate", gate_types: types });
  const agentN = (id: string, agent_key: string) => ({ id, kind: "agent", agent_key });
  const workflows: PackWorkflow[] = [
    { key: "workflow.intake", name: "Intake", module_key: "intake", entitlement_key: "workflow.intake",
      definition: { nodes: [agentN("capture", "agent.intake"), gate("gate", [spec.record.type])], edges: [{ from: "capture", to: "gate" }] } },
    ...spec.stages.map((s): PackWorkflow => ({
      key: `workflow.${s.key}`, name: s.label, module_key: s.key, entitlement_key: `workflow.${s.key}`,
      definition: { nodes: [agentN("run", `agent.${s.key}`), gate("gate", [s.output.type])], edges: [{ from: "run", to: "gate" }] },
    })),
  ];

  // Modules (licensable) — full objects so the UI can render label/icon/desc.
  const modules = [
    { key: "intake", label: "Intake", icon: "📥", order: 0, description: `Capture and structure each ${spec.record.label.toLowerCase()}.` },
    ...spec.stages.map((s, i) => ({ key: s.key, label: s.label, icon: s.icon, order: i + 1, description: s.description })),
  ];

  // Lifecycle: a linear pipeline the record flows through.
  const states = ["received", ...spec.stages.map((s) => s.key), "complete"];
  const transitions = [
    { from: "received", trigger_type: spec.record.type, required_permission: "artifact.confirm", to: spec.stages[0]?.key ?? "complete" },
    ...spec.stages.map((s, i) => ({
      from: s.key, trigger_type: s.output.type, required_permission: "artifact.confirm",
      to: spec.stages[i + 1]?.key ?? "complete", terminal: i === spec.stages.length - 1 ? true : undefined,
    })),
  ];

  const roles = [
    { key: "owner", name: "Owner", tier: "owner_admin" as const, permissions: [...ALL_CORE_KEYS] },
    { key: "member", name: "Member", tier: "delivery" as const, permissions: ["project.create", "project.read", "artifact.read", "artifact.confirm", "artifact.edit", "workflow.read", "workflow.run", "library.read"] },
    { key: "viewer", name: "Viewer", tier: "view" as const, permissions: ["project.read", "artifact.read", "workflow.read", "library.read"] },
  ];

  const manifest = {
    domain: spec.key, name: spec.name, industry: spec.industry, icon: spec.icon, version: "1.0.0",
    modules, // full objects (display)
    artifact_types: types.map((t) => t.key), agents: agents.map((a) => a.key),
    workflows: workflows.map((w) => w.key), personas: ["agent.assistant"],
    lifecycles: [{ key: "pursuit", start: "received", transitions }],
    role_template: roles, permissions: [], settings: { default_tier: "deep", auto_accept_threshold: 0.9 },
    states, assistant: spec.assistant,
  };

  return {
    key: spec.key, name: spec.name, version: "1.0.0", manifest,
    modules, artifactTypes: types, agents, workflows,
    personas: [{ agent_key: "agent.assistant", scope: {}, deviation_kinds: ["flag"], is_default: true, sort_order: 0 }],
    lifecycle: { key: "pursuit", start: "received", transitions },
    roles, packPermissions: [], settings: { default_tier: "deep", auto_accept_threshold: 0.9 }, standardRules: [],
  } as DomainPack;
}

// ── The shipped industry templates. Lean but complete; a tenant edits its clone.
export const TEMPLATE_SPECS: TemplateSpec[] = [
  {
    key: "construction", name: "Construction", industry: "Construction / bids", icon: "🏗️",
    blurb: "Analyse a tender, take off quantities, price it, and assemble the bid.",
    record: { type: "tender", label: "Tender", fields: [
      { name: "project_name", required: true }, { name: "client" }, { name: "deadline", kind: "date" }, { name: "value_minor", kind: "money" } ] },
    stages: [
      { key: "takeoff", label: "Quantities", icon: "📐", description: "Take off quantities from the drawings and specs.",
        output: { type: "boq_line", label: "Bill of quantities", fields: [ { name: "item", required: true }, { name: "quantity", kind: "number" }, { name: "unit" }, { name: "trade" } ] } },
      { key: "estimate", label: "Estimate", icon: "💲", description: "Price each line against the rate books.",
        output: { type: "cost_line", label: "Cost line", fields: [ { name: "item", required: true }, { name: "rate_minor", kind: "money" }, { name: "amount_minor", kind: "money" } ] } },
      { key: "proposal", label: "Proposal", icon: "📋", description: "Assemble the priced, compliant bid.",
        output: { type: "bid", label: "Bid", fields: [ { name: "title", required: true }, { name: "total_minor", kind: "money" }, { name: "summary", kind: "text" } ] } },
    ],
    assistant: { name: "Bid Copilot", blurb: "I read the tender, take off quantities, price the bid, and assemble the proposal." },
  },
];

export const TEMPLATES: Record<string, DomainPack> = Object.fromEntries(
  TEMPLATE_SPECS.map((s) => [s.key, makeTemplate(s)])
);

export const TEMPLATE_META = TEMPLATE_SPECS.map((s) => ({
  key: s.key, name: s.name, industry: s.industry, icon: s.icon, blurb: s.blurb,
  stages: s.stages.map((st) => st.label), assistant: s.assistant.name,
}));

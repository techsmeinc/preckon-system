// ── The Construction pack (implementation deck v1.1) as data against Core's ABI.
// Nothing here changes a Core table/endpoint/syscall — it is registry rows +
// a manifest (§D). Keys are the short forms used throughout (§D.3): one pack,
// so bare keys are unambiguous.

import { ALL_CORE_KEYS } from "./core";
import { REVIEWABLE, SCHEMAS, TYPE_NAMES } from "./schemas";

// The pack vocabulary is Core's, defined once in ./contract. Re-exported here so
// existing importers (and the DOMAINS.md pack template) keep working unchanged.
import type {
  PackAgent, PackArtifactType, PackJobType, PackPersona, PackRole, PackWorkflow, Tier,
} from "./contract";
export type {
  PackAgent, PackArtifactType, PackJobType, PackPersona, PackRole, PackWorkflow, Tier,
} from "./contract";

// ── Artifact types (16) ─────────────────────────────────────────────────────
export const ARTIFACT_TYPES: PackArtifactType[] = Object.keys(SCHEMAS).map((key) => ({
  key,
  name: TYPE_NAMES[key] ?? key,
  payload_schema: SCHEMAS[key],
  is_reviewable: REVIEWABLE[key],
}));

const jt = (type: string, tier: Tier): PackJobType => ({ type, tier, prompt_ref: `${type}@v1` });

// ── Agents (19: 15 workers, 1 service, 3 supervisor personas) — Appendix A ───
export const AGENTS: PackAgent[] = [
  { key: "agent.document", name: "Document", kind: "worker", consumes: [], produces: ["document"], job_types: [jt("document.classify_split", "standard")], permission_keys: ["artifact.read"], entitlement_key: null },
  { key: "agent.tender", name: "Tender", kind: "worker", consumes: ["document"], produces: ["tender_summary"], job_types: [jt("tender.extract_summary", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.specification", name: "Specification", kind: "worker", consumes: ["document"], produces: ["spec_clause"], job_types: [jt("spec.extract_clauses", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.drawing", name: "Drawing", kind: "worker", consumes: ["document", "drawing_index"], produces: ["drawing_index", "drawing_measurement"], job_types: [jt("drawing.index", "standard"), jt("drawing.takeoff", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.boq", name: "BOQ", kind: "worker", consumes: ["tender_summary", "spec_clause", "drawing_measurement"], produces: ["boq_line"], job_types: [jt("boq.derive_lines", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.cost", name: "Cost", kind: "worker", consumes: ["boq_line"], produces: ["cost_line"], job_types: [jt("cost.price_lines", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.schedule", name: "Schedule", kind: "worker", consumes: ["boq_line", "cost_line"], produces: ["schedule_activity"], job_types: [jt("schedule.build_programme", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.procurement", name: "Procurement", kind: "worker", consumes: ["boq_line", "cost_line"], produces: ["procurement_package"], job_types: [jt("procure.build_packages", "standard")], permission_keys: [], entitlement_key: null },
  { key: "agent.rfi", name: "RFI", kind: "worker", consumes: ["tender_summary", "spec_clause", "drawing_measurement"], produces: ["rfi"], job_types: [jt("rfi.detect", "standard")], permission_keys: [], entitlement_key: null },
  { key: "agent.compliance", name: "Compliance", kind: "worker", consumes: ["tender_summary", "spec_clause", "proposal_doc"], produces: ["compliance_item"], job_types: [jt("compliance.check", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.proposal", name: "Proposal", kind: "worker", consumes: ["tender_summary", "boq_line", "cost_line", "schedule_activity", "procurement_package"], produces: ["proposal_doc"], job_types: [jt("proposal.assemble", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.bid_qualification", name: "Bid Qualification", kind: "worker", consumes: ["tender_summary", "risk"], produces: ["bid_decision"], job_types: [jt("bid.qualify", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.risk", name: "Risk", kind: "worker", consumes: ["tender_summary", "spec_clause", "drawing_measurement", "boq_line", "cost_line"], produces: ["risk"], job_types: [jt("risk.assess", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.approval_prep", name: "Approval Prep", kind: "worker", consumes: ["proposal_doc", "cost_line", "risk", "compliance_item"], produces: ["bid_approval"], job_types: [jt("approval.prepare", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.clarification", name: "Clarification", kind: "worker", consumes: ["client_query", "tender_summary", "spec_clause", "boq_line", "proposal_doc"], produces: ["client_query"], job_types: [jt("clarification.draft", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.knowledge", name: "Knowledge", kind: "service", consumes: ["*"], produces: [], job_types: [jt("knowledge.search", "routing")], permission_keys: ["artifact.read"], entitlement_key: null },
  { key: "agent.construction_copilot", name: "Construction Copilot", kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("copilot.respond", "deep"), jt("copilot.review_run", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.commercial", name: "Commercial", kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("commercial.respond", "deep"), jt("commercial.review_run", "deep")], permission_keys: [], entitlement_key: null },
  { key: "agent.compliance_lead", name: "Compliance Lead", kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("compliance_lead.respond", "deep"), jt("compliance_lead.review_run", "deep")], permission_keys: [], entitlement_key: null },
];

// ── Workflows (11 + the walking-skeleton) — Appendix B ───────────────────────
const wf = (key: string, name: string, module_key: string, nodes: any[], edges: any[]): PackWorkflow => ({
  key,
  name,
  module_key,
  definition: { nodes, edges },
  entitlement_key: key,
});

export const WORKFLOWS: PackWorkflow[] = [
  // B.1 — the walking skeleton (§S): defines the ABI end to end.
  wf(
    "workflow.tenderlogix.skeleton",
    "TenderLogix (walking skeleton)",
    "tenderlogix",
    [
      { id: "ingest", kind: "agent", agent_key: "agent.document" },
      { id: "tender", kind: "agent", agent_key: "agent.tender" },
      { id: "gate_scope", kind: "gate", gate_types: ["tender_summary"] },
      { id: "boq", kind: "agent", agent_key: "agent.boq" },
      { id: "gate_boq", kind: "gate", gate_types: ["boq_line"] },
    ],
    [
      { from: "ingest", to: "tender" },
      { from: "tender", to: "gate_scope" },
      { from: "gate_scope", to: "boq" },
      { from: "boq", to: "gate_boq" },
    ]
  ),
  // B.2 — TenderLogix (intake)
  wf(
    "workflow.tenderlogix",
    "TenderLogix",
    "tenderlogix",
    [
      { id: "ingest", kind: "agent", agent_key: "agent.document" },
      { id: "tender", kind: "agent", agent_key: "agent.tender" },
      { id: "gate_scope", kind: "gate", gate_types: ["tender_summary"] },
    ],
    [
      { from: "ingest", to: "tender" },
      { from: "tender", to: "gate_scope" },
    ]
  ),
  // B.3 — DocLogix
  wf(
    "workflow.doclogix",
    "DocLogix",
    "doclogix",
    [
      { id: "ingest", kind: "agent", agent_key: "agent.document" },
      { id: "spec", kind: "agent", agent_key: "agent.specification" },
      { id: "gate", kind: "gate", gate_types: ["spec_clause"] },
    ],
    [
      { from: "ingest", to: "spec" },
      { from: "spec", to: "gate" },
    ]
  ),
  // B.4 — DrawLogix (index → map per sheet → takeoff)
  wf(
    "workflow.drawlogix",
    "DrawLogix",
    "drawlogix",
    [
      { id: "ingest", kind: "agent", agent_key: "agent.document" },
      { id: "index", kind: "agent", agent_key: "agent.drawing", job_type: "drawing.index" },
      { id: "gate_idx", kind: "gate", gate_types: ["drawing_index"] },
      { id: "map_sheets", kind: "map", over: "drawing_index" },
      { id: "takeoff", kind: "agent", agent_key: "agent.drawing", job_type: "drawing.takeoff" },
      { id: "gate_meas", kind: "gate", gate_types: ["drawing_measurement"] },
    ],
    [
      { from: "ingest", to: "index" },
      { from: "index", to: "gate_idx" },
      { from: "gate_idx", to: "map_sheets" },
      { from: "map_sheets", to: "takeoff" },
      { from: "takeoff", to: "gate_meas" },
    ]
  ),
  // B.5 — QuantLogix
  wf(
    "workflow.quantlogix",
    "QuantLogix",
    "quantlogix",
    [
      { id: "boq", kind: "agent", agent_key: "agent.boq" },
      { id: "gate", kind: "gate", gate_types: ["boq_line"] },
    ],
    [{ from: "boq", to: "gate" }]
  ),
  // B.6 — CostLogix
  wf(
    "workflow.costlogix",
    "CostLogix",
    "costlogix",
    [
      { id: "cost", kind: "agent", agent_key: "agent.cost" },
      { id: "gate", kind: "gate", gate_types: ["cost_line"] },
    ],
    [{ from: "cost", to: "gate" }]
  ),
  // B.7 — ScheduleLogix
  wf(
    "workflow.schedulelogix",
    "ScheduleLogix",
    "schedulelogix",
    [
      { id: "schedule", kind: "agent", agent_key: "agent.schedule" },
      { id: "gate", kind: "gate", gate_types: ["schedule_activity"] },
    ],
    [{ from: "schedule", to: "gate" }]
  ),
  // B.8 — ProcureLogix
  wf(
    "workflow.procurelogix",
    "ProcureLogix",
    "procurelogix",
    [
      { id: "procure", kind: "agent", agent_key: "agent.procurement" },
      { id: "gate", kind: "gate", gate_types: ["procurement_package"] },
    ],
    [{ from: "procure", to: "gate" }]
  ),
  // B.10 — BidQualification (lifecycle: qualifying)
  wf(
    "workflow.bidqualification",
    "BidQualification",
    "tenderlogix",
    [
      { id: "risk_scan", kind: "agent", agent_key: "agent.risk" },
      { id: "qualify", kind: "agent", agent_key: "agent.bid_qualification" },
      { id: "gate", kind: "gate", gate_types: ["bid_decision"] },
    ],
    [
      { from: "risk_scan", to: "qualify" },
      { from: "qualify", to: "gate" },
    ]
  ),
  // B.11 — RiskReview (lifecycle: bidding)
  wf(
    "workflow.riskreview",
    "RiskReview",
    "tenderlogix",
    [
      { id: "risk", kind: "agent", agent_key: "agent.risk" },
      { id: "gate", kind: "gate", gate_types: ["risk"] },
    ],
    [{ from: "risk", to: "gate" }]
  ),
  // B.12 — BidAssembly (lifecycle: bidding → approving)
  wf(
    "workflow.bidassembly",
    "BidAssembly",
    "tenderlogix",
    [
      { id: "proposal", kind: "agent", agent_key: "agent.proposal" },
      { id: "compliance", kind: "agent", agent_key: "agent.compliance" },
      { id: "approval", kind: "agent", agent_key: "agent.approval_prep" },
      { id: "gate", kind: "gate", gate_types: ["proposal_doc", "compliance_item", "bid_approval"] },
    ],
    [
      { from: "proposal", to: "compliance" },
      { from: "compliance", to: "approval" },
      { from: "approval", to: "gate" },
    ]
  ),
  // B.13 — ClarificationLoop (lifecycle: clarifying — event-driven)
  wf(
    "workflow.clarificationloop",
    "ClarificationLoop",
    "tenderlogix",
    [
      { id: "draft", kind: "agent", agent_key: "agent.clarification" },
      { id: "gate", kind: "gate", gate_types: ["client_query"] },
    ],
    [{ from: "draft", to: "gate" }]
  ),
  // B.14 — Classify. agent.document is the first node of every workflow, so a
  // document only acquires a type once some downstream workflow is run. That
  // left the Documents tab showing "not classified yet" for a pack that had
  // been fully ingested, with no way to act on it from that screen. This is
  // that one step on its own — same agent, same audit trail, no gate, so the
  // set can be typed before deciding which chain to run.
  wf(
    "workflow.classify",
    "Classify documents",
    "tenderlogix",
    [{ id: "ingest", kind: "agent", agent_key: "agent.document" }],
    []
  ),
];

// ── Personas (3) — §1.3 ──────────────────────────────────────────────────────
export const PERSONAS: PackPersona[] = [
  { agent_key: "agent.construction_copilot", scope: {}, deviation_kinds: [], is_default: true, sort_order: 0 },
  {
    agent_key: "agent.commercial",
    scope: {
      module_keys: ["costlogix", "quantlogix", "tenderlogix", "procurelogix"],
      artifact_types: ["boq_line", "cost_line", "procurement_package", "proposal_doc"],
    },
    deviation_kinds: ["flag", "request_review", "insert_review_gate"],
    is_default: false,
    sort_order: 10,
  },
  {
    agent_key: "agent.compliance_lead",
    scope: {
      module_keys: ["tenderlogix", "doclogix"],
      artifact_types: ["tender_summary", "spec_clause", "compliance_item", "proposal_doc"],
    },
    deviation_kinds: ["flag", "request_review"],
    is_default: false,
    sort_order: 20,
  },
];

// ── Bid-pursuit lifecycle — §2.1 ─────────────────────────────────────────────
export const LIFECYCLE = {
  key: "bid_pursuit",
  start: "received",
  transitions: [
    { from: "received", trigger_type: "tender_summary", required_permission: "artifact.confirm", to: "qualifying" },
    { from: "qualifying", trigger_type: "bid_decision", trigger_match: { decision: "go" }, required_permission: "artifact.confirm", to: "bidding" },
    { from: "qualifying", trigger_type: "bid_decision", trigger_match: { decision: "no_go" }, required_permission: "artifact.confirm", to: "no_bid", terminal: true },
    { from: "bidding", trigger_type: "proposal_doc", required_permission: "artifact.confirm", to: "approving" },
    { from: "approving", trigger_type: "bid_approval", required_permission: "bid.approve", to: "submitted" },
    { from: "submitted", trigger_type: "client_query", required_permission: "artifact.confirm", to: "clarifying" },
    { from: "clarifying", trigger_type: "client_query", trigger_match: { is_addendum: true }, required_permission: "artifact.confirm", to: "bidding" },
  ],
};

// ── Role template (6) — §0.5. Wildcards expanded to concrete Core keys. ───────
const projectAll = ["project.create", "project.read", "project.read_all", "project.update", "project.archive", "project.member.manage"];
const artifactAll = ["artifact.read", "artifact.confirm", "artifact.edit"];
const workflowAll = ["workflow.read", "workflow.run"];
const libraryAll = ["library.read", "library.manage"];
const adminAll = ["admin.users", "admin.branding", "admin.settings"];

export const ROLES: PackRole[] = [
  { key: "owner", name: "Owner", tier: "owner_admin", permissions: [...ALL_CORE_KEYS, "bid.approve"] },
  { key: "admin", name: "Admin", tier: "owner_admin", permissions: [...projectAll, ...artifactAll, ...workflowAll, ...libraryAll, ...adminAll, "billing.view"] },
  { key: "precon_lead", name: "Precon Lead", tier: "delivery", permissions: [...projectAll, ...artifactAll, ...workflowAll, ...libraryAll, "bid.approve"] },
  { key: "estimator", name: "Estimator", tier: "delivery", permissions: ["project.read", "artifact.read", "artifact.confirm", "artifact.edit", "workflow.read", "workflow.run", "library.read"] },
  { key: "qs_reviewer", name: "QS / Reviewer", tier: "review", permissions: ["project.read", "artifact.read", "artifact.confirm", "artifact.edit", "workflow.read", "library.read"] },
  { key: "viewer", name: "Viewer", tier: "view", permissions: ["project.read", "artifact.read", "workflow.read", "library.read"] },
];

// ── Pack permission additions (beyond the Core 18) — §0.5 ─────────────────────
export const PACK_PERMISSIONS = [
  { key: "bid.approve", domain: "tender", description: "authorize a tender for submission" },
];

export const LIBRARY_COLLECTIONS = ["rate_book", "standard", "precedent_bid", "template", "standard_rule"];

// ── Standards & Rules capability (v2). Tiered rules seeded as Library data
// (collection 'standard_rule'). tier precedence: statutory ▸ industry ▸ client ▸
// company ▸ project; binding mandatory | default. applies_when/result drive
// validation. Content is pack/Library data — the resolver mechanism is Core.
export interface PackStandardRule {
  rule_id: string; standard: string; category: string;
  tier: "statutory" | "industry" | "client" | "company" | "project";
  binding: "mandatory" | "default";
  jurisdiction: string; subject: string;
  applies_when?: { type_key: string; match?: Record<string, { contains?: string; equals?: string; prefix?: string }> };
  result?: Record<string, unknown>;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  reference?: string; recommendation?: string; source_ref?: string;
  status: "active" | "superseded";
}

export const STANDARD_RULES: PackStandardRule[] = [
  // The canonical precedence case: statute (m³) must beat company (m²) for concrete walls.
  { rule_id: "obc.measurement.concrete_wall", standard: "Ontario Building Code", category: "measurement",
    tier: "statutory", binding: "mandatory", jurisdiction: "CA-ON", subject: "concrete wall",
    applies_when: { type_key: "boq_line", match: { description: { contains: "oncrete" } } },
    result: { unit: "m3" }, severity: "high", reference: "OBC 2012",
    recommendation: "Measure concrete by volume (m³).", source_ref: "OBC", status: "active" },
  { rule_id: "nrm2.measurement.concrete_wall", standard: "NRM2", category: "measurement",
    tier: "industry", binding: "default", jurisdiction: "global", subject: "concrete wall",
    result: { unit: "m3" }, source_ref: "NRM2 2021", status: "active" },
  { rule_id: "acme.measurement.concrete_wall", standard: "Acme Standards", category: "measurement",
    tier: "company", binding: "default", jurisdiction: "CA-ON", subject: "concrete wall",
    result: { unit: "m2", description_template: "Concrete wall, {thickness}mm" },
    source_ref: "Acme BOQ Manual", status: "active" },
  { rule_id: "proj.measurement.concrete_wall", standard: "Project spec", category: "measurement",
    tier: "project", binding: "default", jurisdiction: "CA-ON", subject: "concrete wall",
    result: { unit: "m3", min_strength_mpa: 40 }, source_ref: "Project 123 spec", status: "active" },

  // A mandatory measurement convention that DOES trigger on the demo BOQ (rebar in kg).
  { rule_id: "nrm2.measurement.reinforcement", standard: "NRM2", category: "measurement",
    tier: "industry", binding: "mandatory", jurisdiction: "global", subject: "reinforcement",
    applies_when: { type_key: "boq_line", match: { description: { contains: "einforcement" } } },
    result: { unit: "t" }, severity: "medium", reference: "NRM2 §11",
    recommendation: "Measure steel reinforcement by mass in tonnes (t), not kg.", source_ref: "NRM2 2021", status: "active" },

  // A cost floor: a cost_line priced below the company rate-book floor is a violation.
  { rule_id: "acme.cost.rate_floor", standard: "Acme Commercial Policy", category: "cost",
    tier: "company", binding: "mandatory", jurisdiction: "CA-ON", subject: "unit rate",
    applies_when: { type_key: "cost_line", match: { currency: { equals: "CAD" } } },
    result: { min_rate_minor: 100 }, severity: "low", reference: "Acme Commercial Policy 4.2",
    recommendation: "Review any unit rate below the company floor.", source_ref: "Acme", status: "active" },
];

export const SETTINGS = { default_tier: "deep" as Tier, auto_accept_threshold: 0.9 };

// ── Modules (the licensable capabilities — the "domain-wise modules") ─────────
export const MODULES = [
  { key: "tenderlogix", label: "TenderLogix", icon: "file-search", order: 10, description: "Analyse the tender and assemble the submittable bid." },
  { key: "drawlogix", label: "DrawLogix", icon: "ruler", order: 20, description: "Index the sheet set and take off quantities per drawing." },
  { key: "doclogix", label: "DocLogix", icon: "file-text", order: 30, description: "Extract normative clauses from specification documents." },
  { key: "quantlogix", label: "QuantLogix", icon: "calculator", order: 40, description: "Derive the bill of quantities from measurements and clauses." },
  { key: "costlogix", label: "CostLogix", icon: "dollar-sign", order: 50, description: "Price each BOQ line against the rate books." },
  { key: "schedulelogix", label: "ScheduleLogix", icon: "calendar-clock", order: 60, description: "Sequence activities into a delivery programme." },
  { key: "procurelogix", label: "ProcureLogix", icon: "shopping-cart", order: 70, description: "Group scope into RFQ packages by trade and lead-time." },
];

// ── The authoritative domain manifest (§D.2 / §0.4) ──────────────────────────
export const MANIFEST = {
  domain: "construction",
  version: "1.0.0",
  modules: MODULES.map((m) => m.key),
  artifact_types: ARTIFACT_TYPES.map((t) => t.key),
  agents: AGENTS.map((a) => a.key),
  workflows: WORKFLOWS.map((w) => w.key),
  personas: PERSONAS.map((p) => p.agent_key),
  library_collections: LIBRARY_COLLECTIONS,
  lifecycles: [LIFECYCLE],
  role_template: ROLES,
  permissions: PACK_PERMISSIONS,
  settings: SETTINGS,
};

export const CONSTRUCTION_PACK = {
  key: "construction",
  name: "Construction",
  version: "1.0.0",
  manifest: MANIFEST,
  modules: MODULES,
  artifactTypes: ARTIFACT_TYPES,
  agents: AGENTS,
  workflows: WORKFLOWS,
  personas: PERSONAS,
  lifecycle: LIFECYCLE,
  roles: ROLES,
  packPermissions: PACK_PERMISSIONS,
  settings: SETTINGS,
  standardRules: STANDARD_RULES,
};

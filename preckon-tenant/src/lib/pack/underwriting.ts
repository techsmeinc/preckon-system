// ── The Underwriting pack (implementation deck v1.0) as data against Core's ABI.
// The SECOND domain — commercial insurance underwriting — proving a new vertical
// needs zero Core change. Keys are namespaced `underwriting.*` (§D.3) so they
// coexist in the shared catalog alongside construction's bare keys.

import { ALL_CORE_KEYS } from "./core";
import type {
  PackAgent, PackArtifactType, PackPersona, PackRole, PackWorkflow, Tier,
} from "./contract";

const N = "underwriting.";
const t = (k: string) => N + k; // type key
const a = (k: string) => N + "agent." + k; // agent key
const w = (k: string) => N + "workflow." + k; // workflow key
const jt = (type: string, tier: Tier) => ({ type, tier, prompt_ref: `${type}@v1` });

// ── Artifact types (10) with payload schemas (deck Appendix C.2) ─────────────
const SCHEMAS: Record<string, any> = {
  document: {
    type: "object", additionalProperties: false, required: ["file_id", "doc_type", "page_range"],
    properties: {
      file_id: { type: "string", format: "uuid" },
      doc_type: { type: "string", enum: ["broker_email", "acord_form", "loss_run", "financials", "schedule_of_values", "other"] },
      title: { type: "string" },
      page_range: { type: "array", items: { type: "integer", minimum: 1 }, minItems: 2, maxItems: 2 },
    },
  },
  submission_summary: {
    type: "object", additionalProperties: false,
    required: ["insured_name", "class_of_business", "effective_date", "requested_limit_minor", "currency"],
    properties: {
      insured_name: { type: "string" }, class_of_business: { type: "string" }, broker: { type: "string" },
      effective_date: { type: "string", format: "date" },
      requested_limit_minor: { type: "integer", minimum: 0 },
      requested_deductible_minor: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
    },
  },
  exposure: {
    type: "object", additionalProperties: false, required: ["location", "peril", "value_minor", "currency"],
    properties: {
      location: { type: "string" },
      peril: { type: "string", enum: ["fire", "flood", "wind", "liability", "theft", "business_interruption", "other"] },
      value_minor: { type: "integer", minimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
      construction_type: { type: "string" },
    },
  },
  loss_run: {
    type: "object", additionalProperties: false, required: ["policy_year", "claim_count", "incurred_minor", "currency"],
    properties: {
      policy_year: { type: "integer" }, claim_count: { type: "integer", minimum: 0 },
      incurred_minor: { type: "integer", minimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
      description: { type: "string" },
    },
  },
  risk_factor: {
    type: "object", additionalProperties: false, required: ["factor", "category", "score", "appetite"],
    properties: {
      factor: { type: "string" },
      category: { type: "string", enum: ["hazard", "financial", "management", "natural_catastrophe", "moral"] },
      score: { type: "number", minimum: 0, maximum: 100 },
      appetite: { type: "string", enum: ["in", "out", "refer"] }, rationale: { type: "string" },
    },
  },
  quote_option: {
    type: "object", additionalProperties: false, required: ["option_name", "premium_minor", "currency", "limit_minor"],
    properties: {
      option_name: { type: "string" }, premium_minor: { type: "integer", minimum: 0 },
      currency: { type: "string", pattern: "^[A-Z]{3}$" }, limit_minor: { type: "integer", minimum: 0 },
      deductible_minor: { type: "integer", minimum: 0 }, terms: { type: "string" },
    },
  },
  referral: {
    type: "object", additionalProperties: false, required: ["reason", "authority_breach", "decision"],
    properties: {
      reason: { type: "string" }, to_role: { type: "string" }, authority_breach: { type: "boolean" },
      decision: { type: "string", enum: ["pending", "approved", "rejected"] }, note: { type: "string" },
    },
  },
  condition: {
    type: "object", additionalProperties: false, required: ["kind", "text"],
    properties: {
      kind: { type: "string", enum: ["subjectivity", "warranty", "exclusion", "endorsement"] },
      text: { type: "string" }, mandatory: { type: "boolean" },
    },
  },
  uw_query: {
    type: "object", additionalProperties: false, required: ["direction", "subject", "body", "status"],
    properties: {
      direction: { type: "string", enum: ["inbound", "outbound"] }, subject: { type: "string" }, body: { type: "string" },
      references: { type: "array", items: { type: "string", format: "uuid" } },
      is_amendment: { type: "boolean" }, status: { type: "string", enum: ["open", "answered", "closed"] },
    },
  },
  quote_letter: {
    type: "object", additionalProperties: false,
    required: ["quote_ref", "insured_name", "total_premium_minor", "currency", "valid_until"],
    properties: {
      quote_ref: { type: "string" }, insured_name: { type: "string" },
      total_premium_minor: { type: "integer", minimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
      valid_until: { type: "string", format: "date" }, option_ref: { type: "string" },
    },
  },
};
const NAMES: Record<string, string> = {
  document: "Document", submission_summary: "Submission Summary", exposure: "Exposure", loss_run: "Loss Run",
  risk_factor: "Risk Factor", quote_option: "Quote Option", referral: "Referral", condition: "Condition",
  uw_query: "UW Query", quote_letter: "Quote Letter",
};
const REVIEWABLE: Record<string, boolean> = { document: false };

export const UW_ARTIFACT_TYPES: PackArtifactType[] = Object.keys(SCHEMAS).map((k) => ({
  key: t(k), name: NAMES[k] ?? k, payload_schema: SCHEMAS[k], is_reviewable: REVIEWABLE[k] ?? true,
}));

// ── Agents (14) ──────────────────────────────────────────────────────────────
export const UW_AGENTS: PackAgent[] = [
  { key: a("document"), name: "Document", kind: "worker", consumes: [], produces: [t("document")], job_types: [jt("uw.document.classify", "standard")], permission_keys: ["artifact.read"], entitlement_key: null },
  { key: a("intake"), name: "Intake", kind: "worker", consumes: [t("document")], produces: [t("submission_summary")], job_types: [jt("uw.intake.extract", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("exposure"), name: "Exposure", kind: "worker", consumes: [t("document")], produces: [t("exposure")], job_types: [jt("uw.exposure.capture", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("loss_analysis"), name: "Loss Analysis", kind: "worker", consumes: [t("document")], produces: [t("loss_run")], job_types: [jt("uw.loss.analyze", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("risk_rating"), name: "Risk Rating", kind: "worker", consumes: [t("submission_summary"), t("exposure"), t("loss_run")], produces: [t("risk_factor")], job_types: [jt("uw.risk.rate", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("pricing"), name: "Pricing", kind: "worker", consumes: [t("exposure"), t("risk_factor"), t("loss_run")], produces: [t("quote_option")], job_types: [jt("uw.pricing.price", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("referral"), name: "Referral", kind: "worker", consumes: [t("risk_factor"), t("quote_option")], produces: [t("referral")], job_types: [jt("uw.referral.detect", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("conditions"), name: "Conditions", kind: "worker", consumes: [t("submission_summary"), t("risk_factor")], produces: [t("condition")], job_types: [jt("uw.conditions.build", "standard")], permission_keys: [], entitlement_key: null },
  { key: a("quote"), name: "Quote", kind: "worker", consumes: [t("submission_summary"), t("quote_option"), t("condition")], produces: [t("quote_letter")], job_types: [jt("uw.quote.assemble", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("broker_query"), name: "Broker Query", kind: "worker", consumes: [t("uw_query"), t("submission_summary"), t("exposure"), t("quote_option")], produces: [t("uw_query")], job_types: [jt("uw.broker.draft", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("knowledge"), name: "Knowledge", kind: "service", consumes: ["*"], produces: [], job_types: [jt("uw.knowledge.search", "routing")], permission_keys: ["artifact.read"], entitlement_key: null },
  { key: a("underwriter"), name: "Underwriting Copilot", kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("underwriter.respond", "deep"), jt("underwriter.review_run", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("actuary"), name: "Actuary", kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("actuary.respond", "deep"), jt("actuary.review_run", "deep")], permission_keys: [], entitlement_key: null },
  { key: a("wordings"), name: "Wordings", kind: "supervisor", consumes: ["*"], produces: [], job_types: [jt("wordings.respond", "deep"), jt("wordings.review_run", "deep")], permission_keys: [], entitlement_key: null },
];

// ── Workflows (8), all module_key = underwriting ─────────────────────────────
const wf = (key: string, name: string, nodes: any[], edges: any[]): PackWorkflow => ({
  key, name, module_key: "underwriting", definition: { nodes, edges }, entitlement_key: key,
});
const gate = (id: string, types: string[]) => ({ id, kind: "gate", gate_types: types });
const agent = (id: string, agent_key: string) => ({ id, kind: "agent", agent_key });

export const UW_WORKFLOWS: PackWorkflow[] = [
  wf(w("intake"), "Intake",
    [agent("ingest", a("document")), agent("intake", a("intake")), gate("gate", [t("submission_summary")])],
    [{ from: "ingest", to: "intake" }, { from: "intake", to: "gate" }]),
  wf(w("exposurecapture"), "ExposureCapture",
    [agent("exposure", a("exposure")), gate("gate", [t("exposure")])], [{ from: "exposure", to: "gate" }]),
  wf(w("lossanalysis"), "LossAnalysis",
    [agent("loss", a("loss_analysis")), gate("gate", [t("loss_run")])], [{ from: "loss", to: "gate" }]),
  wf(w("riskassessment"), "RiskAssessment",
    [agent("rate", a("risk_rating")), gate("gate", [t("risk_factor")])], [{ from: "rate", to: "gate" }]),
  wf(w("pricing"), "Pricing",
    [agent("price", a("pricing")), gate("gate", [t("quote_option")])], [{ from: "price", to: "gate" }]),
  wf(w("referral"), "Referral",
    [agent("refer", a("referral")), gate("gate", [t("referral")])], [{ from: "refer", to: "gate" }]),
  wf(w("quoteassembly"), "QuoteAssembly",
    [agent("conditions", a("conditions")), agent("quote", a("quote")), gate("gate", [t("quote_letter"), t("condition")])],
    [{ from: "conditions", to: "quote" }, { from: "quote", to: "gate" }]),
  wf(w("brokerqueryloop"), "BrokerQueryLoop",
    [agent("draft", a("broker_query")), gate("gate", [t("uw_query")])], [{ from: "draft", to: "gate" }]),
];

// ── Personas (3) ─────────────────────────────────────────────────────────────
export const UW_PERSONAS: PackPersona[] = [
  { agent_key: a("underwriter"), scope: {}, deviation_kinds: [], is_default: true, sort_order: 0 },
  { agent_key: a("actuary"), scope: { module_keys: ["underwriting"], artifact_types: [t("exposure"), t("loss_run"), t("risk_factor"), t("quote_option")] }, deviation_kinds: ["flag", "request_review", "insert_review_gate"], is_default: false, sort_order: 10 },
  { agent_key: a("wordings"), scope: { module_keys: ["underwriting"], artifact_types: [t("submission_summary"), t("condition"), t("quote_letter")] }, deviation_kinds: ["flag", "request_review"], is_default: false, sort_order: 20 },
];

// ── Submission-pursuit lifecycle (branching, with authority referral, §2.1) ──
export const UW_LIFECYCLE = {
  key: "submission_pursuit", start: "received",
  transitions: [
    { from: "received", trigger_type: t("submission_summary"), required_permission: "artifact.confirm", to: "triaging" },
    { from: "triaging", trigger_type: t("risk_factor"), trigger_match: { appetite: "in" }, required_permission: "artifact.confirm", to: "quoting" },
    { from: "triaging", trigger_type: t("risk_factor"), trigger_match: { appetite: "out" }, required_permission: "artifact.confirm", to: "declined", terminal: true },
    { from: "quoting", trigger_type: t("quote_option"), required_permission: "artifact.confirm", to: "quoted" },
    { from: "quoting", trigger_type: t("referral"), trigger_match: { authority_breach: true }, required_permission: "artifact.confirm", to: "referred" },
    { from: "referred", trigger_type: t("referral"), trigger_match: { decision: "approved" }, required_permission: "uw.authorize", to: "quoted" },
    { from: "referred", trigger_type: t("referral"), trigger_match: { decision: "rejected" }, required_permission: "uw.authorize", to: "declined", terminal: true },
    { from: "quoted", trigger_type: t("uw_query"), required_permission: "artifact.confirm", to: "clarifying" },
    { from: "clarifying", trigger_type: t("uw_query"), trigger_match: { is_amendment: true }, required_permission: "artifact.confirm", to: "quoting" },
  ],
};

// ── Role template (6) + uw.authorize ─────────────────────────────────────────
const projectAll = ["project.create", "project.read", "project.read_all", "project.update", "project.archive", "project.member.manage"];
const artifactAll = ["artifact.read", "artifact.confirm", "artifact.edit"];
const workflowAll = ["workflow.read", "workflow.run"];
const libraryAll = ["library.read", "library.manage"];
const adminAll = ["admin.users", "admin.branding", "admin.settings"];

export const UW_ROLES: PackRole[] = [
  { key: "owner", name: "Owner", tier: "owner_admin", permissions: [...ALL_CORE_KEYS, "uw.authorize"] },
  { key: "admin", name: "Admin", tier: "owner_admin", permissions: [...projectAll, ...artifactAll, ...workflowAll, ...libraryAll, ...adminAll, "billing.view"] },
  { key: "underwriting_manager", name: "Underwriting Manager", tier: "owner_admin", permissions: [...projectAll, ...artifactAll, ...workflowAll, ...libraryAll, "uw.authorize"] },
  { key: "underwriter", name: "Underwriter", tier: "delivery", permissions: ["project.read", "artifact.read", "artifact.confirm", "artifact.edit", "workflow.read", "workflow.run", "library.read"] },
  { key: "uw_assistant", name: "UW Assistant", tier: "delivery", permissions: ["project.read", "artifact.read", "artifact.confirm", "workflow.read", "library.read"] },
  { key: "viewer", name: "Viewer", tier: "view", permissions: ["project.read", "artifact.read", "workflow.read", "library.read"] },
];

export const UW_PACK_PERMISSIONS = [
  { key: "uw.authorize", domain: "underwriting", description: "authorize a quote to bind or approve a referral" },
];
export const UW_LIBRARY_COLLECTIONS = ["rate_tables", "appetite_guide", "wordings_library", "precedent_quotes"];
export const UW_SETTINGS = { default_tier: "deep" as Tier, auto_accept_threshold: 0.9 };

export const UW_MODULES = [
  { key: "underwriting", label: "Underwriting", icon: "file-search", order: 80, description: "Triage, rate, price and quote a broker submission." },
];

export const UW_MANIFEST = {
  domain: "underwriting", version: "1.0.0",
  modules: UW_MODULES.map((m) => m.key),
  artifact_types: UW_ARTIFACT_TYPES.map((x) => x.key),
  agents: UW_AGENTS.map((x) => x.key),
  workflows: UW_WORKFLOWS.map((x) => x.key),
  personas: UW_PERSONAS.map((x) => x.agent_key),
  library_collections: UW_LIBRARY_COLLECTIONS,
  lifecycles: [UW_LIFECYCLE],
  role_template: UW_ROLES,
  permissions: UW_PACK_PERMISSIONS,
  settings: UW_SETTINGS,
};

export const UNDERWRITING_PACK = {
  key: "underwriting", name: "Underwriting", version: "1.0.0", manifest: UW_MANIFEST, modules: UW_MODULES,
  artifactTypes: UW_ARTIFACT_TYPES, agents: UW_AGENTS, workflows: UW_WORKFLOWS, personas: UW_PERSONAS,
  lifecycle: UW_LIFECYCLE, roles: UW_ROLES, packPermissions: UW_PACK_PERMISSIONS, settings: UW_SETTINGS,
  standardRules: [] as any[],
};

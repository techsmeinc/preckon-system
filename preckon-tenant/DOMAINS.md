# Preckon — Domains & the Add-a-Vertical Pipeline

Preckon Core is a **domain-neutral engine**. It knows nothing about construction or
underwriting — only about a single interface, **`DomainPack`**. A vertical is *data*:
one file that satisfies the contract, plus one line in the registry. This document is
the correct pipeline and implementation for building **domain-wise modules**.

---

## 1. The mental model

```
                          ┌─────────────────────────────────────────────┐
                          │                PRECKON CORE                  │   ← knows no domain
                          │  artifact store · ABI (4 syscalls) · runtime │
                          │  (gates/map/re-plan) · audit · entitlements  │
                          │  lifecycle engine · personas · standards     │
                          └───────────────▲──────────────▲──────────────┘
                                          │  DomainPack   │  DomainPack
                    ┌─────────────────────┴───┐      ┌────┴────────────────────┐
                    │  construction (7 modules)│      │  underwriting (1 module) │   ← data only
                    │  types·agents·workflows· │      │  types·agents·workflows· │
                    │  personas·lifecycle·roles│      │  personas·lifecycle·roles│
                    └──────────────────────────┘      └──────────────────────────┘
                             ▲                                   ▲
                    tenant bound domain_key=construction   domain_key=underwriting
```

- **A `DomainPack`** declares: **modules** (licensable capabilities), **artifact types**
  (+ JSON schemas), **agents** (typed I/O), **workflows** (DAGs over modules),
  **personas** (supervisors), a **lifecycle** (state machine), a **role template**, pack
  **permissions**, **settings**, and optional **standard rules**.
- **A tenant binds to exactly one domain** at provisioning (`tenant_bootstrap.domain_key`).
  Everything the tenant sees — modules, workflows, personas, lifecycle, roles — is that
  pack's data, resolved generically.
- **Namespacing** keeps packs collision-safe in the shared catalog (`underwriting.document`
  vs construction's `document`). Core matching is namespace-tolerant (short-key compare).

Contract: [`src/lib/pack/contract.ts`](src/lib/pack/contract.ts) · Registry:
[`src/lib/pack/registry.ts`](src/lib/pack/registry.ts).

---

## 2. Runtime pipeline (identical for every domain)

```
provision tenant (domain_key=X)  →  bootstrapTenant seeds X's roles/settings/entitlements
      │
start a run of an X workflow  →  deterministic runtime steps the DAG (Core, no domain logic)
      │                            agent step → enqueueJob → worker (stub or Claude) → emitArtifact
gate  →  awaiting_review  →  human confirms in Review queue  →  resumeGates + advanceLifecycle
      │
edit a confirmed artifact  →  markDownstreamStale  →  rerun-stale  (re-plan)
      │
Trace  →  provenance + producing job + audit  (defensible, any domain)
```

None of these steps contain a domain conditional. The **Standards engine** (validate the
graph against rules) and **personas** (chat + scoped review lens) are likewise generic.

---

## 3. Add a new vertical — 6 steps

Say you want **`legal` (contract review)**.

**Step 1 — write the pack.** Create `src/lib/pack/legal.ts` implementing `DomainPack`
(template below). Author locally; namespace keys with your domain prefix (`legal.`).

**Step 2 — register it.** In `src/lib/pack/registry.ts`:
```ts
import { LEGAL_PACK } from "./legal";
export const PACKS = { construction: ..., underwriting: ..., legal: LEGAL_PACK as any };
```

**Step 3 — worker stubs (or real Claude).** In `worker/src/agents.mjs`, add a `case` per
`job_type` your agents enqueue, returning schema-valid outputs (Claude path picks these up
as templates automatically). Add persona voices to `personaName`/`supervisorVoice`.

**Step 4 — (optional) frontend polish.** In `src/lib/catalog.tsx` add `MODULE_META`,
`MODULE_OUTPUTS`, and per-type `COLS` for nicer tables. Everything else (module nav,
lifecycle stepper, review, trace, colleagues) is already domain-driven and needs nothing.

**Step 5 — validate.** `npm test` runs the generic resolver over your pack
([`test/packs.test.ts`](test/packs.test.ts)) — it must pass with zero errors before Core
will seed it.

**Step 6 — provision a tenant on it.** Bootstrap with `domainKey: "legal"` (via the seed
script or the Host's tenant-create). Done — a full legal workspace, zero Core change.

Modules become licensable automatically (they flow into `MODULE_DISPLAY` from the pack).

---

## 4. The pack template (copy this)

```ts
// src/lib/pack/legal.ts
import { ALL_CORE_KEYS } from "./core";
import type { PackAgent, PackArtifactType, PackPersona, PackRole, PackWorkflow, Tier } from "./construction";

const D = "legal.";
const t = (k: string) => D + k;              // type key
const a = (k: string) => D + "agent." + k;   // agent key
const w = (k: string) => D + "workflow." + k;
const jt = (type: string, tier: Tier) => ({ type, tier, prompt_ref: `${type}@v1` });

export const LEGAL_MODULES = [
  { key: "contractreview", label: "ContractReview", icon: "file-text", order: 90,
    description: "Extract clauses, flag risk, and draft redlines." },
];

const SCHEMAS: Record<string, any> = {
  document: { type: "object", additionalProperties: false, required: ["file_id","doc_type","page_range"],
    properties: { file_id:{type:"string",format:"uuid"}, doc_type:{type:"string"}, title:{type:"string"},
      page_range:{type:"array",items:{type:"integer",minimum:1},minItems:2,maxItems:2} } },
  clause: { type: "object", additionalProperties: false, required: ["ref","text","risk"],
    properties: { ref:{type:"string"}, text:{type:"string"},
      risk:{type:"string",enum:["low","medium","high"]} } },
  // …more types
};
const REVIEWABLE: Record<string, boolean> = { document: false };

export const LEGAL_ARTIFACT_TYPES: PackArtifactType[] =
  Object.keys(SCHEMAS).map((k) => ({ key: t(k), name: k, payload_schema: SCHEMAS[k], is_reviewable: REVIEWABLE[k] ?? true }));

export const LEGAL_AGENTS: PackAgent[] = [
  { key: a("document"), name: "Document", kind: "worker", consumes: [], produces: [t("document")],
    job_types: [jt("legal.document.classify","standard")], permission_keys: ["artifact.read"], entitlement_key: null },
  { key: a("clause"), name: "Clause Extractor", kind: "worker", consumes: [t("document")], produces: [t("clause")],
    job_types: [jt("legal.clause.extract","deep")], permission_keys: [], entitlement_key: null },
  { key: a("legal_copilot"), name: "Legal Copilot", kind: "supervisor", consumes: ["*"], produces: [],
    job_types: [jt("legal_copilot.respond","deep"), jt("legal_copilot.review_run","deep")], permission_keys: [], entitlement_key: null },
];

const gate = (id: string, types: string[]) => ({ id, kind: "gate", gate_types: types });
const agent = (id: string, agent_key: string) => ({ id, kind: "agent", agent_key });
export const LEGAL_WORKFLOWS: PackWorkflow[] = [
  { key: w("contractreview"), name: "ContractReview", module_key: "contractreview", entitlement_key: w("contractreview"),
    definition: { nodes: [agent("ingest", a("document")), agent("clauses", a("clause")), gate("gate", [t("clause")])],
                  edges: [{ from:"ingest", to:"clauses" }, { from:"clauses", to:"gate" }] } },
];

export const LEGAL_PERSONAS: PackPersona[] = [
  { agent_key: a("legal_copilot"), scope: {}, deviation_kinds: [], is_default: true, sort_order: 0 },
];

export const LEGAL_LIFECYCLE = {
  key: "review_pursuit", start: "received",
  transitions: [
    { from: "received", trigger_type: t("clause"), required_permission: "artifact.confirm", to: "reviewing" },
  ],
};

export const LEGAL_ROLES: PackRole[] = [
  { key: "owner", name: "Owner", tier: "owner_admin", permissions: [...ALL_CORE_KEYS] },
  { key: "reviewer", name: "Reviewer", tier: "delivery",
    permissions: ["project.read","artifact.read","artifact.confirm","artifact.edit","workflow.read","workflow.run","library.read"] },
  { key: "viewer", name: "Viewer", tier: "view", permissions: ["project.read","artifact.read","workflow.read","library.read"] },
];

export const LEGAL_PACK = {
  key: "legal", name: "Legal Review", version: "1.0.0",
  manifest: { domain: "legal", version: "1.0.0", modules: LEGAL_MODULES.map(m=>m.key),
    artifact_types: LEGAL_ARTIFACT_TYPES.map(x=>x.key), agents: LEGAL_AGENTS.map(x=>x.key),
    workflows: LEGAL_WORKFLOWS.map(x=>x.key), personas: LEGAL_PERSONAS.map(x=>x.agent_key),
    lifecycles: [LEGAL_LIFECYCLE], role_template: LEGAL_ROLES, permissions: [], settings: { default_tier:"deep", auto_accept_threshold:0.9 } },
  modules: LEGAL_MODULES, artifactTypes: LEGAL_ARTIFACT_TYPES, agents: LEGAL_AGENTS,
  workflows: LEGAL_WORKFLOWS, personas: LEGAL_PERSONAS, lifecycle: LEGAL_LIFECYCLE,
  roles: LEGAL_ROLES, packPermissions: [], settings: { default_tier: "deep" as Tier, auto_accept_threshold: 0.9 },
  standardRules: [],
};
```

That's the entire vertical. `validatePack` will confirm it, and Core runs it unchanged.

---

## 5. What is Core (never edit per-domain) vs. what is a pack

| Core (generic — never per-domain) | Pack (data — per-domain) |
|---|---|
| store · ABI · runtime · audit · entitlements | artifact types + schemas |
| lifecycle engine (§1.6) | the lifecycle state machine |
| personas mechanism (§6) | the persona roster + scopes |
| standards engine (§rules) | the standard rules |
| RBAC mechanism + 18-key catalog | role template + permission adds |
| module display resolution | the module declarations |
| provisioning (`bootstrapTenant`) | which domain a tenant binds to |

If you ever find yourself adding a domain conditional inside `src/lib/*` (store, runtime,
abi, audit, entitlements, lifecycle, persona), that's a Core defect — the behaviour belongs
in the pack or in a generic mechanism. The generic-pack test guards this: both domains pass
the *same* resolver.

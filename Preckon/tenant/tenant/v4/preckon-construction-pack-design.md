# Preckon Construction Pack — Implementation Deck

**Document:** `preckon-construction-pack-design.md`
**Version:** 1.1 (complete — §0 scope + manifest, §1 personas, §2 bid-pursuit lifecycle, Appendices A–C)
**Status:** the first domain pack, authored against **Preckon Core v1.2** (generic ABI + the §1.6 project-lifecycle field). Complete, incl. tender management: the manifest (§0.4), the persona roster (§1), the **bid-pursuit lifecycle** (§2), the agents (Appendix A), the workflows (Appendix B), and the artifact types + ER + Host map (Appendix C).
**Framework:** `preckon-tenant-platform-design.md` v1.0 — the domain-neutral engine this deck plugs into. **This deck is pack data; it changes no Core table, endpoint, or ABI.**

> **Reference convention.** `§`-references (e.g. §3.1, §D.2) point to the **framework doc**. `Appendix`-references (A/B/C) are within *this* deck. Every key shown in short form (`agent.tender`, `boq_line`) is the construction-namespaced value (`construction.agent.tender`, `construction.boq_line`) per §D.3 — the manifest (§0.4) records the full keys.

---

## §0 — Scope & the pack contract

### §0.1 What this deck is

The **Construction pack**: the concrete instantiation that turns generic Preckon Core into a working preconstruction product. It is nothing but pack data (§D) — a single declared `domain` manifest plus the assets it names: an artifact-type vocabulary, nineteen agents (fifteen workers, a Knowledge service, and three supervisor personas), eleven workflows, a bid-pursuit lifecycle, a role template, and library collections. Core loads it without modification; adding this pack (or a legal-review pack tomorrow) is a data change, not an engineering change. That property is the whole point of §D, and this deck is the proof that Core earned it.

### §0.2 What a pack declares (§D.1)

A pack bundles exactly seven things. Each is specified in this deck at the location below:

| Bundle element | Written into (Core) | Specified here |
|---|---|---|
| **artifact types** — the schema vocabulary | §2.1 `artifact_type` registry | Appendix C |
| **agents** — I/O manifests + prompts/tools | §3.1 `agent` registry | **Appendix A** |
| **personas** — the supervisor roster (scope + authority + lens) | §6.4 + `supervisor_profile` | **§1** |
| **lifecycles** — the bid-pursuit state machine | §1.6 + `project.lifecycle_*` | **§2** |
| **workflows** — the DAG definitions | §4.1 `workflow` registry | Appendix B |
| **library collections** — reference kinds | §M.1 `library_entry` | §0.4 (`rate_book`, `standard`, `precedent_bid`, `template`) |
| **role template** — system roles + presets | §1.2, seeded at bootstrap (§D.4) | §0.5 |
| **permission additions** — beyond the Core 18 | §1.2 catalog | §0.5 (`bid.approve`) |
| **settings** — pack defaults | `tenant_setting` at bootstrap | §0.4 (`default_tier`, `auto_accept_threshold`) |

### §0.3 Inherited conventions (re-specified nowhere)

This deck inherits, unchanged, everything in the framework's §0 and §X: UUIDv7 keys, `timestamptz`, money as integer minor units, RLS tenant-scoping and the `withTenant()` seam, the append-only hash-chained audit spine, the review-queue/auto-accept mechanics (§2.5, §5.6), and — load-bearing here — the **ABI's four syscalls** (§3.2). Every agent below is expressible with `emitArtifact` / `readArtifacts` / `enqueueJob`+`onJobResult` / `requestReview` and nothing more. If any pack asset needed a fifth syscall or a new column, that would be a Core defect, not a pack feature.

### §0.4 The construction `domain` manifest

The authoritative declaration — one `domain` row (§D.2), full form of the framework's illustrative example:

```jsonc
{
  "domain": "construction",
  "version": "1.0.0",
  "artifact_types": [
    "construction.document", "construction.tender_summary", "construction.spec_clause",
    "construction.drawing_index", "construction.drawing_measurement", "construction.boq_line",
    "construction.cost_line", "construction.schedule_activity", "construction.procurement_package",
    "construction.rfi", "construction.compliance_item", "construction.proposal_doc",
    "construction.bid_decision", "construction.risk", "construction.bid_approval", "construction.client_query"
  ],
  "agents": [
    "construction.agent.document", "construction.agent.tender", "construction.agent.specification",
    "construction.agent.drawing", "construction.agent.boq", "construction.agent.cost",
    "construction.agent.schedule", "construction.agent.procurement", "construction.agent.rfi",
    "construction.agent.compliance", "construction.agent.proposal",
    "construction.agent.bid_qualification", "construction.agent.risk", "construction.agent.approval_prep", "construction.agent.clarification",
    "construction.agent.knowledge",
    "construction.agent.construction_copilot", "construction.agent.commercial",
    "construction.agent.compliance_lead"
  ],
  "workflows": [
    "construction.workflow.tenderlogix", "construction.workflow.doclogix",
    "construction.workflow.drawlogix", "construction.workflow.quantlogix",
    "construction.workflow.costlogix", "construction.workflow.schedulelogix",
    "construction.workflow.procurelogix",
    "construction.workflow.bidqualification", "construction.workflow.riskreview",
    "construction.workflow.bidassembly", "construction.workflow.clarificationloop"
  ],
  "personas": [
    "construction.agent.construction_copilot", "construction.agent.commercial",
    "construction.agent.compliance_lead"
  ],
  "library_collections": ["rate_book", "standard", "precedent_bid", "template"],
  "lifecycles": [ { "key": "bid_pursuit", "start": "received", "transitions": [ /* … see §2.1 … */ ] } ],
  "role_template": [
    { "key": "owner",        "name": "Owner",        "tier": "owner_admin", "permissions": ["*"] },
    { "key": "admin",        "name": "Admin",        "tier": "owner_admin", "permissions": ["project.*","artifact.*","workflow.*","library.*","admin.*","billing.view"] },
    { "key": "precon_lead",  "name": "Precon Lead",  "tier": "delivery",    "permissions": ["project.*","artifact.*","workflow.*","library.*","bid.approve"] },
    { "key": "estimator",    "name": "Estimator",    "tier": "delivery",    "permissions": ["project.read","artifact.read","artifact.confirm","artifact.edit","workflow.read","workflow.run","library.read"] },
    { "key": "qs_reviewer",  "name": "QS / Reviewer","tier": "review",      "permissions": ["project.read","artifact.read","artifact.confirm","artifact.edit","workflow.read","library.read"] },
    { "key": "viewer",       "name": "Viewer",       "tier": "view",        "permissions": ["project.read","artifact.read","workflow.read","library.read"] }
  ],
  "permissions": [ { "key": "bid.approve", "domain": "tender", "description": "authorize a tender for submission" } ],
  "settings": { "default_tier": "deep", "auto_accept_threshold": 0.9 }
}
```

The manifest **is** the source of truth: "what does this pack own?" reads these arrays, never string-parses keys. Consistency is checkable — every entry above resolves to an asset defined in this deck (Appendix A for agents, B for workflows, C for types).

### §0.5 The role template (the six construction personas)

Seeded at tenant bootstrap from `role_template` (§D.4) into `tenant_role` / `tenant_role_permission`. Core owns the mechanism and the 18-key permission catalog (§1.2); these personas are pack data — another domain ships its own. The presets, expanded against the Core catalog:

| Permission (Core catalog) | owner | admin | precon_lead | estimator | qs_reviewer | viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| project.create / update / archive / read_all / member.manage | ✓ | ✓ | ✓ | | | |
| project.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| artifact.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| artifact.confirm / edit | ✓ | ✓ | ✓ | ✓ | ✓ | |
| workflow.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workflow.run | ✓ | ✓ | ✓ | ✓ | | |
| library.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| library.manage | ✓ | ✓ | ✓ | | | |
| admin.users / branding / settings | ✓ | ✓ | | | | |
| billing.view | ✓ | ✓ | | | | |
| tenant.transfer_ownership | ✓ | | | | | |
| **bid.approve** *(pack add, §2)* | ✓ | | ✓ | | | |

The distinctions that carry the product: **estimator** runs workflows but **qs_reviewer** only confirms their output; **precon_lead** is project admin without tenant admin; **owner** alone transfers ownership; **bid.approve** (authorize submission, §2) is owner + precon_lead only. Tiers: `owner_admin` = {owner, admin}, `delivery` = {precon_lead, estimator}, `review` = {qs_reviewer}, `view` = {viewer}.

### §0.6 The chain → workflows → modules

The customer sees one continuous chain; internally it is seven workflows over one shared artifact graph (§4.5), each mapping to a Host-licensed `module_key` (§8). The **Document Agent** is the shared entry to every chain (ingestion, §7.4). Exact DAGs are Appendix B; the entitlement/Host map is Appendix C. Overview:

| Workflow key | `module_key` | Chain stage | Lead agent → terminal artifact |
|---|---|---|---|
| `workflow.tenderlogix` | `tenderlogix` | Tender | Tender → `tender_summary` (+ Proposal → `proposal_doc`) |
| `workflow.doclogix` | `doclogix` | Specs | Specification → `spec_clause` |
| `workflow.drawlogix` | `drawlogix` | Drawings | Drawing → `drawing_measurement` |
| `workflow.quantlogix` | `quantlogix` | BOQ | BOQ → `boq_line` |
| `workflow.costlogix` | `costlogix` | Estimate | Cost → `cost_line` |
| `workflow.schedulelogix` | `schedulelogix` | Schedule | Schedule → `schedule_activity` |
| `workflow.procurelogix` | `procurelogix` | Procurement | Procurement → `procurement_package` |

Because every run writes the same graph, a project accretes state across workflows: QuantLogix's confirmed `boq_line`s are read by a later CostLogix run without re-derivation (§4.5). The **Construction Copilot** (supervisor, §6) spans all of them; **Knowledge** (service) is called from within any of them.

---

## §1 — The persona roster (the digital company)

§6.4 (framework) generalizes the single Orchestrator to N supervisors; this is construction's roster — the "digital company." Each persona is a `kind = supervisor` agent (in Appendix A, produces nothing) plus a `supervisor_profile` (scope, deviation authority, lens) seeded at bootstrap from the manifest `personas` array (§0.4). Every persona **proposes; only a human disposes** (§6.4.2) — colleagues that advise, flag, and orchestrate, never sign. **Estimator and QS stay human roles** (§0.5); the roster does not clone them as deciders. Architects and engineers are *capability* work (worker agents in later pack versions), not personas.

### §1.1 The roster

| Persona (display) | Supervisor agent | Scope | Deviation authority | Default |
|---|---|:--|:--|:--:|
| **Construction Copilot** (Bid-Manager role) | `agent.construction_copilot` | whole run/project (`{}`) | all kinds | ✓ |
| **Commercial** | `agent.commercial` | costlogix · quantlogix · tenderlogix · procurelogix; `boq_line` · `cost_line` · `procurement_package` · `proposal_doc` | `flag` · `request_review` · `insert_review_gate` | |
| **Compliance Lead** | `agent.compliance_lead` | tenderlogix · doclogix; `tender_summary` · `spec_clause` · `compliance_item` · `proposal_doc` | `flag` · `request_review` | |

### §1.2 Per-persona

- **Construction Copilot / Bid-Manager role** (default, whole-pursuit). Scope `{}` — the entire run/project; the full deviation set. Voice: owns the pursuit end to end — keeps the chain moving, surfaces blockers, and cross-checks that the priced proposal reconciles with the BOQ, quantities are sane against takeoff, and no spec scope is missing. The customer-facing chat product and general colleague; the §6.2 whole-run supervisor. It also **walks the `bid_pursuit` lifecycle** (§2): at each state it proposes the next transition (via `request_review` + chat) for a human to confirm — propose, never dispose (§1.6). Jobs: `copilot.respond`, `copilot.review_run`.
- **Commercial** (margin & risk critic). Scope: the commercial slice. Authority: `flag` / `request_review` / `insert_review_gate` — it can raise concerns and force a human review before spend, but never rerun or skip. Voice: guards margin, cashflow, and pricing risk — challenges thin or missing rates, scope carried uncovered into the estimate, and unbalanced cash; flags a `cost_line` priced below a Library rate-book floor. Jobs: `commercial.respond`, `commercial.review_run`.
- **Compliance Lead** (submission & contractual critic — the Legal/QA colleague). Scope: the requirements slice. Authority: `flag` / `request_review` (review-only). Voice: checks that every mandatory submission requirement is covered by a `compliance_item`, that contractually-loaded spec clauses are addressed, and that the assembled proposal leaves nothing open; requests review before a submission gate. **Distinct from the Compliance *worker*** (`agent.compliance`), which *produces* `compliance_item`s — this persona *supervises coverage* across the run. Jobs: `compliance_lead.respond`, `compliance_lead.review_run`.

### §1.3 Profile seed (`supervisor_profile`, §6.4.4)

Written at bootstrap from `domain.manifest.personas`:

```sql
insert into supervisor_profile (agent_key, scope, deviation_kinds, is_default, sort_order) values
 ('construction.agent.construction_copilot', '{}'::jsonb, '[]'::jsonb, true, 0),
 ('construction.agent.commercial',
    '{"module_keys":["costlogix","quantlogix","tenderlogix","procurelogix"],"artifact_types":["boq_line","cost_line","procurement_package","proposal_doc"]}'::jsonb,
    '["flag","request_review","insert_review_gate"]'::jsonb, false, 10),
 ('construction.agent.compliance_lead',
    '{"module_keys":["tenderlogix","doclogix"],"artifact_types":["tender_summary","spec_clause","compliance_item","proposal_doc"]}'::jsonb,
    '["flag","request_review"]'::jsonb, false, 20);
```

`scope {}` = whole run; `deviation_kinds []` = all §6.1 kinds (§6.4.4).

### §1.4 Packaging

Personas gate transitively by `scope.module_keys` (§8): the base edition ships **Construction Copilot** (always available); **Commercial** and **Compliance Lead** are premium colleagues, licensed per edition. The org chart becomes a pricing surface — more colleagues, higher tier, the same deterministic spine underneath.

---

## §2 — The bid pursuit lifecycle

Tender management is a **lifecycle**, not a workflow. It rides on Core's generic project-lifecycle field (§1.6): Core stores an opaque `project.lifecycle_state`, this pack declares the machine, and the **Bid Manager** persona (§1) walks it. Every transition fires only when a human confirms the gating artifact with the required permission — propose-vs-dispose, at the pursuit level. This is the `lifecycles["bid_pursuit"]` manifest entry (§0.4).

### §2.1 States & transitions

```
received → qualifying ─(no-go)→ no_bid ▸
                    └─(go)→ bidding → approving → submitted → clarifying ⇄ (addendum → re-estimate)
                                          ↑                                    └→ won ▸ / lost ▸
```

Each transition is `{ from, trigger_type, trigger_match?, required_permission, to, terminal? }`:

| From | Trigger (confirmed artifact) | Permission | To |
|---|---|---|---|
| received | `tender_summary` | `artifact.confirm` | qualifying |
| qualifying | `bid_decision` (`decision = go`) | `artifact.confirm` | bidding |
| qualifying | `bid_decision` (`decision = no_go`) | `artifact.confirm` | **no_bid** ▸ |
| bidding | `proposal_doc` | `artifact.confirm` | approving |
| approving | `bid_approval` | **`bid.approve`** | submitted |
| submitted | `client_query` (first) | — | clarifying |
| clarifying | `client_query` (`is_addendum`) | `artifact.confirm` | bidding |
| submitted \| clarifying | `decision_outcome` (`won`) | `artifact.confirm` | **won** ▸ |
| submitted \| clarifying | `decision_outcome` (`lost`) | `artifact.confirm` | **lost** ▸ |

▸ = terminal. `trigger_match` selects on payload (e.g. `bid_decision.decision`). Rework — a rejected `bid_approval`, or an addendum — is handled by editing/re-planning (§2.3), not a distinct transition. Withdrawal (`admin.settings`) sends any non-terminal state to a terminal `withdrawn`.

### §2.2 How the Bid Manager walks it

At each state the Bid Manager reads `project.lifecycle_state`, and proposes the next move in chat + via `request_review` — "scope confirmed; I recommend **GO** (good fit, ~14% margin headroom, one high commercial risk) — start the estimate?" It never advances the state; a human confirming the gating artifact does, and Core's `advanceLifecycle` (§1.6) applies it. **No new deviation kind** — the closed set (§6.1) already covers it. **Commercial** weighs in at `bidding`/`approving`; **Compliance Lead** at `approving`/submission.

### §2.3 Addenda & re-plan

An inbound `client_query` with `is_addendum = true`, referencing scope artifacts, calls `markDownstreamStale` (§2.4 framework) → the affected `boq_line`/`cost_line`/… go `stale` → `rerunStale` re-derives only those (§4.4) → a fresh `bid_approval` is required before re-submission (the pursuit loops `clarifying → bidding → … → approving → submitted`). Re-plan, post-submission — the provenance graph earning its keep.

---

## §3 — Roadmap (this deck)

Complete, v1.1: manifest (§0.4), personas (§1), the **bid-pursuit lifecycle** (§2), agents (Appendix A: 19), workflows (Appendix B: 11, incl. the TenderLogix split), types + ER + Host map (Appendix C: 16). Tender management (the lifecycle, `bid.approve`, and its 4 types / 4 agents / 4 workflows) rides on Core v1.2's generic `project.lifecycle_*` field — the **only** Core surface it uses beyond the finished ABI (Appendix C.5).

---

## Appendix A — Agents

The nineteen agents that make Core a construction product — fifteen workers, the Knowledge service, and three supervisor **personas** (§1) — authored against the finished ABI (§3) — pack data, not Core. Each is one row in the `agent` registry (§3.1): a `kind`, typed I/O over the artifact-type vocabulary (§2.1; full schemas in Appendix C), the AI `job_types` it enqueues (§5), and its gating. Keys shown are short forms of their `construction.`-namespaced values (§D.3).

Two invariants from Core carry through every row: an agent touches only the four ABI syscalls, and the runtime — not the agent — emits, scopes, validates, and gates every output (§5.1). Agents are gated **transitively**: an agent is available iff some licensed workflow references it (§8), so `entitlement_key` is null on all of them and the `module_key` on the workflow (Appendix B) is the license seam.

### A.1 Roster

| Key | Name | Kind | Produces | Primary workflow → module |
|---|---|---|---|---|
| `agent.document` | Document | worker | `document` | (entry to every chain) |
| `agent.tender` | Tender | worker | `tender_summary` | TenderLogix → `tenderlogix` |
| `agent.specification` | Specification | worker | `spec_clause` | DocLogix → `doclogix` |
| `agent.drawing` | Drawing | worker | `drawing_index`, `drawing_measurement` | DrawLogix → `drawlogix` |
| `agent.boq` | BOQ | worker | `boq_line` | QuantLogix → `quantlogix` |
| `agent.cost` | Cost | worker | `cost_line` | CostLogix → `costlogix` |
| `agent.schedule` | Schedule | worker | `schedule_activity` | ScheduleLogix → `schedulelogix` |
| `agent.procurement` | Procurement | worker | `procurement_package` | ProcureLogix → `procurelogix` |
| `agent.rfi` | RFI | worker | `rfi` | cross-cutting |
| `agent.compliance` | Compliance | worker | `compliance_item` | cross-cutting |
| `agent.proposal` | Proposal | worker | `proposal_doc` | TenderLogix → `tenderlogix` |
| `agent.bid_qualification` | Bid Qualification | worker | `bid_decision` | BidQualification → `tenderlogix` |
| `agent.risk` | Risk | worker | `risk` | RiskReview / cross-cutting |
| `agent.approval_prep` | Approval Prep | worker | `bid_approval` | BidAssembly → `tenderlogix` |
| `agent.clarification` | Clarification | worker | `client_query` | ClarificationLoop → `tenderlogix` |
| `agent.knowledge` | Knowledge | service | *(none — returns context)* | all (called by agents) |
| `agent.construction_copilot` | Construction Copilot | supervisor | *(none — proposes deviations)* | all (the Orchestrator role, §6; default persona §1) |
| `agent.commercial` | Commercial | supervisor | *(none — persona; §1)* | premium — margin/risk lens |
| `agent.compliance_lead` | Compliance Lead | supervisor | *(none — persona; §1)* | premium — submission/legal lens |

### A.2 Per-agent I/O

Format: **consumes → produces** · *job_types (default tier)* · review behaviour.

- **Document** — file-page text (a Core ingestion input, not an artifact type; §7.4) **→ `document`** · *`document.classify_split` (standard)* · non-reviewable, auto-confirmed on emit (`document.is_reviewable = false`). Classifies and splits an ingested file into `document` artifacts carrying `file_id` + page range. The classification vocabulary (drawing / specification / tender letter / addendum) is pack data in the agent.
- **Tender** — `document` **→ `tender_summary`** · *`tender.extract_summary` (deep)* · reviewable proposal. The skeleton's scope-extraction step (§S).
- **Specification** — `document` **→ `spec_clause`** · *`spec.extract_clauses` (deep)* · reviewable. Pulls normative clauses (materials, tolerances, standards) from spec documents.
- **Drawing** — `document` **→ `drawing_index`, `drawing_measurement`** · *`drawing.index` (standard), `drawing.takeoff` (deep)* · reviewable. Indexes the sheet set, then measures quantities off page rasters (`file_page.raster_key`, §7.1). A **map** node fans takeoff out per drawing (§4.1).
- **BOQ** — `tender_summary`, `spec_clause`, `drawing_measurement` **→ `boq_line`** · *`boq.derive_lines` (deep)* · reviewable. Shared by TenderLogix (from `tender_summary`, §S) and QuantLogix (from measurements + clauses); defined once because I/O is workflow-independent (§2.1). May call **Knowledge** for precedent before proposing.
- **Cost** — `boq_line` + Library `rate_book` **→ `cost_line`** · *`cost.price_lines` (deep)* · reviewable. Provenance links each `cost_line` to its `boq_line` and the applied rate (§2.3); editing a rate re-plans downstream via the stale walk (§2.4).
- **Schedule** — `boq_line`, `cost_line` **→ `schedule_activity`** · *`schedule.build_programme` (deep)* · reviewable. Sequences activities with durations/dependencies from quantities and resources.
- **Procurement** — `boq_line`, `cost_line` **→ `procurement_package`** · *`procure.build_packages` (standard)* · reviewable. Groups scope into RFQ packages by trade/lead-time.
- **RFI** — `tender_summary`, `spec_clause`, `drawing_measurement` **→ `rfi`** · *`rfi.detect` (standard)* · reviewable. Detects ambiguities, gaps, and conflicts across the graph and raises clarification questions; cross-cutting, not tied to one workflow.
- **Compliance** — `tender_summary`, `spec_clause`, `proposal_doc` **→ `compliance_item`** · *`compliance.check` (deep)* · reviewable. Checks each mandatory requirement is addressed before submission.
- **Proposal** — `tender_summary`, `boq_line`, `cost_line`, `schedule_activity`, `procurement_package` **→ `proposal_doc`** · *`proposal.assemble` (deep)* · reviewable. Assembles the confirmed graph into the submittable bid; the chain's terminal artifact. Compliance runs **after** assembly (Appendix B.12): `proposal_doc` feeds Compliance, not the reverse — that is what keeps the DAG acyclic.
- **Bid Qualification** — `tender_summary`, `risk` **→ `bid_decision`** · *`bid.qualify` (deep)* · reviewable. Recommends **go / no-go / conditional** with signals (fit, capacity, competition, margin headroom); a human decides at the qualifying gate (§2).
- **Risk** — `tender_summary`, `spec_clause`, `drawing_measurement`, `boq_line`, `cost_line` **→ `risk`** · *`risk.assess` (deep)* · reviewable. Registers commercial/technical/programme risks with likelihood, impact, mitigation; feeds `bid_decision` and `bid_approval`; the artifact **Commercial** watches.
- **Approval Prep** — `proposal_doc`, `cost_line`, `risk`, `compliance_item` **→ `bid_approval`** · *`approval.prepare` (deep)* · reviewable. Assembles the submission summary (amount, margin, key risks, compliance status) for sign-off; confirming it requires **`bid.approve`** (§2).
- **Clarification** — `client_query` (inbound), `tender_summary`, `spec_clause`, `boq_line`, `proposal_doc` **→ `client_query`** (outbound) · *`clarification.draft` (deep)* · reviewable. Drafts the answer to a client question; a human confirms before it is sent. An `is_addendum` inbound triggers re-plan (§2.3).
- **Knowledge** (service) — query-driven; calls Core semantic search over `chunk` (project graph + uploaded docs + Library, §7.3) **→ retrieved context** · *`knowledge.search` (routing)* · emits no artifact. Not a pipeline node; other agents invoke it (e.g. BOQ asking for precedent). Requires `artifact.read` on the caller's behalf.
- **Construction Copilot** (supervisor) — whole-run visibility over the run's artifacts and steps **→ deviations + chat** · *`copilot.respond` (deep), `copilot.review_run` (deep)* · emits no artifact. Fills the domain-neutral `Orchestrator` role (§6): cross-checks a run and proposes **deviations** from the closed set (rerun / insert-gate / skip / request-review / flag); a human approves, the runtime applies (§6.1). The one construction-named element on the platform, itself userland.
- **Commercial** (supervisor persona, §1) — scoped whole-run visibility over cost/BOQ/procurement artifacts **→ deviations** (`flag` / `request_review` / `insert_review_gate`) · *`commercial.respond`, `commercial.review_run` (deep)* · emits no artifact. Margin/cashflow/risk critic; scope and voice in §1.2.
- **Compliance Lead** (supervisor persona, §1) — scoped whole-run visibility over tender/spec/compliance artifacts **→ deviations** (`flag` / `request_review`) · *`compliance_lead.respond`, `compliance_lead.review_run` (deep)* · emits no artifact. Submission-requirements + contractual critic; **distinct from the Compliance worker** (`agent.compliance`), which produces `compliance_item`. See §1.2.

### A.3 Wiring rules

- **Type-checked at registration.** The workflow resolver (§4.1) verifies each agent node's `consumes` is reachable from upstream `produces`; a mis-wired pack workflow fails to register, not at runtime.
- **Reviewable vs canonical.** Only `document` is non-reviewable — every derived artifact is a proposal that a human confirms (or auto-accepts above threshold, §5.6). This is the human-in-the-loop line, expressed as pack data.
- **No new Core surface.** Every agent above is expressible with the existing four syscalls (supervisor personas via the §6.1 context/result shape — still no fifth syscall), the existing `agent` columns, and the sixteen seeded artifact types. Adding the eighth workflow product later is another registry row, not a Core change — the property §D exists to guarantee.

---

## Appendix B — Workflows

The seven Logix as `workflow` rows (§4.1) — each a `definition` (nodes + edges) wiring the Appendix A agents over one shared project graph (§4.5). A workflow changes no Core code; it is a registered definition. Keys are short forms of their `construction.`-namespaced values (§D.3).

### B.0 Conventions & the resolver over the shared graph

- **Node kinds** (§4.1): `agent` (runs an agent), `gate` (`gate_types` that must be `confirmed` to pass), `map` (`over` a type — fans one child per artifact; the fan-in reads all children, §4.3). Every workflow **ends at a review gate** — the human-in-the-loop confirm that makes its outputs canonical for downstream.
- **Gate placement** follows §4.1: approve scope *before* spending downstream cycles, not only at the end.
- **The resolver over the shared graph.** §4.1 type-checks each agent node's `consumes` against producers reachable upstream — evaluated against the **project graph the run will see**, which includes artifacts from prior workflow runs (§4.5), not only nodes in this one DAG. A workflow registers iff every `consumes` type is producible by some confirmed source reachable at run time — an upstream node here, **or** a type another licensed workflow produces into the shared graph. A type no licensed workflow produces is a hard registration error. This is what makes cross-workflow composition first-class: CostLogix's `cost` node reads `boq_line` that QuantLogix produced, without QuantLogix being wired into CostLogix.
- Each row also carries `module_key` (the Host-licensed capability, §8) and `entitlement_key = workflow.<key>`.

### B.1 TenderLogix — the walking skeleton (§S)

The minimal end-to-end slice that *defines* the ABI: one upload, two agents, two gates, a re-plan. Registered as the first workflow; production TenderLogix (B.2) splits the BOQ step out into QuantLogix.

```json
{
  "key": "workflow.tenderlogix.skeleton",
  "name": "TenderLogix (walking skeleton)",
  "module_key": "tenderlogix",
  "definition": {
    "nodes": [
      { "id": "ingest",     "kind": "agent", "agent_key": "agent.document" },
      { "id": "tender",     "kind": "agent", "agent_key": "agent.tender" },
      { "id": "gate_scope", "kind": "gate",  "gate_types": ["tender_summary"] },
      { "id": "boq",        "kind": "agent", "agent_key": "agent.boq" },
      { "id": "gate_boq",   "kind": "gate",  "gate_types": ["boq_line"] }
    ],
    "edges": [
      { "from": "ingest", "to": "tender" },
      { "from": "tender", "to": "gate_scope" },
      { "from": "gate_scope", "to": "boq" },
      { "from": "boq", "to": "gate_boq" }
    ]
  }
}
```

Walk: upload one tender PDF → **Document** classifies → **Tender** proposes a `tender_summary` → **gate** (a human confirms scope) → **BOQ** proposes 2–3 `boq_line`s from the *confirmed* summary → **gate**. Editing the confirmed `tender_summary` marks the BOQ lines `stale` (§2.4); re-running the BOQ step supersedes them. This exercises all four syscalls, versioning, provenance, stale-propagation, the gate pause/resume, and RLS — the whole ABI, and nothing it doesn't need.

### B.2 TenderLogix — intake

Tender analysis only. Under the bid-pursuit lifecycle (§2) the proposal / compliance / approval tail moved to **BidAssembly** (B.12) — keeping it fused would span two lifecycle stages and re-create a monolith.

```json
{
  "key": "workflow.tenderlogix",
  "name": "TenderLogix",
  "module_key": "tenderlogix",
  "definition": {
    "nodes": [
      { "id": "ingest",     "kind": "agent", "agent_key": "agent.document" },
      { "id": "tender",     "kind": "agent", "agent_key": "agent.tender" },
      { "id": "gate_scope", "kind": "gate",  "gate_types": ["tender_summary"] }
    ],
    "edges": [
      { "from": "ingest", "to": "tender" },
      { "from": "tender", "to": "gate_scope" }
    ]
  }
}
```

Ingest → **Tender** → gate. Confirming `tender_summary` advances the pursuit `received → qualifying` (§2). `agent.rfi` runs on-demand across the pursuit (not a fixed node), emitting clarification `rfi`s.

### B.3 DocLogix

```json
{
  "key": "workflow.doclogix",
  "name": "DocLogix",
  "module_key": "doclogix",
  "definition": {
    "nodes": [
      { "id": "ingest", "kind": "agent", "agent_key": "agent.document" },
      { "id": "spec",   "kind": "agent", "agent_key": "agent.specification" },
      { "id": "gate",   "kind": "gate",  "gate_types": ["spec_clause"] }
    ],
    "edges": [
      { "from": "ingest", "to": "spec" },
      { "from": "spec", "to": "gate" }
    ]
  }
}
```

Ingest specification documents → **Specification** extracts normative `spec_clause`s → gate.

### B.4 DrawLogix

Index the sheet set, then take off quantities **per sheet** via a `map` (§4.3).

```json
{
  "key": "workflow.drawlogix",
  "name": "DrawLogix",
  "module_key": "drawlogix",
  "definition": {
    "nodes": [
      { "id": "ingest",    "kind": "agent", "agent_key": "agent.document" },
      { "id": "index",     "kind": "agent", "agent_key": "agent.drawing" },
      { "id": "gate_idx",  "kind": "gate",  "gate_types": ["drawing_index"] },
      { "id": "map_sheets","kind": "map",   "over": "drawing_index" },
      { "id": "takeoff",   "kind": "agent", "agent_key": "agent.drawing" },
      { "id": "gate_meas", "kind": "gate",  "gate_types": ["drawing_measurement"] }
    ],
    "edges": [
      { "from": "ingest", "to": "index" },
      { "from": "index", "to": "gate_idx" },
      { "from": "gate_idx", "to": "map_sheets" },
      { "from": "map_sheets", "to": "takeoff" },
      { "from": "takeoff", "to": "gate_meas" }
    ]
  }
}
```

**Drawing** (index job) catalogues sheets → `drawing_index`; confirming it fans `map_sheets` into one `takeoff` child per sheet (each measuring off `file_page.raster_key`, §7.1) → `drawing_measurement`; `gate_meas` fans in.

### B.5 QuantLogix

```json
{
  "key": "workflow.quantlogix",
  "name": "QuantLogix",
  "module_key": "quantlogix",
  "definition": {
    "nodes": [
      { "id": "boq",  "kind": "agent", "agent_key": "agent.boq" },
      { "id": "gate", "kind": "gate",  "gate_types": ["boq_line"] }
    ],
    "edges": [ { "from": "boq", "to": "gate" } ]
  }
}
```

**Prerequisites (shared graph):** confirmed `drawing_measurement` (DrawLogix) + `spec_clause` (DocLogix), optionally `tender_summary`. **BOQ** derives `boq_line`s → gate.

### B.6 CostLogix

```json
{
  "key": "workflow.costlogix",
  "name": "CostLogix",
  "module_key": "costlogix",
  "definition": {
    "nodes": [
      { "id": "cost", "kind": "agent", "agent_key": "agent.cost" },
      { "id": "gate", "kind": "gate",  "gate_types": ["cost_line"] }
    ],
    "edges": [ { "from": "cost", "to": "gate" } ]
  }
}
```

**Prerequisites:** confirmed `boq_line` (QuantLogix) + Library `rate_book`. **Cost** prices each line → `cost_line`; provenance links line + applied rate, so a rate edit re-plans downstream (§2.4).

### B.7 ScheduleLogix

```json
{
  "key": "workflow.schedulelogix",
  "name": "ScheduleLogix",
  "module_key": "schedulelogix",
  "definition": {
    "nodes": [
      { "id": "schedule", "kind": "agent", "agent_key": "agent.schedule" },
      { "id": "gate",     "kind": "gate",  "gate_types": ["schedule_activity"] }
    ],
    "edges": [ { "from": "schedule", "to": "gate" } ]
  }
}
```

**Prerequisites:** confirmed `boq_line` + `cost_line`. **Schedule** sequences `schedule_activity`s → gate.

### B.8 ProcureLogix

```json
{
  "key": "workflow.procurelogix",
  "name": "ProcureLogix",
  "module_key": "procurelogix",
  "definition": {
    "nodes": [
      { "id": "procure", "kind": "agent", "agent_key": "agent.procurement" },
      { "id": "gate",    "kind": "gate",  "gate_types": ["procurement_package"] }
    ],
    "edges": [ { "from": "procure", "to": "gate" } ]
  }
}
```

**Prerequisites:** confirmed `boq_line` + `cost_line`. **Procurement** groups scope into `procurement_package`s by trade/lead-time → gate.

### B.9 The chain as composition

No workflow references another; they compose only through the shared graph (§4.5). A typical pursuit accretes state in this order — DrawLogix + DocLogix (independent) → QuantLogix → CostLogix → { ScheduleLogix, ProcureLogix } → TenderLogix (assembly) — but a project runs whichever it is licensed for, in any order the graph allows. The persona scopes (§1) map straight onto this: **Commercial** watches the QuantLogix→CostLogix→ProcureLogix artifacts; **Compliance Lead** watches TenderLogix + DocLogix; **Construction Copilot** spans all.

---

### B.10 BidQualification  *(lifecycle: qualifying)*

```json
{ "key": "workflow.bidqualification", "name": "BidQualification", "module_key": "tenderlogix",
  "definition": { "nodes": [
    { "id": "risk_scan", "kind": "agent", "agent_key": "agent.risk" },
    { "id": "qualify",   "kind": "agent", "agent_key": "agent.bid_qualification" },
    { "id": "gate",      "kind": "gate",  "gate_types": ["bid_decision"] } ],
    "edges": [ {"from":"risk_scan","to":"qualify"}, {"from":"qualify","to":"gate"} ] } }
```

**Prereq:** confirmed `tender_summary`. A fast **Risk** scan feeds **Bid Qualification** → `bid_decision`; confirming it advances `qualifying → bidding` (go) or `→ no_bid` (§2).

### B.11 RiskReview  *(lifecycle: bidding)*

```json
{ "key": "workflow.riskreview", "name": "RiskReview", "module_key": "tenderlogix",
  "definition": { "nodes": [
    { "id": "risk", "kind": "agent", "agent_key": "agent.risk" },
    { "id": "gate", "kind": "gate",  "gate_types": ["risk"] } ],
    "edges": [ {"from":"risk","to":"gate"} ] } }
```

**Prereq:** the estimate artifacts. The full **Risk** register across scope + estimate — the surface **Commercial** watches.

### B.12 BidAssembly  *(lifecycle: bidding → approving)*

The old TenderLogix tail, now its own workflow.

```json
{ "key": "workflow.bidassembly", "name": "BidAssembly", "module_key": "tenderlogix",
  "definition": { "nodes": [
    { "id": "proposal",   "kind": "agent", "agent_key": "agent.proposal" },
    { "id": "compliance", "kind": "agent", "agent_key": "agent.compliance" },
    { "id": "approval",   "kind": "agent", "agent_key": "agent.approval_prep" },
    { "id": "gate",       "kind": "gate",  "gate_types": ["proposal_doc","compliance_item","bid_approval"] } ],
    "edges": [ {"from":"proposal","to":"compliance"}, {"from":"compliance","to":"approval"}, {"from":"approval","to":"gate"} ] } }
```

**Proposal** assembles the bid from the confirmed graph → **Compliance** checks coverage of the assembled bid → **Approval Prep** builds the `bid_approval` summary. Confirming `proposal_doc` advances `bidding → approving`; confirming `bid_approval` with **`bid.approve`** advances `approving → submitted` (§2). The **Compliance Lead** persona reviews coverage at this gate.

### B.13 ClarificationLoop  *(lifecycle: clarifying — event-driven)*

```json
{ "key": "workflow.clarificationloop", "name": "ClarificationLoop", "module_key": "tenderlogix",
  "definition": { "nodes": [
    { "id": "draft", "kind": "agent", "agent_key": "agent.clarification" },
    { "id": "gate",  "kind": "gate",  "gate_types": ["client_query"] } ],
    "edges": [ {"from":"draft","to":"gate"} ] } }
```

**Not one long run** (§2.3): each inbound `client_query` spawns a fresh short run (`draft → gate`) producing the confirmed outbound answer. An `is_addendum` inbound additionally marks referenced scope `stale` → re-estimate → re-approve.

---

## Appendix C — Artifact types, ER reconciliation & Host map

The twelve construction artifact types: their `payload_schema`s (§2.1), how they reconcile against Core's fixed `artifact` model, and the workflow↔`module_key` map the Host licenses against. Like everything in this deck, it is data on Core's generic tables — **no new table**.

### C.1 The type registry (seed)

Each row seeds `artifact_type` (§2.1). `is_reviewable = false` means the agent's output is canonical on emit (skips the review queue); everything else is a proposal a human confirms. **Derives-from** is the provenance (§2.3) — and, as C.3 shows, it *is* the domain's ER.

| `type_key` | Reviewable | Producer | Derives from (provenance) | Key payload fields |
|---|:--:|---|---|---|
| `document` | no | Document | *(a `file`)* | `file_id`, `doc_type`, `page_range` |
| `tender_summary` | yes | Tender | `document` | `submission_deadline`, `submission_format`, `mandatory_requirements[]` |
| `spec_clause` | yes | Specification | `document` | `section`, `clause_ref`, `text`, `standards[]` |
| `drawing_index` | yes | Drawing | `document` | `sheet_no`, `title`, `discipline` |
| `drawing_measurement` | yes | Drawing | `drawing_index` | `item`, `quantity`, `unit` |
| `boq_line` | yes | BOQ | `drawing_measurement`, `spec_clause`, `tender_summary` | `code`, `description`, `quantity`, `unit` |
| `cost_line` | yes | Cost | `boq_line` (+ Library `rate_book`) | `rate_minor`, `amount_minor`, `currency` |
| `schedule_activity` | yes | Schedule | `boq_line`, `cost_line` | `activity`, `duration_days`, `predecessors[]` |
| `procurement_package` | yes | Procurement | `boq_line`, `cost_line` | `package_name`, `trade`, `boq_codes[]` |
| `rfi` | yes | RFI | `tender_summary`, `spec_clause`, `drawing_measurement` | `subject`, `question`, `severity` |
| `compliance_item` | yes | Compliance | `tender_summary`, `spec_clause`, `proposal_doc` | `requirement_ref`, `status` |
| `proposal_doc` | yes | Proposal | `tender_summary`, `boq_line`, `cost_line`, `schedule_activity`, `procurement_package` | `title`, `sections[]`, `total_amount_minor` |
| `bid_decision` | yes | Bid Qualification | `tender_summary`, `risk` | `decision`, `rationale`, `signals` |
| `risk` | yes | Risk | scope + estimate | `category`, `likelihood`, `impact`, `mitigation` |
| `bid_approval` | yes | Approval Prep | `proposal_doc`, `cost_line`, `risk`, `compliance_item` | `total_amount_minor`, `margin_pct`, `approved_by` |
| `client_query` | yes | Clarification | *(inbound)* + graph | `direction`, `subject`, `body`, `is_addendum` |

### C.2 Payload schemas

Each is the JSON Schema (`payload_schema`) Core validates a payload against on `emitArtifact` (§5.1). Money is **integer minor units** (§X); inter-artifact references in a payload are soft (`file_id`, `evidence_artifact_ids`) — Core treats the payload as opaque `jsonb`, the pack owns its shape.

```json
{ "$id": "document", "type": "object", "additionalProperties": false,
  "required": ["file_id", "doc_type", "page_range"],
  "properties": {
    "file_id": { "type": "string", "format": "uuid" },
    "doc_type": { "type": "string", "enum": ["drawing","specification","tender_letter","addendum","boq","schedule","other"] },
    "title": { "type": "string" },
    "page_range": { "type": "array", "items": { "type": "integer", "minimum": 1 }, "minItems": 2, "maxItems": 2 } } }
```
```json
{ "$id": "tender_summary", "type": "object", "additionalProperties": false,
  "required": ["submission_deadline", "submission_format", "mandatory_requirements"],
  "properties": {
    "submission_deadline": { "type": "string", "format": "date-time" },
    "submission_format": { "type": "string" },
    "project_name": { "type": "string" },
    "client": { "type": "string" },
    "scope_summary": { "type": "string" },
    "mandatory_requirements": { "type": "array", "items": {
      "type": "object", "required": ["ref","text"],
      "properties": { "ref": { "type": "string" }, "text": { "type": "string" } } } } } }
```
```json
{ "$id": "spec_clause", "type": "object", "additionalProperties": false,
  "required": ["section", "clause_ref", "text"],
  "properties": {
    "section": { "type": "string" }, "clause_ref": { "type": "string" }, "title": { "type": "string" },
    "text": { "type": "string" }, "is_normative": { "type": "boolean" },
    "standards": { "type": "array", "items": { "type": "string" } } } }
```
```json
{ "$id": "drawing_index", "type": "object", "additionalProperties": false,
  "required": ["sheet_no", "title", "file_id", "page_no"],
  "properties": {
    "sheet_no": { "type": "string" }, "title": { "type": "string" },
    "discipline": { "type": "string", "enum": ["architectural","structural","civil","mechanical","electrical","plumbing","other"] },
    "revision": { "type": "string" }, "scale": { "type": "string" },
    "file_id": { "type": "string", "format": "uuid" }, "page_no": { "type": "integer", "minimum": 1 } } }
```
```json
{ "$id": "drawing_measurement", "type": "object", "additionalProperties": false,
  "required": ["sheet_no", "item", "quantity", "unit"],
  "properties": {
    "sheet_no": { "type": "string" }, "item": { "type": "string" },
    "quantity": { "type": "number", "minimum": 0 },
    "unit": { "type": "string", "enum": ["m","m2","m3","nr","kg","t","lm"] },
    "location": { "type": "string" }, "method": { "type": "string" } } }
```
```json
{ "$id": "boq_line", "type": "object", "additionalProperties": false,
  "required": ["code", "description", "quantity", "unit"],
  "properties": {
    "code": { "type": "string" }, "description": { "type": "string" },
    "quantity": { "type": "number", "minimum": 0 }, "unit": { "type": "string" },
    "trade": { "type": "string" }, "notes": { "type": "string" } } }
```
```json
{ "$id": "cost_line", "type": "object", "additionalProperties": false,
  "required": ["boq_code", "rate_minor", "amount_minor", "currency"],
  "properties": {
    "boq_code": { "type": "string" },
    "rate_minor": { "type": "integer", "minimum": 0 },
    "amount_minor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "rate_source": { "type": "string" }, "rate_book_ref": { "type": "string" } } }
```
```json
{ "$id": "schedule_activity", "type": "object", "additionalProperties": false,
  "required": ["activity", "duration_days", "predecessors"],
  "properties": {
    "activity": { "type": "string" }, "wbs": { "type": "string" },
    "duration_days": { "type": "number", "minimum": 0 },
    "predecessors": { "type": "array", "items": { "type": "string" } },
    "start_offset_days": { "type": "integer" }, "trade": { "type": "string" } } }
```
```json
{ "$id": "procurement_package", "type": "object", "additionalProperties": false,
  "required": ["package_name", "trade", "boq_codes"],
  "properties": {
    "package_name": { "type": "string" }, "trade": { "type": "string" },
    "boq_codes": { "type": "array", "items": { "type": "string" } },
    "estimated_value_minor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "lead_time_weeks": { "type": "number", "minimum": 0 } } }
```
```json
{ "$id": "rfi", "type": "object", "additionalProperties": false,
  "required": ["subject", "question", "severity"],
  "properties": {
    "subject": { "type": "string" }, "question": { "type": "string" },
    "severity": { "type": "string", "enum": ["low","medium","high","critical"] },
    "references": { "type": "array", "items": { "type": "string" } },
    "raised_against": { "type": "string" } } }
```
```json
{ "$id": "compliance_item", "type": "object", "additionalProperties": false,
  "required": ["requirement_ref", "status"],
  "properties": {
    "requirement_ref": { "type": "string" }, "requirement_text": { "type": "string" },
    "status": { "type": "string", "enum": ["met","partial","not_met","not_applicable"] },
    "evidence_artifact_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } },
    "note": { "type": "string" } } }
```
```json
{ "$id": "proposal_doc", "type": "object", "additionalProperties": false,
  "required": ["title", "sections", "total_amount_minor", "currency"],
  "properties": {
    "title": { "type": "string" },
    "sections": { "type": "array", "items": {
      "type": "object", "required": ["heading","body"],
      "properties": { "heading": { "type": "string" }, "body": { "type": "string" } } } },
    "total_amount_minor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "submission_ready": { "type": "boolean" } } }
```

```json
{ "$id": "bid_decision", "type": "object", "additionalProperties": false,
  "required": ["decision", "rationale"],
  "properties": {
    "decision": { "type": "string", "enum": ["go","no_go","conditional"] },
    "rationale": { "type": "string" },
    "signals": { "type": "object", "properties": {
      "fit": { "type": "string", "enum": ["low","med","high"] },
      "capacity": { "type": "string", "enum": ["low","med","high"] },
      "competition": { "type": "string", "enum": ["low","med","high"] },
      "margin_headroom_pct": { "type": "number" } } },
    "conditions": { "type": "array", "items": { "type": "string" } } } }
```
```json
{ "$id": "risk", "type": "object", "additionalProperties": false,
  "required": ["category", "title", "likelihood", "impact"],
  "properties": {
    "category": { "type": "string", "enum": ["commercial","technical","programme","contractual","external"] },
    "title": { "type": "string" }, "description": { "type": "string" },
    "likelihood": { "type": "string", "enum": ["low","med","high"] },
    "impact": { "type": "string", "enum": ["low","med","high"] },
    "mitigation": { "type": "string" }, "owner_role": { "type": "string" },
    "status": { "type": "string", "enum": ["open","mitigating","closed","accepted"] } } }
```
```json
{ "$id": "bid_approval", "type": "object", "additionalProperties": false,
  "required": ["total_amount_minor", "currency", "margin_pct", "recommendation"],
  "properties": {
    "total_amount_minor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "margin_pct": { "type": "number" },
    "key_risk_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } },
    "compliance_status": { "type": "string", "enum": ["clear","open_items","blocked"] },
    "recommendation": { "type": "string" },
    "conditions": { "type": "array", "items": { "type": "string" } },
    "approved_by": { "type": "string", "format": "uuid" } } }
```
```json
{ "$id": "client_query", "type": "object", "additionalProperties": false,
  "required": ["direction", "subject", "body", "status"],
  "properties": {
    "direction": { "type": "string", "enum": ["inbound","outbound"] },
    "subject": { "type": "string" }, "body": { "type": "string" },
    "references": { "type": "array", "items": { "type": "string", "format": "uuid" } },
    "is_addendum": { "type": "boolean" },
    "status": { "type": "string", "enum": ["open","answered","closed"] } } }
```

### C.3 ER reconciliation — the graph *is* the ER

Core's data model for domain content is fixed and generic: one `artifact` row per value (§2.2), one `artifact_provenance` edge per derivation (§2.3). The construction "entity–relationship model" therefore needs **no construction tables** — it is expressed entirely as:

- **Entities → `artifact` rows.** Each of the twelve types is `artifact.type_key`; its columns (`payload`, `status`, `version`, `confidence`, `source`, `confirmed_by`) are Core's, and the C.2 schema governs only `payload`. A `boq_line` is not a `boq_line` table — it is an `artifact` with `type_key = 'construction.boq_line'` and a schema-valid payload.
- **Relationships → `artifact_provenance` edges**, not foreign keys. The **Derives-from** column of C.1 is the ER diagram: `document → {tender_summary, spec_clause, drawing_index} → drawing_measurement → boq_line → cost_line → {schedule_activity, procurement_package}`, with `proposal_doc` fanning in from the estimate branch and `compliance_item` derived from `proposal_doc`. That edge set is what drives re-plan (§2.4): edit a confirmed `spec_clause` and every downstream `boq_line`/`cost_line`/… goes `stale`.
- **Cross-references inside payloads are soft.** `file_id`, `evidence_artifact_ids`, `boq_code` are values in opaque `jsonb`; Core enforces no FK on them — the pack owns payload integrity, Core owns the artifact/provenance spine. This is the domain line (§0.1) at the data layer.
- **Money and units.** All monetary fields are `*_minor` integers (§X); quantities carry an explicit `unit`. No floats, no implicit currency.

The reconciliation, in one line: **Core supplies the nouns (artifact) and the verbs (provenance); the pack supplies the vocabulary (type keys + schemas). There is nothing else to model.**

### C.4 Host map — workflow ↔ `module_key` (entitlements)

The Host licenses **`module_key`s**; the tenant plane resolves the rest (§8). This is the tenant-side map:

| Workflow | `module_key` | `entitlement_key` |
|---|---|---|
| `workflow.tenderlogix` (+ `.skeleton`) | `tenderlogix` | `workflow.tenderlogix` |
| `workflow.doclogix` | `doclogix` | `workflow.doclogix` |
| `workflow.drawlogix` | `drawlogix` | `workflow.drawlogix` |
| `workflow.quantlogix` | `quantlogix` | `workflow.quantlogix` |
| `workflow.costlogix` | `costlogix` | `workflow.costlogix` |
| `workflow.schedulelogix` | `schedulelogix` | `workflow.schedulelogix` |
| `workflow.procurelogix` | `procurelogix` | `workflow.procurelogix` |
| `workflow.bidqualification` | `tenderlogix` | `workflow.bidqualification` |
| `workflow.riskreview` | `tenderlogix` | `workflow.riskreview` |
| `workflow.bidassembly` | `tenderlogix` | `workflow.bidassembly` |
| `workflow.clarificationloop` | `tenderlogix` | `workflow.clarificationloop` |

**Resolution (§8).** The Host returns `licensed_modules` (a subset of the seven). The tenant plane resolves licensed **workflows** where `workflow.module_key ∈ licensed_modules`, and — transitively — the **agents** those workflows reference (Appendix A) and the **personas** whose `scope.module_keys` intersect the licensed set (§1, §6.4):

- **Agents** are available iff a licensed workflow uses them; the always-on **Knowledge** service and the **Construction Copilot** persona ride along whenever any module is licensed.
- **Commercial** persona lights up with any of `{costlogix, quantlogix, tenderlogix, procurelogix}`; **Compliance Lead** with any of `{tenderlogix, doclogix}` — so the roster scales with the edition, per §1.4.

The Host-side model (edition → `module_key` set, caps, forbidden deviations) lives in `preckon-host-backend-design.md`; this deck only declares the map it reads against.

### C.5 The pack is complete

Every piece Core needs to become a working preconstruction product is now specified as data against the finished ABI: the manifest (§0.4), the persona roster (§1), the **bid-pursuit lifecycle** (§2), the agents (Appendix A), the workflows (Appendix B), and the types + ER + Host map (Appendix C). It adds **no Core table, endpoint, syscall, or ABI change** — it uses only the shared, generic `project.lifecycle_*` field (§1.6), which is domain-neutral *mechanism*, not construction. That is the §D promise, cashed out end to end: a second pack (legal review, underwriting, diligence) is the same set of artifacts against the same Core.

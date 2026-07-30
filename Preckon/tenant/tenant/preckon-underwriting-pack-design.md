# Preckon Underwriting Pack — Implementation Deck

**Document:** `preckon-underwriting-pack-design.md`
**Version:** 1.0 (complete — §0 manifest, §1 personas, §2 submission lifecycle, Appendices A–C)
**Status:** the **second** domain pack, authored against **Preckon Core v1.2** — the *unchanged* generic ABI. Its purpose is proof: a genuinely different vertical (commercial insurance underwriting) expressed as the same set of artifacts. **It adds no Core table, endpoint, syscall, or column.**
**Framework:** `preckon-tenant-platform-design.md` v1.2. Reference convention as in the construction deck: `§`-refs are the framework; `Appendix`-refs are in-deck; short keys are the `underwriting.`-namespaced values (§D.3).

---

## §0 — Scope & the pack contract

### §0.1 What this deck is

The **Underwriting pack**: it turns generic Preckon Core into a commercial-lines underwriting product. A broker submission comes in as documents; agents extract the risk, rate and price it, refer it when it exceeds authority, and assemble a quote; underwriters confirm every step; the pursuit's state lives on the project. It is nothing but pack data — one `domain` manifest and the assets it names (ten artifact types, fourteen agents, eight workflows, three personas, one lifecycle). **The claim it proves:** the seven bundle elements (types, agents, workflows, personas, lifecycle, roles, permission) are the *same* primitives as construction — only the vocabulary differs — and Core needed no change to carry a second vertical.

### §0.2 What a pack declares (§D.1) — same seven, new content

| Bundle element | Written into (Core) | Here |
|---|---|---|
| artifact types | §2.1 `artifact_type` registry | Appendix C |
| agents | §3.1 `agent` registry | **Appendix A** |
| workflows | §4.1 `workflow` registry | Appendix B |
| personas | §6.4 + `supervisor_profile` | §1 |
| lifecycle | §1.6 + `project.lifecycle_*` | §2 |
| role template | §1.2, seeded at bootstrap (§D.4) | §0.5 |
| permission additions | §1.2 catalog | §0.5 (`uw.authorize`) |

### §0.3 Inherited conventions

Unchanged from Core §0/§X: UUIDv7, `timestamptz`, money as **integer minor units**, RLS + `withTenant()`, the append-only hash-chained audit, the review-queue/auto-accept, the four ABI syscalls (§3.2). Every agent below is expressible with those four syscalls and nothing more — the same test the construction pack passed.

### §0.4 The underwriting `domain` manifest

```jsonc
{
  "domain": "underwriting",
  "version": "1.0.0",
  "artifact_types": [
    "underwriting.document", "underwriting.submission_summary", "underwriting.exposure",
    "underwriting.loss_run", "underwriting.risk_factor", "underwriting.quote_option",
    "underwriting.condition", "underwriting.referral", "underwriting.uw_query",
    "underwriting.quote_letter"
  ],
  "agents": [
    "underwriting.agent.document", "underwriting.agent.intake", "underwriting.agent.exposure",
    "underwriting.agent.loss_analysis", "underwriting.agent.risk_rating", "underwriting.agent.pricing",
    "underwriting.agent.referral", "underwriting.agent.conditions", "underwriting.agent.quote",
    "underwriting.agent.broker_query", "underwriting.agent.knowledge",
    "underwriting.agent.underwriter", "underwriting.agent.actuary", "underwriting.agent.wordings"
  ],
  "workflows": [
    "underwriting.workflow.intake", "underwriting.workflow.exposurecapture",
    "underwriting.workflow.lossanalysis", "underwriting.workflow.riskassessment",
    "underwriting.workflow.pricing", "underwriting.workflow.referral",
    "underwriting.workflow.quoteassembly", "underwriting.workflow.brokerqueryloop"
  ],
  "personas": [
    "underwriting.agent.underwriter", "underwriting.agent.actuary", "underwriting.agent.wordings"
  ],
  "lifecycles": [ { "key": "submission_pursuit", "start": "received", "transitions": [ /* …see §2.1… */ ] } ],
  "library_collections": ["rate_tables", "appetite_guide", "wordings_library", "precedent_quotes"],
  "role_template": [
    { "key": "owner",               "name": "Owner",               "tier": "owner_admin", "permissions": ["*"] },
    { "key": "admin",               "name": "Admin",               "tier": "owner_admin", "permissions": ["project.*","artifact.*","workflow.*","library.*","admin.*","billing.view"] },
    { "key": "underwriting_manager","name": "Underwriting Manager","tier": "authority",   "permissions": ["project.*","artifact.*","workflow.*","library.*","uw.authorize"] },
    { "key": "underwriter",         "name": "Underwriter",         "tier": "delivery",    "permissions": ["project.read","artifact.read","artifact.confirm","artifact.edit","workflow.read","workflow.run","library.read"] },
    { "key": "uw_assistant",        "name": "UW Assistant",        "tier": "delivery",    "permissions": ["project.read","artifact.read","artifact.confirm","workflow.read","library.read"] },
    { "key": "viewer",              "name": "Viewer",              "tier": "view",        "permissions": ["project.read","artifact.read","workflow.read","library.read"] }
  ],
  "permissions": [ { "key": "uw.authorize", "domain": "underwriting", "description": "authorize a quote to bind or approve a referral" } ],
  "settings": { "default_tier": "deep", "auto_accept_threshold": 0.9 }
}
```

Every array resolves to an asset defined in this deck (Appendix A/B/C) — the same consistency guarantee the construction manifest carries.

### §0.5 The role template & the authority permission

Six personas seeded at bootstrap (§D.4). The load-bearing distinction is **authority**: `uw.authorize` (bind a quote / approve a referral) is held only by **owner** and **underwriting_manager** — an underwriter may quote within authority but cannot bind beyond it or clear its own referral. This is the underwriting analogue of construction's `bid.approve`, and it is what the referral branch of the lifecycle (§2) hinges on. `uw.authorize` is a **pack permission addition** — Core's 18-key catalog is untouched.

### §0.6 Module & the chain

The pack licenses as a **single Host module** (`module_key = underwriting`) — a valid, coarser granularity than construction's seven, and itself a demonstration that the Host catalog (touch-up doc) supports either. The chain: a submission accretes one shared graph — **documents → submission_summary + exposure + loss_run → risk_factor → quote_option → (referral) → condition → quote_letter** — across the eight workflows, with the **Underwriter** persona (§1) spanning all of it.

---

## §1 — The persona roster (the digital underwriting team)

Same mechanism as §6.4; new colleagues. Each is a `kind = supervisor` agent + a `supervisor_profile` (scope, deviation authority, lens). All **propose; only a human disposes** (§6.4.2). Assistant/manager stay human roles (§0.5); the roster does not decide.

### §1.1 The roster

| Persona | Supervisor agent | Scope | Deviation authority | Default |
|---|---|:--|:--|:--:|
| **Underwriting Copilot** (Underwriter) | `agent.underwriter` | whole submission (`{}`) | all kinds | ✓ |
| **Actuary** | `agent.actuary` | `exposure` · `loss_run` · `risk_factor` · `quote_option` | `flag` · `request_review` · `insert_review_gate` | |
| **Wordings** | `agent.wordings` | `submission_summary` · `condition` · `quote_letter` | `flag` · `request_review` | |

### §1.2 Per-persona

- **Underwriting Copilot** (default, whole-submission). Walks the `submission_pursuit` lifecycle (§2): proposes each transition — "in appetite, rated 62; recommend proceeding to price" — for a human to confirm; never advances state itself (§1.6). Jobs: `underwriter.respond`, `underwriter.review_run`.
- **Actuary** (rating & pricing critic). Authority: `flag` / `request_review` / `insert_review_gate`. Voice: guards technical price — challenges a `quote_option` priced below the rate-table technical minimum, thin loss-loading against the `loss_run`, or a `risk_factor` score inconsistent with the exposure. Jobs: `actuary.respond`, `actuary.review_run`.
- **Wordings** (policy-wordings & regulatory critic). Authority: `flag` / `request_review`. Voice: checks conditions and quote wordings — every subjectivity captured as a `condition`, mandatory exclusions present, the `quote_letter` regulatory-complete before issue. Jobs: `wordings.respond`, `wordings.review_run`.

### §1.3 Profile seed (`supervisor_profile`, §6.4.4)

```sql
insert into supervisor_profile (agent_key, scope, deviation_kinds, is_default, sort_order) values
 ('underwriting.agent.underwriter', '{}'::jsonb, '[]'::jsonb, true, 0),
 ('underwriting.agent.actuary',
    '{"artifact_types":["exposure","loss_run","risk_factor","quote_option"]}'::jsonb,
    '["flag","request_review","insert_review_gate"]'::jsonb, false, 10),
 ('underwriting.agent.wordings',
    '{"artifact_types":["submission_summary","condition","quote_letter"]}'::jsonb,
    '["flag","request_review"]'::jsonb, false, 20);
```

---

## §2 — The submission pursuit lifecycle

A branching state machine — the feature that stresses Core's generic lifecycle (§1.6) harder than construction's: an **authority referral** loop, on top of the linear pursuit. Pack data on `project.lifecycle_*`; the Underwriting Copilot walks it; transitions fire only on a human confirming the gating artifact with the required permission.

### §2.1 States & transitions

```
received → triaging ─(out of appetite)→ declined ▸
                  └─(in appetite)→ quoting → quoted → clarifying ⇄ (amendment → re-rate)
                        │                       └────────────→ bound ▸ / lost ▸
                        └─(exceeds authority)→ referred ─(approved)→ quoted
                                                       └─(rejected)→ declined ▸
```

| From | Trigger (confirmed artifact) | Permission | To |
|---|---|---|---|
| received | `submission_summary` | `artifact.confirm` | triaging |
| triaging | `risk_factor` (`appetite = in`) | `artifact.confirm` | quoting |
| triaging | `risk_factor` (`appetite = out`) | `artifact.confirm` | **declined** ▸ |
| quoting | `quote_option` | `artifact.confirm` | quoted |
| quoting | `referral` (`authority_breach = true`) | `artifact.confirm` | referred |
| referred | `referral` (`decision = approved`) | **`uw.authorize`** | quoted |
| referred | `referral` (`decision = rejected`) | **`uw.authorize`** | **declined** ▸ |
| quoted | `uw_query` (first) | — | clarifying |
| clarifying | `uw_query` (`is_amendment`) | `artifact.confirm` | quoting |
| quoted \| clarifying | `decision_outcome` (`bound`) | **`uw.authorize`** | **bound** ▸ |
| quoted \| clarifying | `decision_outcome` (`lost`) | `artifact.confirm` | **lost** ▸ |

▸ = terminal. The **referral branch** is the interesting bit: exceeding authority routes `quoting → referred`, and only `uw.authorize` clears it — proving the generic mechanism carries a conditional, permission-gated detour that construction never exercised. Withdrawal (`admin.settings`) → `withdrawn` from any non-terminal state.

### §2.2 Addenda & re-rate

An inbound `uw_query` with `is_amendment = true` marks the referenced confirmed artifacts `stale` (§2.4) → re-rate/re-price re-derives only those → a fresh `quote_option` (and, if authority is re-breached, a fresh `referral`) before re-issue. Re-plan, applied to underwriting.

---

## Appendix A — Agents

Fourteen agents — ten workers, the Knowledge service, three supervisor personas — authored against the finished ABI (§3), pack data. Gated transitively (§8); the workflow `module_key` is the license seam.

### A.1 Roster

| Key | Name | Kind | Produces |
|---|---|---|---|
| `agent.document` | Document | worker | `document` |
| `agent.intake` | Intake | worker | `submission_summary` |
| `agent.exposure` | Exposure | worker | `exposure` |
| `agent.loss_analysis` | Loss Analysis | worker | `loss_run` |
| `agent.risk_rating` | Risk Rating | worker | `risk_factor` |
| `agent.pricing` | Pricing | worker | `quote_option` |
| `agent.referral` | Referral | worker | `referral` |
| `agent.conditions` | Conditions | worker | `condition` |
| `agent.quote` | Quote | worker | `quote_letter` |
| `agent.broker_query` | Broker Query | worker | `uw_query` |
| `agent.knowledge` | Knowledge | service | *(none — context)* |
| `agent.underwriter` | Underwriting Copilot | supervisor | *(none — persona §1)* |
| `agent.actuary` | Actuary | supervisor | *(none — persona §1)* |
| `agent.wordings` | Wordings | supervisor | *(none — persona §1)* |

### A.2 Per-agent I/O — **consumes → produces**

- **Document** — file-page text **→ `document`** · non-reviewable (auto-confirmed). Classifies a submission file into `document`s (`doc_type`: broker_email / acord_form / loss_run / financials / schedule_of_values / other).
- **Intake** — `document` **→ `submission_summary`** · reviewable. Insured, class of business, effective date, requested limit/deductible, broker.
- **Exposure** — `document` **→ `exposure`** · reviewable. Exposure units (location, peril, insured value) from schedules of value.
- **Loss Analysis** — `document` **→ `loss_run`** · reviewable. Prior-year claim counts + incurred from loss runs.
- **Risk Rating** — `submission_summary`, `exposure`, `loss_run` **→ `risk_factor`** · reviewable. Scores hazard/financial/nat-cat factors; sets `appetite` (in / out / refer). May call **Knowledge** (`appetite_guide`).
- **Pricing** — `exposure`, `risk_factor`, `loss_run` (+ Library `rate_tables`) **→ `quote_option`** · reviewable. Technical + market premium, limits, deductible. Provenance links each option to its rating + rates (a rate-table edit re-plans, §2.4).
- **Referral** — `risk_factor`, `quote_option` **→ `referral`** · reviewable. Detects authority breach (limit/premium/appetite beyond the underwriter's grant) and raises a `referral`; the gate that routes the lifecycle to `referred`.
- **Conditions** — `submission_summary`, `risk_factor` **→ `condition`** · reviewable. Subjectivities, warranties, exclusions, endorsements. **Wordings** persona watches these.
- **Quote** — `submission_summary`, `quote_option`, `condition` **→ `quote_letter`** · reviewable. Assembles the issued quote/binder; the terminal deliverable.
- **Broker Query** — inbound `uw_query` + `submission_summary`/`exposure`/`quote_option` **→ `uw_query`** (outbound) · reviewable. Drafts the broker reply; an `is_amendment` inbound triggers re-rate (§2.2).
- **Knowledge** (service) — query-driven over `chunk` (submission docs + Library) **→ context** · emits no artifact. Called mid-job (e.g. Pricing asking precedent).
- **Underwriter / Actuary / Wordings** (supervisors) — whole-run (scoped) context **→ deviations + chat** · emit no artifact; §1, the §6.1 shape.

### A.3 Wiring rules

Type-checked at registration (§4.1); only `document` is non-reviewable; every agent is expressible with the four syscalls, the existing `agent` columns, and the ten seeded types — **no new Core surface.**

---

## Appendix B — Workflows

Eight workflows, all `module_key = underwriting`. Each ends at a review gate. Cross-workflow reads resolve against the shared graph (§4.5, framework resolver rule).

```json
{ "key":"workflow.intake","name":"Intake","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"ingest","kind":"agent","agent_key":"agent.document"},
    {"id":"intake","kind":"agent","agent_key":"agent.intake"},
    {"id":"gate","kind":"gate","gate_types":["submission_summary"]}],
   "edges":[{"from":"ingest","to":"intake"},{"from":"intake","to":"gate"}]}}
```
```json
{ "key":"workflow.exposurecapture","name":"ExposureCapture","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"exposure","kind":"agent","agent_key":"agent.exposure"},
    {"id":"gate","kind":"gate","gate_types":["exposure"]}],
   "edges":[{"from":"exposure","to":"gate"}]}}
```
```json
{ "key":"workflow.lossanalysis","name":"LossAnalysis","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"loss","kind":"agent","agent_key":"agent.loss_analysis"},
    {"id":"gate","kind":"gate","gate_types":["loss_run"]}],
   "edges":[{"from":"loss","to":"gate"}]}}
```
```json
{ "key":"workflow.riskassessment","name":"RiskAssessment","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"rate","kind":"agent","agent_key":"agent.risk_rating"},
    {"id":"gate","kind":"gate","gate_types":["risk_factor"]}],
   "edges":[{"from":"rate","to":"gate"}]}}
```
```json
{ "key":"workflow.pricing","name":"Pricing","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"price","kind":"agent","agent_key":"agent.pricing"},
    {"id":"gate","kind":"gate","gate_types":["quote_option"]}],
   "edges":[{"from":"price","to":"gate"}]}}
```
```json
{ "key":"workflow.referral","name":"Referral","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"refer","kind":"agent","agent_key":"agent.referral"},
    {"id":"gate","kind":"gate","gate_types":["referral"]}],
   "edges":[{"from":"refer","to":"gate"}]}}
```
```json
{ "key":"workflow.quoteassembly","name":"QuoteAssembly","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"conditions","kind":"agent","agent_key":"agent.conditions"},
    {"id":"quote","kind":"agent","agent_key":"agent.quote"},
    {"id":"gate","kind":"gate","gate_types":["quote_letter","condition"]}],
   "edges":[{"from":"conditions","to":"quote"},{"from":"quote","to":"gate"}]}}
```
```json
{ "key":"workflow.brokerqueryloop","name":"BrokerQueryLoop","module_key":"underwriting",
  "definition":{"nodes":[
    {"id":"draft","kind":"agent","agent_key":"agent.broker_query"},
    {"id":"gate","kind":"gate","gate_types":["uw_query"]}],
   "edges":[{"from":"draft","to":"gate"}]}}
```

**Composition:** Intake → { ExposureCapture ‖ LossAnalysis } → RiskAssessment → Pricing → (Referral if authority breached) → QuoteAssembly; BrokerQueryLoop is event-driven post-quote (§2.2). No workflow references another — they compose only through the shared graph, exactly as construction's do.

---

## Appendix C — Artifact types, ER & Host map

### C.1 The type registry (seed)

`is_reviewable = false` only for `document`. **Derives-from** is the provenance (§2.3) and the domain ER.

| `type_key` | Rev. | Producer | Derives from | Key fields |
|---|:--:|---|---|---|
| `document` | no | Document | *(a file)* | `file_id`, `doc_type`, `page_range` |
| `submission_summary` | yes | Intake | `document` | `insured_name`, `class_of_business`, `requested_limit_minor` |
| `exposure` | yes | Exposure | `document` | `location`, `peril`, `value_minor` |
| `loss_run` | yes | Loss Analysis | `document` | `policy_year`, `claim_count`, `incurred_minor` |
| `risk_factor` | yes | Risk Rating | `submission_summary`, `exposure`, `loss_run` | `category`, `score`, `appetite` |
| `quote_option` | yes | Pricing | `exposure`, `risk_factor`, `loss_run` | `premium_minor`, `limit_minor`, `deductible_minor` |
| `referral` | yes | Referral | `risk_factor`, `quote_option` | `reason`, `authority_breach`, `decision` |
| `condition` | yes | Conditions | `submission_summary`, `risk_factor` | `kind`, `text`, `mandatory` |
| `uw_query` | yes | Broker Query | *(inbound)* + graph | `direction`, `subject`, `is_amendment` |
| `quote_letter` | yes | Quote | `submission_summary`, `quote_option`, `condition` | `quote_ref`, `total_premium_minor` |

### C.2 Payload schemas

```json
{ "$id":"document","type":"object","additionalProperties":false,
  "required":["file_id","doc_type","page_range"],
  "properties":{ "file_id":{"type":"string","format":"uuid"},
    "doc_type":{"type":"string","enum":["broker_email","acord_form","loss_run","financials","schedule_of_values","other"]},
    "title":{"type":"string"}, "page_range":{"type":"array","items":{"type":"integer","minimum":1},"minItems":2,"maxItems":2} } }
```
```json
{ "$id":"submission_summary","type":"object","additionalProperties":false,
  "required":["insured_name","class_of_business","effective_date","requested_limit_minor","currency"],
  "properties":{ "insured_name":{"type":"string"}, "class_of_business":{"type":"string"},
    "broker":{"type":"string"}, "effective_date":{"type":"string","format":"date"},
    "requested_limit_minor":{"type":"integer","minimum":0},
    "requested_deductible_minor":{"type":"integer","minimum":0},
    "currency":{"type":"string","pattern":"^[A-Z]{3}$"} } }
```
```json
{ "$id":"exposure","type":"object","additionalProperties":false,
  "required":["location","peril","value_minor","currency"],
  "properties":{ "location":{"type":"string"},
    "peril":{"type":"string","enum":["fire","flood","wind","liability","theft","business_interruption","other"]},
    "value_minor":{"type":"integer","minimum":0}, "currency":{"type":"string","pattern":"^[A-Z]{3}$"},
    "construction_type":{"type":"string"} } }
```
```json
{ "$id":"loss_run","type":"object","additionalProperties":false,
  "required":["policy_year","claim_count","incurred_minor","currency"],
  "properties":{ "policy_year":{"type":"integer"}, "claim_count":{"type":"integer","minimum":0},
    "incurred_minor":{"type":"integer","minimum":0}, "currency":{"type":"string","pattern":"^[A-Z]{3}$"},
    "description":{"type":"string"} } }
```
```json
{ "$id":"risk_factor","type":"object","additionalProperties":false,
  "required":["factor","category","score","appetite"],
  "properties":{ "factor":{"type":"string"},
    "category":{"type":"string","enum":["hazard","financial","management","natural_catastrophe","moral"]},
    "score":{"type":"number","minimum":0,"maximum":100},
    "appetite":{"type":"string","enum":["in","out","refer"]},
    "rationale":{"type":"string"} } }
```
```json
{ "$id":"quote_option","type":"object","additionalProperties":false,
  "required":["option_name","premium_minor","currency","limit_minor"],
  "properties":{ "option_name":{"type":"string"},
    "premium_minor":{"type":"integer","minimum":0}, "currency":{"type":"string","pattern":"^[A-Z]{3}$"},
    "limit_minor":{"type":"integer","minimum":0}, "deductible_minor":{"type":"integer","minimum":0},
    "terms":{"type":"string"} } }
```
```json
{ "$id":"referral","type":"object","additionalProperties":false,
  "required":["reason","authority_breach","decision"],
  "properties":{ "reason":{"type":"string"}, "to_role":{"type":"string"},
    "authority_breach":{"type":"boolean"},
    "decision":{"type":"string","enum":["pending","approved","rejected"]},
    "note":{"type":"string"} } }
```
```json
{ "$id":"condition","type":"object","additionalProperties":false,
  "required":["kind","text"],
  "properties":{ "kind":{"type":"string","enum":["subjectivity","warranty","exclusion","endorsement"]},
    "text":{"type":"string"}, "mandatory":{"type":"boolean"} } }
```
```json
{ "$id":"uw_query","type":"object","additionalProperties":false,
  "required":["direction","subject","body","status"],
  "properties":{ "direction":{"type":"string","enum":["inbound","outbound"]},
    "subject":{"type":"string"}, "body":{"type":"string"},
    "references":{"type":"array","items":{"type":"string","format":"uuid"}},
    "is_amendment":{"type":"boolean"},
    "status":{"type":"string","enum":["open","answered","closed"]} } }
```
```json
{ "$id":"quote_letter","type":"object","additionalProperties":false,
  "required":["quote_ref","insured_name","total_premium_minor","currency","valid_until"],
  "properties":{ "quote_ref":{"type":"string"}, "insured_name":{"type":"string"},
    "total_premium_minor":{"type":"integer","minimum":0}, "currency":{"type":"string","pattern":"^[A-Z]{3}$"},
    "valid_until":{"type":"string","format":"date"}, "option_ref":{"type":"string"} } }
```

### C.3 ER reconciliation — identical shape, new nouns

The same result as construction (§C.3 there): **entities are `artifact` rows, relationships are `artifact_provenance` edges, and the C.1 derives-from column is the ER** — no underwriting tables. `document → {submission_summary, exposure, loss_run} → risk_factor → quote_option → {referral, condition} → quote_letter`, and editing a confirmed `risk_factor` marks the downstream `quote_option`/`referral`/`quote_letter` `stale` (§2.4). Money is `*_minor`; cross-references (`file_id`, `references[]`, `option_ref`) are soft values in opaque `jsonb`. Core supplies the nouns and verbs; the pack supplies the vocabulary.

### C.4 Host map

| Workflow | `module_key` | `entitlement_key` |
|---|---|---|
| all eight (`intake` … `brokerqueryloop`) | `underwriting` | `workflow.<key>` |

The pack licenses as **one module** — the Host catalog (touch-up doc) adds a single `module.underwriting` feature with display; the tenant plane resolves all eight workflows under it, transitively the agents, and the three personas (whole-submission scopes intersect the licensed module). Coarser than construction's seven, and that it *just works* is part of the proof.

### C.5 The proof

A second, unrelated vertical — commercial underwriting — is fully specified as **ten types, fourteen agents, eight workflows, three personas, one lifecycle, one permission**, all data against a Core that gained **not one table, endpoint, syscall, or column** to accept it. The branching authority-referral lifecycle and the single-module licensing exercise parts of the abstraction construction never did, and both hold. **Same set of artifacts, same Core** — claim cashed.

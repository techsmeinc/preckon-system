# Preckon AI Fabric
## Master Architecture Blueprint & Implementation Plan v1.1

**Status:** Master engineering + product architecture baseline  
**Date:** 13 August 2026  
**Scope:** Preckon SaaS, Private Cloud/VPC, Customer-Controlled Cloud, and On-Premises deployments  
**Primary objective:** Make AI a core Preckon capability without allowing external LLM token cost, vendor dependency, or enterprise data-sovereignty requirements to threaten product economics or deployability.

**Commercial objective:** Increase customer value and AI capability while continuously reducing external-model dependency and compute cost per successful validated workflow. AI efficiency is a gross-margin and enterprise-defensibility capability, not merely an infrastructure optimization.

---

# 1. Executive Decision

Preckon will not be architected as an application that “calls an LLM.” It will be architected as a construction intelligence platform with a dedicated **Preckon AI Fabric** between every Preckon module and every AI model.

No Preckon module may call OpenAI, Qwen, Mistral, a self-hosted model, or any future model provider directly.

The required execution order is:

> **Deterministic software → exact/semantic cache → structured retrieval → small private model → private reasoning model → frontier model escalation.**

Frontier-model inference is an escalation path, not the default path.

Preckon will present this architecture commercially through three AI capability tiers—**Preckon Edge**, **Preckon Construction AI**, and **Preckon Frontier**—and enterprise deployment offerings—**Preckon Private AI** and **Preckon Sovereign AI**. These are product-facing abstractions over the same governed AI Fabric; they do not create separate application architectures.

Preckon will not primarily monetize raw tokens. Internal token/GPU economics are operational measures. Customer packaging should primarily align to customer value such as projects, users, modules, enterprise capacity, AI intelligence tier, and private/sovereign deployment. Improvements in inference efficiency should primarily improve Preckon gross margin while preserving competitive pricing.

The Preckon AI Fabric owns:

- AI request admission
- tenant and project policy enforcement
- data-sensitivity enforcement
- deterministic/tool-first routing
- exact and semantic caching
- retrieval and context construction
- prompt/version management
- model abstraction and routing
- local/private model serving
- external model adapters
- token and dollar budgets
- response validation
- confidence scoring
- fallback/escalation
- provenance and citations
- project AI memory
- evaluation
- AI usage metering
- AI FinOps
- auditability

This becomes a P0 platform capability alongside identity, security, persistence, workflow, and audit.

---

# 2. Non-Negotiable Architecture Principles

## P-01 — One Internal AI Contract

All modules use one Preckon-owned contract.

```text
TenderLogix ─┐
DrawLogix   ─┤
DocLogix    ─┤
ScheduleLogix├──> Preckon Application Layer ───> Preckon AI Fabric
CostLogix   ─┤
Field       ─┤
Enterprise  ─┘
```

A module must never contain vendor-specific model code.

## P-02 — AI Does Not Own Authoritative Business State

Preckon's application layer owns:

- identity
- authorization
- tenancy
- transactions
- durable workflow/job state
- approvals
- audit
- authoritative project state

The AI layer produces structured proposals, extracted facts, classifications, recommendations, draft artifacts, explanations, and confidence/provenance metadata.

AI cannot directly commit an authoritative BOQ change, schedule baseline, contract value, drawing revision, approval, or other business transaction.

## P-03 — Deterministic Before Probabilistic

If code, SQL, a rules engine, a scheduling engine, a quantity engine, geometry logic, or another deterministic tool can produce the answer reliably, no LLM is used for the computation itself.

Examples:

| Task | Default execution |
|---|---|
| BOQ arithmetic | deterministic quantity/cost engine |
| CPM/date calculations | scheduling engine |
| permission checks | application authorization |
| revision hashes | deterministic diff engine |
| database lookup | repository/query layer |
| unit conversion | deterministic service |
| workflow state | workflow engine |
| document classification | small private model |
| RFI discipline classification | small private model |
| tender requirement extraction | private reasoning model |
| difficult ambiguous contract reasoning | frontier escalation when policy allows |
| cross-drawing multimodal reasoning | private multimodal first, frontier if required |

## P-04 — Retrieval Before Long Context

Project documents are ingested once and converted into indexed, structured, revision-aware knowledge.

The runtime does not repeatedly send entire tenders, specifications, contracts, BOQs, drawing sets, RFIs, or chat histories to a model.

## P-05 — Context Is Budgeted

Every request has a maximum context budget. Retrieval must fit inside the available budget after system instructions, task instructions, tool schema, response budget, and safety margin are reserved.

## P-06 — Cache Before Inference

Exact cache, computed artifact cache, and revision-safe semantic cache are checked before model inference.

## P-07 — Private Before Frontier

Routine and construction-specific tasks are routed to private/self-hosted models first when they meet quality thresholds.

## P-08 — Data Policy Overrides Model Quality

A model is ineligible if tenant policy or data classification does not permit that deployment boundary.

A restricted document does not leave a customer's approved environment simply because an external model is more capable.

## P-09 — Model Independence

Models are referenced using aliases such as:

- `preckon-small`
- `preckon-reasoning`
- `preckon-multimodal`
- `frontier-reasoning`
- `frontier-multimodal`

Application code does not depend on a specific provider or model name.

## P-10 — Every AI Call Has Economics

Every request must be attributable to:

- tenant
- customer
- project
- user
- module
- task type
- workflow
- model route
- model/provider
- input tokens
- cached input tokens
- output tokens
- GPU seconds where applicable
- latency
- cache outcome
- confidence
- validation outcome
- cost
- fallback/escalation count

AI cost is a product KPI, not an accounting afterthought.

---

# 3. Fit With the Existing Preckon Stack

The AI Fabric preserves the existing Preckon architecture decisions.

## Authoritative application stack

- Node.js 20+
- Next.js 15.x
- TypeScript strict
- React 19
- MySQL 8 using `mysql2` and controlled SQL access
- MariaDB-compatible business persistence where required
- Better Auth
- Zod
- UUIDv7
- Docker/Compose

## AI execution stack

- Python 3.11+
- FastAPI
- Pydantic 2
- `arq`
- Redis queues
- model-provider adapters
- self-hosted inference through an OpenAI-compatible serving boundary, with vLLM as the recommended initial serving engine after model/hardware benchmarking

## Storage

- MySQL: authoritative Preckon records, AI policy configuration, durable AI job state, usage ledger, prompt/evaluation metadata
- Redis: queues, short-lived exact cache, distributed locks, rate limits, idempotency helpers
- S3-compatible storage / MinIO: source files, normalized artifacts, model outputs, generated files, evaluation datasets
- semantic index: abstracted service; do not make domain code dependent on a particular vector vendor
- construction relationships: begin in the canonical relational model using typed entities/edges; introduce a specialized graph database only when measured workloads justify the operational cost

This intentionally avoids adding unnecessary infrastructure to the first release.

---

# 4. Logical Architecture

```text
┌───────────────────────────────────────────────────────────────────────┐
│                         PRECKON MODULES                               │
│ Tender │ Draw │ Doc │ Schedule │ Cost │ Procurement │ Field │ Admin │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                 PRECKON APPLICATION / CONTROL PLANE                  │
│ Next.js │ Auth │ Tenant │ Project │ RBAC │ Workflow │ Approval │ DB │
│ Durable AI Job State │ Signed Workload Envelope │ Audit              │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ internal authenticated API / queue
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        PRECKON AI FABRIC                              │
│                                                                       │
│  Admission & Policy                                                   │
│        ↓                                                              │
│  Task Classifier → Cost/Token/Latency Budget                          │
│        ↓                                                              │
│  Exact Cache → Semantic Cache                                         │
│        ↓                                                              │
│  Deterministic/Tool Decision                                          │
│        ↓                                                              │
│  Context Builder                                                      │
│    ├─ Project Memory                                                   │
│    ├─ Canonical Construction Model                                    │
│    ├─ Retrieval Index                                                  │
│    ├─ Source/Revisions                                                 │
│    └─ Knowledge Relationships                                         │
│        ↓                                                              │
│  Model Router                                                         │
│    ├─ Preckon Small                                                   │
│    ├─ Preckon Reasoning                                               │
│    ├─ Preckon Multimodal                                              │
│    └─ Frontier Adapters                                               │
│        ↓                                                              │
│  Structured Validator → Confidence → Escalation                       │
│        ↓                                                              │
│  Provenance / Usage Ledger / Evaluation / FinOps                      │
└───────────────┬──────────────────────────┬────────────────────────────┘
                │                          │
        ┌───────▼────────┐         ┌──────▼─────────────────┐
        │ PRIVATE MODELS │         │ EXTERNAL FRONTIER AI   │
        │ vLLM / future  │         │ policy-controlled only │
        └────────────────┘         └────────────────────────┘
```

---

# 5. Control Plane vs AI Data Plane

The separation is critical for SaaS and enterprise portability.

## Control plane

Owned by the primary Preckon application:

- users and organizations
- tenants
- projects
- subscriptions
- entitlements
- identity and authorization
- tenant AI policy
- project AI policy
- model permissions
- workflow
- human approvals
- durable job states
- usage billing rollups
- audit

## AI data plane

Owned by Preckon AI Fabric:

- queue workers
- context retrieval
- prompt assembly
- local model serving
- external provider calls
- caches
- embeddings/index operations
- AI result validation
- AI telemetry

For enterprise/on-prem installations, the AI data plane can live entirely inside the customer environment.

---

# 6. Standard AI Request Envelope

Every AI workload should arrive in a typed envelope similar to:

```json
{
  "request_id": "0198...",
  "tenant_id": "tenant_...",
  "project_id": "project_...",
  "user_id": "user_...",
  "module": "TenderLogix",
  "task_type": "tender_requirement_extraction",
  "sensitivity": "confidential",
  "prompt": "Extract mandatory fire-rating requirements.",
  "payload": {
    "discipline": "architectural"
  },
  "context_refs": [
    "doc:SPEC-ARCH:r07:section-07-84-00"
  ],
  "response_schema": {},
  "budget": {
    "max_input_tokens": 12000,
    "max_output_tokens": 2000,
    "max_cost_usd": 0.20,
    "max_latency_ms": 20000,
    "allow_frontier": false
  },
  "idempotency_key": "..."
}
```

The module expresses the business task. It does not choose a vendor model.

---

# 7. AI Response Contract

The AI Fabric returns structured results, not uncontrolled prose.

```json
{
  "request_id": "0198...",
  "status": "needs_review",
  "result": {
    "requirements": []
  },
  "citations": [
    {
      "source_ref": "doc:SPEC-ARCH:r07:section-07-84-00",
      "page": 412
    }
  ],
  "confidence": 0.94,
  "routing": {
    "execution_class": "local_reasoning",
    "model_alias": "preckon-reasoning",
    "reason": "construction extraction task"
  },
  "usage": {
    "input_tokens": 4180,
    "cached_input_tokens": 0,
    "output_tokens": 632,
    "cost_usd": 0.0,
    "latency_ms": 2180,
    "cache_hit": false
  },
  "warnings": []
}
```

The application layer then determines whether to:

- display
- request human review
- run deterministic validation
- create a proposed ChangeSet
- request approval
- reject
- commit through an authorized domain command

---

# 8. Task Taxonomy

A defined task taxonomy is required for routing and economics.

## Class A — No LLM

Examples:

- `boq_arithmetic`
- `cost_rollup`
- `cpm_calculation`
- `date_math`
- `permission_check`
- `revision_hash_compare`
- `exact_database_lookup`
- `unit_conversion`
- `quantity_formula_execution`

## Class B — Small Private Model

Examples:

- `document_classification`
- `discipline_classification`
- `metadata_extraction`
- `entity_extraction`
- `rfi_triage`
- `boq_categorization`
- `drawing_titleblock_extraction`
- `document_language_detection`

## Class C — Private Construction Reasoning

Examples:

- `tender_requirement_extraction`
- `specification_mapping`
- `tender_to_boq_mapping`
- `change_impact_summary`
- `schedule_risk_summary`
- `submittal_requirement_mapping`
- `scope_gap_detection`
- `project_question_answering`

## Class D — Private Multimodal

Examples:

- `drawing_detail_interpretation`
- `multi_sheet_cross_reference`
- `drawing_spec_alignment`
- `visual_revision_analysis`

## Class E — Frontier Escalation

Examples:

- severe ambiguity after private model validation failure
- novel multi-domain reasoning
- complex multimodal tasks outside local benchmark threshold
- high-value workflow where frontier quality materially exceeds approved private model

Class E is available only when tenant policy, data classification, and budget permit it.

---

# 9. Token Reduction Architecture

Token reduction is not one technique. It is a sequence of defenses.

## 9.1 Ingest Once

When a document enters Preckon:

```text
Upload
  ↓
Content hash
  ↓
Malware/security checks
  ↓
File type/native parser
  ↓
Text/structure extraction
  ↓
Page/sheet/section boundaries
  ↓
Canonical entity extraction
  ↓
Chunk generation
  ↓
Embeddings/index
  ↓
Hierarchical summaries
  ↓
Provenance record
```

Do not repeat full extraction on every AI request.

## 9.2 Content-Hash Deduplication

Store a SHA-256 or equivalent digest for every immutable source artifact.

If the exact file is re-uploaded:

- reuse extraction
- reuse chunks
- reuse embeddings where tenant/security policy permits
- do not re-run expensive AI ingestion

Cross-tenant reuse of confidential content is prohibited.

## 9.3 Revision-Aware Incremental Processing

For revision R08 after R07:

- compare page/sheet/section hashes
- reprocess only changed units
- preserve unchanged extraction and embeddings
- invalidate only dependent cached answers

Do not process the entire drawing/specification set again.

## 9.4 Structured Canonical Extraction

High-value facts should become durable typed data.

Example:

```text
Specification clause
  ├─ discipline
  ├─ system
  ├─ material
  ├─ requirement type
  ├─ value
  ├─ unit
  ├─ mandatory/advisory
  ├─ source document
  ├─ revision
  ├─ page/section
  └─ confidence
```

If a later workflow needs the fire rating, retrieve the structured fact instead of re-sending the full specification.

## 9.5 Hierarchical Retrieval

Use retrieval stages:

1. project filter
2. current-approved-revision filter
3. document type filter
4. discipline/work-package filter
5. lexical/semantic retrieval
6. reranking
7. overlap deduplication
8. token-budget packing

## 9.6 Context by Reference

Internal agent/tool messages should pass IDs and typed outputs, not duplicate source text.

Bad:

```text
Agent A sends 8,000 tokens to Agent B.
Agent B sends the same 8,000 tokens to Agent C.
```

Good:

```json
{
  "artifact_ref": "aiartifact:0198...",
  "source_refs": ["..."],
  "facts": ["..."]
}
```

The next step resolves only the information it actually needs.

## 9.7 No Free-Form Agent Conversations

Preckon workflows should use typed workflow state and tools rather than multiple agents repeatedly talking to each other in natural language.

```text
State Machine
  ↓
Task
  ↓
Tool/model
  ↓
Structured result
  ↓
Validator
  ↓
Next state
```

This reduces tokens, latency, non-determinism, and debugging complexity.

## 9.8 Conversation Memory Compression

Do not keep replaying the entire user conversation.

Maintain:

- current task state
- explicit user decisions
- project context
- open questions
- recent interaction window
- durable project facts
- references to previous AI artifacts

Older conversation is summarized into typed memory with provenance.

## 9.9 Strict Output Contracts

Use JSON/schema-constrained outputs wherever possible.

Avoid asking the model for long narrative text if the downstream workflow needs five fields.

## 9.10 Output Token Limits

Each task defines a default and hard maximum output budget.

Example:

| Task | Normal output budget |
|---|---:|
| classification | 50–150 tokens |
| metadata extraction | 200–500 |
| requirement extraction | 500–1,500 |
| user explanation | 500–1,500 |
| report draft | explicitly higher |

## 9.11 Provider Prompt Caching

Keep stable provider-facing prefixes stable:

- system policy
- task definition
- output schema
- standard ontology fragments

Place variable content afterward.

Provider-specific cache economics must be stored in the model rate card rather than hard-coded into application logic.

As of August 2026, OpenAI documents discounted cached-input pricing and separate cache-write/cached-input economics for supported APIs/models; the exact rate must be treated as mutable configuration, not an architectural constant.

## 9.12 Exact Cache

Use exact cache for deterministic request fingerprints where source revisions and policy are unchanged.

## 9.13 Semantic Cache

Semantic cache is permitted only when all safety dimensions match:

- tenant
- project
- task type
- sensitivity
- source revision set
- policy version
- prompt/template version
- output schema version
- model/evaluation compatibility when required

A semantic similarity match alone is never enough.

## 9.14 Computed Artifact Cache

Cache expensive intermediate artifacts:

- drawing sheet summaries
- specification section summaries
- tender risk maps
- requirement matrices
- document entity tables
- BOQ normalized structures
- drawing-to-spec links

## 9.15 Batch Processing

Non-interactive ingestion and enrichment should be queued and batched where possible.

Do not burn expensive interactive capacity for overnight indexing, bulk classification, or backfills.

---

# 10. Context Budget Algorithm

For each request:

```text
model_context_limit
- system/reserved instructions
- tool schemas
- response budget
- safety margin
= maximum dynamic context
```

Then:

```text
maximum dynamic context
- project memory allocation
- canonical entity allocation
= retrieval evidence budget
```

Pseudo-code:

```python
def allocate_context(task, model, budget):
    hard_limit = min(model.context_limit, budget.max_input_tokens)

    reserve = (
        task.system_prompt_tokens
        + task.tool_schema_tokens
        + budget.max_output_tokens
        + task.safety_margin_tokens
    )

    dynamic = max(0, hard_limit - reserve)

    memory_budget = min(task.memory_cap, int(dynamic * 0.15))
    entity_budget = min(task.entity_cap, int(dynamic * 0.20))
    evidence_budget = dynamic - memory_budget - entity_budget

    return memory_budget, entity_budget, evidence_budget
```

If retrieval exceeds the budget:

1. drop low-ranking chunks
2. remove duplicate/overlapping text
3. prefer structured facts over raw text
4. use section summaries where evidence granularity permits
5. split the workflow into independently verifiable subtasks

Do not silently exceed the token budget.

---

# 11. Retrieval / RAG Design

## 11.1 Source record

Every retrievable unit must include:

- tenant ID
- project ID
- source document ID
- document type
- discipline
- revision
- approval/current status
- page/sheet/section
- chunk ID
- text/content reference
- content hash
- security classification
- parser version
- extraction version
- embedding version
- created timestamp

## 11.2 Retrieval must be revision-aware

By default, answer from the current approved revision.

If the user asks a historical question, allow historical revisions explicitly.

## 11.3 Hybrid retrieval

Use both structured filters and semantic/lexical scoring.

Construction questions frequently contain exact identifiers such as:

- sheet numbers
- specification sections
- BOQ item IDs
- RFI numbers
- material codes
- room/level IDs

Pure vector similarity is insufficient for these cases.

## 11.4 Source citations are mandatory

Project-specific factual answers should return source references where possible.

The UI should allow the user to open the exact page/sheet/section used.

## 11.5 Retrieval quality telemetry

Track:

- recall@k on golden queries
- citation correctness
- percentage of answers with sufficient evidence
- no-answer correctness
- stale-revision retrieval incidents
- retrieval token count per task

---

# 12. Project Memory

Project memory is not chat history.

## Durable project memory categories

### Project identity

- project type
- location
- customer
- consultant
- contractor
- currency
- units
- codes/standards profile

### Current project state

- active tender revision
- active drawing set
- approved BOQ revision
- schedule baseline
- key commercial assumptions

### Decisions

- approved decisions
- rejected alternatives
- decision owner
- effective date/revision

### AI-derived memory

AI-derived memory must carry:

- source refs
- confidence
- model/prompt version
- validation status
- human approval status where applicable

Unvalidated AI memory must not be treated as authoritative fact.

---

# 13. Canonical Construction Knowledge Layer

The AI Fabric consumes the Preckon Construction Model rather than trying to rediscover the project from raw documents for every request.

Core entity families should connect:

```text
Project
  ├─ Location / Level / Zone / Space
  ├─ System / Element / Assembly
  ├─ Drawing / Sheet / View / Detail
  ├─ Specification / Clause / Requirement
  ├─ Quantity / BOQ Item / Cost Item
  ├─ Vendor / Material / Product
  ├─ Schedule Activity / Milestone
  ├─ Tender Package / Work Package
  ├─ RFI / Submittal / Issue
  ├─ Change / Variation
  ├─ Quality / Safety record
  └─ Revision / ChangeSet / Approval
```

Relationships can initially be represented relationally:

```text
entity
entity_relation
source_provenance
revision
```

Do not introduce a dedicated graph database in Phase 1 unless a proven query/performance need exists.

---

# 14. Model Registry

Models are deployable capabilities, not hard-coded names.

Example registry:

```yaml
models:
  preckon-small:
    provider: local-vllm
    capabilities:
      - classification
      - extraction
      - tagging
    data_boundaries:
      - public
      - internal
      - confidential
      - restricted

  preckon-reasoning:
    provider: local-vllm
    capabilities:
      - construction_reasoning
      - structured_output
      - tool_calling

  frontier-reasoning:
    provider: external
    capabilities:
      - hard_reasoning
      - multimodal
    data_boundaries:
      - public
      - internal
```

Registry metadata should include:

- alias
- provider adapter
- deployment type
- actual model/version
- model license
- allowed commercial use
- weight/source checksum
- context limit
- multimodal capability
- tool/function calling capability
- structured-output capability
- supported languages
- hardware profile
- rate card
- benchmark/evaluation version
- approved status
- effective dates

---

# 15. Routing Engine

Routing must combine business policy, measured model quality, cost, and latency.

## Decision sequence

```text
1. Is request authorized?
2. Is data classification allowed for requested execution boundary?
3. Is exact/verified cache available?
4. Can deterministic software execute the task?
5. What evidence/context is required?
6. Which approved private model meets required task quality?
7. Does estimated execution fit token/cost/latency budget?
8. Execute.
9. Validate output.
10. If confidence/validation fails, escalate only to an eligible route.
```

## Routing score

A future router can optimize a score such as:

```text
score =
  quality_weight * benchmark_quality
- cost_weight * estimated_cost
- latency_weight * expected_latency
- risk_weight * deployment_risk
```

Policy eligibility is evaluated before scoring. An ineligible model never wins even with the highest quality score.

---

# 16. Confidence and Escalation

Confidence cannot come only from “the model says 95%.”

Construct confidence from measurable signals such as:

- retrieval evidence strength
- schema validity
- deterministic rule agreement
- source citation coverage
- cross-model consistency where justified
- domain validation
- known benchmark behavior for the task

Example policy:

```text
>= 0.97   auto-accept for approved low-risk task classes
0.80–0.97 human/automatic validation depending on task
< 0.80    escalate or request review
```

Thresholds are task-specific. Contractual, commercial, drawing, safety, and approval-sensitive workflows require stricter controls than document tagging.

---

# 17. Deterministic Tool Layer

A large portion of AI cost reduction will come from giving models tools rather than making models reproduce application logic.

Tools should include typed APIs for:

- project query
- document lookup
- specification lookup
- drawing metadata lookup
- BOQ query
- quantity engine
- cost engine
- scheduling engine
- revision diff engine
- standards/rules lookup
- RFI/submittal query
- change impact data
- currency/unit conversion
- approved web/external enterprise connector access where applicable

The model decides *what* it needs; Preckon code executes the operation.

Tool results should be concise structured objects.

---

# 18. Prompt Registry

Prompts must be versioned assets.

Store:

- prompt ID
- task type
- version
- system prefix
- task instructions
- output schema
- model-family overrides
- required tools
- evaluation dataset/version
- approval status
- effective date

No production prompt should live as an untracked string buried in module source code.

Prompts should be designed with stable prefixes to improve provider prompt-cache reuse where supported.

---

# 19. Exact and Semantic Caching

## Cache layers

### L1 — process/request cache

Very short-lived repeated resolution within a workflow.

### L2 — Redis exact cache

Key includes tenant/project/task/prompt/revision/policy/template dimensions.

### L3 — semantic answer cache

Stores embeddings/fingerprint plus strong validation metadata.

### L4 — durable artifact cache

Stores expensive reusable artifacts in object storage with MySQL metadata.

## Invalidation triggers

- source document revision change
- BOQ revision change
- schedule baseline change
- project policy change
- AI prompt version change
- model output schema change
- rules/standards version change
- manual invalidation

Do not use TTL alone to guarantee correctness.

---

# 20. AI Usage Ledger / FinOps

Create an immutable usage event for every AI execution attempt.

Recommended durable fields:

```text
id
request_id
tenant_id
project_id
user_id
module
task_type
workflow_id
model_alias
provider
model_version
execution_class
sensitivity
input_tokens
cached_input_tokens
cache_write_tokens (when available)
output_tokens
retrieval_tokens
retrieval_chunks
gpu_milliseconds
provider_cost_usd
allocated_gpu_cost_usd
total_estimated_cost_usd
latency_ms
cache_hit
confidence
validation_status
fallback_count
outcome
created_at
```

## Required dashboards

### Executive AI economics

- AI cost / customer
- AI cost / project
- AI cost / active user
- AI cost / $1 of ARR
- gross-margin impact
- hosted GPU cost
- external provider cost

### Engineering

- requests by execution class
- no-LLM percentage
- cache-hit percentage
- private-model percentage
- frontier escalation percentage
- tokens/task
- context size distribution
- output size distribution
- latency percentile
- error/fallback rate

### Module owner

- TenderLogix AI cost per tender
- DrawLogix AI cost per drawing set
- ScheduleLogix AI cost per schedule analysis
- DocLogix AI cost per 1,000 documents

---

# 21. Cost Guardrails

Every request has four budgets:

1. input-token budget
2. output-token budget
3. dollar/compute budget
4. latency budget

The router rejects or changes route when a budget would be exceeded.

Example behavior:

```text
Requested task estimated at $0.76
Tenant interactive task limit = $0.20

Router options:
1. reduce retrieved context
2. use private model
3. split into subtasks
4. return cached/structured facts
5. send for batch processing
6. require explicit high-cost workflow authorization
```

Do not silently spend beyond configured limits.

---

# 22. Hosted Model Economics

Self-hosted inference is not automatically cheaper.

The correct comparison is:

```text
Hosted cost per successful task =
  allocated GPU infrastructure cost
+ orchestration cost
+ storage/index cost
+ operations/SRE cost
+ failed/retried inference cost
---------------------------------
  successful validated tasks
```

Compare against:

```text
External cost per successful task =
  input token cost
+ cached input cost
+ output token cost
+ provider tool cost
+ retry/fallback cost
```

The model registry and FinOps service should calculate both.

## Break-even

A private model is a financial win only when:

- sufficient utilization exists, or hardware can scale down economically
- task quality meets threshold
- operational burden is acceptable
- data/privacy requirements provide independent value

For enterprise on-prem, sovereignty may justify private inference even before pure token-cost break-even.

---

# 23. Self-Hosted Model Serving

The recommended initial inference-serving abstraction is an OpenAI-compatible HTTP API behind the AI Fabric provider adapter.

vLLM is a strong initial candidate because its official documentation supports OpenAI-compatible serving, production metrics, and distributed serving. Mistral's official self-deployment documentation recommends vLLM for local deployment, and Qwen's official deployment documentation also recommends vLLM for Qwen serving.

Preckon should nevertheless keep vLLM behind an adapter so the runtime can later support:

- alternate inference servers
- CPU/edge runtimes
- optimized NVIDIA runtimes
- customer-standard inference infrastructure

## Model selection gate

Do not select an open-weight model because of leaderboard position alone.

Benchmark against Preckon golden construction workloads:

- extraction accuracy
- schema correctness
- citation behavior
- tool calling
- multilingual GCC/India requirements
- drawing/multimodal quality where needed
- latency
- throughput
- VRAM
- concurrency
- quantized quality
- license/commercial terms

---

# 24. SaaS Deployment Topology

```text
Internet
   │
WAF / Edge
   │
Preckon SaaS Application
   │
Internal Service Network
   ├── MySQL
   ├── Redis
   ├── Object Storage
   ├── Semantic Index
   ├── AI Fabric API
   │      ├── Workers
   │      ├── Policy/Router
   │      └── Provider Adapters
   │
   └── Private GPU Inference Pool
             │
             └── External Frontier Egress Proxy (policy controlled)
```

SaaS goals:

- shared infrastructure with strict tenant isolation
- GPU pooling across tenants
- autoscaling where economically sensible
- provider egress through controlled gateway only
- per-tenant AI budget and policy
- cost attribution

---

# 25. Customer Private Cloud / VPC Topology

```text
Customer Cloud Account / Subscription
┌────────────────────────────────────────────────────┐
│ Preckon Private Deployment                         │
│                                                    │
│ App │ MySQL │ Redis │ Object Store │ AI Fabric    │
│                                    │               │
│                                    ├─ Local GPU    │
│                                    └─ Optional     │
│                                       approved     │
│                                       external AI  │
└────────────────────────────────────────────────────┘
```

The customer can choose:

- local-only inference
- private model + approved external escalation
- customer-provided model endpoints
- customer-owned provider API keys

---

# 26. Air-Gapped / On-Prem Topology

```text
Customer Data Center
┌─────────────────────────────────────────────────────────┐
│ NO REQUIRED INTERNET EGRESS                             │
│                                                         │
│ Preckon UI/Application                                  │
│      │                                                  │
│ MySQL ─ Redis ─ MinIO/S3-compatible storage             │
│      │                                                  │
│ Preckon AI Fabric                                       │
│      │                                                  │
│ Private Inference Server(s)                             │
│      │                                                  │
│ Customer GPU Infrastructure                             │
└─────────────────────────────────────────────────────────┘
```

Deliverable should include:

- signed container images
- Helm chart and/or supported Compose package by deployment tier
- model-weight manifest
- model license manifest
- checksums
- software bill of materials
- offline installation bundle
- migration scripts
- configuration templates
- backup/restore procedure
- health diagnostics
- support-bundle export

Telemetry egress must be disabled by default for true air-gapped installations.

---

# 27. Enterprise AI Policy

Tenant policy should support controls such as:

```yaml
ai_policy:
  deployment_mode: private

  sensitivity:
    public:
      external_models: allowed
    internal:
      external_models: allowed
    confidential:
      external_models: denied
    restricted:
      external_models: denied

  modules:
    TenderLogix:
      frontier: denied
    Marketing:
      frontier: allowed

  budgets:
    daily_usd: 500
    project_monthly_usd: 1500
    single_request_usd: 1.00

  retention:
    provider_request_logging: denied

  model_allowlist:
    - preckon-small
    - preckon-reasoning
```

Policy is evaluated server-side. UI configuration does not bypass enforcement.

---

# 28. Security Architecture

## 28.1 Network

- inference servers are internal-only
- no public vLLM endpoint
- provider egress from a controlled service only
- on-prem egress default-deny
- mTLS/service identity for production internal calls where appropriate
- private subnets/security groups/network policies

vLLM's official security documentation notes that distributed communication components can expose network listeners if deployments are not properly isolated; Preckon deployments must therefore explicitly firewall and restrict inference/distributed-runtime networking.

## 28.2 Secrets

- no provider keys in module code
- no keys in prompts
- secret manager/KMS/Vault abstraction
- enterprise deployment supports customer-managed secrets

## 28.3 Prompt injection

Treat retrieved documents as untrusted data, not instructions.

Separate:

- system policy
- trusted task instructions
- tool definitions
- retrieved evidence

The model must not obey instructions embedded in uploaded tender documents, PDFs, emails, or drawings that attempt to change its execution policy.

## 28.4 Tool safety

AI tools are read-only by default.

Write operations require application-layer command validation and appropriate human/workflow approval.

## 28.5 Model supply chain

For self-hosted models record:

- source
- exact version
- checksum
- license
- approval record
- security scan result
- evaluation result

## 28.6 Data isolation

All retrieval, memory, cache, artifact, and telemetry keys include tenant scope.

Never allow semantic retrieval across tenant boundaries.

---

# 29. Database Additions

The following MySQL tables are recommended for the control plane.

## `ai_job`

```sql
CREATE TABLE ai_job (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  module VARCHAR(64) NOT NULL,
  task_type VARCHAR(96) NOT NULL,
  sensitivity VARCHAR(24) NOT NULL,
  status VARCHAR(32) NOT NULL,
  request_json JSON NOT NULL,
  result_artifact_ref VARCHAR(255) NULL,
  error_code VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  INDEX ix_ai_job_tenant_project (tenant_id, project_id, created_at),
  INDEX ix_ai_job_status (status, created_at)
);
```

## `ai_usage_ledger`

```sql
CREATE TABLE ai_usage_ledger (
  id CHAR(36) PRIMARY KEY,
  request_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  module VARCHAR(64) NOT NULL,
  task_type VARCHAR(96) NOT NULL,
  execution_class VARCHAR(32) NOT NULL,
  model_alias VARCHAR(96) NULL,
  provider VARCHAR(96) NULL,
  model_version VARCHAR(160) NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  cached_input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  retrieval_tokens BIGINT NOT NULL DEFAULT 0,
  gpu_milliseconds BIGINT NOT NULL DEFAULT 0,
  provider_cost_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  allocated_compute_cost_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  total_estimated_cost_usd DECIMAL(18,8) NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  cache_hit TINYINT(1) NOT NULL DEFAULT 0,
  confidence DECIMAL(8,6) NULL,
  outcome VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  INDEX ix_ai_usage_tenant_date (tenant_id, created_at),
  INDEX ix_ai_usage_project_date (project_id, created_at),
  INDEX ix_ai_usage_module_task (module, task_type, created_at)
);
```

## `ai_tenant_policy`

```sql
CREATE TABLE ai_tenant_policy (
  tenant_id CHAR(36) PRIMARY KEY,
  policy_version INT NOT NULL,
  policy_json JSON NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(6) NOT NULL
);
```

## `ai_prompt_version`

```sql
CREATE TABLE ai_prompt_version (
  id CHAR(36) PRIMARY KEY,
  prompt_key VARCHAR(128) NOT NULL,
  version INT NOT NULL,
  task_type VARCHAR(96) NOT NULL,
  prompt_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_prompt_version (prompt_key, version)
);
```

## `ai_model_registry`

```sql
CREATE TABLE ai_model_registry (
  alias VARCHAR(96) PRIMARY KEY,
  provider VARCHAR(96) NOT NULL,
  provider_model VARCHAR(160) NOT NULL,
  deployment_type VARCHAR(32) NOT NULL,
  capabilities_json JSON NOT NULL,
  limits_json JSON NOT NULL,
  rate_card_json JSON NOT NULL,
  license_json JSON NULL,
  evaluation_version VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL,
  updated_at DATETIME(6) NOT NULL
);
```

## `ai_artifact`

Use metadata in MySQL and large content in object storage.

```sql
CREATE TABLE ai_artifact (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  artifact_type VARCHAR(96) NOT NULL,
  object_uri VARCHAR(512) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  source_revision_key VARCHAR(255) NULL,
  prompt_version VARCHAR(64) NULL,
  model_alias VARCHAR(96) NULL,
  validation_status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  INDEX ix_ai_artifact_scope (tenant_id, project_id, artifact_type, created_at)
);
```

Additional evaluation tables should be added in the evaluation workstream.

---

# 30. API Boundaries

## Public/module-facing application API

The module talks to the authoritative Next.js application layer.

Suggested endpoints:

```text
POST /api/ai/jobs
GET  /api/ai/jobs/{id}
POST /api/ai/jobs/{id}/cancel
POST /api/ai/jobs/{id}/approve
POST /api/ai/jobs/{id}/reject
GET  /api/ai/usage/project/{projectId}
```

## Internal AI Fabric API

```text
POST /v1/ai/execute
POST /v1/ai/estimate
POST /v1/ai/embed
POST /v1/ai/retrieve
GET  /v1/ai/health
```

Async workloads should normally use the durable job + Redis/arq pattern.

Interactive low-latency tasks can use synchronous internal execution when safe.

---

# 31. Async Job Flow

```text
User action
  ↓
Next.js validates auth / tenant / project / entitlement
  ↓
Create ai_job in MySQL
  ↓
Enqueue immutable request to Redis/arq
  ↓
AI worker consumes
  ↓
AI Fabric routes/executes
  ↓
Store large output as ai_artifact
  ↓
Append ai_usage_ledger
  ↓
Update ai_job status/result ref through controlled application boundary
  ↓
UI receives completion
  ↓
Human review/approval where required
```

Idempotency keys prevent duplicate cost when the UI or worker retries.

---

# 32. Model Provider Interface

Provider adapters should expose a normalized interface.

```python
class ModelProvider:
    async def generate(
        self,
        model_alias,
        messages,
        tools,
        response_schema,
        token_budget,
        timeout,
    ) -> ProviderResult:
        ...
```

`ProviderResult` normalizes:

- content
- tool calls
- input tokens
- cached tokens
- output tokens
- latency
- provider request ID
- finish reason
- provider errors

Provider-specific APIs stay inside adapters.

---

# 33. Evaluation Framework

Do not route by intuition.

Every important task needs a golden dataset.

## Example datasets

### Tender requirement extraction

- source pages
- expected requirements
- mandatory/advisory label
- units/values
- source citations

### Tender-to-BOQ

- tender/SOW evidence
- expected work packages
- expected mappings
- known missing scope

### Drawing analysis

- drawing/sheet
- expected entities
- expected dimensions/relationships where deterministically available
- expected citations

### Schedule analysis

- schedule inputs
- expected deterministic values
- expected risk classification/explanation

## Metrics

- precision
- recall
- F1
- exact match where suitable
- schema validity
- citation correctness
- evidence faithfulness
- hallucination rate
- no-answer correctness
- deterministic reconciliation
- latency
- input/output tokens
- cost/successful validated task

## Model promotion rule

A model/version cannot become an approved production alias until it:

1. passes task-quality threshold
2. passes security/policy review
3. passes latency threshold
4. has measured economics
5. has a rollback target

---

# 34. Continuous Cost Optimization Loop

```text
Production telemetry
        ↓
Find expensive/high-volume task
        ↓
Determine cause
  ├─ repeated context?
  ├─ poor cache hit?
  ├─ too much output?
  ├─ frontier over-routing?
  ├─ redundant agent step?
  └─ weak retrieval?
        ↓
Optimize
        ↓
Run golden evaluation
        ↓
Canary
        ↓
Promote
```

Cost optimization changes must pass quality evaluation. Saving tokens while silently reducing accuracy is not acceptable.

---

# 35. Initial AI Economics Targets

These are engineering goals to validate, not customer promises.

By the time the AI Fabric is mature enough for broad production use, target:

- **60–80% reduction in external frontier-model token consumption** versus a naive “send context to frontier model” architecture
- **<10% frontier escalation** for mature routine task classes
- **20–30%+ no-LLM execution** where deterministic tools can replace model reasoning
- **20%+ combined exact/semantic/artifact cache contribution** on repetitive enterprise workloads, with higher rates expected on common project questions
- **100% AI calls metered**
- **100% project-specific AI answers carrying provenance where evidence exists**
- **0 direct provider API calls from Preckon modules**
- **0 authoritative business changes committed directly by AI**

Targets must be adjusted based on measured production workloads.

---

# 36. Preckon AI Product Tiers

The AI Fabric is an internal architecture. Customers should experience a coherent Preckon AI capability, not a collection of model vendors.

## 36.1 Preckon Edge

**Purpose:** lowest-cost, high-volume, predictable AI execution close to the workload.

Typical responsibilities:

- document and discipline classification
- metadata/entity extraction
- tagging and normalization
- RFI/submittal triage
- language detection
- title-block extraction
- lightweight embeddings/reranking where suitable
- simple structured transformations

Characteristics:

- small open-weight or task-specific models
- CPU/edge/GPU deployment depending on workload
- strongly schema-constrained outputs
- low latency and high throughput
- private by default
- inexpensive enough to run at enterprise scale

`preckon-small` and related aliases are implementation details underneath this tier.

## 36.2 Preckon Construction AI

**Purpose:** Preckon's domain-specialized construction intelligence layer.

Typical responsibilities:

- tender requirement extraction
- specification mapping
- tender-to-BOQ mapping
- scope-gap detection
- change impact reasoning
- schedule risk explanation
- drawing/specification alignment
- construction Q&A grounded in project evidence
- cross-module reasoning over the canonical construction model

This tier combines:

```text
Approved open-weight/private reasoning model
          +
Preckon prompt/task registry
          +
Construction ontology and canonical data model
          +
Project memory and provenance
          +
RAG / knowledge relationships
          +
Deterministic tools
          +
Preckon evaluation datasets
          =
Preckon Construction AI
```

Over time, Preckon may add supervised fine-tuning, parameter-efficient adaptation, distillation, preference/evaluation tuning, and task-specific models where legally and technically justified.

The defensible asset is not the base model alone. It is the complete construction intelligence system and the data/evaluation flywheel around it.

## 36.3 Preckon Frontier

**Purpose:** controlled escalation to the best eligible external or premium model when materially higher capability is required.

Use cases:

- difficult ambiguity after private-model validation failure
- novel multidisciplinary reasoning
- hard multimodal analysis
- high-value workflows where approved frontier quality materially exceeds private alternatives

Rules:

- never the default route
- always policy-controlled
- sensitivity-aware
- budget-controlled
- usage-metered
- replaceable through provider adapters
- optional/disabled for private and sovereign deployments

## 36.4 Tier selection is dynamic

A customer buying a higher AI tier does not force every request onto a larger model. The AI Fabric still uses the cheapest qualified execution path.

Example:

```text
Enterprise AI-enabled customer request
        ↓
Can deterministic software answer? → yes → no LLM
        ↓ no
Verified cache? → yes → reuse
        ↓ no
Preckon Edge sufficient? → yes → Edge
        ↓ no
Preckon Construction AI sufficient? → yes → Construction AI
        ↓ no
Policy allows Frontier? → yes → Frontier
        ↓ no
Return private result / review-required outcome
```

This preserves quality while protecting customer latency and Preckon economics.

---

# 37. Preckon Private AI and Sovereign AI

Private deployment is a product capability, not a fork of Preckon.

## 37.1 Preckon Private AI

**Definition:** Preckon AI Fabric and approved private models deployed inside a customer-controlled cloud account, subscription, VPC/VNet, or managed isolated environment.

Capabilities can include:

- customer-controlled storage and network boundary
- private model endpoints
- customer-managed encryption keys/secrets
- no external AI for confidential/restricted data
- optional allowlisted frontier escalation
- customer-owned provider API keys if desired
- centralized policy/audit/FinOps
- private Integration Hub connectors

Commercial positioning:

> **Preckon Private AI — enterprise construction intelligence inside your security boundary.**

## 37.2 Preckon Sovereign AI

**Definition:** fully isolated, on-premises or sovereign-cloud deployment where project data, model execution, retrieval, memory, logs, and AI artifacts remain inside the approved sovereign/customer environment and no internet egress is required for operation.

Capabilities include:

- air-gapped/no-egress mode
- offline model and container packages
- signed artifacts and checksums
- customer GPU infrastructure
- local object store/database/index
- local observability
- offline upgrades and support-bundle export
- customer-controlled backup/restore
- local-only Integration Hub connectors where required

Commercial positioning:

> **Preckon Sovereign AI — construction intelligence with no mandatory external AI or data egress.**

## 37.3 Same logical product, different deployment topology

```text
                    PRECKON PRODUCT
                          │
                 PRECKON AI FABRIC
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
   Preckon SaaS      Private AI       Sovereign AI
   Preckon-hosted    Customer VPC     On-prem/air-gap
        │                 │                  │
 pooled private AI   customer/private   local-only models
 + optional frontier + optional frontier no required frontier
```

Module teams must not special-case these deployment modes. Deployment policy and provider availability are resolved by the AI Fabric.

## 37.4 Enterprise policy examples

Customers must be able to express policies such as:

```text
External frontier AI
  ✓ public information
  ✓ explicitly approved non-confidential reasoning
  ✕ tender pricing
  ✕ contracts
  ✕ BOQ/commercial data
  ✕ restricted drawings
  ✕ personally sensitive enterprise records

Private/Sovereign Preckon AI
  ✓ approved project workloads
```

The gateway enforces these rules server-side. A module or user prompt cannot bypass them.

---

# 38. AI Commercial and Pricing Architecture

AI architecture and AI monetization must be separated.

## 38.1 Internal unit economics

Internally Preckon should measure:

- uncached/cached input tokens
- output tokens
- retrieval tokens
- embeddings/index cost
- GPU seconds/milliseconds
- CPU/RAM/storage allocation
- provider tool fees
- retries/fallbacks
- model serving/SRE allocation
- cost per successful validated task

These measures are essential for FinOps, routing, and gross-margin control.

## 38.2 Customer-facing value units

Preckon should not primarily expose raw token billing to normal customers. Preferred commercial dimensions include:

- number/scale of projects
- named or active users
- enabled Logix modules
- document/drawing/project capacity bands
- enterprise throughput/capacity
- AI intelligence tier
- Private AI deployment
- Sovereign AI deployment
- premium support/SLA
- optional unusually expensive specialist workloads where a separate consumption unit is justified

Final packaging remains a commercial decision, but engineering must not design the product around pass-through token billing.

## 38.3 Margin principle

If an AI workflow costs Preckon $30 today and architectural improvements reduce it to $3 without reducing quality, the $27 efficiency gain should primarily strengthen Preckon's gross margin and strategic pricing flexibility.

```text
Customer value       ↑
AI capability        ↑
Workflow automation  ↑

while

Tokens/workflow      ↓
Frontier dependency  ↓
Compute cost/task    ↓
Retries/rework       ↓

therefore

Gross margin         ↑
Pricing flexibility  ↑
Enterprise scale     ↑
```

Do not automatically translate every infrastructure saving into a lower customer price.

## 38.4 Cost allocation and entitlements

Even when customers do not see tokens, Preckon should maintain internal fair-use/capacity controls:

- per-tenant concurrency
- project ingestion limits
- interactive request budgets
- batch quotas
- expensive-task authorization
- frontier eligibility
- GPU capacity class
- rate limits

These controls protect service quality and prevent one customer/workflow from consuming disproportionate infrastructure.

## 38.5 Enterprise deployment economics

Private/Sovereign AI can carry separate commercial value because the customer receives:

- data sovereignty
- model control
- isolated infrastructure
- deployment engineering
- customer-specific hardening
- offline/regulated operation
- dedicated capacity
- support and upgrade obligations

The price should reflect this enterprise value and operational responsibility, not just raw GPU cost.

---

# 39. AI Efficiency as a Competitive Moat

Token reduction is not merely a cost-saving project. It is part of Preckon's product defensibility.

## 39.1 The compounding advantage

Every approved reusable project fact, requirement, relationship, mapping, evaluation case, and deterministic tool result can reduce future inference while improving quality.

```text
More customer/project usage
        ↓
More canonical structured knowledge
        ↓
More reusable verified artifacts
        ↓
Better retrieval / routing / evaluations
        ↓
Fewer unnecessary model calls
        ↓
Higher private-model coverage
        ↓
Lower cost per successful workflow
        ↓
Better margins + more competitive enterprise offering
```

Subject to tenant isolation, licensing, privacy, and contractual rights, aggregate learnings should improve platform algorithms and evaluation systems without leaking customer confidential data.

## 39.2 What Preckon should own

Long-term proprietary value should concentrate in:

- canonical construction data model
- construction ontology and relationship model
- project-memory architecture
- source/revision provenance
- task taxonomy
- routing policies
- deterministic construction engines
- prompt/task registry
- evaluation/golden datasets
- domain-specific model adaptations
- reusable AI artifacts
- Integration Hub normalized tools/connectors
- private/sovereign deployment architecture
- AI FinOps data and optimization methods

Any individual base model can be replaced.

## 39.3 Board-level AI efficiency KPIs

Track at least:

- external-model cost / ARR
- total AI cost / ARR
- AI cost / project
- AI cost / module workflow
- cost / successful validated task
- frontier escalation percentage
- private-model coverage percentage
- no-LLM execution percentage
- verified cache/artifact reuse percentage
- average retrieval tokens/task
- average output tokens/task
- gross margin after AI infrastructure
- accuracy/quality at each route

A reduction in cost that lowers task quality is not progress.

## 39.4 North-star objective

Preckon's long-term objective is:

> **Deliver increasingly capable construction intelligence while making the marginal cost of a common validated AI workflow fall over time.**

The ideal mature workload becomes progressively less dependent on expensive general-purpose external inference because Preckon already understands the project's structured construction state.

## 39.5 Strategic result

Preckon should be difficult to displace not because it has access to a particular LLM, but because it has accumulated the construction-specific knowledge architecture, validated workflows, economics, deployment flexibility, and evaluation system required to use any capable model efficiently and safely.

---

# 40. Implementation Workstreams

The AI Fabric should be built in parallel with continuing Logix product development.

## Workstream A — AI Platform

- AI request contract
- gateway
- model abstraction
- router
- budget engine
- policy engine
- provider adapters
- retry/circuit breaker
- structured validation

## Workstream B — Knowledge & Context

- ingestion pipeline
- chunking
- canonical extraction
- semantic index
- revision-aware retrieval
- project memory
- provenance

## Workstream C — Private Inference

- vLLM/reference runtime
- benchmark harness
- model selection
- quantization tests
- GPU sizing
- autoscaling strategy
- model registry

## Workstream D — AI FinOps & Evaluation

- usage ledger
- dashboards
- rate cards
- evaluation datasets
- regression runner
- model/prompt promotion gates

## Workstream E — Enterprise Deployment

- private VPC package
- on-prem package
- offline installation
- customer-managed keys
- no-egress mode
- support/diagnostics
- upgrade strategy

---

# 41. Phased Implementation

The phases below are sequencing guidance; several tracks should run in parallel.

## Phase 0 — Baseline and Architecture Freeze

**Goal:** Ensure Preckon knows its starting AI economics and interfaces.

Deliverables:

- ADR: AI Fabric boundary
- task taxonomy v1
- sensitivity model v1
- model alias contract
- AI request/response schemas
- usage event schema
- current-token baseline for representative workflows
- initial golden evaluation set

Exit criteria:

- module teams cannot introduce new direct model calls
- representative baseline cost can be measured

## Phase 1 — Gateway, Policy, Metering

Build:

- `/v1/ai/execute`
- provider interface
- external provider adapter
- model registry
- tenant policy
- request budgets
- rate card
- usage ledger
- OpenTelemetry/metrics hooks
- retries/circuit breakers

Exit criteria:

- every model call flows through AI Fabric
- usage is attributable by tenant/project/module/task

## Phase 2 — Retrieval and Context Budgeting

Build:

- ingestion hash/dedup
- revision-aware chunking
- semantic index adapter
- hybrid retrieval
- context budget allocator
- project memory v1
- citations/provenance

Exit criteria:

- no representative Q&A workflow sends complete project document sets by default
- retrieval evaluation exists

## Phase 3 — Cache and Deterministic-First Routing

Build:

- deterministic task registry
- tool adapters
- exact cache
- computed artifact cache
- semantic cache
- invalidation/version keys

Exit criteria:

- router demonstrably avoids LLM calls on defined deterministic tasks
- cache hit/miss telemetry is visible

## Phase 4 — Private Model Runtime

Build:

- internal inference endpoint
- approved vLLM deployment
- small-model benchmark
- reasoning-model benchmark
- model registry deployment mapping
- GPU utilization telemetry
- private-first routing

Exit criteria:

- production-like task classes can run with no external provider
- private model quality/cost is benchmarked against frontier baseline

## Phase 5 — Confidence, Validation, Escalation

Build:

- task-specific validators
- confidence composition
- escalation rules
- review workflow integration
- fallback logic

Exit criteria:

- private model failures can be detected and handled rather than silently accepted

## Phase 6 — Enterprise Private/VPC Deployment

Build:

- infrastructure templates
- customer-managed secrets
- private object storage configuration
- local inference
- optional approved external egress
- backup/restore
- upgrade path

Exit criteria:

- full representative Preckon AI workflow operates inside a customer-controlled cloud account

## Phase 7 — Air-Gapped On-Prem

Build:

- offline artifact/model repository
- signed bundle
- no-egress validation
- local license/config flow
- support bundle
- offline upgrade procedure

Exit criteria:

- customer can execute the target workflow with external networking disabled

## Phase 8 — Preckon Construction Model Adaptation

Only after sufficient legally usable training/evaluation data exists:

- supervised fine-tuning or parameter-efficient adaptation where technically and legally appropriate
- domain-specific distillation where permitted
- construction preference/evaluation tuning
- task-specific small models where justified

The goal is not to create a foundation model from scratch. The goal is to progressively own more of the high-volume construction inference path.

---

# 42. Recommended Initial Team

A practical dedicated parallel team:

| Role | Focus |
|---|---|
| AI Platform / Solution Architect | architecture, routing, contracts, enterprise topology |
| 2 Backend/Platform Engineers | Next.js/TypeScript + Python/FastAPI integration, jobs, policy, APIs |
| 2 ML/AI Engineers | retrieval, models, inference, benchmark/evaluation |
| Data/Knowledge Engineer | ingestion, canonical extraction, semantic index, provenance |
| DevOps/SRE | GPU/runtime, Kubernetes/containers, monitoring, private deployment |
| QA/Evaluation Engineer | golden datasets, regression, quality gates |
| Security Architect (fractional initially) | threat model, on-prem, model/data security |

A smaller team can begin the gateway, metering, and retrieval foundation, but private inference + enterprise packaging should not be treated as a one-engineer side project.

---

# 43. Suggested Repository Structure

```text
preckon/
├─ apps/
│  └─ web/
├─ services/
│  ├─ ai-fabric/
│  │  ├─ app/
│  │  │  ├─ api/
│  │  │  ├─ core/
│  │  │  ├─ providers/
│  │  │  ├─ routing/
│  │  │  ├─ retrieval/
│  │  │  ├─ memory/
│  │  │  ├─ validation/
│  │  │  ├─ telemetry/
│  │  │  └─ workers/
│  │  ├─ config/
│  │  └─ tests/
│  └─ ...
├─ packages/
│  ├─ ai-contracts/
│  ├─ domain-contracts/
│  └─ observability/
├─ ai/
│  ├─ prompts/
│  ├─ evals/
│  ├─ datasets/
│  ├─ model-registry/
│  └─ benchmarks/
├─ deploy/
│  ├─ saas/
│  ├─ private-cloud/
│  └─ on-prem/
└─ docs/
   └─ architecture/
      └─ ai-fabric/
```

Cross-language contracts should be generated/versioned from OpenAPI/JSON Schema rather than manually duplicated between TypeScript and Python.

---

# 44. First Engineering Sprint Backlog

## Epic A — Contract

- define `AIRequest` schema
- define `AIResponse` schema
- define `UsageEvent` schema
- define task type enum/registry
- define sensitivity enum
- publish OpenAPI
- generate TypeScript types

## Epic B — Gateway

- FastAPI internal endpoint
- service-to-service authentication
- request validation
- idempotency
- structured logging
- error taxonomy

## Epic C — Router

- deterministic-task registry
- local-small task registry
- private-reasoning task registry
- external eligibility policy
- budget checks

## Epic D — Ledger

- create `ai_job`
- create `ai_usage_ledger`
- persist request lifecycle
- cost calculator/rate card
- tenant/module/task dashboard query

## Epic E — Starter provider adapters

- external provider adapter
- OpenAI-compatible local provider adapter
- disabled-by-default frontier configuration

## Epic F — Evaluation baseline

Create at least 25–50 high-quality cases each for the first two important AI task classes rather than hundreds of weak synthetic tests.

Recommended first Preckon task classes:

1. tender requirement extraction
2. document/discipline classification

---

# 45. Second Sprint / Early Foundation

- document digest service
- immutable source/revision references
- chunk schema
- semantic index abstraction
- retrieval service
- context-budget implementation
- source citation contract
- exact cache
- first dashboard

Then benchmark current frontier-only baseline against:

```text
A. naive full/large context
B. RAG + frontier
C. RAG + cache + frontier
D. RAG + small private model
E. RAG + private reasoning model with frontier escalation
```

Measure quality, cost, and latency on the same golden dataset.

---

# 46. First Production Use Case

Do not begin with the hardest DrawLogix multimodal problem.

Recommended AI Fabric proving workflow:

## TenderLogix — Requirement Extraction

Why:

- high business value
- document-heavy, so token savings are visible
- structured output is possible
- ground truth can be reviewed by domain experts
- good fit for RAG
- good fit for private models
- direct path to tender-to-BOQ

Workflow:

```text
Tender upload
  ↓
Hash/dedup
  ↓
Parse/index
  ↓
Extract candidate requirements
  ↓
Private model
  ↓
Schema validation
  ↓
Source citation validation
  ↓
Human review
  ↓
Approved requirement records
  ↓
Reusable canonical data for BOQ and downstream workflows
```

Once an approved requirement becomes canonical structured data, downstream workflows should reuse it instead of paying to rediscover it.

---

# 47. DrawLogix Special Handling

Drawings can be extremely expensive if every interaction sends full-resolution pages to multimodal frontier models.

Use a staged architecture:

```text
Drawing ingest
  ↓
Native/vector extraction where possible
  ↓
Sheet metadata / title block / view regions
  ↓
Geometry/text/object extraction
  ↓
Tile/region indexing
  ↓
Only relevant region(s) sent to vision model
```

For a question about Detail 6 on Sheet A-501, do not transmit the entire 300-sheet drawing package.

Cache visual embeddings, sheet summaries, detected entities, and region references by drawing revision.

---

# 48. ScheduleLogix Special Handling

Scheduling is a major opportunity to avoid token waste.

The model should not calculate CPM itself.

```text
User: "What causes the completion delay?"
  ↓
AI understands intent
  ↓
Schedule engine calculates critical/near-critical paths and deltas
  ↓
AI receives compact structured result
  ↓
AI explains causes, risks and actions
```

This is cheaper and more reliable than sending a giant schedule to an LLM and asking it to infer the calculation.

---

# 49. Enterprise Integration Hub Interaction

The Integration Hub and AI Fabric should share a governed tool boundary.

```text
AI Fabric
   │
   └─ Tool Gateway
        ├─ Preckon domain APIs
        ├─ Integration Hub canonical APIs
        ├─ Primavera connector
        ├─ ERP connector
        ├─ Autodesk/BIM connector
        └─ other approved connectors
```

AI gets normalized tool results rather than raw external-system exports whenever possible.

This prevents every agent from learning every vendor API and reduces context size.

---

# 50. What Not to Build

Do **not**:

- train a foundation LLM from scratch
- let every module choose its own model
- put provider keys in module code
- send full tender packages for routine questions
- use an LLM for arithmetic/CPM/permissions
- keep entire chat history in every request
- allow autonomous agents to free-form chat indefinitely
- use model-reported confidence as the sole quality signal
- introduce a graph database, multiple vector stores, or heavyweight agent framework before a measured need
- hard-code today's provider prices
- hard-code today's model names
- allow AI to commit authoritative business state
- make internet access a requirement for on-prem inference
- buy enterprise GPU hardware before benchmarking real Preckon workloads

---

# 51. Definition of Done for AI Fabric v1

AI Fabric v1 is complete when:

1. all AI calls route through the internal gateway
2. every request is authorized and tenant-scoped
3. every request has token/cost/latency budgets
4. deterministic tasks bypass LLMs
5. retrieval uses revision-aware evidence
6. project-specific answers return provenance
7. exact caching is operational
8. usage ledger records every attempt
9. at least one private model is production-approved for one meaningful task class
10. frontier escalation is policy-controlled
11. quality regression suite runs automatically
12. application code uses model aliases only
13. AI cannot directly commit business changes
14. SaaS deployment is supported
15. private-cloud deployment has a reproducible package
16. product configuration maps customer AI entitlements to Preckon Edge / Construction AI / Frontier without exposing vendor models
17. Private AI and Sovereign AI policy profiles are represented in configuration and deployment manifests
18. AI economics dashboards report cost per successful validated task and frontier/private/no-LLM coverage

Air-gapped certification can be the next enterprise milestone if it is not required for the first enterprise customer.

---

# 52. Strategic Outcome

This architecture changes Preckon from:

> a construction application dependent on third-party AI APIs

into:

> **a model-independent Construction Intelligence Platform that owns its knowledge, routing, economics, policy, evaluation, and deployment boundary.**

The long-term proprietary assets become:

- Preckon Construction Model
- construction ontology and relationships
- normalized project memory
- tender/drawing/schedule/cost datasets
- evaluation datasets
- construction-specific routing policy
- high-value reusable AI artifacts
- private construction-model adaptations
- Integration Hub tools/connectors
- customer deployment architecture

Models will improve and change. Preckon should be able to replace them without re-architecting the product.

Commercially, Preckon should capture the benefit of this architecture through higher gross-margin efficiency, predictable enterprise operating economics, and premium Private/Sovereign deployment capabilities rather than becoming a pass-through reseller of model tokens.

---

# 53. Immediate Decision List

Engineering and product leadership should approve these decisions now:

1. **Preckon AI Fabric is mandatory infrastructure.**
2. **No direct LLM API use from modules.**
3. **AI remains non-authoritative.**
4. **The AI request carries sensitivity and hard economics budgets.**
5. **RAG/context engineering is implemented before scaling model usage.**
6. **Private-model serving begins with benchmark-driven open-weight deployment, not foundation-model training.**
7. **SaaS, Private AI, and Sovereign AI use the same logical architecture.**
8. **Enterprise deployment can disable all external AI.**
9. **AI FinOps and evaluation ship with the platform, not later.**
10. **Preckon customer-facing AI tiers are Preckon Edge, Preckon Construction AI, and Preckon Frontier.**
11. **Private AI and Sovereign AI are explicit enterprise deployment offerings, not custom forks.**
12. **Customer pricing is value/capacity-oriented rather than primarily pass-through token billing.**
13. **AI efficiency and declining cost per validated workflow are product/board KPIs.**
14. **TenderLogix requirement extraction is the recommended first proving workload.**

---

# 54. Primary Technical References

The architecture deliberately relies on portable interfaces, but the following current primary-source documentation supports the initial implementation choices:

- OpenAI API — Prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI API — Pricing: https://developers.openai.com/api/docs/pricing
- OpenAI API — Production best practices: https://developers.openai.com/api/docs/guides/production-best-practices
- vLLM — Documentation: https://docs.vllm.ai/en/latest/
- vLLM — Production metrics: https://docs.vllm.ai/en/stable/design/metrics/
- vLLM — Security: https://docs.vllm.ai/en/latest/usage/security/
- Mistral — Self-deployment: https://docs.mistral.ai/models/deployment/local-deployment
- Mistral — vLLM local deployment: https://docs.mistral.ai/models/deployment/local-deployment/vllm
- Qwen — vLLM deployment: https://qwen.readthedocs.io/en/latest/deployment/vllm.html

Provider/model versions, licenses, prices, supported features, and hardware characteristics must always be revalidated during implementation rather than copied permanently from this document.

---

# Appendix A — Reference Routing Pseudocode

```python
async def execute_ai(request):
    authorize(request)
    policy = get_tenant_policy(request.tenant_id)
    enforce_data_policy(request, policy)

    budget = clamp_to_tenant_limits(request.budget, policy)

    exact = await exact_cache.get(fingerprint(request))
    if exact and still_valid(exact, request):
        return finish(exact, route="cache")

    if deterministic_registry.can_handle(request.task_type):
        result = await deterministic_registry.execute(request)
        validate(result)
        return finish(result, route="deterministic")

    context = await context_builder.build(
        request,
        token_budget=budget.max_input_tokens,
        current_revisions_only=True,
    )

    semantic = await semantic_cache.lookup(request, context.revision_key)
    if semantic and semantic.is_safe_reuse:
        return finish(semantic.result, route="cache")

    candidates = model_registry.eligible_models(
        task=request.task_type,
        sensitivity=request.sensitivity,
        tenant_policy=policy,
    )

    route = router.choose(candidates, context, budget)
    result = await route.provider.generate(route.model, context)
    validation = validator.validate(request.task_type, result, context)

    if not validation.acceptable:
        route2 = router.escalate(route, candidates, budget)
        if route2:
            result = await route2.provider.generate(route2.model, context)
            validation = validator.validate(request.task_type, result, context)

    artifact = persist_ai_artifact(result, validation)
    record_usage(request, route, result.usage, validation)

    return artifact
```

---

# Appendix B — Cost Formula

For an external provider:

```text
C_external =
  (uncached_input_tokens / 1,000,000 × input_rate)
+ (cached_input_tokens / 1,000,000 × cached_input_rate)
+ (output_tokens / 1,000,000 × output_rate)
+ tool_charges
+ retries
```

For private GPU inference:

```text
C_private_task =
  GPU_hourly_allocated_cost × GPU_seconds / 3600
+ CPU/RAM allocation
+ storage/index allocation
+ serving overhead allocation
+ failed/retried inference allocation
```

Track both even if private inference has no token invoice.

---

# Appendix C — Required Architecture Decision Records

Create the following ADRs:

- ADR-AI-001: Mandatory AI Fabric boundary
- ADR-AI-002: AI non-authoritative state rule
- ADR-AI-003: Model alias/provider abstraction
- ADR-AI-004: Tenant AI policy and sensitivity enforcement
- ADR-AI-005: Deterministic-first routing
- ADR-AI-006: Context budget and retrieval architecture
- ADR-AI-007: Exact/semantic cache safety and invalidation
- ADR-AI-008: AI usage ledger and rate cards
- ADR-AI-009: Private inference serving runtime
- ADR-AI-010: SaaS/private/on-prem deployment parity
- ADR-AI-011: Evaluation/model promotion gates
- ADR-AI-012: Prompt registry/versioning
- ADR-AI-013: Model supply-chain approval
- ADR-AI-014: AI tool write restrictions
- ADR-AI-015: Preckon AI product tier abstraction
- ADR-AI-016: Private AI / Sovereign AI deployment profiles
- ADR-AI-017: AI commercial metering versus customer-facing entitlements
- ADR-AI-018: AI efficiency and cost-per-validated-workflow KPI governance

---

**End of Preckon AI Fabric Master Architecture Blueprint & Implementation Plan v1.1**

# PRECKON MASTER BLUEPRINT v1.0

**Product, Platform, Enterprise Integration, AI and Implementation Architecture**  
**Status:** Master architectural baseline  
**Date:** 13 August 2026  
**Classification:** Confidential - Product and Engineering Strategy

---

## Table of Contents

- Document Purpose
- 1\. Executive Blueprint
- 2\. Product Boundary
- 3\. Construction Lifecycle Model
- 4\. Personas and Workspaces
- 5\. System Architecture
- 6\. Reference Technology Architecture
- 7\. Domain Architecture
- 8\. Canonical Construction Data Model
- 9\. Preckon Core Services
- 10\. TenderLogix Blueprint
- 11\. DocLogix Blueprint
- 12\. DrawLogix Blueprint
- 13\. QuantLogix / BOQ Blueprint
- 14\. EstimateLogix and CostLogix Blueprint
- 15\. ScheduleLogix Blueprint
- 16\. ProcurementLogix Blueprint
- 17\. RFI, Submittal and Change Blueprint
- 18\. Field, Quality and Safety Blueprint
- 19\. Enterprise Integration Hub
- 20\. Integration Hub Validation Without Customer Systems
- 21\. Knowledge Graph
- 22\. AI Architecture
- 23\. Agent Architecture
- 24\. AI Evaluation and Governance
- 25\. Deployment Architecture
- 26\. Browser, Desktop and Mobile Architecture
- 27\. API Architecture
- 28\. Event Architecture
- 29\. Data Architecture
- 30\. Security Architecture
- 31\. Audit, Versioning and Digital Evidence
- 32\. Search and Project Intelligence
- 33\. Observability and FinOps
- 34\. Reliability and SLO Blueprint
- 35\. DevSecOps Blueprint
- 36\. Testing Strategy
- 37\. Import, Migration and Coexistence
- 38\. Multi-Region and Localization
- 39\. Standards and Domain Packs
- 40\. Packaging and Entitlement Architecture
- 41\. Repository and Engineering Organization
- 42\. Implementation Roadmap
- 43\. First 180-Day Engineering Backlog
- 44\. Architecture Decision Records to Lock Early
- 45\. Product Rules That Must Not Be Violated
- 46\. Build vs Buy Guidance
- 47\. Customer Configuration vs Custom Development
- 48\. Enterprise Onboarding Blueprint
- 49\. Product Analytics and Success Metrics
- 50\. Principal Risks and Mitigations
- 51\. Governance Model
- 52\. Definition of Done for a Preckon Feature
- 53\. Target End-State
- Appendix A - Initial Domain Event Catalog
- Appendix B - Source-of-Truth Matrix Template
- Appendix C - AI Budget Policy Example
- Appendix D - Connector Test Fixture Requirements
- Appendix E - Pilot Acceptance Gate
- Appendix F - Blueprint Relationship to Detailed Engineering Documents
---

## Document Purpose

This document is the top-level blueprint for Preckon. It defines what Preckon is, how the modules fit together, how the platform should be architected, how the SMB and enterprise offerings remain one product family, how AI is used without destroying SaaS margins, how enterprise integrations are implemented, and how engineering should build and validate the platform.

This is intentionally broader than a PRD or a single-module design. It should be used as the common reference by product, architecture, engineering, QA, DevOps, implementation, sales engineering and leadership.

The **Preckon PRA / Engineering Bible remains the detailed engineering source of truth** for object identity, bounded contexts, tenancy, authorization, events, versioning, audit, AI governance, implementation conventions and related platform rules. Where this blueprint expresses a business or architectural intent, the PRA should translate that intent into enforceable engineering contracts.

---

# 1. Executive Blueprint

## 1.1 The Preckon thesis

Preckon should become an **AI-native connected construction intelligence platform** that unifies preconstruction, design/drawing workflows, quantities, estimating, scheduling, project controls, documentation, field execution and enterprise intelligence.

The product is not intended to win by reproducing every screen in every incumbent application. It should win by doing three things better:

1. **Connect the construction lifecycle** so project information is not trapped in disconnected systems, drawings, spreadsheets, emails and departmental tools.
2. **Turn project data into intelligence** through deterministic construction engines, structured project memory and carefully governed AI.
3. **Adapt to customer scale**: provide a complete native Preckon experience for SMB/mid-market customers and an integration/intelligence layer for large enterprises that cannot replace their existing ERP, Primavera, Autodesk, CDE and other systems immediately.

## 1.2 One platform, two market motions

| Customer segment | Product motion | Primary value |
|---|---|---|
| Small / Medium | **Preckon Standard** | Replace fragmented spreadsheets and point tools with a connected construction operating platform. |
| Mid-market | **Preckon Professional** | Deeper controls, multi-project operations, more automation, stronger commercial and document workflows. |
| Large / XL | **Preckon Enterprise + Integration Hub** | Connect existing systems, create a canonical project intelligence layer, automate cross-system workflows and add AI without forcing a rip-and-replace program. |

There must not be separate product forks. The same domain model, identity model, API contracts, workflow concepts, audit model and AI governance should operate across SaaS, dedicated cloud and on-premise deployments.

## 1.3 Architectural principles

1. **Construction-domain first.** Generic AI or generic workflow technology is not the product; construction semantics are.
2. **Deterministic before generative.** Use rules, calculations, geometry, structured mappings and templates before invoking an LLM.
3. **Structured memory over prompt history.** Project facts, decisions and relationships belong in persistent structured stores, not repeated prompts.
4. **Modular monolith before microservice sprawl.** Preserve strict bounded contexts while minimizing early operational complexity.
5. **Events are first-class.** Every important state change emits a normalized domain event through an outbox/event mechanism.
6. **Human approval at commercial and contractual gates.** AI may recommend; it should not silently create contractual commitments.
7. **Every derived answer has provenance.** Quantity, cost, schedule, document and AI outputs must be traceable to source/version/rule/model.
8. **Open integration surface.** API, events, files and connector SDK are product capabilities, not custom-project afterthoughts.
9. **Cloud-neutral core.** SaaS can use managed services; enterprise deployments must also support private cloud and on-premise patterns.
10. **AI FinOps is part of architecture.** Cost per project, request, model and agent must be measurable and enforceable.
11. **Desktop + browser where the workflow demands it.** Heavy drawing/CAD operations can use local compute while collaboration and governance remain web-first.
12. **Security and audit by design.** Multi-tenancy, least privilege, document controls, model access, data lineage and tamper-evident audit are mandatory platform functions.

![Preckon product map](preckon_blueprint_assets/product_map.png)

---

# 2. Product Boundary

## 2.1 Preckon Core

Preckon Core is the common operating foundation. Every Logix module must consume these capabilities instead of recreating them:

- Organization, tenant and legal entity management
- Projects, portfolios, programs and workspaces
- Project hierarchy, WBS and coding structures
- Users, teams, companies, contacts and project participants
- Role-based and attribute-based authorization
- Project configuration, units, currencies, calendars and standards
- Files, document references, versions and metadata
- Comments, mentions, assignments, notifications and activity feed
- Workflow and approval engine
- Rules engine
- Master data and classification libraries
- Audit, provenance and version history
- Search
- Reporting and dashboards
- API gateway and integration contracts
- Event/outbox infrastructure
- AI gateway, model policy and usage accounting
- Subscription, entitlements and feature flags
- Localization and regional configuration

## 2.2 Primary Logix modules

### TenderLogix
Tender intake, tender workspace, requirements extraction, bidder/contractor coordination, clarifications, addenda, bid comparison, tender risk, tender-to-BOQ workflow and tender intelligence.

### DocLogix
Document control, transmittals, registers, version/revision management, metadata, review routing, approval matrices, correspondence, OCR/indexing, semantic retrieval and controlled distribution.

### DrawLogix
Browser and desktop drawing workspace for 2D/3D review, markups, layers, measurement, drawing generation assistance, PDF/DWG interoperability, revision comparison, drawing workflow and AI-assisted design operations.

### QuantLogix / BOQ Engine
Drawing/specification/tender-to-quantity extraction, measurement rules, quantity takeoff, item classification, BOQ generation, reconciliation, version comparison and traceability from quantity back to source geometry/document.

### EstimateLogix / CostLogix
Rate libraries, assemblies, estimates, budget, cost codes, commitments, forecasts, earned value inputs, cash flow, variance, cost-to-complete and commercial intelligence.

### ScheduleLogix
WBS, activities, dependencies, calendars, resources, baselines, critical path, progress, look-ahead planning, delay analysis, schedule health and Primavera migration/interoperability.

### ProcurementLogix
Material/service requisitions, packages, RFQs, vendor comparisons, purchase recommendations, commitments, delivery tracking and linkage to cost/schedule.

### ProjectControlsLogix
Cross-module control layer for baseline vs actual, progress, KPI, risk, change impact, portfolio views and management reporting.

### RFI / Submittal / Approval workflows
May be packaged as a Project Controls or DocLogix capability but must use common workflow objects and approval contracts.

### ChangeLogix
Potential change, change request, variation/change order, pricing, approvals, cost/schedule impact, entitlement evidence and audit trail.

### FieldLogix
Daily logs, site observations, tasks, inspections, progress capture, photos, punch/snags, mobile/offline workflows and field-to-office synchronization.

### Quality & Safety
ITPs, inspections, NCRs, observations, incidents, permits/checklists, corrective actions and evidence.

### Commercial / Finance
Contract values, payment applications/certificates, retention, claims, progress billing, supplier invoices/commitments and ERP synchronization where required.

### Analytics / Intelligence
Portfolio dashboards, project health, variance explanations, schedule/cost correlation, risk signals, executive summaries, benchmark analytics and natural-language project interrogation.

---

# 3. Construction Lifecycle Model

Preckon should model the lifecycle as connected states rather than isolated modules.

## 3.1 Lifecycle stages

1. Opportunity / Tender
2. Requirement intake
3. Design / drawing development
4. Quantity / BOQ
5. Estimation and commercial planning
6. Baseline schedule and resource plan
7. Procurement
8. Construction execution
9. Document/RFI/submittal/change control
10. Progress, cost and schedule control
11. Quality and safety
12. Testing / commissioning
13. As-built / handover
14. Closeout and organizational learning

## 3.2 Cross-module traceability chain

A critical Preckon capability is the ability to answer questions such as:

> Which tender requirement created this drawing element, which quantity did it produce, what BOQ item and cost code did that quantity feed, which schedule activity consumes it, what procurement package supplies it, what change affected it, what document approved it, and what field evidence proves completion?

That requires persistent identifiers and relationships across modules. The cross-module chain should support:

`Requirement -> Document/Spec -> Drawing/Model Element -> Measurement -> BOQ Item -> Estimate Item -> Cost Code -> WBS/Activity -> Procurement Package -> Commitment -> Field Progress -> Change -> Payment/Forecast -> Handover Asset`

Not every project will populate the full chain. The platform must support partial links without breaking integrity.

---

# 4. Personas and Workspaces

Preckon should adapt by workspace and responsibility rather than exposing every module to every user.

| Persona | Primary workspace | Key capabilities |
|---|---|---|
| Owner / Developer | Portfolio | Project health, cost, schedule, risk, approvals, investment decisions |
| CEO / COO | Executive | Cross-project KPIs, exceptions, forecast, AI summaries |
| Project Director / PM | Project Controls | Scope, schedule, cost, risk, change, decisions |
| Planning Engineer | ScheduleLogix | Baselines, CPM, progress, delay, look-ahead |
| Quantity Surveyor | Quant/Cost | Takeoff, BOQ, estimate, variation, valuation |
| Estimator | Tender/Estimate | Tender analysis, pricing, assemblies, risk |
| Architect / Designer | Draw/Docs | Drawings, reviews, revisions, requirements |
| BIM / CAD Engineer | DrawLogix Desktop | Model/drawing processing, layers, geometry, export |
| Document Controller | DocLogix | Registers, revisions, transmittals, routing, compliance |
| Procurement Manager | Procurement | Packages, RFQ, vendor comparison, delivery |
| Site Engineer | Field | Daily progress, drawings, RFIs, inspections, evidence |
| QA/QC | Quality | ITP, inspection, NCR, closeout |
| HSE | Safety | Observations, incidents, permits, corrective actions |
| Commercial Manager | Commercial | Contract, variations, claims, valuations, forecast |
| Subcontractor / Vendor | External portal | Assigned package, documents, submittals, progress |
| Enterprise IT / Integration | Admin / Hub | Connectors, mappings, monitoring, data governance |

---

# 5. System Architecture

## 5.1 Recommended topology

Preckon should use a **modular platform core** with independently deployable heavy-processing and integration components.

![Preckon runtime architecture](preckon_blueprint_assets/runtime.png)

### Logical layers

1. **Experience layer** - web, desktop, mobile, external portal, APIs.
2. **Edge and access layer** - CDN, WAF, API gateway, identity, SSO, tenant routing.
3. **Application layer** - domain modules and orchestrated use cases.
4. **Workflow/rules layer** - approvals, state machines, policies, timers and deterministic decisions.
5. **AI intelligence layer** - AI Gateway, tools, RAG, project memory, model routing and validation.
6. **Async compute layer** - OCR, document parsing, CAD conversion, takeoff, rendering, import/export, reporting.
7. **Event/integration layer** - outbox, event bus, connector runtime and normalized enterprise events.
8. **Data layer** - transactional database, object store, search index, vector store and graph store.
9. **Platform operations** - security, secrets, observability, audit, FinOps, configuration and deployment.

## 5.2 Service decomposition rule

A module should become an independent service only if at least one of the following is true:

- It has a materially different scaling profile.
- It requires different compute/runtime technology.
- It has strict data residency or security isolation.
- It needs independent release cadence for enterprise connectors.
- It is a high-risk failure domain that should be isolated.
- It has sustained throughput that would otherwise destabilize the core platform.

### Independently scalable from the start

- AI Gateway and inference workers
- OCR/document extraction workers
- CAD/DWG/model conversion workers
- Takeoff/geometry compute workers
- Report/export workers
- Integration Hub connector runtime
- Search/indexing workers
- Notification workers

### Keep within the modular core initially

- Organizations/projects
- Tender
- Documents metadata/workflow
- BOQ/estimate/cost control
- Schedule management
- RFI/submittal/change
- Field records
- Quality/safety
- Procurement/commercial state

This gives the team clean boundaries without paying the operational cost of excessive microservices prematurely.

---

# 6. Reference Technology Architecture

The blueprint is technology-aware but not technology-locked. Every major selection should be recorded as an Architecture Decision Record (ADR).

## 6.1 Reference stack

| Layer | Recommended baseline | Rationale |
|---|---|---|
| Web | React/Next.js or equivalent enterprise SPA | Rich interaction, modular UI, SSR where valuable |
| Desktop | Tauri or Electron shell + shared web components + native workers | Fast delivery with local compute and filesystem/CAD access |
| Mobile | React Native/Flutter or responsive PWA first | Field workflows and offline capture |
| Core APIs | .NET 9 / modern LTS .NET | Strong enterprise/API background, performance, typing |
| Worker runtime | .NET + Python | .NET orchestration; Python for AI, geometry and data science ecosystems |
| Transaction DB | PostgreSQL | Cloud-neutral, robust relational + JSON + extensions |
| Object store | S3-compatible abstraction | Drawings, models, PDFs, photos, exports |
| Search | OpenSearch/Elasticsearch-compatible | Full text, metadata and operational search |
| Vector | pgvector first; dedicated vector service when justified | Minimize early infrastructure; scale later |
| Graph | Relational relationship tables first; Neo4j/Memgraph-class graph for enterprise KG | Avoid graph infrastructure until relationship use cases justify it |
| Messaging | Outbox + NATS JetStream/RabbitMQ class bus; enterprise Kafka adapter where needed | Reliable async events with manageable operations |
| Workflow | Explicit domain state machines + durable orchestration; Temporal-class engine where long-running workflows justify it | Construction approvals need durable timers and compensation |
| Identity | OIDC/OAuth2 + SAML federation | Enterprise SSO compatibility |
| Observability | OpenTelemetry + Prometheus/Grafana + log/trace backend | Vendor-neutral telemetry |
| Containers | Docker; Kubernetes for SaaS/enterprise scale | Portable deployment |
| Secrets | Vault/KMS abstraction | SaaS and customer-owned keys |
| IaC | Terraform/OpenTofu class tooling | Repeatable environments |

## 6.2 Avoid hard dependency on one cloud

Managed services can be used for Preckon SaaS, but domain code must not call proprietary cloud APIs directly. Use adapters for:

- Object storage
- Message bus
- Key management
- Email/SMS
- Search
- AI provider
- OCR/document intelligence
- Secrets
- Monitoring exporters

---

# 7. Domain Architecture

## 7.1 Core bounded contexts

Recommended contexts:

- Identity & Access
- Organization & Tenant
- Project & Portfolio
- Party / Company / Contact
- Document Control
- Tender
- Requirement
- Drawing / Model
- Quantity & Measurement
- Estimate & Rate Library
- Cost Control
- Schedule
- Procurement
- Contract / Commercial
- RFI / Submittal
- Change
- Field Execution
- Quality
- Safety
- Risk / Issue / Decision
- Workflow
- Notification
- Audit & Provenance
- Integration
- AI Intelligence
- Subscription / Entitlements

Every context owns its write model. Cross-context queries may use projections/read models, but one context must not update another context's tables directly.

## 7.2 Common identity pattern

All business objects should have:

- `id` - immutable global identifier
- `tenant_id`
- `project_id` where project scoped
- `object_type`
- `human_number` or project-specific sequence when needed
- `status`
- `version`
- `created_at/by`
- `updated_at/by`
- `source_system`
- `source_external_id`
- `correlation_id`
- `provenance_ref`
- soft-delete/archive semantics where contractually appropriate

## 7.3 Project code system

Preckon must support customer-specific code systems without corrupting internal identity:

- WBS
- CBS / cost code
- BOQ code
- document numbering
- drawing numbering
- location breakdown structure
- asset code
- material code
- vendor code
- contract/package code

Internal IDs remain stable even when customer codes change.

---

# 8. Canonical Construction Data Model

The canonical model is shared by native Preckon modules and the Enterprise Integration Hub.

## 8.1 Top-level canonical entities

### Organization and party
- Tenant
- LegalEntity
- BusinessUnit
- Company
- Person
- ProjectRole
- ContractParty
- Vendor/Subcontractor

### Project structure
- Portfolio
- Program
- Project
- Phase
- WBSNode
- LocationNode
- CostCode
- Calendar
- Resource

### Scope/design
- Requirement
- SpecificationSection
- Document
- DocumentRevision
- Drawing
- DrawingRevision
- Model
- ModelElement
- Markup
- DesignIssue

### Quantity/commercial
- Measurement
- QuantityItem
- BOQSection
- BOQItem
- RateItem
- Assembly
- Estimate
- EstimateLine
- Budget
- Commitment
- CostTransaction
- Forecast
- PaymentApplication

### Schedule
- Schedule
- Baseline
- Activity
- Milestone
- Relationship
- ResourceAssignment
- ProgressUpdate
- DelayEvent

### Procurement
- ProcurementPackage
- Requisition
- RFQ
- Bid
- BidEvaluation
- PurchaseOrder/Subcontract
- Delivery

### Controls
- RFI
- Submittal
- Transmittal
- ChangeEvent
- ChangeRequest
- ChangeOrder
- Risk
- Issue
- Decision
- Action

### Field and quality
- DailyLog
- FieldObservation
- Inspection
- ITP
- NCR
- PunchItem
- Incident
- Permit/Checklist
- ProgressEvidence

### AI/knowledge
- Fact
- EvidenceReference
- Chunk
- EmbeddingReference
- AIExecution
- AIRecommendation
- HumanDecision
- RelationshipEdge

## 8.2 Provenance contract

Any value that is imported, extracted or AI-derived should be able to record:

- source object and source revision
- source system
- source location/page/region/geometry where possible
- extraction/mapping rule version
- model/provider and model version if AI was used
- confidence
- human reviewer and override
- timestamp
- downstream objects that consumed the value

This is essential for defensibility in quantity, cost, schedule and contractual workflows.

---

# 9. Preckon Core Services

## 9.1 Organization and tenancy

Support:

- multi-tenant SaaS
- dedicated single-tenant cloud
- customer-hosted deployment
- multiple legal entities/business units inside a tenant
- data partitioning by tenant and project
- cross-project portfolio permissions
- project joint ventures and external participants

## 9.2 Identity and permissions

Use layered authorization:

1. **RBAC:** Project Manager, Planner, QS, Document Controller, etc.
2. **Object permission:** can this user view/edit this project/object?
3. **ABAC:** region, company, package, confidentiality, document class, contract party.
4. **Workflow authority:** approval limits and delegated authority.
5. **AI permission:** which sources/models/tools may this user invoke?

## 9.3 Workflow engine

Workflow should support:

- configurable statuses and transitions
- approval matrices
- serial and parallel approval
- conditional branches
- due dates and escalation
- delegation
- reminders
- SLA timers
- rejection/resubmit loops
- comments and decision reason
- electronic acknowledgement/signature integration
- webhook/event callbacks
- immutable approval history

Workflow templates should be reusable at organization/project/package level.

## 9.4 Rules engine

Rules must be deterministic, versioned and auditable. Examples:

- tender completeness checks
- BOQ validation tolerances
- approval thresholds
- change authorization limits
- schedule quality rules
- document naming/metadata rules
- quantity formula rules
- rate selection rules
- procurement vendor criteria
- field inspection acceptance rules

AI can propose a rule outcome, but contractually binding decisions should pass through deterministic rules or human approval.

---

# 10. TenderLogix Blueprint

## 10.1 Core workflow

`Tender Received -> Intake -> Document Classification -> Requirement Extraction -> Clarification/Risk -> Quantity/BOQ Preparation -> Estimate -> Bid Review -> Submission -> Addendum/Revisions -> Award/Handover`

## 10.2 Key capabilities

- multi-source tender intake: upload, email, portal/API
- tender document register
- automatic document classification
- scope/requirement extraction
- mandatory submission matrix
- commercial condition extraction
- clause and risk flagging
- missing-information detection
- tender questions/clarifications
- addenda comparison and impact detection
- bidder/subcontractor package coordination
- bid leveling and comparison
- tender calendar and responsibility matrix
- tender-to-BOQ traceability
- tender estimate and margin scenarios
- approval and submission pack generation
- handover of award data into project execution

## 10.3 AI use

Use AI for extraction, summarization, semantic comparison and risk suggestions. Use deterministic parsers for tables, dates, numeric values, known clause formats and formula validation whenever possible.

---

# 11. DocLogix Blueprint

## 11.1 Document object model

Separate the logical document from its revisions and binary files:

`Document -> Revision -> File Representation -> Review/Approval -> Distribution`

## 11.2 Capabilities

- controlled document register
- naming conventions and numbering
- revision/status schemes
- metadata templates
- transmittals
- review and approval routes
- distribution lists
- superseded/obsolete handling
- document packages
- correspondence records
- email ingestion/linking
- OCR/text extraction
- full-text and semantic search
- document comparison
- requirement/clause linking
- retention/archive policy
- external portal distribution

## 11.3 Document immutability rule

Once a document revision is formally transmitted/approved, the binary and core metadata representing that revision must not be silently overwritten. Corrections require a new revision or controlled administrative action with audit.

---

# 12. DrawLogix Blueprint

## 12.1 Product model

DrawLogix should have a **browser experience** and a **desktop companion** sharing the same project/document/version services.

### Browser
Best for:

- viewing
- collaboration
- comments/markups
- revision comparison
- measurement
- approvals
- lightweight drawing edits
- AI prompts
- dashboards

### Desktop
Best for:

- large files
- local CAD/model processing
- DWG/DXF import/export
- layer-intensive work
- geometry conversion
- offline/local cache
- plug-in/interop workflows
- high-performance rendering

## 12.2 Drawing data strategy

Do not make DWG the internal system of record. Maintain a Preckon drawing representation with:

- drawing metadata
- page/sheet hierarchy
- layers
- vector entities where parsed
- measurements
- model element references
- annotations/markups
- source-file references
- conversion status
- coordinate systems
- version/revision

Preserve source files and exported files as immutable artifacts.

## 12.3 AI-assisted drawing workflow

AI may:

- interpret requirement text
- propose drawing elements
- identify symbols/text/objects
- suggest layers
- detect revision changes
- propose dimensions/annotations
- identify missing coordination items
- translate natural-language intent into structured drawing commands

The AI should output **structured drawing operations**, not opaque raster images, wherever the result is expected to remain editable.

---

# 13. QuantLogix / BOQ Blueprint

## 13.1 Inputs

- PDF drawings
- vector drawings
- DWG/DXF-derived geometry
- BIM/model elements
- specifications
- existing BOQ
- tender schedules
- manual measurements

## 13.2 Processing pipeline

1. Ingest and version source
2. Classify sheet/model
3. Normalize scale/units
4. Detect/identify relevant geometry
5. Apply measurement rule
6. Generate measurement objects
7. Map to standard/customer item classification
8. Aggregate into quantity items
9. Map into BOQ structure
10. Validate and reconcile
11. Human review where confidence/tolerance requires it
12. Freeze a version/baseline

## 13.3 Measurement rule object

Each rule should define:

- applicable object/category
- unit
- geometric formula
- waste/allowance policy
- deduction/opening rules
- rounding
- inclusion/exclusion
- source priority
- classification mapping
- validation tolerance
- version/effective date

## 13.4 Defensibility

A user must be able to click a BOQ quantity and navigate back to the measurements and drawing/model regions that produced it.

---

# 14. EstimateLogix and CostLogix Blueprint

## 14.1 Estimating

- rate library by geography/time/vendor
- resource rates: labor/material/equipment/subcontract
- assemblies
- productivity assumptions
- indirects/overheads
- escalation
- contingency
- markups
- alternates/options
- estimate versions
- estimate review/approval
- estimate-to-budget conversion

## 14.2 Cost control

Core equation concepts:

- original budget
- approved changes
- revised budget
- commitments
- actuals
- accruals
- forecast to complete
- estimate at completion
- variance at completion

Every organization can configure financial terminology, but underlying semantics should remain normalized.

## 14.3 Cross-module integration

- BOQ -> estimate
- estimate -> budget
- procurement -> commitments
- ERP -> actuals
- field progress -> earned/progress values
- changes -> revised budget/forecast
- schedule -> time-phased cash flow

---

# 15. ScheduleLogix Blueprint

## 15.1 Objective

ScheduleLogix must be capable of serving SMB/mid-market customers as a native planning tool and large customers as a connected schedule intelligence layer alongside or migrating from Primavera P6.

## 15.2 Capabilities

- EPS/project/WBS concepts as appropriate
- activities and milestones
- relationships
- calendars
- constraints
- activity codes
- resources and assignments
- baseline management
- CPM calculation
- float and critical path
- progress update cycles
- look-ahead planning
- schedule comparison
- schedule quality checks
- delay events
- change impact scenarios
- narrative/report generation
- multi-project portfolio schedule analytics

## 15.3 Primavera interoperability

Support staged compatibility:

1. import/export of common exchange formats
2. validated mapping of calendars/WBS/activities/relationships/codes
3. integration via supported APIs where customer licenses/access permit
4. schedule delta synchronization
5. migration validation reports

No imported schedule should be considered accepted until Preckon produces an integrity report comparing counts, dates, relationships, calendars, constraints and critical-path characteristics.

---

# 16. ProcurementLogix Blueprint

Procurement is the bridge between BOQ/cost/schedule and actual project delivery.

Key objects and workflows:

`Need/BOQ Item -> Requisition -> Package -> RFQ -> Vendor Bid -> Comparison -> Recommendation -> Approval -> PO/Subcontract -> Delivery -> Inspection -> Invoice/Payment`

Capabilities:

- package strategy
- vendor master/prequalification references
- RFQ issue and addenda
- commercial/technical bid tabs
- bid normalization
- long-lead identification
- required-on-site date linkage to schedule
- delivery tracking
- submittal/material approval links
- cost commitment updates
- vendor performance history

---

# 17. RFI, Submittal and Change Blueprint

## 17.1 RFI

RFI should link to:

- drawings/specs
- location
- WBS/activity
- responsible party
- due date
- cost/schedule impact flag
- resulting instruction/change

## 17.2 Submittal

Submittal should support:

- package/register
- planned submission/approval dates
- required-on-site date
- revisions
- reviewer routing
- review codes/status
- linked materials/vendor/procurement
- schedule impact

## 17.3 Change

Use separate lifecycle stages:

`Potential Change -> Notification -> Scope Definition -> Estimate -> Time Impact -> Internal Approval -> Client/Vendor Negotiation -> Approved/Rejected -> Contract Change -> Budget/Schedule Update`

Never conflate a potential change with an approved contractual change.

---

# 18. Field, Quality and Safety Blueprint

## 18.1 FieldLogix

- daily diary
- manpower/equipment
- weather reference
- work completed
- progress quantities
- photos/video
- location-tagged observations
- site instructions
- issues/actions
- material deliveries
- offline capture

## 18.2 Quality

- ITP templates
- inspection requests
- checklist execution
- test records
- NCR lifecycle
- corrective/preventive action
- punch/snag
- closeout evidence

## 18.3 Safety

- toolbox/checklist workflows
- permits
- observations
- incident/near-miss records
- action management
- inspection evidence
- analytics

AI should not make autonomous safety clearance decisions. It may identify risks, missing records and patterns for human review.

---

# 19. Enterprise Integration Hub

Large enterprises should not be asked to abandon every incumbent platform. Preckon Enterprise should become the intelligence and orchestration layer across them.

![Preckon Integration Hub](preckon_blueprint_assets/integration_hub.png)

## 19.1 Hub responsibilities

- connector lifecycle management
- authentication/credential isolation
- API/webhook/file/DB/SFTP integration patterns
- scheduled and event-driven sync
- extraction and checkpointing
- retries, idempotency and dead-letter handling
- canonical mapping
- units/codes/master-data normalization
- identity resolution
- data quality checks
- lineage/provenance
- event normalization
- conflict policy
- observability
- replay
- customer-specific mapping configuration

## 19.2 Connector classes

### Class A - API connectors
For products with supported REST/GraphQL/SOAP APIs.

### Class B - Event/webhook connectors
For near-real-time updates where source systems publish events.

### Class C - File connectors
CSV, Excel, XML, JSON, PDF or industry exchange files through upload, watched storage or SFTP.

### Class D - Database / CDC connectors
Read-only database integration or CDC where customer policy permits.

### Class E - Desktop/agent connectors
Customer network agent for systems not exposed externally.

## 19.3 Connector SDK contract

Every connector should implement standardized functions:

- authenticate/test connection
- discover capabilities
- pull page/batch
- pull delta since checkpoint
- push object where permitted
- subscribe/unsubscribe webhook
- map external object to staging model
- validate payload
- expose health/metrics
- checkpoint
- replay

A connector must not contain business logic that belongs to the canonical mapping or domain modules.

## 19.4 Systems to prioritize

Initial enterprise connector families should target the systems most likely in large construction customers:

- Oracle Primavera P6
- Autodesk Construction Cloud/BIM/authoring ecosystem
- Procore-class project management platforms
- ERP/finance systems such as SAP/Oracle/Microsoft ecosystems
- SharePoint/OneDrive and enterprise DMS
- Microsoft 365 email/collaboration as permitted
- Excel/CSV/SFTP for pragmatic integration

Specific connectors should be prioritized by signed customer demand, not by building a giant speculative marketplace.

---

# 20. Integration Hub Validation Without Customer Systems

Preckon can build and test the Integration Hub before receiving full production access.

## 20.1 Test strategy

1. Obtain public/vendor API schemas and sandbox access when available.
2. Build a **connector simulator** that mimics pagination, throttling, failures, changed records and webhooks.
3. Maintain anonymized **golden datasets** representing realistic construction projects.
4. Build contract tests for every external payload.
5. Build mapping tests into the canonical model.
6. Build replay/idempotency tests.
7. Inject failure conditions: timeouts, duplicate messages, missing fields, schema changes and rate limits.
8. Run end-to-end integration against mock source and target systems.
9. During a real customer onboarding, run read-only shadow sync before enabling writes.
10. Produce reconciliation reports between source and Preckon.

## 20.2 Connector certification levels

- **Level 0 - Prototype:** mocked API only
- **Level 1 - Contract verified:** schema and behavior tests pass
- **Level 2 - Sandbox verified:** vendor sandbox/test environment passed
- **Level 3 - Customer staging verified:** customer non-production data reconciled
- **Level 4 - Production certified:** monitored production use with rollback/replay and agreed SLO

---

# 21. Knowledge Graph

The Knowledge Graph is not a replacement for transactional databases. It is a relationship and reasoning projection over trusted project objects.

## 21.1 Useful relationships

Examples:

- requirement `SATISFIED_BY` drawing
- drawing `PRODUCES` quantity
- BOQ item `MAPS_TO` cost code
- activity `CONSUMES` material
- submittal `BLOCKS` activity
- RFI `REFERENCES` drawing revision
- change `IMPACTS` activity
- risk `THREATENS` milestone
- document `APPROVES` material
- field evidence `PROVES` progress
- company `RESPONSIBLE_FOR` package

## 21.2 Graph rules

- every node references a canonical object or controlled derived fact
- every edge records provenance
- graph can be rebuilt from source events/projections
- graph is not the sole system of record for commercial facts
- AI may query the graph but cannot create trusted facts without evidence/validation

---

# 22. AI Architecture

AI must be treated as a governed capability, not a direct call from every screen to a frontier model.

![AI cost-efficiency pipeline](preckon_blueprint_assets/ai_efficiency.png)

## 22.1 AI Gateway

All AI requests pass through a Preckon AI Gateway responsible for:

- tenant/user authorization
- use-case policy
- model routing
- prompt/template versioning
- context assembly
- RAG
- tool permissions
- PII/data residency policy
- token/output budgets
- caching
- structured output enforcement
- validation
- retries/fallback
- usage/cost telemetry
- evaluation logging

No module should hold provider API keys or call an external LLM directly.

## 22.2 Model hierarchy

Use the cheapest reliable mechanism that satisfies the task:

1. deterministic code/rules
2. indexed lookup/search
3. cached result
4. local classifier/extractor
5. small open-weight model
6. specialized model
7. larger open-weight model
8. external frontier model
9. human escalation

## 22.3 Token reduction strategies

Mandatory patterns:

- structured project memory instead of resending conversation history
- retrieve small evidence sets rather than entire documents
- pre-extract facts once and reuse them
- use embeddings/search to select context
- summarize hierarchically and cache summaries by revision hash
- schema-constrained output
- deterministic tools for arithmetic, schedule and quantity calculations
- semantic/exact response cache
- model router by complexity and risk
- batch document extraction jobs
- local embeddings/rerankers
- avoid repeated OCR/vision of unchanged files
- content-addressable storage/hash for deduplication
- store AI outputs as reusable project facts with provenance
- per-tenant/model token budgets and anomaly alerts

## 22.4 Project memory

Project memory should have layers:

### Layer 1 - Trusted structured facts
Project dates, values, WBS, costs, quantities, approvals, statuses.

### Layer 2 - Evidence index
Document chunks, pages, drawing references, transmittals, correspondence.

### Layer 3 - Decisions and rationale
Approved decisions, assumptions, exceptions, change decisions.

### Layer 4 - AI working memory
Short-lived task state. Must expire and must never silently become a trusted project fact.

## 22.5 RAG rules

- retrieve by tenant/project permissions
- retrieval result records source revision
- context budget is explicit
- prefer structured facts over prose when available
- answer should cite evidence internally in the UI
- do not retrieve superseded document revisions by default unless historical comparison is requested

---

# 23. Agent Architecture

Preckon agents should be **tool-using domain orchestrators**, not unrestricted autonomous chatbots.

## 23.1 Agent families

- Tender Agent
- Requirement Agent
- Drawing Agent
- Quantity Agent
- Estimate Agent
- Schedule Agent
- Document Agent
- Procurement Agent
- Change Agent
- Project Controls Agent
- Field/Quality Agent
- Executive Intelligence Agent
- Integration Agent

## 23.2 Agent execution model

`Intent -> Authorization -> Plan -> Retrieve Facts -> Call Tools -> Validate -> Propose Result -> Human Gate if Required -> Persist Result/Decision -> Emit Event`

## 23.3 Tool contract

Agents should use typed tools such as:

- `get_project_fact`
- `search_project_evidence`
- `compare_document_revisions`
- `calculate_quantity`
- `calculate_cpm`
- `get_cost_forecast`
- `create_draft_rfi`
- `create_draft_change`
- `generate_report`

Tools expose safe business operations. Agents should not receive raw unrestricted database access.

## 23.4 Autonomy levels

- **A0 - Inform:** answer/summarize only
- **A1 - Recommend:** propose structured action
- **A2 - Draft:** create draft object
- **A3 - Execute reversible action:** allowed within policy, fully audited
- **A4 - Contractual/financial/safety commitment:** requires human authority by default

---

# 24. AI Evaluation and Governance

Every high-value AI use case needs a test set and acceptance metric.

## 24.1 Evaluation dimensions

- extraction precision/recall
- numeric accuracy
- citation/evidence correctness
- hallucination rate
- structured schema validity
- confidence calibration
- latency
- token/compute cost
- model drift
- customer override rate

## 24.2 AI release gate

A model/prompt/router change must not be promoted solely because examples “look better.” It should pass:

1. regression dataset
2. domain correctness thresholds
3. cost threshold
4. latency threshold
5. safety/security checks
6. human review for high-risk workflows
7. versioned deployment with rollback

---

# 25. Deployment Architecture

Preckon should support multiple deployment modes without creating separate code lines.

![Preckon deployment modes](preckon_blueprint_assets/deployment.png)

## 25.1 SaaS

- multi-tenant control/data plane
- managed database/search/object services where economical
- central AI gateway
- shared model serving with tenant isolation
- regional deployment as business grows

## 25.2 Dedicated private cloud / VPC

- single-tenant environment
- private networking
- customer identity federation
- customer-managed keys where required
- dedicated model endpoints if required
- controlled outbound connectivity

## 25.3 On-premise / sovereign

- deployable containers/Kubernetes distribution
- local object/database/search services
- local/open-weight model serving
- offline license/entitlement option where contractually necessary
- update bundle and signed artifact process
- optional outbound provider access only when customer policy permits

## 25.4 Hybrid

Desktop/CAD workers or a connector agent can run on customer networks while the control plane runs in SaaS/private cloud.

---

# 26. Browser, Desktop and Mobile Architecture

## 26.1 Shared application services

All clients should use the same APIs and domain rules. The desktop app should not become a second business-logic implementation.

## 26.2 Desktop local worker

Responsibilities:

- local file access
- CAD conversion
- local rendering
- large file chunking
- offline project cache
- secure upload/download
- optional local AI inference

## 26.3 Sync rules

- every offline-created object receives a client-generated UUID
- optimistic concurrency/version check on sync
- conflict surfaced to user rather than silent overwrite
- binary uploads are resumable and content-addressed
- signed URLs/short-lived credentials
- local cache encrypted at rest where feasible

---

# 27. API Architecture

## 27.1 API styles

- REST/JSON for transactional public APIs
- event/webhook subscriptions for changes
- bulk import/export for high-volume exchange
- GraphQL/read aggregation only if a clear UI or partner need justifies it

## 27.2 API rules

- versioned contracts
- idempotency keys for create/financial actions
- optimistic concurrency using version/ETag
- pagination and filtering standards
- UTC timestamps + project timezone metadata
- explicit units/currency
- correlation IDs
- consistent error envelope
- tenant/project context required

## 27.3 Example event envelope

```json
{
  "eventId": "uuid",
  "eventType": "preckon.change.approved.v1",
  "occurredAt": "2026-08-13T10:00:00Z",
  "tenantId": "uuid",
  "projectId": "uuid",
  "objectId": "uuid",
  "objectType": "ChangeOrder",
  "objectVersion": 7,
  "correlationId": "uuid",
  "actor": { "type": "user", "id": "uuid" },
  "source": "preckon",
  "payload": {},
  "provenance": {}
}
```

---

# 28. Event Architecture

## 28.1 Event categories

### Domain events
Business facts: TenderReceived, DocumentApproved, BOQBaselined, ActivityProgressed, ChangeApproved.

### Integration events
Stable events intended for connectors/other contexts.

### System events
IndexRequested, FileConverted, ReportGenerated, AIExecutionCompleted.

## 28.2 Reliability

- transactional outbox for events emitted with database changes
- idempotent consumers
- retry with exponential backoff
- dead-letter queue
- replay tooling
- event versioning
- metrics by consumer lag/failure

---

# 29. Data Architecture

## 29.1 Stores by responsibility

### Relational system of record
Business transactions and authoritative metadata.

### Object storage
Original and derived files, drawings, models, photos, reports and exports.

### Search index
Full text, metadata facets and fast user search.

### Vector index
Embeddings for retrieval; not a source of truth.

### Graph projection
Relationships/knowledge; rebuildable from authoritative objects and events.

### Analytics warehouse/lakehouse
Historical/project portfolio analytics when volume justifies separation from OLTP.

## 29.2 Data retention

Configurable by tenant/project and object class. Contractual records may require retention even after project closure. Hard deletion should be restricted and auditable.

---

# 30. Security Architecture

## 30.1 Minimum controls

- OIDC/OAuth2/SAML
- MFA support
- least privilege
- tenant isolation tests
- encryption in transit and at rest
- key rotation
- secrets vault
- signed/expiring file access
- WAF and rate limiting
- secure headers and CSP
- vulnerability scanning
- SBOM
- audit logs
- data export/delete controls
- backup/restore testing
- incident response process

## 30.2 Enterprise controls

- customer SSO
- SCIM/user provisioning where required
- private networking
- customer-managed keys
- IP restrictions
- DLP/classification integrations
- regional data residency
- audit export to SIEM
- dedicated environment

## 30.3 AI-specific security

- provider allowlist by tenant
- data-use policy by model/provider
- prompt injection defenses for retrieved documents
- tool allowlist
- output schema validation
- no secret exposure to model prompts
- sensitive data redaction/pseudonymization where required
- complete AI execution trace without unnecessarily storing sensitive prompt data

---

# 31. Audit, Versioning and Digital Evidence

Construction disputes and approvals make auditability a product requirement.

## 31.1 Audit event

Capture:

- who/what actor
- tenant/project
- action
- object
- before/after or change summary
- timestamp
- client/source
- reason/comment when required
- correlation ID

## 31.2 Versioning

Formal project objects such as BOQ, estimate, schedule baseline, drawing revision and approved change should support immutable historical versions.

## 31.3 Evidence package

Preckon should eventually be able to export an evidence package for an RFI, change, claim or decision containing linked documents, revisions, correspondence, approvals, schedule/cost impact and audit records.

---

# 32. Search and Project Intelligence

Search must combine:

- exact IDs/codes
- metadata filtering
- full text
- semantic retrieval
- relationship navigation

Example query:

> Show all approved submittals for façade package P-210 that affect activities on the current critical path and have procurement delivery dates later than required-on-site date.

This should be solved by structured query + graph/relationship logic, with AI used for explanation rather than asking an LLM to infer everything from raw documents.

---

# 33. Observability and FinOps

## 33.1 Telemetry

Every request/job should carry:

- tenant/project
- correlation/trace ID
- user/service actor
- module/use case
- latency
- error code
- compute/storage metrics where relevant

## 33.2 AI FinOps

Track:

- tokens in/out
- provider/model
- inference duration
- local GPU seconds
- cache hit/miss
- RAG retrieval size
- cost estimate
- cost by tenant/project/user/use case
- quality/evaluation metric

Set budgets:

- per request
- per agent execution
- per user/day where appropriate
- per tenant/month
- per use case

## 33.3 Unit economics dashboard

Leadership should see:

`Revenue per customer - cloud infrastructure - model inference - storage/search - support burden = contribution margin`

AI cost must be visible as a product metric from the first commercial deployment.

---

# 34. Reliability and SLO Blueprint

Target tiers can evolve, but architecture should distinguish:

- interactive API path
- async document/CAD/AI jobs
- integrations
- reporting

Example objectives:

- core interactive availability: 99.9% target for SaaS production after stabilization
- no acknowledged business transaction lost
- durable async jobs with retry/replay
- RPO/RTO defined by customer tier
- connector lag visible per source
- graceful degradation if external AI provider is unavailable

Critical workflows must still permit deterministic/manual operation when AI is unavailable.

---

# 35. DevSecOps Blueprint

## 35.1 Environments

- local developer
- shared dev
- integration
- QA
- staging/pre-production
- production
- customer-specific staging for enterprise integrations where required

## 35.2 CI gates

- compile/build
- unit tests
- domain contract tests
- lint/static analysis
- dependency vulnerability scan
- secrets scan
- database migration validation
- API compatibility tests
- integration contract tests
- container scan
- AI regression tests for affected AI assets

## 35.3 Deployment

- immutable artifacts
- environment-specific configuration
- feature flags
- blue/green or canary for risky components
- backward-compatible DB migrations
- rollback plan
- audit of production deployments

---

# 36. Testing Strategy

## 36.1 Pyramid

1. domain/unit tests
2. application/use-case tests
3. database/repository integration tests
4. API contract tests
5. connector contract tests
6. end-to-end workflow tests
7. performance/load tests
8. security tests
9. AI evaluation/regression tests
10. migration/reconciliation tests

## 36.2 Golden construction projects

Maintain synthetic but realistic reference projects:

- small building tender
- mid-size commercial project
- high-rise project
- infrastructure project

Each contains known drawings, revisions, BOQ, estimates, schedule, RFIs, changes and field progress. These projects become the regression benchmark across modules.

## 36.3 Numerical acceptance

For quantity, cost and schedule features, expected outputs must be numeric and machine-verifiable. Screenshots alone are not sufficient QA.

---

# 37. Import, Migration and Coexistence

## 37.1 Migration framework

Every major domain import should use:

`Extract -> Stage -> Validate -> Map -> Transform -> Dry Run -> Reconcile -> Approve -> Commit -> Report`

## 37.2 Reconciliation report

Show:

- source count vs target count
- rejected/ignored records
- mapping assumptions
- missing master data
- unit/currency transforms
- date/calendar differences
- relationship integrity
- unresolved conflicts

## 37.3 Coexistence

Enterprise customers may run systems in parallel. Therefore each mapped object requires external identity and sync state. A source-of-truth matrix must be configured per object/domain.

---

# 38. Multi-Region and Localization

Preckon is intended for GCC and broader markets, so core architecture should support:

- currencies and exchange-rate sources
- metric/imperial units
- configurable tax/VAT concepts
- project timezone
- localized date/number formatting
- English + Arabic UI readiness including RTL design
- customer/local classification standards
- regional document templates
- data residency by deployment/region

Do not embed GCC-specific business rules in global core tables; implement them as configuration/rules/localization packs.

---

# 39. Standards and Domain Packs

Preckon should use versioned **Domain Packs** containing customer/region/discipline configuration:

- classification systems
- standard BOQ libraries
- measurement rules
- material libraries
- productivity assumptions
- document types
- workflow templates
- QA/QC templates
- safety templates
- schedule health rules
- drawing symbol/object libraries
- tender clause/risk patterns

A pack is versioned. Projects can pin to a version to avoid standards changing underneath active work.

---

# 40. Packaging and Entitlement Architecture

Commercial packaging should be configuration, not separate builds.

## 40.1 Example packaging

### Preckon Standard
Core + Tender + Docs + basic Draw/Quant + Estimate + Schedule + project workflows.

### Preckon Professional
Advanced Draw/Quant/Cost/Schedule + procurement + field + quality + commercial + advanced AI.

### Preckon Enterprise
Professional + Integration Hub + dedicated deployment options + enterprise SSO/security + knowledge graph + advanced governance + custom connector entitlement.

## 40.2 Meterable dimensions

- active projects
- internal users
- external collaborators
- storage
- drawing/model processing volume
- AI usage tier
- integration connectors
- portfolio scale

Avoid pricing the product solely on tokens. AI should be packaged as customer value with internal cost guardrails.

---

# 41. Repository and Engineering Organization

## 41.1 Recommended repository structure

```text
/preckon
  /apps
    /web
    /desktop
    /mobile
  /services
    /platform-api
    /ai-gateway
    /document-worker
    /cad-worker
    /integration-hub
    /notification-worker
  /domains
    /core
    /tender
    /documents
    /draw
    /quantity
    /estimate-cost
    /schedule
    /procurement
    /controls
    /field
    /quality-safety
  /packages
    /contracts
    /ui
    /auth
    /events
    /observability
    /sdk
  /connectors
  /ai
    /prompts
    /evaluations
    /tools
    /routing
  /domain-packs
  /infra
  /tests
  /docs
    /pra
    /adrs
    /api
```

This can be a monorepo initially if the team can manage build boundaries; repository split should follow team/deployment scale rather than ideology.

## 41.2 Team topology

### Team A - Platform/Core
Identity, projects, workflow, audit, files, APIs, entitlements.

### Team B - Preconstruction
Tender, requirements, BOQ, estimate.

### Team C - Design Intelligence
DrawLogix browser/desktop, geometry, CAD workers.

### Team D - Project Controls
Schedule, cost, procurement, RFI/submittal/change, reporting.

### Team E - Enterprise Integration
Canonical model, connector SDK, Integration Hub, knowledge graph.

### Team F - AI Platform
AI Gateway, model serving, RAG, agents, evaluation, FinOps.

### Shared - QA/Automation, DevSecOps/SRE, UX/Product Design, Domain SMEs

Early teams may combine these responsibilities; the boundaries indicate ownership, not immediate headcount.

---

# 42. Implementation Roadmap

The original Preckon/Logix development can continue while Enterprise Integration is developed in parallel by a separate stream.

## Phase 0 - Architectural foundation (0-6 weeks)

Deliver:

- master PRA alignment
- canonical IDs/object contracts
- tenant/project/auth model
- domain module boundaries
- event envelope + outbox
- object storage/file versioning
- workflow baseline
- AI Gateway skeleton
- observability baseline
- CI/CD and environments
- ADR process

**Exit:** a vertical slice can create a project, ingest a document, process it asynchronously, produce an AI-assisted structured result, persist provenance and emit an event.

## Phase 1 - Preconstruction MVP (6-16 weeks)

Parallel work:

- TenderLogix intake and register
- DocLogix base
- DrawLogix viewing/markups + desktop worker foundation
- quantity/BOQ pipeline
- estimate/rate library base
- AI extraction and project memory
- project dashboards

**Exit:** tender package can flow from documents -> extracted requirements -> drawings/measurements -> BOQ -> estimate with traceability.

## Phase 2 - Project controls (12-26 weeks)

- ScheduleLogix core
- Primavera import validation
- cost baseline/forecast
- procurement packages
- RFI/submittal
- change workflow
- document transmittals/approvals
- portfolio controls

**Exit:** an awarded project can establish cost/schedule/document controls and track change.

## Phase 3 - Field and closeout (20-36 weeks)

- mobile/PWA field workflows
- daily logs
- quality inspections/NCR
- punch/snags
- progress evidence
- safety baseline
- handover document/asset package

## Enterprise Track E1 - Integration Hub foundation (parallel, 0-12 weeks)

- connector SDK
- staging model
- canonical mapping service
- sync/checkpoint/retry framework
- simulator/mocks
- reconciliation engine
- connector monitoring
- SFTP/CSV/Excel generic connectors

## Enterprise Track E2 - Priority connectors (8-24 weeks)

- Primavera family
- Autodesk family where APIs/customer access allow
- ERP/finance connector chosen by pilot
- SharePoint/Microsoft document integration
- knowledge graph projection

## Enterprise Track E3 - Enterprise intelligence (18-36 weeks)

- cross-system portfolio model
- project health graph
- cross-system agents
- source-of-truth policies
- dedicated/private deployment automation
- enterprise audit/SIEM integration

---

# 43. First 180-Day Engineering Backlog

## Epic 1 - Platform identity and tenancy
- tenant/project model
- RBAC/ABAC policy service
- external party access
- audit

## Epic 2 - Files and document processing
- object storage abstraction
- file hash/dedup
- revision model
- async conversion/extraction

## Epic 3 - Workflow and events
- approval state machine
- outbox
- event bus
- notifications

## Epic 4 - AI Gateway
- provider adapters
- self-hosted model adapter
- budget policy
- RAG service
- cache
- evaluation harness

## Epic 5 - Tender vertical slice
- tender workspace
- document register
- extraction
- requirement matrix
- tender risk/clarification

## Epic 6 - Quantity/BOQ vertical slice
- measurement object
- rule engine
- takeoff workflow
- BOQ versioning
- traceability UI

## Epic 7 - Draw foundation
- web viewer
- markup
- desktop shell
- local conversion worker
- revision compare

## Epic 8 - Schedule foundation
- WBS/activity/calendar/relationship
- CPM engine
- baseline
- import validation

## Epic 9 - Integration Hub
- connector SDK
- simulator
- mapping
- checkpoints/retry/DLQ
- reconciliation

## Epic 10 - Operational readiness
- observability
- backup/restore
- security scan
- tenant isolation tests
- cost telemetry

---

# 44. Architecture Decision Records to Lock Early

Create and approve these ADRs before multiple teams diverge:

1. Internal global ID strategy
2. Tenant data isolation pattern
3. Modular monolith/service boundary rules
4. Event/outbox standard
5. API versioning/idempotency standard
6. File/object storage and revision model
7. Workflow/state machine model
8. Authorization model
9. Primary database
10. Search/vector strategy
11. AI Gateway contract
12. Project memory model
13. AI provider/local-model abstraction
14. Desktop technology
15. Drawing internal representation
16. Canonical construction model ownership
17. Connector SDK
18. Source-of-truth/conflict policy
19. Deployment packaging for private/on-prem
20. Observability and AI cost metering

---

# 45. Product Rules That Must Not Be Violated

1. No module calls external AI providers directly.
2. No AI output silently becomes an approved commercial fact.
3. No cross-module direct database writes.
4. No formal revision may be overwritten without version/audit.
5. No connector writes to a source system without configured source-of-truth and permission.
6. No imported data is treated as reconciled merely because the import job completed.
7. No AI answer may retrieve another tenant's data.
8. No quantity/cost/schedule result should lose its source/provenance.
9. No new microservice without a documented operational reason.
10. No customer-specific code fork for a rule that can be represented as configuration, domain pack, mapping or extension.
11. No pricing tier should require a separate build.
12. No critical workflow should become unusable solely because an AI provider is unavailable.

---

# 46. Build vs Buy Guidance

## Build where it differentiates Preckon

- construction canonical model
- tender intelligence orchestration
- drawing-to-quantity traceability
- BOQ/estimate integration
- schedule/cost/change relationship model
- domain packs/rules
- project memory/knowledge relationships
- agent tools and construction reasoning flows
- Integration Hub mapping semantics

## Use proven infrastructure where it does not differentiate

- identity protocol implementation
- message broker
- object storage
- metrics/tracing
- Kubernetes/container runtime
- basic OCR engines where fit
- PDF rendering libraries
- email/SMS delivery

Avoid spending engineering cycles rebuilding commodity infrastructure unless deployment/licensing constraints make it necessary.

---

# 47. Customer Configuration vs Custom Development

Use this decision hierarchy:

1. Can the requirement be solved by configuration?
2. Can a versioned rule/domain pack solve it?
3. Can a workflow template solve it?
4. Can a mapping/connector extension solve it?
5. Can a supported plugin/extension point solve it?
6. Only then consider core product customization.

Any one-off core fork should require executive architecture approval because it creates permanent maintenance cost.

---

# 48. Enterprise Onboarding Blueprint

## Stage 1 - Discovery

- systems landscape
- process map
- identity/SSO
- data residency
- source-of-truth matrix
- priority use cases
- integration constraints

## Stage 2 - Data contract

- canonical mappings
- object ownership
- sync direction
- frequency/latency
- retention
- reconciliation rules

## Stage 3 - Non-production integration

- connector config
- sample data
- mapping validation
- security review
- load/retry tests

## Stage 4 - Shadow production

- read-only synchronization
- compare/reconcile
- user acceptance

## Stage 5 - Controlled activation

- enable approved writes/workflows
- monitor SLOs
- rollback/replay capability

## Stage 6 - Expansion

Add new domains/connectors/use cases without redesigning the hub.

---

# 49. Product Analytics and Success Metrics

## Customer value

- tender review time reduction
- BOQ preparation time reduction
- quantity variance/error rate
- estimate cycle time
- schedule update effort
- RFI/submittal turnaround
- change approval cycle
- time spent finding documents
- forecast accuracy
- rework reduction
- integration/manual re-entry reduction

## Platform health

- active projects/users
- workflow completion
- document processing success
- connector lag/error
- search success
- AI acceptance/override
- AI cost per project
- gross margin per customer tier
- support incidents per project

---

# 50. Principal Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope becomes “replace everything” | Product never stabilizes | Shared core + phased modules + clear acceptance criteria |
| AI cost scales faster than revenue | SaaS margin collapse | Gateway, routing, local models, caching, RAG, budgets, telemetry |
| AI hallucinations damage trust | Commercial/safety risk | Provenance, tools, deterministic validation, human gates |
| Excess microservices | Delivery/ops slowdown | Modular core, extraction criteria for services |
| CAD/drawing complexity | Draw roadmap slips | Browser/desktop split, worker architecture, phased format support |
| Enterprise connector explosion | Services business trap | Connector SDK, canonical model, prioritize paid demand |
| Customer-specific forks | Maintenance fragmentation | Config/rules/domain packs/extensions |
| Weak migration fidelity | Enterprise rejection | Dry run + reconciliation + validation reports |
| Security/data residency | Enterprise deal blocker | private/on-prem deployment and policy abstraction |
| Inconsistent domain semantics | Cross-module failures | PRA, canonical model, ADR governance, architecture reviews |

---

# 51. Governance Model

## Architecture Council

A small council should own cross-cutting decisions:

- Chief/Product architecture owner
- Platform lead
- AI lead
- Enterprise Integration lead
- Domain SME representative
- DevSecOps/SRE representative when relevant

Responsibilities:

- PRA evolution
- ADR approval
- domain boundary disputes
- shared contract changes
- security exceptions
- connector standards
- AI governance/cost thresholds

## Product Council

Owns customer value, prioritization and scope. It should not override core integrity rules without an explicit architecture decision.

---

# 52. Definition of Done for a Preckon Feature

A feature is not done when the screen works. Depending on the feature, DoD includes:

- domain model approved
- authorization rules implemented
- API contract documented
- audit/provenance implemented
- events emitted if state is business-relevant
- workflow/rules versioned
- tenant isolation tests
- unit/integration/E2E tests
- error/empty/loading states
- observability
- performance target
- accessibility baseline
- localization readiness
- import/export where applicable
- AI evaluation if AI is used
- AI cost telemetry if AI is used
- documentation/runbook
- migration compatibility

---

# 53. Target End-State

The end-state is not “a collection of Logix screens.” It is a connected project intelligence system where:

- tender requirements become structured scope;
- scope links to design and documents;
- design produces traceable quantities;
- quantities feed BOQ and estimate;
- estimate becomes budget and procurement demand;
- scope/cost link to schedule;
- documents, RFIs and submittals affect activities and packages;
- field progress updates quantities, schedule and controls;
- changes propagate through cost and schedule with approval;
- quality and safety evidence attach to the same project objects;
- enterprise systems remain connected through a canonical integration layer;
- AI can reason over trusted project facts and evidence without repeatedly ingesting the entire project or leaking data;
- every important result is explainable, versioned and auditable.

That architecture gives Preckon a credible path from a practical SMB construction platform to an enterprise construction intelligence layer without building two separate products.

---

# Appendix A - Initial Domain Event Catalog

| Domain | Representative events |
|---|---|
| Core | ProjectCreated, ProjectConfigured, ProjectMemberAdded |
| Tender | TenderReceived, TenderAddendumReceived, TenderSubmitted, TenderAwarded |
| Document | DocumentRegistered, RevisionUploaded, ReviewRequested, DocumentApproved, DocumentTransmitted |
| Draw | DrawingRevisionCreated, MarkupAdded, DrawingCompared |
| Quantity | MeasurementCreated, QuantityValidated, BOQGenerated, BOQBaselined |
| Estimate | EstimateCreated, EstimateApproved, BudgetBaselined |
| Schedule | ScheduleImported, BaselineCreated, ActivityProgressed, CriticalPathChanged |
| Procurement | PackageCreated, RFQIssued, BidReceived, CommitmentAwarded, DeliveryRecorded |
| Controls | RFICreated, RFICanswered, SubmittalApproved, ChangePotentialCreated, ChangeApproved |
| Field | DailyLogSubmitted, ProgressEvidenceAdded, PunchItemClosed |
| Quality | InspectionCompleted, NCRRaised, NCRClosed |
| AI | AIExecutionCompleted, AIRecommendationAccepted, AIRecommendationOverridden |
| Integration | SyncStarted, SyncCompleted, MappingRejected, ReconciliationFailed |

---

# Appendix B - Source-of-Truth Matrix Template

For every enterprise integration, populate:

| Object | System of record | Preckon read | Preckon write | Sync latency | Conflict rule |
|---|---|---:|---:|---|---|
| Project | ERP / Preckon | Yes | Configured | Daily/near real-time | Master wins |
| Schedule | Primavera / Preckon | Yes | Configured | Update cycle | Explicit ownership |
| Cost actual | ERP | Yes | No | Daily | ERP wins |
| RFI | Preckon or PM system | Yes | Configured | Near real-time | Owning system wins |
| Documents | CDE/DocLogix | Yes | Configured | Near real-time | Revision rules |

The matrix is customer-specific and must be signed off during integration design.

---

# Appendix C - AI Budget Policy Example

```yaml
use_case: tender_requirement_extraction
risk_level: medium
preferred_paths:
  - deterministic_parser
  - cached_extraction
  - small_local_model
  - frontier_model
max_input_tokens: 12000
max_output_tokens: 3000
cache_by: [file_hash, extraction_schema_version]
requires_evidence: true
requires_structured_schema: true
human_review_if_confidence_below: 0.90
persist_as_trusted_fact: only_after_validation
```

---

# Appendix D - Connector Test Fixture Requirements

Every connector repository/package should include fixtures for:

- valid minimum object
- valid complete object
- pagination
- deleted/archived record
- changed record/delta
- duplicate delivery
- invalid credentials
- rate limit
- timeout
- partial response
- missing required field
- unknown enum/value
- schema-compatible extra field
- malformed payload
- source record with unit/timezone edge cases
- source relationship pointing to missing parent

---

# Appendix E - Pilot Acceptance Gate

A pilot should not be called successful merely because a demo works. Minimum acceptance should cover:

1. Real customer project/tender dataset loaded.
2. User permissions validated.
3. At least one end-to-end workflow crosses three or more modules.
4. Quantity/cost/schedule outputs reconciled to agreed tolerances.
5. AI outputs show evidence and are evaluated against known answers.
6. Operational logs and metrics are visible.
7. Backup/restore path is tested for pilot data.
8. Integration data is reconciled if connectors are in scope.
9. Users complete an agreed UAT script.
10. Support issues and product gaps are categorized into configuration, product backlog and customer-specific needs.

---

# Appendix F - Blueprint Relationship to Detailed Engineering Documents

This master blueprint should be decomposed into maintained engineering artifacts:

- Preckon PRA / Engineering Bible
- Solution Architecture Specification
- Canonical Data Model
- Database Design
- API Standards and OpenAPI contracts
- Event Catalog
- Security Architecture
- AI Architecture and Evaluation Manual
- Integration Hub SDK Specification
- Connector Certification Guide
- DrawLogix architecture
- TenderLogix PRD/technical design
- DocLogix PRD/technical design
- Quant/BOQ technical design
- ScheduleLogix technical design
- Cost/Project Controls technical design
- Deployment and Operations Runbook
- Data Migration Playbook
- Test Strategy and Golden Project datasets
- Architecture Decision Record repository

These documents should reference this blueprint and may add detail, but they should not silently contradict its core principles.

---

**End of Preckon Master Blueprint v1.0**

# Preckon Construction Knowledge Graph & Cross-Domain Intelligence Blueprint v1.0

## Purpose
The Preckon Construction Knowledge Graph (CKG) is a **Preckon Core platform service** connecting authoritative construction data across the lifecycle. It answers: what is related, what depends on it, what changed, what is impacted, what evidence supports the conclusion, and which decisions must be revisited.

## Domain Ownership
- **DocLogix:** documents, clauses, revisions, evidence.
- **DrawLogix:** drawings, models, design elements, revisions.
- **QuantLogix:** takeoff, quantities and provenance.
- **CostLogix:** rates, estimates, budgets and cost baselines.
- **ScheduleLogix:** activities, milestones, dependencies and time baselines.
- **ProcureLogix:** suppliers, RFQs, quotations and packages.
- **TenderLogix:** tender lifecycle, compliance, bid decisions, submission and award.
- **Contract/Change:** obligations, changes, entitlements and commercial outcomes.

**CKG owns relationships, semantic identity, provenance and cross-domain impact intelligence - not source truth.**

## Core Graph Model
Nodes include `Project, Tender, Document, DocumentRevision, Clause, Requirement, Drawing, DrawingRevision, DesignElement, ScopeItem, BOQItem, QuantityItem, CostItem, EstimateRevision, RFQPackage, SupplierQuote, ScheduleActivity, Milestone, Risk, Clarification, Addendum, Assumption, Qualification, Exclusion, ContractClause, ChangeEvent, Approval, Submission, Award`.

Relationships include `REFERENCES, REQUIRES, DEFINES, DEPICTS, MEASURES, PRICES, SUPPLIED_BY, SCHEDULED_BY, DEPENDS_ON, CONFLICTS_WITH, SUPERSEDES, CHANGED_BY, IMPACTS, EVIDENCED_BY, ASSUMES, EXCLUDES, QUALIFIES, RESPONDS_TO, APPROVED_BY, BASELINED_AS`.

Every edge carries tenant/context, source/target module-object-version, relationship type, confidence, provenance, timestamps and validity.

## Traceability Example
`Specification Clause 23.4 → Acoustic Ceiling Requirement → Drawing A-214 Rev C → 3,422 m2 Quantity → BOQ A.12.34 → Quote Q-1187 → Activity INT-440 → Risk R-31 → Qualification QL-09`.

## Change Impact Engine
1. Receive domain event.
2. Resolve changed object/version.
3. Traverse relevant relationships.
4. Apply deterministic impact rules first.
5. Expand traversal only where rules permit.
6. Create proposed impacts with severity/confidence.
7. Route impacts to owning Logix.
8. Require validation for governed changes.
9. Recompute readiness/risk/approval where relevant.

Example: addendum changes clauses/drawings → quantities recalculate → estimate reprices → schedule recalculates → quotes become stale → TenderLogix reopens impacted bid decisions.

## Impact Types
Informational; Review Required; Recalculate; Reprice; Reschedule; Requote; Reapprove; Revalidate Compliance; Reopen Clarification; Revisit Qualification; Submission Blocker; Project Baseline Change.

## Evidence & Provenance
Retain source object/version, page/clause/drawing region, extraction method, AI/model/rule version, confidence, human confirmation and supersession. AI-governed relationships begin **PROPOSED** and become **CONFIRMED** only through authorized validation or deterministic rules.

## Semantic Identity
Use stable canonical identities for scope, location, systems/assets, cost codes, WBS/CBS, disciplines and classifications. Map external standards where useful without forcing one standard on every customer.

## Technical Architecture
- Domain databases remain systems of record.
- CKG maintains graph relationship/index projections.
- Event bus keeps projections current.
- Search/vector indexes support semantic retrieval.
- Owning modules retain files/models.
- Hide physical graph storage behind an abstraction service so implementation can evolve.

## Core Services
Graph Registry; Relationship Service; Semantic Mapping; Provenance; Impact Traversal; Rule Engine; Graph Search; Graph RAG Context Builder; Event Projection Workers; Human Validation Queue; Graph Audit; Tenant/Permission Filter.

## Representative APIs
`POST /graph/relationships`
`GET /graph/objects/{module}/{type}/{id}/neighbors`
`GET /graph/objects/{...}/lineage`
`GET /graph/objects/{...}/downstream-impact`
`POST /graph/impact-analysis`
`POST /graph/relationships/{id}/confirm`
`POST /graph/relationships/{id}/reject`
`GET /graph/search`
`POST /graph/context`

## Events
Consume domain revision/change events from Doc, Draw, Quant, Cost, Schedule, Procure, Tender and Contract/Change services.
Emit `RelationshipProposed, RelationshipConfirmed, ImpactDetected, ImpactValidated, RecalculationRequired, ReapprovalRequired, SubmissionBlockerDetected, GraphContextUpdated`.

## AI & Token Efficiency
Use graph traversal and deterministic rules before LLM calls. AI flow: intent → graph traversal → retrieve only relevant authoritative objects → permission-aware RAG context → model routing → evidence-backed answer. Avoid repeatedly sending whole tender/project packages to an LLM.

## Security
Tenant isolation; source-object permission inheritance; commercial/margin restrictions; governed-query audit; no relationship exposure if endpoint permissions prohibit it. Support SaaS, VPC/private cloud and on-prem/customer-controlled deployment.

## TenderLogix as First Major Consumer
TenderLogix uses CKG for requirement traceability, scope completeness, spec/drawing/BOQ reconciliation, addendum/clarification impact, unpriced scope, commercial risk propagation, submission readiness and bid-to-project handover. **TenderLogix does not own CKG.**

## Organizational Construction Memory
Connect tender assumptions to outcomes; estimated vs actual productivity; supplier quotes to final procurement; tender risks to changes/claims; client clauses to payment/change behavior; schedule assumptions to actual delay; design maturity to cost growth.

## MVP Roadmap
**Phase 1:** registry, cross-module IDs, relationships, provenance, DocLogix + TenderLogix.
**Phase 2:** DrawLogix + QuantLogix and scope/BOQ gap detection.
**Phase 3:** Cost/Schedule/Procure impact propagation.
**Phase 4:** addendum impact engine + validation queue.
**Phase 5:** graph RAG/context builder + organizational memory.
**Phase 6:** execution/change/contract lifecycle intelligence.

## Non-Negotiables
Domain modules remain authoritative. No blind AI-governed relationships. Every conclusion is explainable. Every edge is tenant/security aware. Source revisions are immutable. Impact propagation is idempotent. Graph failures never corrupt source data. Governed commercial/contractual decisions require human authority.

## Differentiation
**Preckon understands how a change in one construction truth affects other construction truths - and routes those impacts to the people and workflows responsible for acting on them.**

This is more than AI search: it enables reasoning across documents, design, quantities, cost, time, procurement, risk and commercial commitments.

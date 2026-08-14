# Preckon TenderLogix Blueprint v2.0 - Standalone Product Blueprint

## Product Definition
TenderLogix is Preckon's **AI-native tender engineering and bid orchestration platform**.

**North star:** Convert an unstructured tender opportunity into a traceable, compliant, priced, scheduled, risk-assessed and submission-ready bid, then transfer the awarded bid directly into execution without recreating information.

## What TenderLogix Owns
Opportunity/tender lifecycle; bid/no-bid; tender team; milestones; requirements/compliance; bid-specific scope decisions; clarifications; addendum incorporation; risks/opportunities; assumptions/qualifications/exclusions; bid strategy; tender-specific estimate/programme/RFQ references; readiness; approvals; submission; negotiation/BAFO; award/loss; handover; portfolio/win-loss analytics.

## What It Does Not Own
| Capability | Owner |
|---|---|
| Files, OCR, revisions, clauses, search | DocLogix |
| Drawing/model intelligence | DrawLogix |
| Takeoff and quantities | QuantLogix |
| Rates and estimate calculations | CostLogix |
| CPM/programme engine | ScheduleLogix |
| Supplier/RFQ/quotation master | ProcureLogix |
| Cross-domain relationships/impact | Construction Knowledge Graph |

## Lifecycle
`Opportunity → Registration → AI Intake → Bid/No-Bid → Requirements → Scope → BOQ/Quantity Reconciliation → Estimate → RFQs → Programme → Risk/Commercial → Clarifications/Addenda → Bid Strategy → Approval → Submission QA → Submit → Negotiation/BAFO → Award/Loss → Handover`

## Tender War Room
Default active-tender cockpit. Header: client/tender, countdown, stage, bid value, margin, readiness, win probability and blockers.

Readiness tiles: Requirements | Scope | BOQ | Estimate | RFQs | Programme | Technical | Commercial | Addenda | Approvals | Submission.

AI brief: What changed? What could change price? What could prevent submission? What needs management decision? What remains unpriced/unresolved?

## Requirements & Compliance
AI proposes requirements from DocLogix evidence; humans confirm governed requirements. Retain mandatory flag, source/revision, clause/page, owner, due date, response, evidence, compliance, deviation, confidence and status.

Traceability: `Requirement → Evidence → Response → Approval → Submission Artifact`.

## Scope Intelligence
Tender Scope Breakdown: `Project → Package → Discipline → System → Work Package → Scope Item`.

Through CKG, scope links to specs, drawings, quantities, BOQ, cost, RFQs, schedule, risk and commercial positions. Detect specified-but-unpriced, drawing/no-BOQ, BOQ/no-drawing/spec, duplicate/conflicting scope, missing response and unquoted work.

## BOQ & Quantity Reconciliation
Support employer BOQ, no BOQ and hybrid/partial BOQ. Preserve `Employer Quantity | Preckon Derived Quantity | Adopted Tender Quantity | Decision/Rationale`.

Variance decisions may create clarification, risk, allowance, qualification or exclusion.

## Estimate
CostLogix calculates; TenderLogix governs tender revisions/scenarios: Base, Target, Aggressive, Strategic Win, BAFO and custom. Show direct cost, preliminaries, overhead, escalation, contingency, risk allowance, profit, tax, final value, margin waterfall and risk-adjusted margin.

## RFQ Coverage
ProcureLogix owns RFQs/quotes; TenderLogix measures coverage and selection rationale. Flag single source, expiry, scope exclusions, missing packages and noncompliant quotes.

## Programme
ScheduleLogix calculates; TenderLogix manages contractual milestones, adopted programme revision, assumptions and feasibility. Show contractual vs modeled completion, float, critical milestones, long leads and constraints.

## Clarifications
`Draft → Internal Review → Approved → Submitted → Answered → Impact Assessment → Closed`.

An answer cannot close until applicable scope/BOQ/quantity/cost/schedule/risk/qualification impacts are assessed.

## Addendum Intelligence
DocLogix/DrawLogix identify changes; CKG identifies relationships; TenderLogix orchestrates bid action.

Show impacts across documents, drawings, requirements, scope, BOQ, quantities, estimate, RFQs, programme, risks, clarifications, qualifications and submission artifacts.

`Received → Processed → Impact Identified → Actions Assigned → Recalculated → Reviewed → Incorporated → Approved`.

Mandatory unincorporated addendum = hard submission blocker.

## Risk & Commercial
Maintain risks/opportunities and assumptions/qualifications/exclusions with evidence and cost/time impact. Executive view: value, cost, margin, risk-adjusted margin, contingency, working capital, LD exposure, bonds, top risks and major qualifications.

## Bid Strategy
Target/minimum margin, strategic importance, competitor assumptions, differentiators, alternates, value engineering, negotiation limits and walk-away conditions. AI recommends scenarios using historical memory; humans govern final price.

## Submission Readiness
Weighted readiness plus hard gate. Hard blockers include unresolved mandatory requirements, unincorporated addenda, unfrozen final estimate/programme, missing approvals/signatures/bonds and package validation failures.

Display both **Readiness: 93%** and **Submission Gate: BLOCKED - 2 critical items**.

## Submission Builder
TenderLogix composes the manifest; DocLogix owns controlled files. Validate presence, revision, approval, signature, naming, format, size, addendum acknowledgement and requirement mapping. Freeze tender/estimate/programme/commercial/addendum/package revisions at submission.

## Approval Governance
Gates: Bid/No-Bid; Technical Freeze; Commercial Review; Final Bid; BAFO/Negotiated Revision. Delegation rules depend on value, margin, risk, geography, client and deviations.

## Negotiation / BAFO
Never overwrite submitted bids. Compare revisions by price, cost, margin, scope changes, concessions, programme, qualifications and approvals.

## Award / Loss
Award captures final negotiated truth and initiates handover. Loss captures reason, competitor/winning price if known, feedback and lessons.

## Bid-to-Project Handover
Compare `Submitted → Negotiated → Awarded → Project Baseline`. Transfer to DocLogix, QuantLogix, CostLogix, ScheduleLogix, ProcureLogix and project controls. Each receiving module validates its own baseline.

## AI Agents
Tender Intake; Requirement; Scope; Compliance; BOQ Reconciliation; Clarification; Addendum Impact; Commercial Risk; Bid Strategy; Submission QA; Handover.

All agents use permission-aware CKG/RAG context and expose evidence/confidence.

## Screen Architecture
1. Tender Portfolio
2. Opportunity/Bid-No-Bid
3. Registration/Intake
4. War Room
5. Requirements/Compliance
6. Scope
7. BOQ/Quantity
8. Estimate
9. RFQ Coverage
10. Programme
11. Risks
12. Clarifications
13. Addenda
14. Commercial
15. Bid Strategy
16. Submission Builder
17. Approval Center
18. Submission History
19. Negotiation/BAFO
20. Award/Loss
21. Project Handover
22. Tender Analytics/Knowledge

## Core Entities
`Opportunity, Tender, TenderRevision, TenderTeam, TenderMilestone, TenderRequirement, RequirementEvidenceLink, ComplianceDecision, ScopeItem, TenderBOQDecision, TenderEstimateReference, TenderScenario, TenderRFQCoverage, TenderProgrammeReference, Clarification, ClarificationImpact, Addendum, AddendumImpact, TenderRisk, CommercialPosition, BidStrategy, BidApproval, SubmissionManifest, TenderSubmission, NegotiationRound, BidRevision, Award, LossReview, HandoverPackage, HandoverItem`.

## State Machines
Tender: `Opportunity → Registered → Intake → BidDecision → ActiveBid → Approval → ReadyToSubmit → Submitted → Negotiation → Awarded/Lost/Withdrawn`.

Requirement: `Proposed → Confirmed → Assigned → InProgress → Ready → Compliant/Deviation/NA → Submitted`.

Addendum: `Received → Processing → ImpactPending → ActionsOpen → Incorporated → Approved`.

Clarification: `Draft → Review → Approved → Submitted → Answered → ImpactPending → Closed`.

Handover: `Prepared → Validating → Exceptions → Accepted → Activated`.

## Integration Events
`TenderCreated, TenderPackageLinked, RequirementConfirmed, DrawingRevisionDetected, QuantityBaselineChanged, EstimateRevisionPublished, VendorQuoteReceived, ProgrammeRevisionPublished, ClarificationAnswered, AddendumReceived, AddendumImpactCreated, RiskEscalated, BidApprovalRequested, BidApproved, SubmissionFrozen, TenderSubmitted, BAFORequested, TenderAwarded, TenderLost, HandoverPrepared, ProjectBaselineAccepted`.

## Security & Governance
Tenant isolation; tender-team RBAC; separate cost/sell/margin permissions; immutable submitted/approved snapshots; complete audit; source revisions retained; server-side approval/submission hashes; timezone-aware deadlines; configurable delegation of authority.

## Desktop + Browser
One backend/domain model. Browser: War Room, collaboration, compliance, approvals, executives. Desktop: large BOQs, dense estimating, bulk edits, drawing/quantity side-by-side and controlled caching. No separate product forks.

## MVP Roadmap
**MVP 1:** portfolio, registration, DocLogix intake, AI summary, bid/no-bid, requirements, team/milestones, clarifications, addenda register, risks, commercial positions, War Room, submission checklist, approvals, submission record, award/loss.

**MVP 2:** QuantLogix/BOQ, CostLogix/estimate, ProcureLogix/RFQ, ScheduleLogix/programme, DrawLogix relationships and automated addendum impact.

**MVP 3:** CKG-powered cross-domain reasoning, advanced compliance, bid strategy, submission QA, organizational tender memory, benchmarking, win probability and automated handover.

## Product Differentiation
Do not position TenderLogix as another tender register or subcontractor invitation tool.

Position it as:
**A tender engineering system that understands what the contractor is being asked to build, what must be priced, what is missing, where the bid is exposed, what changed, and whether the exact bid is safe and ready to submit.**

## Non-Negotiables
One domain, one source of truth. Every governed tender decision is evidence-linked and revisioned. AI proposes and explains. Addenda propagate impact. Submitted bids are immutable. Award handover requires no re-keying. TenderLogix remains useful even when optional Preckon modules are not licensed.

## North Star
**TenderLogix knows whether every requirement, scope item, quantity, price, programme commitment, risk, clarification, addendum and commercial position has been reconciled into the exact bid being submitted - and preserves that intelligence into project execution.**

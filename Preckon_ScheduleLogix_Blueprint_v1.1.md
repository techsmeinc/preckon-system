# Preckon ScheduleLogix — Product & Engineering Blueprint v1.0

**Mission:** Replace Primavera P6 for target construction customers without forcing them to rebuild schedules, relearn planning, or accept calculation uncertainty.

> **Bring your Primavera schedule. Keep your methodology and data. Continue working. Then activate Preckon intelligence.**

## 1. Product Positioning

ScheduleLogix is not a Gantt add-on or a visual P6 clone. It is Preckon's construction scheduling and project-time intelligence system:

**Primavera-class scheduling + seamless migration + connected project controls + AI planning/prediction.**

The schedule becomes the time dimension of Preckon, connected to DrawLogix, TenderLogix, BOQ/Quant, CostLogix, procurement, RFIs, submittals, changes, documents and field progress.

## 2. Non-Negotiable Principles

1. **Migration first:** existing P6 schedules should not be rebuilt.
2. **Familiar before different:** preserve planner concepts and terminology.
3. **Deterministic CPM:** AI never owns schedule mathematics.
4. **AI assists; planner controls:** Observe → Analyze → Recommend → Simulate → Explain → Approve → Apply → Audit.
5. **Construction-first:** design, procurement, quantities, locations, crews, commissioning and handover are native.
6. **Open/reversible:** import, export, APIs, snapshots and audit reduce lock-in.
7. **One engine, two clients:** browser and downloadable planner application share services and domain model.

## 3. Personas

Planner/Scheduler; Senior Planner; Planning Manager; Project Controls Manager; Project Manager; Construction Manager; Design Manager; Procurement Manager; Commercial/Contracts Manager; Cost Controller; Field Engineer; Executive/Portfolio Manager.

## 4. Five Product Layers

1. **Scheduling Engine** — CPM, calendars, constraints, float, progress, resources, baselines.
2. **Planner Workspace** — WBS, activity grid, Gantt, network, bulk/keyboard workflows.
3. **P6 Migration & Compatibility** — import, mapping, reconciliation, parity and coexistence.
4. **Connected Planning** — links to all Preckon project objects.
5. **Schedule Intelligence** — generation, diagnostics, prediction, simulation and recovery.

## 5. Primavera Migration — Release-Blocking Capability

### Formats
Priority: P6 XER and P6 XML. Then CSV/Excel and Microsoft Project exchange where practical.

### Migration Pipeline
**Upload → Preflight → Map → Sandbox Import → Calculate → Reconcile → Exceptions → Planner Sign-off → Publish → Connect**

### Preflight
Inspect project/WBS, activities, activity types/status, relationships/lags, calendars, constraints, codes, UDFs, resources/roles, assignments, expenses/costs, baselines, progress/actuals, units/rates and scheduling settings.

Classify each item: **Fully Supported / Transformed / Mapping Required / Unsupported / Semantic Difference / Conflict**.

### Mapping
Map IDs, WBS, activity codes, calendars, resources, roles, cost codes, units, UDFs and existing Preckon entities. Save reusable organization mapping templates.

### Reconciliation
Recalculate in ScheduleLogix and compare source results for project start, data date, forecast finish, milestones, activity dates, remaining dates, total/free float, critical activities, longest path, constraints, calendars, relationships, resources and baselines.

Exceptions use Critical/High/Medium/Low severity.

### Migration Confidence Score
Example: **97.8%**, composed of structural, activity, logic, calendar, constraint, date, float, resource, cost and UDF fidelity. Every deduction must be explainable.

### P6 Compatibility Workspace
Expose familiar columns: Activity ID/Name, WBS, Type, Status, Original/Remaining/Actual Duration, Start/Finish, Actual/Remaining dates, constraints, Total/Free Float, Percent Complete, Physical/Duration/Units %, Calendar, Activity Codes, Resources and Costs.

This is functional familiarity—not copying Oracle's UI.

### Exit/Coexistence
Provide Primavera-compatible export where technically supportable plus structured export/APIs. Customers must be able to pilot without fearing lock-in.

## 6. Enterprise Structure & WBS

**Organization → Portfolio → Program → Project → WBS → Activity**

Support business units, regions, templates, responsible managers, hierarchy-based security and corporate scheduling standards.

WBS: unlimited hierarchy, codes, owner, dates, notes, custom fields, rollups, templates, copy/paste and import/export.

## 7. Activity & Logic Model

Activity fields include ID/name, WBS, type/status, calendar, duration/percent-complete types, original/remaining/actual duration, planned/actual/remaining dates, expected finish, constraints, codes/UDFs, location, owner, resources/roles, costs, quantities, relationships, attachments and Preckon links.

Types: Task Dependent, Resource Dependent, Start/Finish Milestone, Level of Effort and WBS Summary.

Relationships: FS, SS, FF, SF, positive lag, policy-controlled negative lag, multiple predecessors/successors.

Tools: relationship inspector, predecessor/successor trace, driving relationship, longest path, open-end/circular/redundant logic detection and bulk editor.

## 8. Calendars

Global, organization, project and resource calendars; work weeks; holidays; exceptions; shifts; night work; regional calendars; Ramadan schedules; optional weather nonworking periods. Calendar changes require impact preview.

## 9. CPM Engine

A separate deterministic, versioned, heavily tested service supporting forward/backward pass, ES/EF, LS/LF, total/free float, critical path, longest path, driving logic, calendar-aware duration, constraints, actual-progress treatment, remaining duration, data date and out-of-sequence policies.

Maintain automated regression suites and reference schedules used to compare ScheduleLogix results with expected Primavera outcomes.

## 10. Scheduling Policies

Configurable critical threshold, data date, progress treatment, out-of-sequence handling, open-end warnings, lag policy, constraint policy, float options, leveling policy, default calendars and calculation precision. Save as organization standards.

## 11. Baselines, Versions & Compare

Baselines: Original, Contract, Approved, Revised, Recovery, Internal Target and user-defined.

Compare Current vs Baseline, Current vs Prior Update, Current vs Recovery, and Baseline vs Baseline. Detect date/duration/float, activity, logic, constraint, calendar, cost and resource changes.

Every published update creates an immutable snapshot recording user, timestamp, reason, data date and approval status.

## 12. Progress & Look-Ahead

Progress: data date, Actual Start/Finish, Remaining Duration, Physical/Duration/Units %, installed/remaining quantity, resource/cost actuals, expected finish and suspend/resume where required.

Sources may include planner, field, daily reports, quantities, procurement, inspections, APIs or AI proposals. AI evidence requires approval before becoming contractual progress.

Generate 2/3/4/6/8-week and custom look-aheads with location, crew, quantity, required drawings/material/equipment/submittals/approvals, constraints, owner and readiness.

## 13. Work Readiness

Track drawing, material, equipment, labor, access, permit, inspection, RFI, submittal, approvals, predecessor work, temporary works and safety prerequisites.

Generate a **Work Readiness Score** plus predicted executable start. Example: planned start Oct 12; readiness 62%; drawing approval and glass delivery indicate executable start Oct 19.

## 14. Resources, Cost & Earned Value

Resources: labor, crews, equipment, roles, skills, availability, rates, calendars and planned/actual/remaining units. Provide histograms, usage profiles and over-allocation.

Resource leveling is deterministic; AI may propose scenarios within planner limits.

Link activities to CostLogix budgets/cost codes, BOQ, contracts, commitments and changes. Support planned/actual/remaining/forecast cost, time-phasing, cash flow, S-curves, PV, EV, AC, SPI, CPI, SV, CV, BAC, ETC, EAC and VAC.

CostLogix remains authoritative commercially; ScheduleLogix supplies time.

## 15. Schedule Health & Critical Path Intelligence

Configurable Schedule Health Score checks missing logic, constraints, negative/excessive lags, long durations, invalid dates, negative/high float, relationship density, calendar anomalies, stale progress, baseline divergence and critical-path instability.

For any critical milestone answer: **Why critical? What drives it? When did it become critical? What changed? What downstream milestone is affected? Which drawing/procurement/RFI/resource is involved? What recovery options exist?**

## 16. Delay Intelligence & Recovery

Analyze progress, float consumption, critical-path movement, procurement forecasts, drawing approvals, RFIs/submittals, change, resources, productivity, field constraints and weather when connected.

Always separate deterministic schedule impact from AI-predicted risk.

Recovery request example: **“Recover 15 days without moving handover and without increasing peak labor more than 10%.”**

Generate alternatives: resequence eligible work, parallelize, add shifts/crews, expedite procurement, prioritize approvals, compress selected durations or change zone sequence. Show finish improvement, cost/resource impact, new critical path, risks, changed activities, assumptions and confidence. Planner approves before applying.

## 17. What-If Sandbox

Disposable schedule branches for scenarios such as 21-day procurement slip, second crane, night shift, delayed approval, crew increase, zone resequencing or milestone acceleration. Compare scenarios side-by-side without changing the published schedule.

## 18. AI Schedule Generation & Copilot

Inputs: tender/SOW, BOQ, drawings, specifications, milestones, project type, locations, quantities, productivity libraries, templates and historical schedules.

Propose **WBS → Activities → Durations → Logic → Calendars → Milestones → Resources → Design/Procurement Dependencies** with provenance/confidence and planner review.

Copilot questions include: Why are we late? What changed since last update? What drives handover? Which activities consumed >10 days float? What could delay next month? What if steel arrives two weeks late? Recover 10 days. Which activities wait on drawings? Compare to approved baseline.

Answers must link to deterministic calculations and project evidence.

## 19. Preckon Connected Planning

- **TenderLogix:** milestones, requirements, bid assumptions.
- **DrawLogix:** drawing packages, revisions, deliverables, approvals.
- **Quant/BOQ:** quantity-driven durations, productivity and installed progress.
- **CostLogix:** cost loading, cash flow, EV, forecasts and change impact.
- **Procurement:** submittal, approval, fabrication, shipping, delivery, required-on-site dates.
- **Documents/RFI/Submittals:** approval dependencies and exposure.
- **Field:** daily progress, quantities, inspections and constraints.
- **Change:** affected activities, schedule impact and approved time changes.

Defining chain:

**Drawing Revision → Quantity Change → Cost Change → Procurement Change → Schedule Impact → Critical Path → Completion Forecast → Executive Alert**

Every link is traceable.

## 20. UX / Screens

Primary screens: Command Center; Projects/Programs; P6 Migration Center; Migration Reconciliation; Planner Workspace; WBS; Activity Details; Relationships; Gantt; Network Diagram; Calendars; Resources/Histogram; Baselines; Schedule Compare; Progress Update; Look-Ahead; Readiness; Schedule Health; Critical Path Explorer; Delay Intelligence; Recovery Scenarios; What-If Sandbox; Cost/S-Curve; Earned Value; Reports; Copilot; Audit/Version History; Organization Standards; Portfolio Intelligence.

Planner workspace layout: **WBS tree | high-performance activity grid | synchronized Gantt**, with a details drawer for relationships, resources, codes, notes and Preckon links.

Required interactions: frozen/resizeable columns, chooser, sort/group/filter, saved layouts, copy/paste, fill-down, bulk edit, undo/redo, keyboard navigation, multi-select, zoom, timescale, baseline bars, relationship lines and critical/longest-path highlighting.

## 21. Browser + Downloadable Application

**Browser:** collaboration, dashboards, approvals, field interaction, management review and normal editing.

**Desktop/downloadable:** power planners, large schedules, bulk editing, keyboard-heavy workflows, caching and intermittent connectivity.

Both use the same ScheduleLogix APIs, domain model and CPM engine. Do not create two independent products.

## 22. Technical Architecture

**Clients → Schedule API/Application Services → Domain Services → CPM Engine → Baseline/Version Engine → Migration Service → Reconciliation Engine → Resource/Cost Services → Event/Integration Layer → AI Orchestration → Preckon Core**

Infrastructure: relational operational DB, object storage, search/index, event bus, cache, workers, audit/event store and analytics platform as scale requires.

Core entities: Organization, Portfolio, Program, Project, ProjectSettings, WBS, Activity, Relationship, Calendar, CalendarException, Constraint, ActivityCode, UDF, Resource, Role, ResourceAssignment, CostAssignment, Baseline, ScheduleVersion, ProgressUpdate, QuantityProgress, Location, ScheduleLink, MigrationJob, MigrationMapping, MigrationException, ReconciliationResult, HealthCheck, RiskPrediction, Scenario, ScenarioChange, AIRecommendation, Approval and AuditEvent.

## 23. API Families

`/projects`, `/wbs`, `/activities`, `/relationships`, `/calendars`, `/resources`, `/baselines`, `/versions`, `/progress`, `/schedule/calculate`, `/schedule/critical-path`, `/schedule/compare`, `/schedule/health`, `/migrations`, `/migrations/{id}/reconcile`, `/scenarios`, `/ai/schedule/generate`, `/ai/schedule/analyze`, `/ai/schedule/recovery`, `/links`.

All mutations require authorization, validation and audit.

## 24. AI Agents

- **Schedule Generation Agent:** draft WBS/activity/logic plans.
- **Schedule Quality Agent:** identify structural/logic problems.
- **Delay Prediction Agent:** forecast emerging exposure.
- **Recovery Agent:** produce recovery alternatives.
- **Progress Intelligence Agent:** propose progress from connected evidence.
- **Schedule Impact Agent:** trace drawing/BOQ/procurement/change impact.
- **Schedule Copilot:** conversational interface over calculations and evidence.

Agents use controlled tools and cannot directly rewrite approved schedules.

## 25. Governance, Security & Performance

Audit activity/logic/constraint/calendar/baseline/progress changes, imports/exports, AI recommendations, scenario promotion, approvals and publication with who/when/before/after/source/reason.

Roles: Schedule Admin, Planning Manager, Planner, Project Controls, Project Manager, Viewer, Field Contributor, Approver and External Consultant. Support project/WBS-sensitive permissions when needed.

Design from the beginning for enterprise schedules with tens of thousands of activities. Virtualize grid/Gantt rendering; move heavy calculations/imports to scalable jobs; benchmark large-project performance continuously.

## 26. Reporting

Executive summary, milestones, critical/longest path, variance, baseline comparison, look-ahead, delayed activities, float consumption, logic changes, resource usage, S-curves, earned value, procurement exposure, design/RFI/submittal exposure, recovery scenarios, schedule health and migration reconciliation.

Export PDF, Excel and structured data; provide API access.

## 27. Phased Delivery

### Phase 0 — Engine & Compatibility Foundation
Domain model, CPM engine, calendars, relationships, constraints, progress semantics, baseline model, P6 test corpus and automated parity tests.

**Exit:** engineering proves deterministic calculation integrity.

### Phase 1 — Planner MVP
Projects/WBS, activities, logic, calendars, Gantt/grid, critical path/float, progress, baselines, filters/grouping/layouts, snapshots and basic reporting.

**Exit:** planner can create and maintain a real construction schedule.

### Phase 2 — P6 Migration
XER/XML ingestion, preflight, mapping, sandbox import, reconciliation, confidence score, exception workflow, compatibility layout and supported export.

**Exit:** pilot customer migrates real P6 schedules without rebuilding.

### Phase 3 — Connected Preckon
Drawings, BOQ/quantity, procurement, cost, RFI/submittal, change, field progress and look-ahead/readiness.

**Exit:** schedule becomes the project time graph rather than a standalone file.

### Phase 4 — Intelligence
Health scoring, Copilot, delay prediction, schedule generation, impact tracing, what-if and recovery scenarios.

**Exit:** AI produces explainable, planner-approved value beyond P6.

### Phase 5 — Enterprise / Portfolio
Programs/portfolios, resource planning, advanced earned value, organization standards, portfolio risk, enterprise analytics, integration marketplace and scale hardening.

## 28. MVP Boundary

**Must have:** deterministic CPM; WBS/activity management; logic/lags; calendars; constraints; float/critical path; progress/data date; baselines; high-performance grid/Gantt; filters/grouping; version/audit; P6 XER/XML migration; reconciliation; confidence report; basic resource/cost loading; reports; Preckon identity/security.

**Do not block initial pilot on:** full portfolio optimization, every obscure P6 enterprise feature, advanced AI optimization, exhaustive third-party integrations or perfect parity with every historical P6 version.

## 29. Acceptance Criteria for “Primavera Replacement Ready”

A target pilot cannot be called replacement-ready until:

1. A real customer P6 schedule imports without manual reconstruction.
2. Unsupported/transformed data is explicitly reported.
3. Key dates/float/critical path reconcile within agreed tolerances or differences are explained.
4. Planner can perform normal update-cycle work efficiently.
5. Baselines and schedule versions are controlled/auditable.
6. Critical path, look-ahead and standard reports are usable operationally.
7. Large schedules meet agreed performance targets.
8. Customer can export/retrieve its schedule data.
9. AI is optional and cannot silently modify approved schedule logic.
10. Migration and production data are protected by enterprise authorization/audit controls.

## 30. Competitive Differentiation

**P6 replacement capability gets us through the door. Connected intelligence is why customers should stay.**

ScheduleLogix should ultimately know not only that an activity is late, but **why**: a drawing is unapproved, quantity changed, material is late, productivity is below plan, an RFI blocks execution, or a predecessor has slipped. It should then quantify downstream time/cost exposure and simulate practical recovery options.

That is the Preckon advantage.

## 31. Recommended Engineering Workstreams

Run these in parallel:

**A. Scheduling Engine** — CPM semantics, tests, performance.  
**B. P6 Compatibility Lab** — XER/XML parser, mapping, parity corpus, reconciliation.  
**C. Planner UX** — grid/Gantt, WBS, bulk/keyboard workflows.  
**D. Connected Data Graph** — canonical links across Preckon modules.  
**E. AI Schedule Intelligence** — initially read-only analysis/simulation.  
**F. Enterprise Platform** — security, audit, jobs, scale, APIs.

## 32. Immediate Next Build Package

Before sprint implementation, produce:

1. **P6 → ScheduleLogix Capability Matrix** with Must Match / Transform / Improve / Defer decisions.
2. **CPM Calculation Specification** with deterministic examples and edge cases.
3. **P6 Migration Technical Specification** for XER/XML parsing, mapping and reconciliation.
4. **ScheduleLogix Domain/Data Model** with table/entity definitions.
5. **Planner UX Specification** and wireframes.
6. **API Contract v1**.
7. **Schedule Agent Architecture** with permissions and human-approval boundaries.
8. **Pilot Migration Test Pack** using representative construction schedules.

## 33. North-Star Customer Experience

A customer uploads an existing P6 project. ScheduleLogix analyzes it, maps organization data, imports it into a sandbox, recalculates it, reports a 98%+ confidence score and explains the remaining differences. The planner opens a familiar scheduling workspace and continues the next update cycle.

They then connect drawings, BOQ, procurement, cost and field progress. ScheduleLogix detects that a drawing approval and long-lead procurement package threaten a milestone, shows the driving path and predicted delay, and generates three recovery scenarios. The planner reviews one, compares cost/resource impact, approves it, and publishes a controlled recovery version.

**That is the product we should build.**

# Appendix A — Primavera P6 → ScheduleLogix Capability Matrix

## A.1 Classification
- **P0 — Migration/Parity:** Required before we claim a credible P6 replacement for target pilot customers.
- **P1 — Preckon Improvement:** Required to make switching worthwhile, not merely possible.
- **P2 — Enterprise/Advanced:** Important for broader enterprise displacement after pilot validation.
- **Disposition:** Must Match, Transform, Preckon Improve, Differentiate, or Later.

## A.2 Core Migration and Scheduling Matrix

| ID | Capability | Priority | Disposition | ScheduleLogix Requirement | Migration / Acceptance Gate | Preckon Advantage |
|---|---|---|---|---|---|---|
| SL-P6-001 | P6 XER import | P0 | Must Match | Production-grade XER parser and semantic mapper | Representative customer XER projects import without silent loss; exceptions reported | Migration Confidence Score and reconciliation |
| SL-P6-002 | P6 XML import | P0 | Must Match | P6 XML import through common migration pipeline | Supported XML projects pass same parity suite as XER | One migration experience regardless of format |
| SL-P6-003 | Project settings | P0 | Must Match | Preserve scheduling-critical project settings | Source settings mapped or explicitly flagged | Corporate scheduling-standard templates |
| SL-P6-004 | WBS | P0 | Must Match | Unlimited hierarchical WBS, codes, owners and rollups | Hierarchy/codes preserved | Link WBS to BOQ, drawings, cost, locations and procurement |
| SL-P6-005 | Activities | P0 | Must Match | Stable Activity ID, name, type, status and scheduling attributes | Supported activity fields survive import | Activity becomes connected Preckon execution object |
| SL-P6-006 | Activity types | P0 | Must Match | Task/resource dependent, milestones, LOE, summary semantics as required | Equivalent scheduling behavior validated | Additional construction-aware types later |
| SL-P6-007 | Durations | P0 | Must Match | Original, remaining and actual duration | Values/units and calculated dates reconcile | Quantity/productivity can propose duration |
| SL-P6-008 | Relationships | P0 | Must Match | FS, SS, FF, SF, multiple links, lag | Supported relationships import 1:1 and recalculate correctly | AI logic-quality analysis |
| SL-P6-009 | Calendars | P0 | Must Match | Global/org/project/resource calendars, workweeks, exceptions, shifts | Calendar-driven dates match reference cases | GCC/Ramadan/night-shift templates |
| SL-P6-010 | Constraints | P0 | Must Match | Required P6 constraint semantics | Unsupported semantic differences block/flag migration | Constraint-risk explanation |
| SL-P6-011 | Forward pass | P0 | Must Match | Deterministic ES/EF calculation | Golden schedule suite passes | Explain driving logic |
| SL-P6-012 | Backward pass | P0 | Must Match | Deterministic LS/LF/float calculation | Golden schedule suite passes | Float-consumption intelligence |
| SL-P6-013 | Total/free float | P0 | Must Match | TF/FF calculation and display | Within approved parity tolerance | Float trend and risk prediction |
| SL-P6-014 | Critical path | P0 | Match + Improve | Critical threshold, driving and longest-path exploration | Critical path reproduced or discrepancy explained | Critical Path Explorer |
| SL-P6-015 | Data date | P0 | Must Match | Controlled status/data date | Imported data date retained | Connect field evidence to update period |
| SL-P6-016 | Out-of-sequence progress | P0 | Must Match | Configurable progress treatment required by target customers | Dedicated OOS parity tests | Detect repeated sequence breakdown |
| SL-P6-017 | Percent complete | P0 | Must Match | Duration, physical and units methods | Method/value retained | Quantity/field evidence can propose physical progress |
| SL-P6-018 | Actuals | P0 | Must Match | Actual dates/units/cost and remaining work | Supported actuals survive migration | Controlled FieldLogix progress feed |
| SL-P6-019 | Activity codes | P0 | Must Match | Code types, values, assignment, grouping | Dictionaries and assignments preserved | AI can suggest missing classifications |
| SL-P6-020 | UDF/custom fields | P0 | Transform | Typed ScheduleLogix custom fields | Mapping wizard; no silent discard | Fields usable by rules, APIs and AI |
| SL-P6-021 | Filters/grouping | P0 | Must Match | Fast filtering, grouping, sorting and saved layouts | Planner can reproduce normal working views | Natural-language view/filter creation later |
| SL-P6-022 | Gantt | P0 | Match + Improve | Synchronized high-performance grid/Gantt | Large schedule performance benchmark | Overlay procurement/readiness/risk |
| SL-P6-023 | Baselines | P0 | Match + Improve | Original/contract/approved/revised/recovery baselines | Supported baseline data reconciled | Strong governance and explainable variance |
| SL-P6-024 | Schedule versions | P0 | Improve | Immutable snapshots and schedule diff | Every publish is traceable | Git-like schedule history |
| SL-P6-025 | Resources/roles | P0 | Must Match | Labor, crew, equipment, role, calendar, rate, assignment | Supported assignments preserved | Link actual crews/equipment/productivity |
| SL-P6-026 | Security | P0 | Must Match | Tenant/org/project/role authorization | Access-control tests pass | Unified Preckon security |
| SL-P6-027 | Audit | P0 | Improve | Fine-grained change and AI audit | Who/what/when/source captured | AI proposal/approval fully traceable |
| SL-P6-028 | Desktop power UX | P0 | Must Match UX | Downloadable power-planner client on common services | Keyboard/bulk-edit/performance acceptance tests | Same core for desktop and web |
| SL-P6-029 | Browser collaboration | P0 | Improve | Browser planning, review, approval and management | Same controlled project/version visible across clients | Native collaboration |
| SL-P6-030 | Large schedule performance | P0 | Must Match | Architecture target 100k activities with large logic sets | Benchmark suite before enterprise release | Cloud scale + local caching |
| SL-P6-031 | APIs | P0 | Improve | Versioned APIs/events for schedule objects and progress | Integration contract tests | Schedule becomes Preckon's time API |
| SL-P6-032 | AI governance | P0 | Required | Observe → Recommend → Simulate → Approve → Apply → Audit | No material AI change bypasses approval | Enterprise-safe AI |

## A.3 P1 — Switching Value / Connected Project Controls

| ID | Capability | Priority | Disposition | ScheduleLogix Requirement | Acceptance Gate | Preckon Advantage |
|---|---|---|---|---|---|---|
| SL-P6-033 | Resource histogram | P1 | Must Match | Time-phased demand/usage | Reconciles from assignments | Bottleneck prediction |
| SL-P6-034 | Resource leveling | P1 | Match + Improve | Deterministic leveling plus scenario preview | Repeatable rule-based results | AI optimization within planner constraints |
| SL-P6-035 | Cost loading | P1 | Transform + Improve | Activity costs linked to CostLogix | Imported supported costs reconcile | Unified time/cost model |
| SL-P6-036 | Earned value | P1 | Must Match | PV, EV, AC, SPI, CPI, SV, CV, BAC, EAC, ETC, VAC | Formula/configuration tests | Predictive risk layered on EVM |
| SL-P6-037 | Network diagram | P1 | Must Match | Interactive logic network/path tracing | Relationship/path tests | AI explanation on network |
| SL-P6-038 | Schedule comparison | P1 | Improve | Structural/calculated diff | Detect date/activity/logic/constraint/calendar changes | Automatic variance explanation |
| SL-P6-039 | Export/exit | P1 | Must Match where validated | Open structured export and validated P6-compatible export | Supported round-trip tests | Low lock-in risk |
| SL-P6-040 | Reporting | P1 | Match + Improve | Schedule reports, Excel/PDF, templates | Core planner reports reproducible | AI executive narrative |
| SL-P6-041 | Look-ahead | P1 | Improve | Native 2–8 week construction workspace | Correct derivation from current schedule | Readiness + crew + material + drawing context |
| SL-P6-042 | Work readiness | P1 | Improve | Readiness score from prerequisites | Every blocker traceable | Predict executable vs planned start |
| SL-P6-043 | DrawLogix linkage | P1 | Improve | Link drawing packages/revisions to activities | Revision identifies affected activities | Drawing→schedule impact |
| SL-P6-044 | BOQ/quantity linkage | P1 | Improve | Quantity/productivity/activity links | Reproducible quantity-driven duration/progress | BOQ→time intelligence |
| SL-P6-045 | Procurement linkage | P1 | Improve | Package/submittal/fabrication/shipping/delivery/ROS dates | Late package exposes impacted path | Long-lead prediction |
| SL-P6-046 | RFI/submittal linkage | P1 | Improve | Approval dependencies and aging | Approval delay traces to affected activities | Prioritize approvals by schedule impact |
| SL-P6-047 | Change integration | P1 | Improve | Change event/order to affected activities/scenario/time award | Before/after impact auditable | Commercial + time impact in one chain |
| SL-P6-048 | What-if sandbox | P1 | Improve | Branch-based disposable schedule scenarios | Published schedule cannot be changed accidentally | Fast schedule/cost/resource simulation |
| SL-P6-049 | Recovery planning | P1 | Differentiate | Goal-constrained recovery scenario generator | Shows activities, assumptions, gain, cost/resource impact | AI explores resequencing/crews/shifts/expediting |
| SL-P6-050 | Schedule Health | P1 | Differentiate | Configurable schedule-quality score | Every finding tied to deterministic rule | Continuous quality monitoring |
| SL-P6-051 | Schedule Copilot | P1 | Differentiate | Grounded conversational schedule analysis | Answers trace to activities/versions/calculations | Business-language explanation of complex schedule |

## A.4 P2 — Advanced Enterprise Differentiation

| ID | Capability | Priority | Disposition | Requirement | Why Later / Gate |
|---|---|---|---|---|---|
| SL-P6-052 | Portfolio/program management | P2 | Enterprise | Multi-project portfolio health, milestones and rollups | Build after single-project parity is proven |
| SL-P6-053 | Cross-project relationships | P2 | Enterprise | Governed external dependencies | High calculation/migration complexity |
| SL-P6-054 | Shared enterprise resource optimization | P2 | Enterprise | Resource capacity across projects | Requires portfolio foundation |
| SL-P6-055 | AI schedule generation | P2 | Differentiate | Draft WBS/activities/durations/logic from tender, BOQ, drawings and templates | Must not distract from migration/parity |
| SL-P6-056 | Predictive delay model | P2 | Differentiate | Forecast risk from progress, float, procurement, approvals, productivity and history | Needs sufficient data and validation |
| SL-P6-057 | Historical productivity learning | P2 | Differentiate | Learn productivity ranges by work type/project/location | Requires governed historical data |
| SL-P6-058 | Portfolio AI | P2 | Differentiate | Cross-project systemic risk and intervention recommendations | Requires mature portfolio data |

# Appendix B — Migration Fidelity Contract

ScheduleLogix should not display a generic **“Import Successful”** message. Each migration produces a signed-off reconciliation package.

## B.1 Required Results
1. Source file fingerprint and import timestamp.
2. Objects discovered/imported/transformed/rejected.
3. Field-level mapping summary.
4. Unsupported semantic warnings.
5. Source vs ScheduleLogix calculation comparison.
6. Milestone/date/float/critical-path comparison.
7. Migration Confidence Score with component scores.
8. Exceptions requiring planner review.
9. Planner acceptance identity/time.
10. Published ScheduleLogix version ID.

## B.2 Pilot Go/No-Go Threshold
A pilot customer cannot cut over until:
- No unresolved Critical migration exceptions exist.
- Contract milestones reconcile within the agreed tolerance.
- Critical/longest-path differences are understood and accepted.
- Calendar and relationship fidelity is approved.
- Baseline/progress data needed for the customer's process is available.
- Planner performs representative update, recalculate, baseline comparison, look-ahead and reporting workflows successfully.
- An export/exit package has been demonstrated.

# Appendix C — Engineering Traceability Model

Every capability becomes an auditable delivery chain:

> **P6 Capability → ScheduleLogix Requirement → Migration Mapping → Domain Model → API → UI Workflow → Calculation/Business Rule → Automated Test → Golden P6 Comparison → Customer Acceptance → Release Gate**

Required engineering metadata per capability:
- Requirement ID
- Owner
- Priority
- Source P6 concept
- Domain entities
- API endpoints/events
- UX screens
- Migration parser/mapping rule
- Calculation impact
- Unit tests
- Integration tests
- Golden schedule tests
- Performance tests
- Customer acceptance scenario
- Release status

# Appendix D — Definition of “Primavera Replacement Ready”

Preckon should **not** market ScheduleLogix as a Primavera replacement merely because it can display a Gantt chart or import an XER file.

For a defined target customer segment, “Primavera Replacement Ready” means:

1. Their real P6 projects migrate without unacceptable data/semantic loss.
2. Their critical scheduling calculations reconcile within agreed tolerances.
3. Their planners can perform normal planning/update/baseline/reporting workflows without returning to P6.
4. Schedule performance is acceptable on their real project sizes.
5. Governance, permissions, audit and versioning satisfy their controls.
6. They can export their data and are not trapped.
7. Training focuses on UI differences and new Preckon capabilities—not relearning project scheduling.
8. Connected Preckon capabilities provide a clear reason to switch.

# Appendix E — Recommended Build Order

## Release 1 — Migration + Planner Core
XER/XML migration, reconciliation, WBS, activities, relationships, calendars, constraints, CPM, float, critical path, data date, progress, codes/UDFs, baselines, versions, planner grid/Gantt, desktop/browser foundation, security, audit and APIs.

## Release 2 — Replacement + Preckon Advantage
Resources, leveling, cost/EVM, network diagram, schedule compare, reports, export, look-ahead, readiness, DrawLogix/BOQ/procurement/RFI/submittal/change integration, Schedule Health, What-If, Recovery and Schedule Copilot.

## Release 3 — Enterprise Intelligence
Portfolio/programs, cross-project dependencies, shared resources, AI schedule generation, predictive delay, historical productivity and portfolio intelligence.

# Appendix F — Product Rule

> **Do not force the customer to choose between familiarity and innovation. ScheduleLogix should let them migrate first, operate safely second, connect their project data third, and adopt AI progressively.**

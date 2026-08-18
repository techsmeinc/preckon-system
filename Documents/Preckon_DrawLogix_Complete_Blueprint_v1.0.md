# Preckon DrawLogix — Complete Product & Engineering Blueprint
## Version 1.0 — Engineering Baseline

**Parent architecture:** Preckon Complete Platform Blueprint v1.1 + PCM Engineering Blueprint v1.1

# 1. Product Definition
DrawLogix is Preckon's AI-native drawing, design, BIM, documentation and drawing-intelligence module. It strengthens—not replaces—the original lifecycle:

**Tender → Requirements → Draw/Design → Quantity → BOQ → Estimate → Bid → Procurement → Delivery → Cost Control → Handover**

ArchiLabs is a capability benchmark for AI-native design/BIM, not the definition of Preckon. DrawLogix must cover relevant AI-assisted authoring, parametric automation, smart components, review and documentation, then connect those objects to Preckon's broader construction lifecycle.

# 2. Guardrails
1. PCM is authoritative; no disconnected BIM model.
2. AI interprets intent; deterministic tools execute authoritative changes.
3. Engineering-critical changes require appropriate human authority.
4. Material changes are revisioned, attributable and reversible.
5. Imported data retains source provenance and confidence.
6. 2D/3D should be views of shared structured objects where practical.
7. PDF, DWG/DXF, IFC and appropriate Revit interoperability are first-class.
8. Authoritative state, AI suggestions and derived calculations remain separate.
9. Construction objects link to requirements, quantity, BOQ, cost and delivery.
10. Do not clone AutoCAD/Revit command-for-command before differentiated value.

# 3. Capability Map
- Drawing/file intake and intelligence
- Native 2D and 3D/BIM authoring
- Parametric modeling and constraints
- Smart components/families
- AI Design Copilot and workflow automation
- Architecture, structural and MEP workbenches
- Shop, coordination/composite and as-built drawings
- Views, sheets, dimensions, tags and schedules
- Design options, clash detection and validation
- Review, issues, approvals, revisions and collaboration
- Quantity, BOQ, estimate and cost integration
- TenderLogix/specification integration
- Change-impact analysis
- Interoperability, APIs, security and observability

# 4. Core Workflow
```text
Tender / Requirement / PDF / DWG / IFC / Blank
                    ↓
             Drawing Intake
          ↙                 ↘
 Drawing Intelligence    Native Authoring
          ↘                 ↙
             Structured PCM
                    ↓
        2D + 3D/BIM + Parametrics
                    ↓
           AI-assisted Design
                    ↓
       Engineering Validation
                    ↓
       Views/Sheets/Documentation
                    ↓
              Quantities
                    ↓
          BOQ / Estimate / Cost
                    ↓
 Procurement / Delivery / Changes
                    ↓
                As-Built
```

# 5. Workspace UX
```text
+----------------------------------------------------------------------------+
| Preckon | DrawLogix | Project | Discipline | Level | View | Rev | Publish |
+-------------+---------------------------------------+----------------------+
| PROJECT     |            DESIGN CANVAS              | AI COPILOT           |
| Drawings    |       2D / 3D / BIM / PDF / IFC      | Prompt               |
| Models      |                                       | Suggestions          |
| Levels      |                                       | Validation/Impact    |
| Sheets      |                                       | Preview | Apply      |
+-------------+---------------------------------------+----------------------+
| Properties | Layers | Constraints | Quantity | BOQ | Issues | History     |
+----------------------------------------------------------------------------+
```
Modes: Select, Draw, Model, Annotate, Measure, Review, Compare, Coordinate, Quantity, AI, Sheet, 3D and Walkthrough.

# 6. PCM Contract
```text
PCMObject
 id, projectId, objectType, discipline, classification
 geometryRef, spatialContainerId, typeId
 propertySetIds[], materialIds[], relationshipIds[]
 requirementIds[], specificationIds[], sourceRefs[]
 revisionCreated, revisionModified, lifecycleStatus
```
Spatial hierarchy: Project → Site → Building → Zone → Level → Space/Room → Objects. Additional grouping: area, wing, block, grid, system, discipline, phase, work package and trade package.

# 7. Geometry & Parametric Engine
```text
User Intent → AI Interpretation → Typed Command → Geometry/Parametric Engine
→ Validation → Preview Diff → Commit → PCM ChangeSet + Revision + Events
```
LLMs never directly write authoritative geometry.

Primitives: point, vector, line, polyline, arc, circle, polygon, curve, plane, mesh, surface, solid, extrusion, sweep, boolean and transform.

Engineering geometry: wall paths, slab/roof boundaries, beam/column axes, MEP centerlines, openings, clearance zones, equipment footprints, room boundaries and grids.

Parametric objects define parameters, constraints, dependencies, regeneration, validation and quantity rules. Constraints include dimensional, geometric, alignment, host, level, offset, equality, clearance, standards and connectivity.

# 8. Deterministic Commands
Core commands include `CreateWall`, `ModifyWall`, `DeleteObject`, `MoveObject`, `RotateObject`, `CopyObject`, `CreateDoor`, `CreateWindow`, `CreateRoom`, `CreateSlab`, `CreateColumn`, `CreateBeam`, `CreateGrid`, `CreatePipe`, `CreateDuct`, `CreateEquipment`, `ChangeType`, `ChangeParameter`, `ApplyConstraint`, `CreateDimension`, `CreateTag`, `CreateView`, `CreateSheet`, `GenerateSchedule`, `ImportModel` and `LinkModel`.

Every command returns validation, preview diff, dependency impact, warnings/errors, ChangeSet and domain events.

# 9. AI Design Copilot
Copilot responsibilities: understand intent/context, query and semantically select objects, propose designs, generate typed commands, invoke approved tools, explain impacts, identify missing information, automate repetitive documentation and compare revisions.

Examples:
- Create a 60m × 120m warehouse with 12m structural grid.
- Replace Level 2 partitions with the approved acoustic wall type.
- Tag all fire doors.
- Generate RCP sheets for office levels.
- Find doors violating the fire-rating requirement.
- Route ductwork around beams while maintaining clearance.
- Compare Rev 8 vs Rev 7 and show quantity/cost impact.

Execution modes: `READ_ONLY`, `PROPOSE`, `PREVIEW`, `APPLY_WITH_USER_APPROVAL`, `POLICY_AUTHORIZED_AUTOMATION`.

# 10. Drawing Intake & Recognition
Inputs: PDF/scanned PDF, DWG, DXF, IFC, raster images and appropriate RVT interoperability; DGN and point clouds later.

Pipeline: Upload → security validation → metadata → classification → scale → coordinate normalization → vector/layer extraction → text/symbol interpretation → object inference → confidence → verification → PCM mapping.

Recognize title blocks, revisions, dimensions, scales, grids, levels, walls, doors, windows, columns, beams, slabs, rooms, equipment, symbols, text, callouts, sections, elevations, details, legends and schedules.

Each inferred object stores source, evidence, recognition model version, confidence and review state. Low-confidence results enter verification queues.

# 11. Native Authoring
**2D:** line/polyline, shapes, trim/extend, offset/fillet, move/rotate/mirror, copy/array, hatch, text, leaders, dimensions, snaps, grids, layers and components.

**Architecture BIM:** walls, curtain walls, doors, windows, slabs, ceilings, roofs, stairs, ramps, railings, rooms/spaces and finishes.

**Structural:** grids, foundations, columns, beams, braces, slabs, structural walls and openings.

**MEP:** equipment, ducts, pipes, fittings, terminals, cable trays, conduits, devices and system/connectivity relationships.

# 12. Smart Components
A component contains metadata, category/classification, geometry template, parameters, connectors, materials, constraints, placement rules, quantity rules, property sets, validation rules, manufacturer data, version and approval state.

Libraries: Preckon global, organization, project, manufacturer and regional. AI-generated components require validation before production approval.

# 13. Discipline Workbenches
**Architecture:** space planning, room/wall/opening layouts, finishes, areas, circulation, accessibility/egress pre-checks, facade concepts, RCP, schedules, sheets and design options.

**Structural:** grids, foundations, framing, slabs, walls, openings and coordination. Certified detailed analysis initially integrates with specialist solvers.

**MEP:** equipment, systems, connectors, routing, fittings, clearances, penetrations, coordination and schedules. AI routing is constraint-based.

# 14. Drawing Stages
Concept → Design Development → Working → Shop → Coordination/Composite → Approved for Construction → Redline → As-Built.

Shop workflow: Design Model → Trade Package → Generate/Import → Subcontractor Review → Internal Review → Consultant Submission → Comments → Revision → Approval → Construction Release.

# 15. Coordination & Clash
Federate architectural, structural, HVAC, electrical, plumbing, fire and specialist models. Detect hard, clearance, workflow/sequence, code/requirement and reserved-zone clashes.

Workflow: Detect → Group → Prioritize → Assign → Resolve → Recheck → Close.

# 16. Documentation
Views: plan, RCP, elevation, section, detail, 3D, perspective, schedule, quantity and coordination.

Support title blocks, sheet templates, view placement, legends, schedules, revision clouds, notes, dimensions, tags, symbols, callouts, detail references, sheet sets and issue packages. Tags bind to object properties; schedules remain live PCM projections.

# 17. Requirements, Specifications & Validation
TenderLogix/document intelligence creates structured requirements with source, normalized rule, applicable objects, jurisdiction, severity and validation method.

Validation layers:
1. geometry integrity
2. parametric constraints
3. host/dependency validity
4. system connectivity
5. discipline rules
6. specification compliance
7. tender compliance
8. standards/code pre-checks
9. constructability
10. project rules

Severity: INFO, WARNING, ERROR, BLOCKING. Results identify affected objects, evidence and remediation options.

# 18. Revisions, Branching & Collaboration
Every mutation uses a ChangeSet containing base revision, author/source, commands, object diffs, validation and impact summary.

States: DRAFT → PREVIEWED → VALIDATED → APPROVED → COMMITTED, with REJECTED/CANCELLED alternatives.

Support undo/redo, named revisions, design branches/options, comparison, conflict-aware merge, immutable audit, presence, comments, markups, mentions, issue assignment, review packages and approvals.

# 19. Quantity, BOQ & Cost
```text
PCM Object → Measurement Rule → Derived Quantity → BOQ Mapping → Rate/Estimate → Cost
```
On design change: commit revision → determine dependencies → mark quantities dirty → recalculate → compute BOQ delta → calculate commercial impact → identify procurement/schedule/document impacts → present impact summary.

Never fabricate cost or schedule impacts when downstream data is unavailable.

# 20. Construction Lifecycle Graph
A design object may link to drawing/view/sheet, specification, tender requirement, quantity, BOQ, estimate, budget, supplier, procurement item, schedule activity, RFI, submittal, change order, issue, inspection, installation and handover asset.

This connected object graph is a central Preckon differentiator: design intelligence becomes construction lifecycle intelligence.

# 21. Interoperability
**PDF:** preserve page coordinates/source references and export issue sheets.  
**DWG/DXF:** preserve layers/entities/blocks/text/dimensions/coordinates with documented fidelity.  
**IFC:** strategic open-BIM exchange with GUID/property/classification mapping.  
**Revit:** begin with IFC/import-export and controlled integration; evaluate a connector/plugin for bidirectional workflows.

Never claim lossless round-trip without tested evidence.

# 22. Logical Service Architecture
- DrawLogix API Gateway
- Project/Model Service
- Geometry Service
- Parametric Service
- Drawing Intake Service
- Recognition Service
- AI Orchestration Service
- Command Service
- Validation Service
- Clash Service
- Documentation Service
- Revision/ChangeSet Service
- Collaboration Service
- Interoperability Service
- Quantity Integration Service
- PCM Event Bus

Prefer a modular architecture initially; split services operationally only when scale, isolation or team ownership justifies it.

# 23. Storage
Use PCM's transactional store for authoritative metadata/relationships; spatial/geometry capabilities defined by PCM; object storage for binaries and derived artifacts; search index for discovery; cache for transient rendering/query acceleration; event/outbox infrastructure for reliable downstream propagation.

Render caches are never authoritative.

# 24. APIs & Events
Representative APIs:
```text
POST /projects/{id}/drawlogix/commands/preview
POST /projects/{id}/drawlogix/commands/commit
GET  /projects/{id}/model/objects
GET  /projects/{id}/model/objects/{objectId}
POST /projects/{id}/imports
POST /projects/{id}/validation/run
GET  /projects/{id}/revisions/{rev}/diff
POST /projects/{id}/sheets/generate
```

Events:
`ModelObjectCreated`, `ModelObjectChanged`, `ModelObjectDeleted`, `RevisionCommitted`, `DrawingImported`, `RecognitionCompleted`, `ValidationFailed`, `QuantityInvalidated`, `ClashDetected`, `SheetPublished`.

# 25. Security & Governance
RBAC plus organization/project boundaries; least privilege; tenant isolation; encryption; malware scanning; immutable audit; protected approval actions; secure file processing; AI tool authorization; prompt/input hardening; resource limits; configurable retention and data-residency strategy.

# 26. Performance Targets
Initial targets:
- pan/zoom should feel real-time
- common local previews <1s where feasible
- ordinary server preview p95 target <2s
- ordinary commit p95 target <2s excluding heavy regeneration
- incremental regeneration preferred
- large models use streaming, LOD, tiling and lazy loading
- imports, recognition and large clash runs are asynchronous with progress

Benchmark and revise these targets using representative GCC construction projects.

# 27. Testing Strategy
- geometry unit tests
- command determinism
- parametric regeneration
- constraint testing
- PCM persistence/invariants
- import/export golden files
- recognition benchmark sets
- visual regression
- quantity traceability
- revision/diff testing
- concurrency/collaboration
- AI tool safety
- performance/load
- end-to-end construction workflows

Critical invariant: **same authoritative input + same deterministic command + same engine version → equivalent authoritative result.**

# 28. Delivery Roadmap
## Phase 0 — Foundation
PCM contracts, units, coordinates, geometry-kernel decision, ChangeSets, IDs and event contracts.

## Phase 1 — Drawing Intelligence MVP
PDF/DWG/DXF intake, viewer, scale/layers, recognition, confidence review, walls/rooms/doors/windows, measurement and quantity linkage.

## Phase 2 — Native Authoring
2D editing, semantic walls/openings/rooms, properties, snapping, undo/redo and revisions.

## Phase 3 — AI Authoring
Semantic selection, typed AI tools, preview/approval, natural-language modification and reusable automation.

## Phase 4 — BIM/Parametric
3D views, smart components, slabs/columns/beams, constraints, regeneration and IFC.

## Phase 5 — Documentation
Views, sections/elevations, sheets, tags, dimensions, schedules and publishing.

## Phase 6 — Coordination
Federated disciplines, clash/clearance, issue workflow and MEP routing.

## Phase 7 — Construction Integration
Deep BOQ/cost/procurement/schedule/change/RFI/submittal linkage.

## Phase 8 — Advanced Design Intelligence
Generative layouts, discipline agents, standards packs, optimization and broader native-design replacement.

# 29. AIGCC MVP
The MVP should prove:
1. create project
2. upload a real drawing
3. identify scale/title/layers
4. recognize selected architectural objects
5. human verifies uncertain objects
6. map verified objects to PCM
7. view/edit semantic objects
8. ask AI contextual questions
9. AI proposes a controlled edit
10. preview and commit
11. quantity updates
12. BOQ mapping shows impact
13. revision comparison explains the change
14. publish/export reviewed output

Do not delay this proof by attempting full Revit replacement.

# 30. First Engineering Backlog
**Epic A — Model Foundation:** units, coordinates, IDs, wall/room/door/window schemas, geometry references and relationships.

**Epic B — Change Engine:** command envelope, preview, validation, commit, revisions and undo.

**Epic C — Viewer:** PDF/vector rendering, zoom/pan, layers, selection and semantic overlays.

**Epic D — Intake:** upload, metadata, scale, vector extraction and source provenance.

**Epic E — Recognition:** walls/rooms/doors/windows, confidence scoring and verification UI.

**Epic F — Quantity Bridge:** measurement rules, invalidation, traceability and BOQ mapping.

**Epic G — AI Tools:** model query, semantic selection, change-type/move/create commands and preview explanation.

**Epic H — Quality:** golden project, deterministic tests, revision diff and performance telemetry.

# 31. Reference Architecture Demonstration
The first authoritative model transaction should demonstrate:

**Create Level → create wall types → create walls → host door → user/AI proposes type change → preview → validate → commit → revision increments → dependent quantity becomes dirty → event emitted → quantity recalculates → BOQ delta appears → audit shows before/after.**

This proves the foundation beneath future ArchiLabs-class AI authoring.

# 32. Definition of Done
A DrawLogix capability is production-ready only when:
- authoritative PCM objects are created/updated correctly
- source and revision history are traceable
- undo/recovery behavior is defined
- permissions are enforced
- validation is deterministic where required
- downstream invalidation/events are correct
- tests cover normal and failure paths
- performance is measured
- user-facing uncertainty is explicit
- interoperability limitations are documented
- AI cannot bypass engineering approval policy

# 33. Strategic Capability Benchmark
DrawLogix should continually benchmark leading products across:
- conversational BIM authoring
- parametric automation
- smart components
- drawing/model understanding
- sheet/document automation
- tagging/dimensioning/schedules
- 2D-to-3D conversion
- design review/validation
- workflow generation
- collaborative BIM

The objective is not feature imitation. The requirement is that a Preckon customer should not need a separate AI-design product merely because DrawLogix omitted a strategically important design workflow.

Preckon's added value is the connection of those design capabilities to **TenderLogix + requirements + quantities + BOQ + estimating + procurement + project controls + field execution + cost control + handover**.

# 34. North-Star Workflow
The long-term north-star transaction is:

```text
Tender requirement
 ↓
Preckon understands requirement
 ↓
DrawLogix creates/updates design
 ↓
PCM validates objects and relationships
 ↓
Engineering rules identify conflicts
 ↓
Engineer reviews/approves
 ↓
Drawings/BIM/sheets update
 ↓
Quantities recalculate
 ↓
BOQ and estimate update
 ↓
Procurement and schedule impacts surface
 ↓
Affected RFIs/submittals/changes are linked
 ↓
Construction executes against the same model
 ↓
As-built and handover inherit the complete history
```

That is the intended DrawLogix contribution to the complete Preckon platform.

---
**End of Preckon DrawLogix Complete Product & Engineering Blueprint v1.0**

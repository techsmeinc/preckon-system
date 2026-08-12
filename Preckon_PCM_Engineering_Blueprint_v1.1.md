# Preckon Construction Model (PCM) — Engineering Blueprint
**Version 1.1 | August 12, 2026**  
**Status:** Engineering baseline for implementation  
**Parent Architecture:** Preckon — Complete Platform Blueprint v1.1

---

## 0. Purpose of this document

This document defines the **Preckon Construction Model (PCM)** at an implementation level so engineering teams can begin building the domain model, persistence layer, APIs, geometry services, versioning, event system, quantity/BOQ integration, AI tool contracts and interoperability layer.

PCM is the foundational data and execution model for Preckon. It is intentionally broader than BIM. A BIM model describes the physical and functional characteristics of a built asset; PCM connects those design objects to **requirements, drawings, specifications, quantities, BOQ, estimates, schedule, procurement, RFIs, submittals, changes, quality, field progress and handover**.

The system must support the long-term Preckon vision:

> **Tender / Idea → Requirements → Design → Engineering → Drawings → Quantities → BOQ → Estimate → Procurement → Construction → Cost Control → Handover**

through a single connected model.

### Scope guardrail: PCM supports the original Preckon vision
PCM is **not a redesign of Preckon around ArchiLabs or around CAD/BIM alone**. It remains the common construction model for the complete Preckon platform. AI-native design/BIM capabilities are requirements of the Draw / Design Studio domain and must use PCM in the same way that TenderLogix, Quantity & BOQ, Estimation, Procurement, Project Delivery, Cost Control, Planning, Quality/Safety and Handover use PCM.

ArchiLabs and similar products are engineering benchmarks for selected design-authoring capabilities only. They do not define PCM boundaries, module priorities or Preckon’s product identity.

```text
TenderLogix ─────────────┐
Draw / Design Studio ────┤
Quantity / BOQ ──────────┤
Estimation / Commercial ─┤
Planning / Procurement ──┼── PCM ── AI Core / Knowledge Graph / Events
Project Delivery ────────┤
Change / Cost Control ───┤
Quality / Safety ────────┤
Handover / Assets ───────┘
```

---

# PART I — FOUNDATIONAL ARCHITECTURE

## 1. Engineering principles

PCM SHALL be designed around the following non-negotiable principles.

### 1.1 Object-first, not file-first
A PDF, DWG, DXF, IFC or RVT import is a source artifact. It must not become the fundamental system-of-record.

The system-of-record is a set of **typed construction objects and relationships** with persistent global IDs.

Example:

```text
PDF page 14
  ↓ recognized from
Wall PCM-OBJ-8F3A
  ↓ represented in
Drawing A-201 Rev C
  ↓ measured by
Quantity Q-11042
  ↓ contributes to
BOQ BOQ-09-2216-001
```

### 1.2 Authoritative state vs derived state
PCM must distinguish:

1. **Authoritative state** — approved design/commercial/project data.
2. **Derived state** — quantities, calculated geometry, cost impacts, clash results, analytics.
3. **Proposed state** — AI-generated or user-drafted changes not yet committed.

AI must never silently mutate authoritative state.

### 1.3 Intent → deterministic execution
LLMs interpret user intent and produce structured commands. Geometry, measurements, rule checks and state mutations must be performed by deterministic services.

```text
User request
→ Intent Interpreter
→ Plan
→ Tool Commands
→ Validation
→ Transaction Preview
→ Commit
→ Domain Events
```

### 1.4 Stable object identity
Every logical PCM entity must have a stable UUID independent of imported file IDs or source application IDs.

External identifiers are aliases, not primary identifiers.

### 1.5 Relationship-rich model
Objects must support graph relationships without forcing all relationships into the physical object table.

### 1.6 Explicit provenance
Every important value must be capable of answering:

- Where did this value come from?
- Who/what changed it?
- Which source document/model/revision supports it?
- Was it imported, manually entered, inferred or AI-generated?
- Was it validated?
- Which rule/version calculated it?

### 1.7 Version everything that matters
Geometry, properties, relationships, classifications and downstream commercial mappings need temporal/version awareness.

### 1.8 Open interoperability
PCM must be capable of mapping to/from IFC and external CAD/BIM systems without being constrained by any single vendor data model.

---

## 2. PCM bounded contexts

Do not implement PCM as one giant service or one giant table set. Divide responsibilities into bounded contexts.

### 2.1 Core Model Context
Owns:
- Project spatial hierarchy
- Construction objects
- Object types
- Properties
- Relationships
- Classifications
- Lifecycle state
- Model revisions

### 2.2 Geometry Context
Owns:
- 2D geometry
- 3D geometry
- geometric operations
- transforms
- constraints
- topology
- spatial queries
- geometry-derived values

### 2.3 Document & Drawing Context
Owns:
- source files
- sheets/pages
- drawings
- markups
- revisions
- source regions
- provenance anchors

### 2.4 Requirements & Specifications Context
Owns:
- tender requirements
- specification clauses
- technical requirements
- compliance conditions
- links between requirements/specs and objects

### 2.5 Measurement Context
Owns:
- quantity rules
- measurement definitions
- calculated quantities
- takeoff traceability
- confidence/review status

### 2.6 BOQ & Cost Context
Owns:
- BOQ structure
- mappings from PCM objects/quantities
- rates
- estimates
- budget items
- commercial deltas

### 2.7 Planning / Procurement Context
Owns:
- activities
- WBS
- packages
- material requirements
- RFQs/POs
- schedule dependencies

### 2.8 Project Controls Context
Owns:
- RFIs
- submittals
- issues
- changes
- approvals
- inspections
- field progress

### 2.9 AI Orchestration Context
Owns:
- AI sessions
- tool plans
- proposed mutations
- evidence
- confidence
- approvals
- execution logs

---

# PART II — DOMAIN MODEL

## 3. Base entity conventions

All first-class PCM records SHOULD derive conceptually from a common entity envelope.

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "projectId": "uuid",
  "entityType": "ConstructionObject",
  "version": 17,
  "status": "ACTIVE",
  "createdAt": "2026-08-12T10:00:00Z",
  "createdBy": "uuid",
  "updatedAt": "2026-08-12T10:32:00Z",
  "updatedBy": "uuid",
  "source": {
    "method": "MANUAL|IMPORT|AI|RULE|INTEGRATION",
    "sourceSystem": "PRECKON|IFC|DWG|REVIT|PDF|API",
    "sourceId": "optional external id"
  }
}
```

### 3.1 Required platform fields
- `id UUID`
- `tenant_id UUID`
- `project_id UUID`
- `created_at TIMESTAMPTZ`
- `created_by UUID`
- `updated_at TIMESTAMPTZ`
- `updated_by UUID`
- `row_version BIGINT`
- `deleted_at TIMESTAMPTZ NULL`

Use soft deletion for domain records where legal/audit requirements apply.

---

## 4. Spatial hierarchy

Minimum supported hierarchy:

```text
Project
└── Site
    └── Facility / Building
        ├── Zone
        └── Level
            └── Space / Room
```

Do not hard-code only buildings. Industrial projects may use plants, process areas, warehouses, yards and infrastructure zones.

### 4.1 `pcm_spatial_node`

```text
id UUID PK
project_id UUID FK
parent_id UUID NULL FK pcm_spatial_node
node_type ENUM(PROJECT,SITE,FACILITY,BUILDING,LEVEL,ZONE,SPACE,AREA,EXTERNAL_AREA,CUSTOM)
code VARCHAR(100)
name VARCHAR(255)
description TEXT NULL
elevation_mm DECIMAL NULL
gross_area_m2 DECIMAL NULL
net_area_m2 DECIMAL NULL
geometry_id UUID NULL
sort_order INT
metadata JSONB
```

### 4.2 Rules
- tree cycles prohibited
- node codes unique within parent unless project settings permit duplicates
- construction objects may belong to multiple spatial nodes through relationships, but one `primary_spatial_node_id` should exist for common querying

---

## 5. Construction object model

The central entity is `ConstructionObject`.

Examples:
- Wall
- Door
- Window
- Column
- Beam
- Slab
- Roof
- Stair
- Ceiling
- Finish
- Equipment
- Duct
- Pipe
- Cable tray
- Lighting fixture
- Electrical device
- Plumbing fixture
- Structural connection
- Temporary works object
- Custom customer-defined object

### 5.1 `pcm_object`

```text
id UUID PK
project_id UUID FK
object_type_id UUID FK
object_type_code VARCHAR(100)
name VARCHAR(255) NULL
mark VARCHAR(100) NULL
primary_spatial_node_id UUID NULL
geometry_id UUID NULL
lifecycle_state ENUM(PROPOSED,DESIGNED,COORDINATED,ISSUED,APPROVED,PROCURED,INSTALLED,INSPECTED,HANDED_OVER,DEMOLISHED,VOID)
validation_state ENUM(UNVALIDATED,VALIDATED,WARNING,ERROR)
source_confidence DECIMAL(5,4) NULL
source_method ENUM(MANUAL,IMPORT,AI,RULE,INTEGRATION)
current_revision_id UUID NULL
metadata JSONB
```

### 5.2 Object type definition

Object type must be data-driven.

`pcm_object_type`

```text
id UUID PK
tenant_id UUID NULL
code VARCHAR(100)
name VARCHAR(255)
discipline ENUM(ARCHITECTURE,STRUCTURE,MECHANICAL,ELECTRICAL,PLUMBING,CIVIL,FIRE,LANDSCAPE,GENERAL,CUSTOM)
category VARCHAR(100)
geometry_behavior VARCHAR(100)
measurement_profile_id UUID NULL
property_schema_id UUID
ifc_entity_mapping VARCHAR(100) NULL
is_system BOOLEAN
```

Example types:

```text
WALL.GYPSUM.PARTITION
WALL.CMU
DOOR.SINGLE
COLUMN.RC.RECTANGULAR
DUCT.RECTANGULAR
PIPE.CHILLED_WATER
```

---

## 6. Type-instance separation

PCM should distinguish reusable type definitions from instances.

Example:

```text
Wall Type WT-04
  thickness: 150 mm
  fireRating: 120 min
  acousticRating: STC 50
  layers: ...

Wall Instance W-1034
  type = WT-04
  length = 5100 mm
  height = 3200 mm
  location = Level 4 / Office 403
```

### 6.1 `pcm_family`
Reusable product/component family.

### 6.2 `pcm_type`
Specific parametric type within a family.

### 6.3 `pcm_object.type_id`
Points to `pcm_type` where relevant.

This architecture supports native components and imported Revit/IFC families without forcing direct semantic equivalence.

---

## 7. Property system

Avoid schema expansion every time a new construction parameter is introduced.

Use a hybrid model:
- relational columns for heavily queried platform attributes
- typed property definitions for extensible domain properties
- JSON only for non-critical metadata

### 7.1 `pcm_property_definition`

```text
id UUID PK
code VARCHAR(150)
name VARCHAR(255)
data_type ENUM(STRING,INTEGER,DECIMAL,BOOLEAN,DATE,DATETIME,ENUM,REFERENCE,LENGTH,AREA,VOLUME,MASS,CURRENCY,RATIO,TEMPERATURE)
unit_type VARCHAR(100) NULL
default_unit VARCHAR(50) NULL
allowed_values JSONB NULL
is_required BOOLEAN
ais_searchable BOOLEAN
is_inheritable BOOLEAN
```

### 7.2 `pcm_property_value`

```text
entity_id UUID
property_definition_id UUID
value_string TEXT NULL
value_decimal DECIMAL NULL
value_integer BIGINT NULL
value_boolean BOOLEAN NULL
value_date DATE NULL
value_reference UUID NULL
unit VARCHAR(50) NULL
source_id UUID NULL
confidence DECIMAL NULL
is_override BOOLEAN DEFAULT FALSE
```

Use a uniqueness constraint on `(entity_id, property_definition_id, active_version)` conceptually.

### 7.3 Property precedence
When a value exists at multiple levels:

```text
Instance override
> Type
> Family
> Project default
> Organization default
```

Always expose resolved value and origin.

---

## 8. Classification system

One PCM object may have multiple classifications.

Examples:
- IFC class
- MasterFormat
- UniFormat
- Uniclass
- OmniClass
- customer-specific cost code
- procurement category

### Tables

`classification_system`

`classification_code`

`entity_classification`

Required fields:

```text
entity_id
classification_system_id
classification_code_id
is_primary
source
confidence
```

Never encode a single global classification directly in `pcm_object`.

---

# PART III — GEOMETRY AND PARAMETRICS

## 9. Geometry architecture

PCM must not store raw vendor-native geometry as the only geometry representation.

Use three layers:

### 9.1 Canonical semantic geometry
Compact parametric representation used for editing.

Examples:

Wall:
```json
{
  "baseline": [[0,0,0],[5000,0,0]],
  "thicknessMm": 150,
  "baseLevelId": "...",
  "baseOffsetMm": 0,
  "topConstraint": {"mode":"LEVEL","levelId":"...","offsetMm":0}
}
```

Column:
```json
{
  "origin": [10000,5000,0],
  "rotationDeg": 0,
  "widthMm": 400,
  "depthMm": 600,
  "baseLevelId": "...",
  "topLevelId": "..."
}
```

### 9.2 Computed geometry
Generated mesh/B-rep/solid/vector geometry for display, clash, measurements and export.

### 9.3 Source/native geometry
Preserve imported source payload or references for fidelity and round-trip workflows.

---

## 10. Geometry service contract

Core interface:

```typescript
interface GeometryService {
  create(input: GeometryCreateCommand): Promise<GeometryResult>;
  update(input: GeometryUpdateCommand): Promise<GeometryResult>;
  transform(input: TransformCommand): Promise<GeometryResult>;
  intersect(a: GeometryId, b: GeometryId): Promise<IntersectionResult>;
  contains(container: GeometryId, target: GeometryId): Promise<boolean>;
  distance(a: GeometryId, b: GeometryId): Promise<DistanceResult>;
  measure(id: GeometryId): Promise<GeometryMeasurements>;
  clash(query: ClashQuery): Promise<ClashResult[]>;
  export(ids: GeometryId[], format: ExportFormat): Promise<JobId>;
}
```

### Measurements returned

```json
{
  "lengthMm": 5200,
  "perimeterMm": 10400,
  "areaMm2": 16640000,
  "volumeMm3": 2496000000,
  "centroid": [x,y,z],
  "boundingBox": {...}
}
```

### Geometry storage recommendation
Use object/blob storage for large binary geometry payloads. Store searchable bounds/spatial indexes in relational or spatial database.

A PostgreSQL + PostGIS architecture is recommended for spatial queries, but the geometry abstraction must permit a specialized geometry engine/service.

---

## 11. Coordinate systems

PCM MUST define coordinate semantics early.

Support:
- project-local coordinate system
- site/shared coordinate system
- source-file coordinate system
- optional geospatial coordinates

Every imported model must receive a transform into PCM project coordinates.

`pcm_coordinate_system`

`pcm_source_transform`

Store full 4x4 transform matrices when required.

Never silently modify imported coordinates without retaining the original transform.

---

## 12. Constraints and dependency graph

Parametric objects depend on other objects.

Examples:

```text
Level → Wall base/top
Grid → Column location
Wall → Door host
Room boundary → Finish quantity
Duct → Hanger positions
```

### 12.1 `pcm_constraint`

```text
id UUID
project_id UUID
constraint_type ENUM(HOST,ALIGN,DISTANCE,PARALLEL,PERPENDICULAR,EQUAL,LOCK,LEVEL,OFFSET,DEPENDENCY,CUSTOM)
source_entity_id UUID
target_entity_id UUID NULL
parameter JSONB
priority ENUM(REQUIRED,STRONG,WEAK)
status ENUM(SATISFIED,VIOLATED,DISABLED)
```

### 12.2 Recompute behavior
On mutation:

```text
changed object
→ dependency graph lookup
→ impacted objects topologically sorted
→ recompute
→ validation
→ transaction diff
```

Cycles must be detected and rejected unless the solver explicitly supports them.

---

# PART IV — RELATIONSHIPS AND KNOWLEDGE GRAPH

## 13. Generic relationship model

Use explicit typed edges.

`pcm_relationship`

```text
id UUID
project_id UUID
source_entity_id UUID
relationship_type_id UUID
target_entity_id UUID
valid_from TIMESTAMPTZ
valid_to TIMESTAMPTZ NULL
source ENUM(MANUAL,IMPORT,AI,RULE,INTEGRATION)
confidence DECIMAL NULL
metadata JSONB
```

### 13.1 Initial relationship types

Physical:
- `HOSTED_BY`
- `CONTAINS`
- `CONNECTED_TO`
- `SUPPORTED_BY`
- `SERVES`
- `ADJACENT_TO`

Documentary:
- `REPRESENTED_IN`
- `SPECIFIED_BY`
- `REQUIRED_BY`
- `DERIVED_FROM`
- `SUPERSEDES`

Commercial:
- `MEASURED_BY`
- `CONTRIBUTES_TO_BOQ`
- `BUDGETED_BY`
- `PROCURED_BY`

Execution:
- `BUILT_BY_ACTIVITY`
- `AFFECTED_BY_CHANGE`
- `REFERENCED_BY_RFI`
- `REFERENCED_BY_SUBMITTAL`
- `INSPECTED_BY`
- `INSTALLED_IN_PACKAGE`

---

## 14. Graph implementation strategy

Do NOT require a dedicated graph database for MVP.

Phase 1:
- relationship table in PostgreSQL
- indexed source/type/target queries
- materialized paths where useful

Phase 2:
- graph projection into a graph store or graph analytics engine if traversal complexity warrants it

The relational record remains authoritative unless architecture is intentionally migrated.

---

# PART V — DOCUMENTS, DRAWINGS AND PROVENANCE

## 15. Document model

### Entities
- `document`
- `document_version`
- `document_page`
- `drawing`
- `drawing_revision`
- `source_region`

### 15.1 `source_region`
Used to connect PCM objects to evidence in documents.

```text
id UUID
document_version_id UUID
page_number INT
region_type ENUM(BOUNDING_BOX,POLYGON,TEXT_RANGE,MODEL_OBJECT)
coordinates JSONB
source_native_id VARCHAR NULL
extracted_text TEXT NULL
```

A recognized wall from a PDF can point to the exact polygon/region that produced it.

---

## 16. Import pipeline

```text
Upload
→ malware/file validation
→ content fingerprint
→ format parser
→ source object extraction
→ coordinate normalization
→ semantic classification
→ candidate PCM objects
→ cross-document reconciliation
→ validation queue
→ commit approved objects
```

### Import job state

```text
UPLOADED
PARSING
EXTRACTING
RECONCILING
AWAITING_REVIEW
COMMITTING
COMPLETED
FAILED
```

### Required import outputs
- source object IDs
- source geometry
- proposed PCM type
- mapped properties
- confidence
- evidence regions
- warnings/errors

---

# PART VI — VERSIONING, TRANSACTIONS AND AUDIT

## 17. Change set model

All meaningful PCM mutations occur in a `ChangeSet`.

A ChangeSet may originate from:
- direct UI edit
- batch command
- AI plan
- import
- integration
- rule engine

### 17.1 `pcm_change_set`

```text
id UUID
project_id UUID
change_type ENUM(USER_EDIT,AI_EDIT,IMPORT,INTEGRATION,RULE,MERGE,REVISION)
status ENUM(DRAFT,VALIDATING,AWAITING_APPROVAL,APPROVED,COMMITTED,REJECTED,FAILED)
title VARCHAR
description TEXT
requested_by UUID
approved_by UUID NULL
base_project_revision BIGINT
created_at TIMESTAMPTZ
committed_at TIMESTAMPTZ NULL
```

### 17.2 `pcm_change_operation`

```text
change_set_id UUID
sequence INT
operation ENUM(CREATE,UPDATE,DELETE,RELATE,UNRELATE,TRANSFORM,RETYPE)
entity_type VARCHAR
entity_id UUID
before_state JSONB NULL
after_state JSONB NULL
```

`before_state` / `after_state` may be stored as patches for scale, but APIs should reconstruct full diffs when needed.

---

## 18. Project revision number

Each committed ChangeSet increments `project_revision`.

Clients send:

```http
If-Match: project-revision-1842
```

or command field:

```json
{"expectedProjectRevision":1842}
```

If authoritative data changed since the client read it, return conflict and a structured merge/diff payload.

---

## 19. Undo/redo

Undo is not destructive history deletion.

Undo creates an inverse ChangeSet.

This preserves full audit history and downstream event consistency.

---

## 20. Design branches/options

Long-term design authoring requires alternatives.

Support:
- main branch
- design option branch
- proposal branch
- imported revision branch

MVP implementation can use copy-on-write entity version sets rather than full Git semantics.

Merge requires:
- common base revision
- changed object set
- conflict detection at property/geometry/relationship level

---

# PART VII — QUANTITY, BOQ AND COST CONNECTION

## 21. Measurement engine

Quantity is a derived domain, not an arbitrary field stored on objects.

### 21.1 Measurement definitions

`measurement_rule`

```text
id UUID
code VARCHAR
name VARCHAR
applicable_object_type VARCHAR
measurement_type ENUM(COUNT,LENGTH,AREA,VOLUME,MASS,CUSTOM)
expression JSONB
unit VARCHAR
standard_reference VARCHAR NULL
version INT
```

Example conceptual rule:

```text
NET_WALL_FINISH_AREA =
  wall.length * wall.height
  - sum(hosted_opening.area where opening.area > deduction_threshold)
```

### 21.2 Quantity result

`quantity_result`

```text
id UUID
project_id UUID
measurement_rule_id UUID
entity_id UUID
quantity_value DECIMAL
unit VARCHAR
calculation_version VARCHAR
source_project_revision BIGINT
status ENUM(CURRENT,DIRTY,SUPERSEDED,ERROR)
calculation_details JSONB
```

### 21.3 Dirty propagation
When geometry/property dependencies change:

```text
ObjectChanged
→ find dependent measurement rules
→ mark quantity results DIRTY
→ queue recalculation
→ QuantityChanged event
```

Critical commercial operations should wait for quantity recalculation or explicitly indicate stale values.

---

## 22. Quantity provenance

Every aggregate quantity must be explainable.

Example API:

```http
GET /api/v1/quantities/{id}/trace
```

Response:

```json
{
  "quantity": 386.42,
  "unit": "m2",
  "rule": "NET_WALL_FINISH_AREA:v3",
  "sourceRevision": 1844,
  "contributors": [
    {"objectId":"...","value":12.41},
    {"objectId":"...","value":8.17}
  ],
  "deductions": [...],
  "evidence": [...]
}
```

Clicking quantity results in UI should highlight contributing PCM objects.

---

## 23. BOQ mapping

BOQ item mapping should use explicit mapping records.

`boq_object_mapping`

```text
boq_item_id UUID
entity_id UUID NULL
quantity_result_id UUID NULL
allocation_factor DECIMAL DEFAULT 1
mapping_source ENUM(MANUAL,RULE,AI,IMPORT)
confidence DECIMAL NULL
status ENUM(PROPOSED,APPROVED,REJECTED)
```

AI can propose mappings. Commercially authoritative BOQ mappings require project-defined approval policies.

---

# PART VIII — SPECIFICATIONS, REQUIREMENTS AND RULES

## 24. Requirement model

`requirement`

```text
id UUID
project_id UUID
requirement_type ENUM(TECHNICAL,CONTRACTUAL,REGULATORY,CLIENT,SCOPE,PERFORMANCE)
text TEXT
normalized_statement TEXT
source_region_id UUID NULL
priority ENUM(MUST,SHOULD,MAY)
verification_method ENUM(MODEL_CHECK,DOCUMENT_CHECK,MANUAL,TEST,INSPECTION)
status ENUM(EXTRACTED,REVIEWED,APPROVED,SATISFIED,NONCOMPLIANT,WAIVED)
```

Link requirements to applicable PCM objects/types/spaces using `pcm_relationship` or dedicated applicability tables.

---

## 25. Rule engine

Do not put jurisdiction or customer validation rules directly in application code where avoidable.

Rule definition fields:

```text
rule_id
rule_version
name
scope
jurisdiction
applicability_expression
validation_expression
severity
message_template
effective_from
effective_to
source_reference
```

Example:

```text
IF room.classification == "ELECTRICAL_ROOM"
AND door.swing_direction != "OUTWARD"
THEN warning/error according to selected code profile
```

Engineering/regulatory rules must retain source/version/effective dates.

---

# PART IX — AI TOOL CONTRACTS

## 26. AI must operate through tools

Forbidden:

```text
LLM → SQL update
LLM → geometry database mutation
```

Required:

```text
LLM
→ authorized tool schema
→ application service
→ validation
→ ChangeSet
→ commit policy
```

---

## 27. Core PCM agent tools

### 27.1 Search objects

```json
{
  "tool": "find_objects",
  "input": {
    "projectId": "uuid",
    "types": ["WALL"],
    "spatialFilter": {"levelId":"uuid"},
    "propertyFilters": [
      {"property":"partitionType","operator":"EQ","value":"100MM_GYPSUM"}
    ]
  }
}
```

### 27.2 Propose property update

```json
{
  "tool": "propose_update_objects",
  "input": {
    "objectIds": ["..."],
    "updates": [
      {"property":"typeId","value":"WT-150-ACOUSTIC"}
    ],
    "reason": "User requested acoustic partition conversion"
  }
}
```

Return:
- affected object count
- validation warnings
- calculated immediate geometry impact
- downstream systems needing recalculation
- ChangeSet ID

### 27.3 Commit change set

This tool requires user/approval authorization where configured.

```json
{
  "tool": "commit_change_set",
  "input": {
    "changeSetId":"uuid",
    "expectedProjectRevision":1842
  }
}
```

---

## 28. AI evidence envelope

Every significant AI proposal:

```json
{
  "aiRunId":"uuid",
  "modelProvider":"...",
  "modelVersion":"...",
  "toolPlanVersion":"...",
  "confidence":0.91,
  "evidence":[
    {"type":"PCM_OBJECT","id":"..."},
    {"type":"DOCUMENT_REGION","id":"..."},
    {"type":"SPEC_CLAUSE","id":"..."}
  ],
  "assumptions":["..."],
  "requiresApproval":true
}
```

Do not store full hidden chain-of-thought. Store concise rationale, evidence, structured decisions and tool traces needed for audit.

---

# PART X — API DESIGN

## 29. API conventions

Recommended API style:
- REST for resource/domain APIs
- asynchronous jobs for heavy geometry/import/AI work
- WebSocket/SSE for collaboration/job status
- event/webhook APIs for integrations

### 29.1 URI conventions

```text
/api/v1/projects/{projectId}/pcm/objects
/api/v1/projects/{projectId}/pcm/object-types
/api/v1/projects/{projectId}/pcm/spatial-nodes
/api/v1/projects/{projectId}/pcm/relationships
/api/v1/projects/{projectId}/pcm/change-sets
/api/v1/projects/{projectId}/quantities
/api/v1/projects/{projectId}/models/imports
```

### 29.2 Command endpoints
Use commands for multi-object behavioral mutations.

```text
POST /api/v1/projects/{projectId}/pcm/commands/change-type
POST /api/v1/projects/{projectId}/pcm/commands/move
POST /api/v1/projects/{projectId}/pcm/commands/create-wall
POST /api/v1/projects/{projectId}/pcm/commands/delete
```

Do not expose CRUD-only APIs for operations requiring geometry constraints or downstream recalculation.

---

## 30. Example: create wall command

```http
POST /api/v1/projects/{projectId}/pcm/commands/create-wall
```

```json
{
  "expectedProjectRevision": 1842,
  "typeId": "uuid",
  "levelId": "uuid",
  "baseline": {
    "start": {"x":1000,"y":1000,"z":0},
    "end": {"x":6500,"y":1000,"z":0}
  },
  "height": {"mode":"TO_LEVEL","levelId":"uuid","offsetMm":0},
  "changeSetMode":"PREVIEW"
}
```

Response:

```json
{
  "changeSetId":"uuid",
  "preview": {
    "createdObjects":[...],
    "validation":[],
    "derivedImpacts": {
      "quantityRulesAffected":4,
      "clashesPotential":0
    }
  }
}
```

---

## 31. Query strategy

Common filtering:
- object type
- discipline
- level/zone/space
- lifecycle state
- property values
- bounding box
- classification
- source drawing/revision
- affected-by relationship

Example:

```http
GET /objects?type=WALL&level=L04&bbox=x1,y1,x2,y2&property.fireRating.gte=120
```

For complex queries introduce a structured query endpoint rather than increasingly complex URL parameters.

---

# PART XI — DOMAIN EVENTS

## 32. Event envelope

```json
{
  "eventId":"uuid",
  "eventType":"pcm.object.changed.v1",
  "occurredAt":"2026-08-12T05:40:00Z",
  "tenantId":"uuid",
  "projectId":"uuid",
  "projectRevision":1843,
  "changeSetId":"uuid",
  "correlationId":"uuid",
  "actor":{"type":"USER|AI|SYSTEM|INTEGRATION","id":"uuid"},
  "payload":{}
}
```

### 32.1 Initial event catalog

PCM:
- `pcm.object.created.v1`
- `pcm.object.changed.v1`
- `pcm.object.deleted.v1`
- `pcm.relationship.changed.v1`
- `pcm.geometry.changed.v1`
- `pcm.change_set.committed.v1`

Documents:
- `drawing.revision.issued.v1`
- `model.import.completed.v1`

Commercial:
- `quantity.dirty.v1`
- `quantity.changed.v1`
- `boq.mapping.changed.v1`
- `cost.impact.detected.v1`

Controls:
- `rfi.affected.v1`
- `submittal.affected.v1`
- `procurement.affected.v1`
- `schedule.impact.detected.v1`

---

## 33. Event processing rules

Use transactional outbox pattern so committed state and emitted events cannot diverge.

Consumers must be idempotent.

All events carry schema version.

Never treat the event bus itself as the only authoritative persistence for MVP unless intentionally adopting event sourcing across the platform.

---

# PART XII — DATA PLATFORM AND STORAGE

## 34. Recommended persistence architecture

### Primary transactional store
**PostgreSQL** recommended.

Rationale:
- strong relational consistency
- JSONB for extensibility
- PostGIS spatial support
- mature indexing
- tenant/project partitioning options

### Blob/object storage
For:
- PDFs
- DWG/DXF
- IFC
- model snapshots
- meshes
- textures
- point clouds
- exported packages

### Search
OpenSearch/Elasticsearch or equivalent for:
- document text
- object/property search
- tender/specification retrieval

### Vector index
Can share search infrastructure initially or use vector-enabled PostgreSQL.

### Analytics store
Separate warehouse/lake later. Do not run heavy portfolio analytics against authoring transactional paths.

---

## 35. Partitioning

Primary query scope is almost always tenant + project.

At scale consider partitioning large tables by project hash/range or tenant, especially:
- object versions
- relationships
- properties
- quantity results
- event log
- audit log

Do not prematurely create one physical database per project.

---

## 36. Caching

Cache:
- resolved type/property schemas
- object bounding boxes
- view-level geometry tiles
- common relationship traversals
- project standards profiles

Do not cache authoritative mutable state without revision-aware keys.

Recommended key pattern:

```text
pcm:{projectId}:{projectRevision}:object:{objectId}
```

---

# PART XIII — BIM/CAD INTEROPERABILITY

## 37. IFC mapping

PCM requires an interoperability mapping layer rather than one-to-one schema coupling.

Example:

```text
IfcWall / IfcWallStandardCase
  ↕ mapper
PCM WALL
```

Maintain:
- IFC GlobalId
- source model/version
- source entity type
- property-set mappings
- geometry mapping status
- round-trip mapping metadata

### Import rule
Never replace PCM IDs with IFC GlobalIds.

### Export rule
Preserve existing IFC GlobalIds where safe for round-trip continuity; create new compliant IDs for native objects as needed.

---

## 38. DWG/DXF strategy

DWG/DXF are frequently geometry/layer-centric and semantically weak.

Import stages:
- layers
- blocks
- text
- dimensions
- polylines/arcs
- coordinates
- symbols
- semantic recognition

A DWG line must not automatically become a wall. Semantic candidates require recognition rules and confidence.

Retain source handles for traceability.

---

## 39. Revit strategy

Near-term:
- import/export through IFC and supported Autodesk APIs/connectors
- retain external unique IDs and model/version references
- synchronization jobs generate controlled diffs

Long-term:
- native PCM authoring reduces dependency while maintaining consultant interoperability

Do not make PCM property architecture depend on Revit parameter semantics.

---

## 40. PDF drawing strategy

PDF remains important because many construction workflows are drawing-document driven.

PCM must support:
- calibrated sheets
- vector/text extraction
- raster recognition
- source-region linking
- drawing revision comparison
- recognized object confidence

PDF-derived PCM objects remain explicitly tagged with provenance and validation status.

---

# PART XIV — COLLABORATION

## 41. Collaborative editing

MVP:
- optimistic concurrency at project/object revision
- temporary edit lease for high-risk geometry operations
- live presence optional

Later:
- object-level realtime collaboration
- geometry operation conflict resolution

Do not implement naive last-write-wins for engineering model state.

---

## 42. Object locks

Recommended lease model:

```text
lock_id
entity_id
user_id
acquired_at
expires_at
lock_scope PROPERTY|GEOMETRY|OBJECT|SELECTION
```

Locks expire automatically and should be renewable.

Long batch AI operations should use ChangeSet isolation rather than holding locks for extended periods.

---

# PART XV — VALIDATION AND SAFETY

## 43. Validation pipeline

Before commit:

```text
Schema validation
→ property validation
→ geometry validation
→ constraint solver
→ discipline rules
→ project standards
→ regulatory rules where configured
→ downstream impact analysis
→ approval policy
```

Severity:
- INFO
- WARNING
- BLOCKING_ERROR

Only configured blocking rules prevent commit.

---

## 44. Human approval policy

Examples requiring human approval by default:
- major geometry generation from AI
- structural element sizing recommendations
- code/safety-impacting changes
- BOQ mapping changes over configured financial thresholds
- issued/approved design revisions
- changes affecting procurement commitments

Approval rules are project configurable.

---

# PART XVI — SECURITY AND MULTI-TENANCY

## 45. Tenant isolation

All domain tables contain tenant scope either explicitly or reliably through project foreign key plus database enforcement.

Use:
- application authorization
- query-level enforcement
- optional PostgreSQL RLS for defense-in-depth

Never rely only on UI filtering.

---

## 46. Authorization model

RBAC plus project/object attributes.

Examples:
- Architect can edit architecture model
- Quantity Surveyor can approve quantity/BOQ mappings
- Viewer can inspect but not mutate
- subcontractor can access only assigned packages

Authorization checks happen at command boundary, not only REST controller layer.

---

# PART XVII — OBSERVABILITY

## 47. Required telemetry

For every mutating operation track:
- command name
- duration
- project revision
- object count
- validation count
- geometry runtime
- event publishing latency
- downstream recalculation jobs
- actor type
- failure category

For AI:
- model
- latency
- tokens/cost
- tool calls
- accepted/rejected suggestions
- confidence
- manual correction rate

---

# PART XVIII — ENGINEERING SERVICE DECOMPOSITION

## 48. Recommended initial services

Do NOT start with dozens of microservices.

Suggested deployable boundaries:

### 48.1 Core API / PCM Service
Owns:
- objects
- types
- properties
- spatial tree
- relationships
- ChangeSets
- revisions
- validation orchestration

### 48.2 Geometry Service
Owns deterministic geometry execution and spatial calculations.

### 48.3 Document Intelligence Service
Owns file parsing, PDF/DWG/IFC extraction pipelines and candidate recognition.

### 48.4 Measurement & BOQ Service
Owns measurement rules, quantities and BOQ linkage.

### 48.5 AI Orchestration Service
Owns agent sessions, tool routing, proposal generation and evidence.

### 48.6 Worker Runtime
Runs imports, exports, recalculations and expensive AI/geometry jobs.

This can later split by scale/domain.

---

# PART XIX — INITIAL DATABASE TABLE MAP

## 49. PCM core tables

```text
pcm_project_revision
pcm_spatial_node
pcm_object
pcm_object_type
pcm_family
pcm_type
pcm_property_schema
pcm_property_definition
pcm_property_value
pcm_classification_system
pcm_classification_code
pcm_entity_classification
pcm_relationship_type
pcm_relationship
pcm_constraint
pcm_geometry_ref
pcm_coordinate_system
pcm_source_transform
pcm_change_set
pcm_change_operation
pcm_validation_result
pcm_object_version
```

### Document/drawing

```text
document
document_version
document_page
drawing
drawing_revision
source_region
model_source
model_import_job
model_source_entity
```

### Requirement/specification

```text
requirement
specification_document
specification_clause
requirement_applicability
rule_definition
rule_version
rule_execution
```

### Quantity/BOQ

```text
measurement_rule
measurement_dependency
quantity_result
quantity_aggregate
boq
boq_section
boq_item
boq_object_mapping
rate_item
estimate_item
```

### AI

```text
ai_session
ai_run
ai_tool_call
ai_evidence
ai_proposal
ai_feedback
```

### Platform

```text
domain_event_outbox
audit_event
background_job
object_lock
```

---

# PART XX — MVP OBJECT COVERAGE

## 50. Phase 1 object types

For the first AIGCC-oriented Draw/BOQ MVP, implement deeply rather than broadly.

### Required spatial objects
- Site
- Building
- Level
- Zone
- Room/Space

### Required architecture objects
- Wall
- Door
- Window
- Column
- Slab

### Required drawing constructs
- Grid
- Dimension
- Text annotation
- drawing/sheet reference

### Recommended next objects
- Beam
- Ceiling
- Stair
- Finish
- generic equipment

Do not implement complete MEP before the architecture pipeline, geometry model, quantities and change propagation are stable.

---

# PART XXI — MVP END-TO-END WORKFLOW

## 51. Workflow A — PDF to PCM to BOQ

```text
1. User uploads architectural PDF
2. Create document/version/pages
3. Detect sheet number/title/scale
4. User calibrates where required
5. Recognition extracts levels/grids/walls/doors/windows/columns/rooms
6. Create candidate PCM objects in proposed ChangeSet
7. UI displays overlay + confidence
8. User corrects/approves
9. Commit authoritative PCM objects
10. Measurement engine calculates quantities
11. BOQ agent proposes mappings
12. QS approves mappings
13. BOQ generated
14. Every BOQ quantity is traceable to objects/source regions
```

Acceptance criterion: no BOQ quantity may be presented as authoritative without traceable contributing objects or an explicitly identified manual quantity source.

---

## 52. Workflow B — AI design edit

User:

> Change all Level 4 office partitions to 150 mm acoustic walls.

Execution:

```text
AI finds applicable spaces and walls
→ tool returns 47 walls
→ AI proposes retype command
→ ChangeSet preview
→ geometry/constraints validate
→ quantity impact calculated
→ BOQ/cost impact preview calculated
→ user approves
→ commit
→ project revision increments
→ affected quantities recompute
→ downstream change-impact events emitted
```

No direct AI mutation.

---

## 53. Workflow C — drawing revision import

```text
New PDF/DWG/IFC revision uploaded
→ parse
→ align coordinates
→ compare source entities
→ semantic match against PCM IDs
→ detect added/removed/changed candidates
→ produce revision ChangeSet
→ user reviews
→ commit accepted model changes
→ quantities dirty/recompute
→ BOQ delta
→ existing procurement/submittal/RFI links evaluated
```

Object matching must use multiple signals:
- external IDs when reliable
- geometry proximity
- type
- location
- marks/tags
- semantic similarity

---

# PART XXII — CHANGE IMPACT ENGINE

## 54. Impact traversal

Input: set of changed PCM entities.

Traversal stages:

```text
Physical dependencies
→ Measurements
→ BOQ / Estimate
→ Schedule
→ Procurement
→ Documents / Drawings
→ RFIs / Submittals
→ Field progress
→ Quality / Handover
```

Impact entries:

```json
{
  "impactType":"QUANTITY|COST|SCHEDULE|PROCUREMENT|DOCUMENT|RFI|SUBMITTAL|FIELD",
  "severity":"LOW|MEDIUM|HIGH|CRITICAL",
  "sourceObjectIds":["..."],
  "affectedEntityIds":["..."],
  "calculatedDelta":{},
  "confidence":0.98,
  "requiresAction":true
}
```

Never have the LLM calculate cost/quantity deltas itself when deterministic services can calculate them.

---

# PART XXIII — TESTING STRATEGY

## 55. Test pyramid

### Unit
- property resolution
- constraints
- measurement formulas
- mapping logic
- version conflicts
- permission policies

### Geometry golden tests
Maintain fixture models with known:
- lengths
- areas
- volumes
- intersections
- clash results
- coordinate transforms

### Import regression
Golden PDF/DWG/IFC files.

Expected results include:
- extracted object counts
- semantic classifications
- dimensions/tolerances
- source-region mapping

### End-to-end
- import → approve → quantity → BOQ
- object change → quantity delta
- revision import → impact analysis
- AI proposal → preview → approval → commit

### Data migration tests
PCM schema versions must be testable against production-sized sample projects.

---

## 56. Accuracy KPIs

Track:
- object recognition precision
- object recognition recall
- dimensional absolute/relative error
- quantity variance vs verified takeoff
- BOQ mapping accuracy
- false negative rate for critical objects
- object identity matching accuracy between revisions
- user correction rate
- AI proposal acceptance rate
- downstream impact detection recall

---

# PART XXIV — PERFORMANCE TARGETS

## 57. Initial engineering targets

For typical authoring interactions:
- property update preview: p95 < 500 ms excluding large recompute
- object query in visible view: p95 < 300 ms
- geometry manipulation response: interactive target < 100 ms client-side where feasible
- server geometry validation: p95 < 1 s for small edits
- project commit: p95 < 2 s for normal edits

Large operations:
- asynchronous job with progress
- partial results where safe
- cancellable when practical

Browser rendering must use view/level-of-detail tiling; never ship entire large project geometry for every view.

---

# PART XXV — FAILURE HANDLING

## 58. Transaction guarantees

A committed ChangeSet must be atomic for authoritative PCM state.

Derived recalculations may be eventual, but their stale/dirty state must be explicit.

Example:

```text
PCM commit succeeds
quantity recalculation temporarily fails
→ object change remains committed
→ quantity marked DIRTY
→ BOQ UI shows "Recalculation pending / stale"
→ retry worker
```

Never silently show previous quantities as current after dependency changes.

---

# PART XXVI — IMPLEMENTATION ROADMAP

## 59. Phase 0 — architecture foundation

Deliverables:
- PCM schemas
- global ID conventions
- project revisions
- ChangeSet engine
- event envelope/outbox
- spatial hierarchy
- object type/property system
- geometry abstraction interfaces
- source/provenance model

**Exit criterion:** create/edit/version simple typed objects transactionally with full audit and events.

---

## 60. Phase 1 — architectural PCM

Deliver:
- levels/grids/spaces
- walls/doors/windows/columns/slabs
- canonical geometry definitions
- 2D display geometry
- property panel
- object selection/query
- relationships/hosting
- manual authoring basics

**Exit criterion:** user can create and edit a small structured architectural model without imported CAD dependency.

---

## 61. Phase 2 — drawing intelligence/import

Deliver:
- PDF pipeline
- drawing scale/calibration
- vector/text extraction
- object candidates
- confidence/evidence
- validation overlay
- source-region traceability

Then:
- DXF/DWG
- IFC

**Exit criterion:** imported drawings produce reviewable structured PCM objects.

---

## 62. Phase 3 — quantity and BOQ integration

Deliver:
- measurement rule engine
- quantity provenance
- dirty/recompute pipeline
- BOQ mapping
- object-to-BOQ trace UI
- revision quantity delta

**Exit criterion:** every generated quantity can be audited visually and mathematically.

---

## 63. Phase 4 — AI authoring

Deliver:
- find/filter tools
- create/update/retype tools
- ChangeSet preview
- AI evidence
- confirmation/approval policies
- multi-step task plans

**Exit criterion:** AI can safely execute real model edits without bypassing deterministic services.

---

## 64. Phase 5 — impact intelligence

Deliver:
- cost linkage
- schedules
- procurement
- RFIs/submittals
- change graph traversal
- impact report

**Exit criterion:** significant design changes produce trusted downstream impact analysis.

---

# PART XXVII — ENGINEERING DECISIONS TO LOCK NOW

## 65. ADR candidates

The team should create Architecture Decision Records immediately for:

1. **ADR-001:** PCM is the canonical system-of-record, files are sources/exports.
2. **ADR-002:** Stable UUID identity independent of external CAD IDs.
3. **ADR-003:** AI cannot directly mutate PCM state.
4. **ADR-004:** All authoritative mutations use ChangeSets.
5. **ADR-005:** PostgreSQL/PostGIS is primary PCM transactional store.
6. **ADR-006:** Geometry engine hidden behind provider-neutral interface.
7. **ADR-007:** Quantity calculations are versioned deterministic rules.
8. **ADR-008:** Event publishing uses transactional outbox.
9. **ADR-009:** IFC is interoperability format, not PCM internal schema.
10. **ADR-010:** Hybrid typed property architecture.
11. **ADR-011:** Explicit stale/dirty semantics for derived data.
12. **ADR-012:** Source provenance is mandatory for AI/import-derived objects.

---

# PART XXVIII — DEFINITION OF DONE

## 66. PCM foundational release is not done until

- every object has stable identity
- every authoritative mutation has audit provenance
- every object supports revision/history
- geometry is separate from vendor file format
- object types/properties are extensible
- relationships can model lifecycle links
- imported objects retain source evidence
- derived quantities know their source project revision
- stale quantities cannot masquerade as current
- AI changes produce previews and structured ChangeSets
- commits emit reliable domain events
- authorization applies at command/domain level
- end-to-end regression fixtures exist

---

# PART XXIX — REFERENCE TYPE EXAMPLE

## 67. Full example: acoustic partition wall

```json
{
  "id": "3a3c39dc-fc21-4fe7-99ca-ef947e0606e1",
  "objectType": "WALL",
  "typeId": "WT-150-ACOUSTIC",
  "mark": "W-04023",
  "spatial": {
    "buildingId": "BLDG-A",
    "levelId": "L04",
    "spaceRelations": ["OFFICE-403", "CORRIDOR-4A"]
  },
  "geometry": {
    "baseline": [[12000,8400,12800],[17100,8400,12800]],
    "thicknessMm": 150,
    "heightMm": 3200
  },
  "properties": {
    "fireRatingMin": 120,
    "acousticRatingStc": 50,
    "assemblyCode": "GA-150-02"
  },
  "classification": {
    "ifc": "IfcWall",
    "masterFormat": "09 22 16"
  },
  "provenance": {
    "method": "IMPORT",
    "drawing": "A-401",
    "drawingRevision": "C",
    "sourceRegionId": "uuid",
    "confidence": 0.96,
    "validatedBy": "user-id"
  },
  "commercialLinks": {
    "measurementRule": "NET_PARTITION_AREA_V3",
    "boqItems": ["BOQ-09-2216-001"]
  },
  "executionLinks": {
    "activities": ["ACT-L04-PARTITIONS"],
    "submittals": ["SUB-0098"]
  },
  "revision": 22
}
```

This object is not merely a wall shape. It is the persistent identity that design, quantities, cost, procurement, construction and handover can reference.

---

# PART XXX — FINAL ENGINEERING POSITION

## 68. What PCM must become

PCM should become the **construction operating data model** behind Preckon.

Its competitive value does not come from storing more attributes than BIM. It comes from maintaining durable identity and trustworthy relationships across the project lifecycle:

```text
Requirement
   ↓
Construction Object
   ↓
Drawing / Model
   ↓
Quantity
   ↓
BOQ / Cost
   ↓
Schedule
   ↓
Procurement
   ↓
Installation
   ↓
Inspection
   ↓
Asset / Handover
```

If this foundation is implemented correctly, Preckon can add increasingly sophisticated AI-native design generation, BIM authoring and parametric automation (including capabilities benchmarked against platforms such as ArchiLabs) without creating disconnected products or rebuilding the data architecture each time a new construction module is introduced.

**Engineering priority:** build PCM identity, transactions, geometry abstraction, provenance and quantity traceability correctly before expanding aggressively into broad CAD/BIM feature coverage.

---

## Appendix A — Suggested repository structure

```text
/preckon
  /services
    /pcm-core
      /domain
      /application
      /infrastructure
      /api
      /tests
    /geometry
    /document-intelligence
    /measurement-boq
    /ai-orchestration
    /workers
  /packages
    /pcm-contracts
    /event-contracts
    /geometry-contracts
    /classification
    /units
  /database
    /migrations
    /seed
    /fixtures
  /docs
    /adr
    /api
    /pcm
```

---

## Appendix B — Suggested first sprint backlog

### Story PCM-001 — Project revision infrastructure
Implement monotonic project revision and optimistic concurrency.

### Story PCM-002 — ChangeSet engine
Create draft, preview, validate, commit and reject ChangeSets.

### Story PCM-003 — Object type and property schemas
Support system-defined and organization-defined object metadata.

### Story PCM-004 — Spatial hierarchy
Create site/building/level/zone/space tree.

### Story PCM-005 — Construction object CRUD through commands
Create wall/door/window/column/slab domain commands with no direct table mutation from controllers.

### Story PCM-006 — Geometry abstraction
Define geometry contracts and implement initial line/polyline/profile/bounds operations.

### Story PCM-007 — Relationship engine
Support host/containment/representation links.

### Story PCM-008 — Audit and event outbox
Record ChangeSet provenance and publish versioned events reliably.

### Story PCM-009 — Source provenance
Link objects to uploaded file/version/page/source region.

### Story PCM-010 — Quantity dirty propagation skeleton
When relevant object state changes, mark dependent measurement results dirty.

### Sprint acceptance demonstration

```text
Create Level 01
→ create two wall types
→ create four walls
→ host a door
→ edit a wall type through ChangeSet preview
→ commit
→ project revision increments
→ quantity dependency marked dirty
→ audit shows before/after
→ object/source relationships query successfully
```

This demonstration should pass via API tests before building a sophisticated UI.

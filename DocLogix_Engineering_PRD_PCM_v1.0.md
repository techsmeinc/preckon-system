# PRECKON DOCLOGIX — MASTER PRODUCT & ENGINEERING BLUEPRINT

**Version:** 1.0  
**Product:** Preckon DocLogix  
**Role in Platform:** Common Data Environment (CDE), Document Control, Workflow, Intelligence & Project Knowledge Layer  
**Prepared for:** Product, Engineering, Architecture, UX, AI, Implementation, Migration and QA Teams

---

## 1. Executive Vision

DocLogix is the document intelligence and control backbone of Preckon.

It must not be designed as a generic cloud file repository. Its purpose is to convert construction documents into structured, connected, governed project knowledge that can be consumed by every Preckon module.

The core principle is:

> Every project document enters Preckon once, becomes structured and governed, and remains connected to the drawings, schedule, cost, BOQ, RFIs, submittals, approvals, correspondence, contracts, field records, decisions and handover information that depend on it.

DocLogix becomes the project's authoritative Common Data Environment (CDE) and the system of record for controlled project information.

---

# 2. Strategic Objectives

DocLogix must enable Preckon to:

1. Replace spreadsheet-based document registers.
2. Replace fragmented file stores and uncontrolled shared folders.
3. Provide disciplined document numbering, revision, status and distribution controls.
4. Manage formal reviews, approvals, acknowledgements and transmittals.
5. Create one authoritative source for current project information.
6. Automatically classify, extract and understand uploaded documents.
7. Connect documents to all other Preckon business objects.
8. Identify downstream impacts when project information changes.
9. Allow users to search an entire project using natural language.
10. Maintain full provenance and auditability for AI-assisted results.
11. Support migration from incumbent construction platforms without disrupting live projects.
12. Preserve project information from tender through handover and operations.

---

# 3. Product Positioning

DocLogix should be positioned as:

**Construction CDE + Document Control + AI Document Intelligence + Project Knowledge Graph**

It should ultimately cover four layers:

### Layer 1 — CDE / Repository
Secure storage, structured metadata, permissions, folders/views, synchronization and file lifecycle.

### Layer 2 — Document Control
Numbering, revisions, statuses, distribution, review, approval, transmittals, registers and audit trails.

### Layer 3 — Intelligence
Classification, extraction, summarization, semantic search, change detection, requirement extraction and relationship discovery.

### Layer 4 — Connected Project Intelligence
Document-to-drawing, document-to-BOQ, document-to-schedule, document-to-cost, document-to-RFI, document-to-submittal and broader impact analysis.

---

# 4. Product Architecture

```text
                              PRECKON PLATFORM
                                    │
                          ┌─────────▼──────────┐
                          │      DOCLOGIX      │
                          │        CDE         │
                          └─────────┬──────────┘
                                    │
       ┌────────────────────────────┼─────────────────────────────┐
       │                            │                             │
       ▼                            ▼                             ▼
   INGESTION                    CONTROL                      INTELLIGENCE
   ─────────                    ───────                      ────────────
   Upload                        Metadata                     Classification
   Bulk Upload                   Document IDs                 Extraction
   Email Capture                 Revisions                    Summarization
   Mobile Capture                Status                       OCR
   API                           Permissions                  Comparison
   External Sync                 Review/Approval              Semantic Search
   Migration                     Transmittals                 Requirement Mining
   Scanner                       Audit                        Relationship Mining
       │                            │                             │
       └────────────────────────────┼─────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ DOCUMENT KNOWLEDGE │
                          │       GRAPH        │
                          └─────────┬──────────┘
                                    │
       ┌────────────┬───────────────┼──────────────┬───────────────┐
       ▼            ▼               ▼              ▼               ▼
  TenderLogix    DrawLogix    ScheduleLogix    CostLogix       Field/QA
       │            │               │              │               │
       └────────────┴───────────────┴──────────────┴───────────────┘
                                    │
                              PRECKON AI AGENTS
```

---

# 5. Core Product Domains

DocLogix should be implemented as a collection of tightly connected engines.

## 5.1 Document Hub

The Document Hub is the visible CDE layer.

Capabilities:

- Project document repository
- Company document repository
- Templates
- Controlled and uncontrolled documents
- Folder views
- Metadata-driven views
- Saved searches
- Personal favourites
- Recently accessed
- Shared with me
- Offline synchronization
- Bulk upload/download
- Drag and drop
- File preview
- PDF, Office and image viewing
- Drawing preview links
- Version history
- Document relationships
- Access logs

Supported content should eventually include:

- PDF
- DOC/DOCX
- XLS/XLSX
- PPT/PPTX
- TXT
- CSV
- DWG/DXF references
- IFC references
- RVT model references
- Images
- Videos
- ZIP packages
- Email/EML
- Message attachments
- Scanned records

Native CAD/BIM editing is not a DocLogix responsibility. DocLogix stores, previews, governs and connects these objects while DrawLogix or external integrated applications handle specialist authoring.

---

# 6. Intelligent Document Register

The traditional document register must become a first-class live application.

Each controlled document should contain fields such as:

- Project
- Document UID
- Document Number
- Document Title
- Document Type
- Discipline
- Originator
- Authoring Organization
- Recipient Organization
- Location
- Zone
- Level
- System
- Package
- Work Package
- Contract Package
- Classification Code
- Revision
- Revision Sequence
- Revision Date
- Revision Description
- Status
- Suitability / Purpose of Issue
- Confidentiality
- File Name
- File Type
- File Size
- Current / Superseded
- Approval State
- Required Response Date
- Distribution List
- Created By
- Created Date
- Modified By
- Modified Date
- Retention Category
- Record Category
- Handover Category

### AI-Assisted Registration

When a user uploads a file, DocLogix should attempt to derive:

```text
Uploaded File:
MEP_HVAC_L04_RevC_AFC.pdf

Detected Metadata:
Document Type: Drawing
Discipline: Mechanical
System: HVAC
Location: Level 04
Revision: C
Status: Approved for Construction
Drawing Number: MEP-HVAC-L04-103
Originator: ABC Consultants
Previous Revision: B
Confidence: 96%
```

Users can confirm or correct suggestions before committing controlled metadata.

Repeated project conventions should become learned mapping rules.

---

# 7. Document Numbering Engine

Projects frequently use strict document-numbering conventions.

DocLogix must support configurable numbering patterns.

Example:

```text
PROJECT-ORIGINATOR-VOLUME-LEVEL-TYPE-DISCIPLINE-NUMBER
DXB01-ABC-ZZ-04-DR-M-0103
```

Capabilities:

- Project-specific numbering schemes
- Company templates
- Segment validation
- Required/optional segments
- Auto-increment number ranges
- Reserved ranges
- Duplicate detection
- Number generator
- Regex/pattern validation
- Legacy numbering support
- Multiple numbering schemes in one project

---

# 8. Revision and Version Control

Construction revision control is different from ordinary file versioning.

DocLogix must distinguish:

- Binary file version
- Formal document revision
- Workflow status
- Purpose of issue
- Superseded revision

Example:

```text
Document: MEP-HVAC-L04-103

Revision A — Shared for Review
Revision B — Approved with Comments
Revision C — Approved for Construction
Revision D — Revised for Construction
Revision E — As-Built
```

Rules:

- Only one revision can be designated current within a defined status context.
- Superseded revisions remain immutable and retrievable.
- Previously transmitted documents retain the exact revision issued.
- Relationships preserve the revision used at the time of linkage.
- Audit history cannot be rewritten by ordinary users.

---

# 9. Revision Intelligence

Revision Intelligence is a major product differentiator.

When Revision C supersedes Revision B, DocLogix should compare them and identify changes.

Possible classifications:

- Text added
- Text removed
- Text modified
- Dimensions changed
- Notes changed
- Drawing objects added/removed
- Equipment changed
- Material changed
- Requirement changed
- Specification clause changed
- Quantity-related change
- Schedule-related change
- Commercial/contractual change

Example output:

```text
REVISION B → REVISION C

17 changes detected

8   annotation changes
5   dimensional changes
2   equipment changes
1   specification-related change
1   possible quantity/cost impact

Affected references:
RFI-037
Submittal SUB-081
BOQ M-142
Schedule activity HVAC-L4-140
Purchase order PO-183
```

The user must be able to inspect every AI-detected change visually.

---

# 10. Document Workflow Engine

Workflows must be configurable by company, project, document type, discipline and package.

Example:

```text
WIP
 ↓
Internal Review
 ↓
Shared for Review
 ↓
Consultant Review
 ↓
Approved / Approved with Comments / Revise & Resubmit / Rejected
 ↓
Issued for Construction
 ↓
Superseded
 ↓
As-Built
 ↓
Archived
```

Workflow primitives:

- Start
- Assign
- Parallel review
- Sequential review
- Conditional branch
- Review
- Comment
- Approve
- Approve with comments
- Reject
- Revise and resubmit
- Acknowledge
- Escalate
- Delegate
- Return
- Publish
- Close

Workflow configuration should support:

- SLA duration
- Due dates
- Role-based assignees
- Organization-based assignees
- Escalation
- Reminders
- Required comment fields
- Required attachments
- Required signatures
- Required response codes
- Minimum approvals
- Consensus rules

---

# 11. Review & Approval Workspace

Reviewers need a purpose-built review environment.

Three-panel model:

```text
DOCUMENTS          VIEWER                  REVIEW
──────────         ─────────               ─────────────
Spec 21 00         [Document]              Assigned To
Drawing M-103                              Due Date
Drawing M-104      Markup                  Review Status
                                           Comments
                                           Related RFIs
                                           Revision Changes
                                           AI Summary
                                           [Approve]
                                           [Approve w/ Comments]
                                           [Revise & Resubmit]
                                           [Reject]
```

Requirements:

- Annotation / markup
- Comment threads
- Pin comments to document region
- Resolve comments
- Assign comments
- Compare versions
- Review checklist
- Decision log
- Digital signature support where required
- Full action audit trail

---

# 12. Transmittal Management

Transmittals are structured business objects, not merely generated PDFs.

## Transmittal Data Model

```text
Transmittal
├── TransmittalId
├── ProjectId
├── TransmittalNumber
├── SenderOrganization
├── SenderUser
├── RecipientOrganizations[]
├── RecipientUsers[]
├── Purpose
├── Subject
├── Instructions
├── SentDate
├── RequiredResponseDate
├── Status
├── DocumentRevisions[]
├── Distribution[]
├── Acknowledgements[]
├── Responses[]
├── Attachments[]
└── AuditEvents[]
```

Capabilities:

- Create transmittal
- Select exact document revisions
- Distribution groups
- Recipient acknowledgements
- Cover sheet generation
- Email notifications
- Download package
- Resend
- Recall where legally/workflow appropriate
- Response monitoring
- Overdue alerts
- Transmittal register
- Incoming transmittals
- Outgoing transmittals
- Auto numbering

Useful query:

> Show all AFC structural drawings transmitted to Contractor X that have not been acknowledged.

---

# 13. Correspondence Management

DocLogix should capture formal project correspondence.

Types:

- Letters
- Notices
- Emails
- Instructions
- Consultant responses
- Contractor correspondence
- Client directives
- Meeting correspondence

Capabilities:

- Email ingestion
- Email-to-project filing
- Thread preservation
- Attachment ingestion
- Linking correspondence to documents/issues
- Formal correspondence register
- Contractual notice classification
- Due dates
- Response tracking
- AI extraction of commitments and actions

---

# 14. Document Packages

Construction information is frequently issued in packages.

Examples:

- Tender package
- IFC drawing package
- Shop drawing package
- Consultant review package
- Municipality submission
- Handover package
- O&M manual package

A package should freeze the included revision set.

```text
Package IFC-2026-08-15

M-101 Rev C
M-102 Rev C
M-103 Rev D
E-201 Rev B
S-301 Rev E
```

Later document revisions must not silently alter an already-issued package.

---

# 15. Project Knowledge Graph

This is one of DocLogix's most important architectural components.

Every relevant object is represented as a node with typed relationships.

Possible nodes:

- Document
- Document Revision
- Drawing
- Specification
- Requirement
- BOQ Item
- Cost Code
- Schedule Activity
- RFI
- Submittal
- Change Event
- Change Order
- Purchase Order
- Contract
- Organization
- User
- Location
- Asset
- Equipment
- Material
- Inspection
- Test
- NCR
- Issue
- Meeting
- Decision
- Correspondence
- Site Photo

Example relationships:

```text
DocumentRevision --SUPERCEDES--> DocumentRevision
DocumentRevision --REFERENCES--> SpecificationClause
RFI --REFERENCES--> DocumentRevision
BOQItem --DERIVED_FROM--> Drawing
ScheduleActivity --REQUIRES--> ApprovedDocument
Submittal --SATISFIES--> SpecificationRequirement
ChangeEvent --IMPACTS--> BOQItem
ChangeEvent --IMPACTS--> ScheduleActivity
Inspection --VERIFIES--> Requirement
PurchaseOrder --PROCURES--> Material
Material --SPECIFIED_BY--> SpecificationClause
```

Relationship metadata should include:

- Relationship type
- Source
- Confidence
- Created by
- Created date
- AI/Human origin
- Accepted/rejected status
- Valid from/to

---

# 16. Document Impact Analysis Engine

When important information changes, DocLogix should identify downstream consequences.

Pipeline:

```text
NEW / REVISED DOCUMENT
          │
          ▼
Document Understanding
          │
          ▼
Revision Difference Detection
          │
          ▼
Requirement / Entity Extraction
          │
          ▼
Relationship Graph Traversal
          │
   ┌──────┼─────────┬──────────┬──────────┐
   ▼      ▼         ▼          ▼          ▼
Drawing  BOQ     Schedule     Cost      Procurement
   │      │         │          │          │
   └──────┴─────────┴──────────┴──────────┘
                    │
                    ▼
               IMPACT REPORT
```

Example:

```text
Document Impact Alert

Specification Rev 04 changes fire-door rating for Stair Core B
from 60 minutes to 90 minutes.

Potentially affected:
12 door assets
2 approved material submittals
1 procurement package
2 BOQ items
7 schedule activities
3 drawings

Suggested actions:
- Review procurement
- Re-open affected submittals
- Check commercial change
- Update BOQ
- Notify responsible contractor
```

All impact recommendations must be explainable and traceable.

---

# 17. Ask DocLogix — AI Project Search

Users should be able to search using natural language.

Examples:

- What is the latest approved HVAC drawing for Level 8?
- Find the waterproofing specification for basement walls.
- Which RFIs reference Drawing S-301 Rev C?
- What changed between Specification Rev 3 and Rev 4?
- Show documents awaiting consultant approval for more than seven days.
- Did the consultant approve Brand X fire dampers?
- Which documents are required before Level 5 concrete pour starts?
- Find every instruction that may affect the façade contract.
- What is the contractual notice period for delayed access?

## Mandatory AI Answer Structure

Every AI answer should include:

1. Answer
2. Confidence
3. Source document
4. Revision
5. Page / sheet
6. Location / paragraph / region
7. Related objects
8. Link to evidence

Example:

```text
Answer:
The required membrane is a 4 mm SBS modified bitumen membrane.

Source:
Specification 07 52 00 Rev 03
Page 14
Clause 2.3.1

Confidence: High

[Open Source]
```

AI must never silently replace controlled project information.

---

# 18. AI Architecture

DocLogix should use multiple specialist AI services/agents rather than a single generic chatbot.

## 18.1 Document Intake Agent

Responsibilities:

- Recognize document type
- Extract metadata
- Suggest document number
- Detect revision
- Determine likely discipline
- Identify organization
- Detect duplicate or superseded document

## 18.2 Document Understanding Agent

Responsibilities:

- Parse text
- Parse tables
- Interpret title blocks
- Identify sections
- Extract entities
- Extract requirements
- Identify references to other documents

## 18.3 Revision Agent

Responsibilities:

- Compare revisions
- Classify differences
- Highlight meaningful changes
- Determine probable downstream effects

## 18.4 Requirement Agent

Responsibilities:

Extract structured requirements such as:

- Product/material
- Standard
- Performance requirement
- Installation requirement
- Testing requirement
- Inspection requirement
- Approval requirement
- Documentation requirement
- Warranty requirement

## 18.5 Relationship Agent

Responsibilities:

- Detect references across project content
- Propose graph relationships
- Score confidence
- Avoid duplicate relationships

## 18.6 Impact Agent

Responsibilities:

- Traverse relationships
- Detect potential impacts
- Identify responsible party
- Generate recommended actions

## 18.7 Search Agent

Responsibilities:

- Interpret natural-language request
- Resolve project context
- Retrieve controlled evidence
- Generate citation-backed answers

## 18.8 Compliance Agent

Responsibilities:

- Identify required documents
- Detect expired documents
- Detect missing approvals
- Detect incomplete packages
- Identify required closeout records

## 18.9 Migration Agent

Responsibilities:

- Classify imported documents
- Map metadata
- identify revisions
- Detect conflicts
- Recommend mapping rules

---

# 19. AI Guardrails

Construction information can have commercial, legal, engineering and safety consequences.

Therefore:

- AI cannot change controlled metadata without user authorization.
- AI suggestions must be clearly marked.
- AI-generated relationships carry confidence values.
- Critical relationships may require user confirmation.
- Every AI answer must expose evidence.
- Generated summaries must retain document/revision context.
- Superseded content must not be presented as current without warning.
- Permission checks apply before retrieval, embeddings and answer generation.
- Tenant/project isolation applies to vector indexes.
- Audit trail records consequential AI actions.

---

# 20. Search Architecture

DocLogix requires hybrid search.

### Search modes

1. Exact metadata search
2. Full-text search
3. Semantic search
4. OCR search
5. Relationship search
6. Visual/drawing reference search
7. AI question answering

### Search facets

- Project
- Document number
- Document type
- Discipline
- Organization
- Status
- Revision
- Date range
- Package
- Location
- Level
- System
- Workflow state
- User
- Contract
- Keyword

Search result ranking should privilege current controlled revisions unless the query explicitly asks for historical/superseded records.

---

# 21. Metadata Architecture

Avoid hard-coding all metadata fields.

Use:

- Core system metadata
- Project-defined metadata
- Document-type schemas
- Configurable controlled vocabularies
- Custom fields
- Validation rules

Example:

```text
DocumentType: MATERIAL_SUBMITTAL

Required Fields:
- SpecificationSection
- Manufacturer
- Product
- Supplier
- Subcontractor
- RequiredOnSiteDate
- ReviewStatus
```

---

# 22. Permissions & Security

Permission architecture must support construction project realities.

Dimensions:

- Tenant
- Company
- Project
- Organization
- Role
- Document
- Folder/view
- Document type
- Package
- Workflow
- Confidentiality classification

Roles may include:

- Project Administrator
- Document Controller
- Client
- Consultant
- Architect
- Engineer
- Main Contractor
- Subcontractor
- Supplier
- Viewer
- Auditor

Permissions:

- View
- Download
- Upload
- Edit metadata
- Create revision
- Review
- Approve
- Issue
- Transmit
- Share
- Delete
- Archive
- Administer

Security should support:

- SSO
- MFA
- RBAC
- organization-level isolation
- immutable audit logs
- encryption at rest
- encryption in transit
- configurable download restrictions
- watermarking
- access expiry
- external-user access
- session controls

---

# 23. Audit Trail

Every material event should be auditable.

Examples:

- Upload
- Metadata change
- Revision creation
- View
- Download
- Share
- Approval
- Rejection
- Transmittal
- Acknowledgement
- Relationship creation
- AI extraction acceptance
- Workflow action
- Permission change
- Archive

Audit record:

```text
Timestamp
User
Organization
Action
Object
Previous Value
New Value
IP / Session
Source Application
Reason / Comment
```

---

# 24. Integration with DrawLogix

DocLogix owns controlled drawing/document records.

DrawLogix owns drawing intelligence, authoring assistance, drawing comparison, quantity extraction and technical drawing workflows.

Integration examples:

```text
DocLogix                         DrawLogix
────────                         ─────────
Drawing Record      <--------->  Drawing Workspace
Revision            <--------->  Drawing Revision
Status              <--------->  Drawing Approval
Metadata            <--------->  Drawing Attributes
Controlled File     <--------->  Render/Model
Relationships       <--------->  Drawing Entities
```

Do not duplicate drawing masters across modules.

---

# 25. Integration with TenderLogix

Tender documents should enter through DocLogix.

Typical lifecycle:

```text
Tender Received
      ↓
DocLogix Ingestion
      ↓
TenderLogix Interpretation
      ↓
Requirements / BOQ / Clarifications
      ↓
Bid Submission Package
      ↓
Contract Award
      ↓
Construction Document Baseline
```

TenderLogix references DocLogix document IDs and revisions.

---

# 26. Integration with ScheduleLogix

Schedule activities can depend upon documentation.

Examples:

```text
Activity: Install AHU-04

Required Documents:
✓ Approved shop drawing
✓ Approved material submittal
✕ Consultant inspection release
```

DocLogix changes can trigger ScheduleLogix risk notifications.

Example:

> Shop drawing approval is 8 days late and activity HVAC-L4-220 starts in 4 days.

This becomes a schedule risk, not merely a document overdue alert.

---

# 27. Integration with CostLogix / BOQ

Relationships:

- Drawing → BOQ item
- Specification → BOQ item
- Document revision → quantity change
- Change instruction → change event
- Approved change → revised cost

Revision Impact Agent should be able to send potential commercial impacts for review.

---

# 28. Submittals

Submittals may either be implemented inside DocLogix or as a dedicated Preckon application that relies on DocLogix.

Recommended design:

DocLogix owns the controlled documents.

Submittal workflow owns:

- Submittal record
- Package
- Specification reference
- Supplier
- Contractor
- Review cycles
- Response code
- Required-on-site date
- Approval

Documents remain linked rather than copied.

---

# 29. RFI Integration

RFI should be a business object connected to documents.

```text
RFI-037
Question
Response
Status
Raised By
Assigned To
Due Date

Referenced Documents:
M-103 Rev B
Spec 23 31 00 Rev 2

Resulting Documents:
M-103 Rev C
```

This creates traceability from issue to resolution to revised information.

---

# 30. Meeting & Decision Records

Meeting minutes often drive project decisions but are poorly connected.

DocLogix should allow:

- Meeting minute ingestion
- Decision extraction
- Action extraction
- Document references
- RFI references
- Schedule references
- Change references
- Responsible person
- Due date

A decision should become a structured node in the project graph.

---

# 31. Closeout & Handover

DocLogix must support project closeout from the beginning, not as an afterthought.

Handover categories:

- As-built drawings
- O&M manuals
- Warranties
- Test certificates
- Commissioning records
- Training records
- Asset data
- Spare parts
- Inspection records
- Authority approvals
- Final certificates

Dashboard:

```text
HANDOVER COMPLETENESS

As-Builts              92%
O&M Manuals             81%
Test Certificates       76%
Warranties               88%
Training Records         65%
Asset Data               71%

Overall:                 79%
```

Missing documentation should be traceable to package, system, subcontractor and responsible party.

---

# 32. Desktop + Browser Architecture

DocLogix must support both browser and downloadable Preckon application experiences.

## Browser

Best for:

- External consultants
- Clients
- Reviewers
- Occasional project users
- Mobile/tablet access
- Fast collaboration

## Desktop

Best for:

- Document controllers
- Engineers working with large packages
- Bulk upload/download
- Offline/poor-connectivity environments
- Large drawing review
- Synchronization
- Heavy local workflows

Recommended architecture:

```text
Preckon Desktop
      │
Local Cache / Sync Engine
      │
Preckon APIs
      │
DocLogix Services
      │
Object Storage + Metadata + Search + Graph
```

Desktop and web must use the same business APIs and permission model.

---

# 33. Offline Sync

Desktop sync should support:

- Pin folders/packages for offline use
- Download current revisions
- Sync metadata
- Detect conflicts
- Queue uploads
- Resume interrupted transfers
- Preserve hashes
- Reconcile revisions

Avoid allowing uncontrolled offline editing to silently overwrite newer controlled revisions.

---

# 34. Migration Strategy

Migration is mandatory for enterprise adoption.

Potential sources:

- Oracle Aconex
- Autodesk Construction Cloud / BIM 360
- Procore
- SharePoint
- OneDrive
- Dropbox
- Network drives
- Legacy DMS
- Existing Excel document registers

Migration must preserve as much as available:

- Documents
- Revisions
- Metadata
- Statuses
- Folder structures
- Organizations
- Users
- Transmittals
- Review history
- Comments
- Dates
- Audit history
- Relationships

---

# 35. Migration Studio

Provide a user-facing migration application.

```text
SOURCE SYSTEM                          PRECKON
──────────────────                     ─────────────────
Document Number       ───────────────> Document Number
Revision              ───────────────> Revision
Document Type         ───────────────> Type
Discipline            ───────────────> Discipline
Status                ───────────────> Workflow Status
Originator            ───────────────> Organization
Folder                ───────────────> Package / View

142,891 documents analyzed
131,420 mapped automatically
  9,837 require confirmation
  1,634 conflicts
```

Migration phases:

1. Connect/export
2. Scan source
3. Inventory
4. Map metadata
5. Map users/organizations
6. Detect revisions
7. Detect duplicates
8. Dry run
9. Validation report
10. Production import
11. Reconciliation
12. Customer sign-off

---

# 36. Deduplication

Use multiple signals:

- Cryptographic file hash
- Document number
- Revision
- File name
- Content similarity
- Title block
- Metadata similarity

Possible states:

- Exact duplicate
- Same document/revision, different binary
- Same document, new revision
- Related document
- Potential conflict

Never auto-delete conflicts during migration.

---

# 37. System Services

Recommended service boundaries:

```text
Document Service
Revision Service
Metadata Service
Workflow Service
Transmittal Service
Correspondence Service
Package Service
Search Service
AI Document Service
Relationship/Graph Service
Impact Service
Preview Service
Conversion Service
Notification Service
Audit Service
Permission Service
Migration Service
Sync Service
Retention Service
```

These may begin within a modular monolith but should have explicit domain boundaries.

---

# 38. Storage Architecture

Separate binary storage from business metadata.

```text
                       DOCLOGIX
                          │
        ┌─────────────────┼───────────────────┐
        ▼                 ▼                   ▼
 Relational DB        Object Storage       Search Index
 Metadata             Binary Files         Full Text
 Workflow             Revisions            Semantic
 Permissions          Previews              OCR
 Audit                 Packages             Embeddings
        │                                     │
        └──────────────────┬──────────────────┘
                           ▼
                     Knowledge Graph
```

Binary objects should be content-addressable or hash-verified where practical.

---

# 39. Suggested Core Entities

Initial domain model should include at least:

```text
Tenant
Company
Project
Organization
User
ProjectMember
Role
Permission
Document
DocumentRevision
DocumentFile
DocumentMetadata
DocumentType
DocumentClassification
DocumentStatus
DocumentNumberScheme
DocumentPackage
PackageDocumentRevision
WorkflowDefinition
WorkflowInstance
WorkflowTask
WorkflowAction
Review
ReviewComment
Markup
Transmittal
TransmittalRecipient
TransmittalDocument
Acknowledgement
Correspondence
CorrespondenceThread
DistributionGroup
Relationship
RelationshipType
Requirement
ExtractedEntity
AIAnalysis
AIProposal
SearchIndexRecord
AuditEvent
RetentionPolicy
MigrationJob
MigrationItem
MigrationMapping
SyncJob
```

---

# 40. Document Entity Example

```json
{
  "documentId": "DOC-uuid",
  "projectId": "PRJ-uuid",
  "documentNumber": "DXB01-ABC-ZZ-04-DR-M-0103",
  "title": "Level 04 HVAC Layout",
  "documentType": "DRAWING",
  "discipline": "MECHANICAL",
  "originatorId": "ORG-ABC",
  "currentRevisionId": "REV-C",
  "status": "AFC",
  "location": "LEVEL_04",
  "system": "HVAC",
  "packageId": "PKG-MEP-04",
  "confidentiality": "PROJECT",
  "createdAt": "...",
  "createdBy": "..."
}
```

---

# 41. Revision Entity Example

```json
{
  "revisionId": "REV-C",
  "documentId": "DOC-uuid",
  "revisionCode": "C",
  "revisionSequence": 3,
  "status": "APPROVED_FOR_CONSTRUCTION",
  "purposeOfIssue": "CONSTRUCTION",
  "fileId": "FILE-uuid",
  "supersedesRevisionId": "REV-B",
  "revisionDescription": "Consultant comments incorporated",
  "revisionDate": "...",
  "issuedAt": "...",
  "issuedBy": "..."
}
```

---

# 42. Relationship Entity Example

```json
{
  "relationshipId": "REL-uuid",
  "sourceType": "DOCUMENT_REVISION",
  "sourceId": "REV-C",
  "relationshipType": "IMPACTS",
  "targetType": "SCHEDULE_ACTIVITY",
  "targetId": "ACT-HVAC-L4-140",
  "origin": "AI_PROPOSED",
  "confidence": 0.89,
  "status": "CONFIRMED",
  "createdBy": "AI-IMPACT-AGENT",
  "confirmedBy": "USR-uuid"
}
```

---

# 43. API Design

Representative APIs:

```text
POST   /projects/{projectId}/documents
GET    /projects/{projectId}/documents
GET    /documents/{documentId}
PATCH  /documents/{documentId}

POST   /documents/{documentId}/revisions
GET    /documents/{documentId}/revisions
GET    /revisions/{revisionId}

POST   /revisions/{revisionId}/workflow/start
POST   /workflow/tasks/{taskId}/approve
POST   /workflow/tasks/{taskId}/reject

POST   /projects/{projectId}/transmittals
POST   /transmittals/{id}/issue
POST   /transmittals/{id}/acknowledge

POST   /documents/{id}/relationships
GET    /documents/{id}/relationships

POST   /revisions/{revisionId}/compare/{otherRevisionId}
GET    /revisions/{revisionId}/impact-analysis

POST   /projects/{projectId}/search
POST   /projects/{projectId}/ask

POST   /projects/{projectId}/migration/jobs
GET    /migration/jobs/{jobId}
```

---

# 44. Events

Publish domain events so other Preckon modules can react.

Examples:

```text
DocumentCreated
RevisionUploaded
RevisionPublished
DocumentApproved
DocumentRejected
DocumentSuperseded
DocumentTransmitted
TransmittalAcknowledged
ReviewOverdue
DocumentRelationshipCreated
DocumentImpactDetected
RequiredDocumentMissing
PackagePublished
MigrationCompleted
```

Example:

```text
DocumentApproved
        │
        ├── ScheduleLogix recalculates documentation constraint
        ├── CostLogix reevaluates change event
        ├── TenderLogix updates requirement state
        └── Notification service alerts stakeholders
```

---

# 45. Primary UI Navigation

```text
DOCLOGIX

Dashboard
Documents
Document Register
My Reviews
Transmittals
Submittals
Correspondence
Packages
Search / Ask DocLogix
Impact Center
Handover
Migration Studio
Reports
Administration
```

---

# 46. Dashboard

Key widgets:

- Documents awaiting review
- Overdue reviews
- Recently revised documents
- Recently issued documents
- Missing approvals
- Unacknowledged transmittals
- Potential document impacts
- Document status distribution
- Handover completeness
- Most active disciplines
- My tasks

---

# 47. Main Document Workspace

Recommended desktop layout:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ DocLogix      Project: Marina Tower            Search              │
├───────────────┬───────────────────────────────┬──────────────────────┤
│ FILTERS       │ DOCUMENT REGISTER             │ DETAILS              │
│               │                               │                      │
│ Discipline    │ M-103 HVAC L04 C AFC          │ Revision C           │
│ Type          │ M-104 HVAC L05 B Review       │ Status AFC           │
│ Status        │ E-201 Lighting B AFC          │ Originator ABC       │
│ Originator    │                               │ Relationships        │
│ Level         │                               │ Workflow             │
│ Package       │                               │ AI Insights          │
└───────────────┴───────────────────────────────┴──────────────────────┘
```

---

# 48. Document Viewer

```text
┌──────────────────────────────────────────────────────────────────────┐
│ MEP-HVAC-L04-103 Rev C     AFC      [Compare] [Review] [Transmit] │
├──────────────┬────────────────────────────────┬─────────────────────┤
│ REVISIONS    │ VIEWER                         │ INTELLIGENCE        │
│ C Current    │                                │ Summary             │
│ B            │ PDF / Drawing                  │ Changes: 17         │
│ A            │                                │ RFIs: 2             │
│              │ Markups                        │ BOQ: 8              │
│              │                                │ Activities: 4       │
│              │                                │ Relationships       │
│              │                                │ History             │
└──────────────┴────────────────────────────────┴─────────────────────┘
```

---

# 49. Impact Center

A dedicated workspace should aggregate AI-proposed impacts.

```text
IMPACT CENTER

High Risk     8
Medium       21
Low          37

Spec 07 52 00 Rev 4
Potential cost + schedule impact
12 linked objects
[Review Impact]

M-103 Rev C
Possible quantity change
6 linked BOQ items
[Review Impact]
```

Users can:

- Confirm
- Reject
- Delegate
- Create RFI
- Create change event
- Notify responsible organization
- Update BOQ
- Link schedule activity

---

# 50. Reporting

Reports should include:

- Master Document Register
- Drawing Register
- Specification Register
- Review Status Report
- Overdue Review Report
- Transmittal Register
- Incoming/Outgoing Correspondence
- Document Revision History
- Document Distribution Report
- Workflow Cycle Time
- Handover Completeness
- Missing Required Documents
- Document Impact Register
- AI Relationship Confirmation Report

Export formats:

- Excel
- PDF
- CSV

---

# 51. Analytics

Potential KPIs:

- Average review duration
- Approval turnaround
- First-time approval rate
- Revision count by discipline
- Documents overdue
- RFI-document correlation
- Rework-associated documents
- Change events originating from revisions
- Documents issued late vs schedule need date
- Handover readiness

---

# 52. Construction-Specific Document Types

Initial library:

### Design
- Drawings
- Specifications
- Design reports
- Calculations
- BIM deliverables

### Commercial
- Contracts
- BOQ
- Quotations
- Purchase orders
- Change documents
- Payment records

### Technical
- Shop drawings
- Material submittals
- Method statements
- Samples
- Technical data

### Project Control
- Schedules
- Progress reports
- Lookaheads
- Risk reports

### Site
- RFIs
- NCRs
- Inspections
- Test records
- Site instructions
- Photos
- Daily reports

### Governance
- Meeting minutes
- Correspondence
- Approvals
- Permits
- Authority submissions

### Closeout
- As-builts
- O&M
- Warranties
- Commissioning
- Certificates
- Training

---

# 53. Standards Strategy

DocLogix should support configurable information management aligned with commonly used construction information-management concepts such as:

- Common Data Environment workflows
- Information status/suitability
- Controlled naming conventions
- Revision control
- Published/shared/work-in-progress states
- Immutable records
- Auditability

Do not hard-code one country's naming convention into the platform. Create standards profiles that can be configured by client/project.

---

# 54. Multi-Tenant Architecture

Hierarchy:

```text
Preckon
└── Tenant
    ├── Companies
    ├── Users
    └── Projects
        ├── Organizations
        ├── Documents
        ├── Workflows
        ├── Metadata Schemas
        └── Relationships
```

Every data query, search request, vector retrieval and graph traversal must enforce tenant/project security boundaries.

---

# 55. Non-Functional Requirements

## Performance

- Responsive registers with 100k+ documents
- Efficient pagination/filtering
- Background preview generation
- Multipart uploads
- Resumable transfer
- CDN-backed document delivery
- Async AI analysis

## Scale

Target architecture should support projects containing:

- Hundreds of thousands of documents
- Millions of revisions/files
- Millions of relationships
- Large transmittal histories

## Availability

Enterprise-grade service architecture with redundancy, backup, recovery and monitoring.

## Data Integrity

- Hash verification
- Immutable history
- Transactional metadata changes
- Revision consistency

---

# 56. Notifications

Triggers:

- Review assigned
- Review due
- Review overdue
- Document approved
- Document rejected
- Revision received
- Transmittal issued
- Acknowledgement outstanding
- Document impact detected
- Required document missing
- Handover item overdue

Channels:

- In-app
- Email
- Mobile push
- Optional integrations

Avoid excessive notifications. Support digesting and project preferences.

---

# 57. Automation Rules

Example rule engine:

```text
WHEN Document.Type = SHOP_DRAWING
AND Document.Discipline = MEP
AND Status = SUBMITTED
THEN
  Start Workflow = MEP_SHOP_DRAWING_REVIEW
  Assign = MEP_CONSULTANT
  Due = +7 days
```

Another:

```text
WHEN Document.Status becomes AFC
THEN
  Notify linked subcontractors
  Re-evaluate linked schedule constraints
  Re-evaluate pending change events
```

---

# 58. MVP Scope

Do not attempt the entire vision in Release 1.

## MVP — Foundation

Must include:

- Project repository
- Upload/download
- Metadata
- Document register
- Document numbering
- Formal revision model
- Status model
- Basic permissions
- Document viewer
- Search
- Basic AI metadata extraction
- Basic document summary
- Workflow engine
- Review/approval
- Transmittals
- Audit trail
- Relationships API
- Excel export/import
- Bulk document import

This is sufficient to begin replacing spreadsheet registers and simple CDE use cases.

---

# 59. Phase 2 — Intelligence

Add:

- Semantic search
- Ask DocLogix
- Requirement extraction
- Revision comparison
- AI relationship discovery
- Correspondence ingestion
- Package management
- Submittal integration
- RFI integration
- Schedule links
- BOQ links

---

# 60. Phase 3 — Connected Intelligence

Add:

- Document Impact Analysis
- Schedule risk propagation
- Commercial impact suggestions
- Procurement impacts
- Advanced drawing comparison integration
- Compliance Agent
- Handover intelligence
- Knowledge graph visualization

---

# 61. Phase 4 — Enterprise Migration & Ecosystem

Add:

- Dedicated migration connectors
- Enterprise Migration Studio
- Large-scale synchronization
- Advanced records retention
- e-signature integrations
- Extended external APIs
- enterprise analytics
- client-specific CDE profiles

---

# 62. Suggested Engineering Delivery Sequence

Recommended order:

### Sprint Group A — Domain Foundation

- Document entity
- Revision entity
- Metadata engine
- Storage abstraction
- project security
- audit

### Sprint Group B — Core UX

- Document register
- Upload
- viewer
- metadata editor
- revision history
- filters/search

### Sprint Group C — Control

- Numbering engine
- statuses
- workflow
- review actions
- document publishing

### Sprint Group D — Distribution

- transmittals
- acknowledgements
- distribution groups
- notifications

### Sprint Group E — Intelligence

- OCR/parsing
- classification
- metadata extraction
- summary
- semantic indexing

### Sprint Group F — Relationships

- relationship model
- relationship API
- linked objects UI
- module integrations

### Sprint Group G — Advanced Intelligence

- comparison
- requirement extraction
- knowledge graph
- impact engine

### Sprint Group H — Migration

- bulk import
- mapping engine
- dry-run report
- reconciliation
- connector framework

---

# 63. Product Principles

The engineering team should follow these rules consistently.

## Principle 1 — One Master Document

A document is stored once and referenced by other Preckon modules.

## Principle 2 — Revisions Are Immutable Records

Do not overwrite historical controlled revisions.

## Principle 3 — Relationships Over Folders

Folders are useful user views. The project graph is the actual intelligence model.

## Principle 4 — AI Proposes, Humans Govern

AI can identify and recommend. Controlled changes require proper authority.

## Principle 5 — Every AI Answer Has Evidence

No unsupported project answers.

## Principle 6 — Migration Is Product Functionality

Migration cannot be treated as a one-off services script.

## Principle 7 — Desktop and Web Share One Platform

Avoid separate product logic.

## Principle 8 — Preserve Construction Semantics

Generic file-management abstractions must not destroy construction-specific concepts like revisions, suitability, packages and formal issue.

---

# 64. Key Competitive Differentiators

DocLogix should ultimately differentiate through:

1. AI-created document registers.
2. Cross-document requirement extraction.
3. Intelligent revision comparison.
4. Document-to-project-object relationships.
5. Impact analysis across cost, schedule, drawing and procurement.
6. Evidence-backed natural-language project search.
7. Native connection with all Preckon Logix modules.
8. Automated handover completeness.
9. Strong migration tooling.
10. Full project lifecycle from tender through handover.

The deepest differentiator is not any one screen.

It is the **connected project graph** behind the screens.

---

# 65. Example End-to-End Scenario

A consultant uploads `MEP-HVAC-L04-103 Rev C`.

## Step 1 — Intake

DocLogix recognizes:

- Mechanical drawing
- HVAC
- Level 04
- Revision C
- Previous revision B

## Step 2 — Control

Number, status, revision and originator are validated.

## Step 3 — Compare

Revision Agent detects 17 changes.

## Step 4 — Understand

Three equipment changes and one dimensional change are considered meaningful.

## Step 5 — Relationships

DocLogix finds links to:

- RFI-037
- BOQ M-142
- SUB-081
- Activities HVAC-L4-130/140
- PO-183

## Step 6 — Impact

Impact Agent determines the equipment change may affect quantities and procurement.

## Step 7 — Review

Engineer reviews the AI evidence and confirms the impact.

## Step 8 — Actions

Preckon offers:

- Create change event
- Recheck quantity
- Notify procurement
- Notify subcontractor
- Update schedule constraint

## Step 9 — Audit

Every decision and action remains traceable to Revision C.

This is the product experience we are designing toward.

---

# 66. Definition of Success

DocLogix succeeds when a project user can answer:

- What is the current approved document?
- What changed?
- Who approved it?
- Who received it?
- What does it relate to?
- What does it impact?
- What action is required?
- What evidence supports the answer?

without manually searching folders, spreadsheets, emails and separate project systems.

---

# 67. Recommended Next Engineering Documents

This Master Blueprint should lead to the following implementation artifacts:

1. DocLogix Product Requirements Document (PRD)
2. DocLogix Solution Architecture
3. DocLogix Logical and Physical Data Model
4. Document + Revision State Machine Specification
5. Workflow Engine Specification
6. Knowledge Graph Ontology
7. AI Agent & RAG Architecture
8. Search Architecture
9. API / Event Contract Specification
10. Screen & UX Catalogue
11. Migration Framework Specification
12. Security & Permission Model
13. Test Strategy & Acceptance Criteria
14. Phased Sprint Backlog

---

# 68. Final Product Statement

DocLogix should become the **information backbone of Preckon**.

TenderLogix understands what needs to be built.  
DrawLogix understands what is being designed.  
ScheduleLogix understands when it should happen.  
CostLogix understands what it costs.  
Field modules understand what happened on site.  

**DocLogix preserves the information, evidence, approvals, revisions and relationships connecting all of them.**

That is why DocLogix should be implemented as Preckon's Common Data Environment and Project Knowledge Layer—not merely as a Documents module.


---

# ENGINEERING IMPLEMENTATION SUPPLEMENT — PRD / PCM

## A. Engineering Contract

This supplement converts the Master Blueprint into implementation rules. The following are non-negotiable: master documents are referenced rather than copied between modules; formal revision is separate from binary file version; issued revisions are immutable; AI suggestions never silently alter controlled truth; every AI result retains source provenance; authorization is applied before search/AI retrieval; and migration is treated as a first-class product capability.

## B. Epic Backlog

| Epic | Capability | Release |
|---|---|---|
| DLX-100 | Document Hub & Storage | MVP |
| DLX-200 | Intelligent Document Register | MVP |
| DLX-300 | Numbering, Classification & Metadata | MVP |
| DLX-400 | Revision, Status & Suitability | MVP |
| DLX-500 | Review & Approval Workflow | MVP |
| DLX-600 | Transmittals & Distribution | MVP |
| DLX-700 | Correspondence | MVP/1.1 |
| DLX-800 | Viewer, Markup & Compare | MVP |
| DLX-900 | AI Ingestion & Extraction | MVP |
| DLX-1000 | Semantic Search / Ask DocLogix | MVP |
| DLX-1100 | Relationship / Knowledge Graph | MVP |
| DLX-1200 | Revision Intelligence | 1.1 |
| DLX-1300 | Impact Analysis | 1.1 |
| DLX-1400 | Migration Studio | MVP |
| DLX-1500 | Desktop Sync / Offline | 1.1 |
| DLX-1600 | Handover / Record Completion | 2.0 |
| DLX-1700 | Analytics / Compliance | 1.1 |

## C. Core Aggregate Rules

```text
Tenant
 └─ Project
     ├─ Document
     │   └─ Revision
     │       ├─ FileVersion
     │       ├─ MetadataSnapshot
     │       ├─ WorkflowInstance
     │       ├─ ReviewDecision
     │       ├─ Markup
     │       └─ AIArtifact
     ├─ Transmittal
     ├─ Correspondence
     ├─ DocumentPackage
     ├─ DistributionGroup
     ├─ SavedView
     └─ MigrationJob
```

`DocumentId`, `RevisionId`, `FileVersionId` and all audit IDs are immutable internal identifiers. `DocumentNumber` is the governed business identifier. A revision that has been formally issued cannot have its binary or issue-context metadata overwritten. A later correction is a new revision or an explicitly audited privileged correction event.

## D. DLX-100 — Document Hub Acceptance Criteria

- Support drag/drop, bulk and resumable multipart upload.
- Compute SHA-256 for every stored binary and detect duplicates.
- Quarantine uploads until malware/security checks complete.
- Generate previews asynchronously; preview failure must never lose the source file.
- Maintain object-storage abstraction independent of UI.
- Support soft-delete, restore, retention-aware purge and legal hold.
- Audit upload, preview, download, export, delete and restore.
- Metadata/path views may look like folders, but folder path must not be the primary object identity.
- Large-project grids use server-side pagination/filtering and virtualization.

## E. DLX-200 — Register Acceptance Criteria

The register must support configurable columns, server-side filter/sort/group, saved views, bulk actions, permission-controlled export, frozen identity columns and deep links preserving view state. Baseline fields include document number, title, type, discipline, originator, package, location, level, system, revision, revision date, status, suitability, workflow state, response due date, current flag and confidentiality.

AI-assisted registration stores, per field: proposed value, confidence, source evidence and accepted/overridden state. Document number, formal revision and issue status require human confirmation by default in MVP.

## F. DLX-300 — Numbering and Metadata Rules

Numbering schemes are versioned segment definitions. Segment types include fixed, lookup, free text, numeric sequence, date, project code, organization code and derived field. Support validation regex, required/optional segments, delimiters, sequence scopes, reservations, aliases and legacy overrides.

Concurrency tests must prove that two simultaneous requests cannot receive the same governed document number. A numbering-scheme change never mutates historical document numbers.

## G. DLX-400 — Revision State Machine

Do not collapse these dimensions: binary processing state, formal revision, workflow state, document status, suitability/purpose of issue, and current/superseded state.

A previous revision becomes superseded only when the new revision reaches the configured publication/issue condition. Historical transmittals always resolve to the exact revision and file hash originally issued.

## H. DLX-500 — Workflow Engine

Workflow definitions are versioned. Required primitives: start, assign, sequential review, parallel review, conditional branch, approve, approve-with-comments, reject, revise-and-resubmit, acknowledge, delegate, escalate, publish and close.

Each workflow instance snapshots the workflow version, revision under review, required reviewers, quorum/consensus rules and SLA configuration. A later revision cannot silently replace the object being reviewed.

Final decisions record actor, organization, timestamp, decision code, comments and configured signature/evidence. Task transitions must be idempotent and concurrency-safe.

## I. DLX-600 — Transmittal Rules

A sent transmittal is immutable. It contains exact revision references, recipients, purpose, instructions, issue date, response due date and a generated manifest. Resend creates a resend event; it does not modify the original issue. Cancellation/recall is an auditable event and never erases history.

Package manifests contain document number, title, revision, file name and checksum. Delivery, download and acknowledgement evidence must be retained.

## J. DLX-700 — Correspondence

Support letters, notices, instructions, emails, consultant responses, client directives and general correspondence. Correspondence may link to contracts, RFIs, change events, activities, cost items and documents. AI may extract commitments, due dates and action candidates, but users confirm governed commitments.

## K. DLX-800 — Viewer and Markup

The viewer supports PDF, Office preview representations, images and DrawLogix/CAD-BIM handoff. Markup is stored separately from the source binary with page/sheet, geometry, author, timestamp, status and thread. Markup remains anchored to the exact revision reviewed.

MVP comparison supports page/text/overlay comparison where technically supported. Semantic comparison becomes DLX-1200.

## L. DLX-900 — AI Ingestion Pipeline

```text
Upload → Security Scan → Identify → Preview/OCR → Layout Extraction
→ Classification → Metadata Extraction → Chunking → Indexing
→ Entity/Requirement Extraction → Relationship Candidates
→ Confidence/Quality Gate → Publish AI Artifacts
```

Every AI artifact records source revision/hash, model/provider/version, prompt/template version, timestamp, confidence and evidence citations. Low-confidence results must be visibly uncertain and cannot be silently committed as controlled metadata.

## M. DLX-1000 — Ask DocLogix Contract

Retrieval combines exact metadata, full text, semantic retrieval and relationship traversal. Authorization is applied before retrieval/generation. Every substantive answer returns source document, revision, page/sheet and a deep link to evidence when possible.

Representative queries: latest approved HVAC drawing for Level 8; specification defining waterproofing; material approval history; documents required before an activity; documents referencing a BOQ item; and changes between two revisions.

## N. DLX-1100 — Relationship Model

```text
Relationship
- RelationshipId
- ProjectId
- SourceType / SourceId / SourceRevisionId
- TargetType / TargetId / TargetRevisionId
- RelationshipType
- Direction
- Origin: Human | Rule | Import | AI
- Confidence
- Evidence
- Status: Suggested | Confirmed | Rejected
- CreatedBy / CreatedAt
```

AI-created relationships default to Suggested. Deterministic imported/rule-based relationships may be Confirmed according to policy. Supported targets include documents, drawings, specifications, BOQ items, activities, cost items, RFIs, submittals, changes, POs, inspections, NCRs, assets and locations.

## O. DLX-1200 — Revision Intelligence

Revision comparison produces a `ChangeSet` containing typed findings: text, dimensions, notes, drawing objects, equipment, materials, requirements, clauses, quantities, schedule and commercial implications. Each finding contains evidence geometry/text, confidence and review status.

Users can mark findings Confirmed, Not Relevant or False Positive. These decisions become evaluation data for future model quality measurement.

## P. DLX-1300 — Impact Analysis

```text
New Revision → ChangeSet → Relationship Traversal → Candidate Impacts
→ Risk Scoring → Suggested Actions → Human Confirmation → Downstream Workflow
```

DocLogix must never autonomously alter approved schedule or cost baselines. Impact findings remain advisory until accepted. Risk scoring may use change severity, relationship confidence, object criticality, schedule proximity, procurement state and commercial exposure.

## Q. DLX-1400 — Migration Studio

Initial targets: Procore, Autodesk Construction Cloud, Oracle Aconex, SharePoint, OneDrive/network drives and structured CSV/XLSX + file packages.

Migration stages: Connect/Upload → Discover → Profile → Map → Dry Run → Validate → Resolve Exceptions → Import → Reconcile → Sign-off.

Each imported record stores source system, source ID, source revision ID, source checksum, target ID, mapping version, import timestamp and result. Dry-run reports duplicates, invalid codes, missing users, orphan relationships, revision conflicts, unsupported files and metadata loss. Re-running a migration batch must be idempotent.

## R. DLX-1500 — Desktop and Offline

Desktop and browser use the same API/domain services. Desktop adds encrypted local cache, selective sync, resumable transfer, high-performance preview and offline queue. Users choose projects/packages for offline availability. Offline edits are limited to explicitly supported objects; conflicts are surfaced rather than silently resolved.

## S. API Surface

Recommended API groups:

```text
/api/documents
/api/documents/{id}/revisions
/api/revisions/{id}/files
/api/revisions/{id}/metadata
/api/revisions/{id}/relationships
/api/revisions/{id}/compare
/api/workflows
/api/workflow-instances
/api/reviews
/api/transmittals
/api/correspondence
/api/search
/api/ask
/api/relationships
/api/migrations
/api/audit
/api/admin/metadata
/api/admin/numbering
/api/admin/statuses
```

All mutation endpoints use optimistic concurrency (`ETag`/row version) and idempotency keys where retries are expected. External APIs use scoped service principals/OAuth and rate limits.

## T. Domain Events

Publish durable events through an outbox pattern:

- `DocumentCreated`
- `RevisionCreated`
- `RevisionPublished`
- `RevisionSuperseded`
- `DocumentMetadataChanged`
- `WorkflowStarted`
- `ReviewCompleted`
- `TransmittalSent`
- `TransmittalAcknowledged`
- `RelationshipConfirmed`
- `ChangeSetGenerated`
- `ImpactFindingCreated`
- `MigrationBatchCompleted`

Consumers include ScheduleLogix, CostLogix, DrawLogix, TenderLogix, notifications, analytics and AI indexing.

## U. Security and Authorization

Use tenant isolation plus project membership, organization, role, document confidentiality and object-level grants. Permissions include view metadata, preview, download, upload, create revision, edit metadata, issue, approve, transmit, export, administer and audit.

Security requirements: encryption in transit/at rest, malware scanning, secrets manager, signed expiring file URLs, MFA/SSO integration, access audit, export controls, legal hold, retention and configurable external-user restrictions.

AI retrieval must use the same authorization boundary as the normal application.

## V. Audit Model

Audit events are append-only and include event ID, tenant/project, actor, organization, action, object type/id, revision, timestamp, before/after governed values where appropriate, IP/session/device metadata where policy allows, correlation ID and source (UI/API/import/system/AI-assisted).

Audit events cannot be edited by ordinary administrators. Exported audit reports must be reproducible.

## W. Non-Functional Requirements

- Register P95 target under normal load: <2 seconds.
- Metadata/search query P95 target: <2 seconds for standard project scopes.
- Common preview first page target: <3 seconds after preview exists.
- Availability target: 99.9% initially, configurable upward for enterprise tiers.
- Horizontal worker scaling for conversion/OCR/AI/indexing.
- Tenant/project partitioning strategy for large datasets.
- Point-in-time database recovery and versioned object storage.
- RPO/RTO defined per deployment tier.
- WCAG-oriented keyboard/focus/contrast behavior for core workflows.
- Structured telemetry with correlation IDs across upload → processing → AI → workflow.

## X. Screen Catalogue

1. DocLogix Home
2. Document Register
3. Document Detail
4. Three-Panel Viewer
5. Upload / Registration Wizard
6. New Revision Wizard
7. Revision History
8. Compare Revisions
9. Review Inbox
10. Review Workspace
11. Workflow Monitor
12. Transmittal Register
13. Transmittal Composer
14. Transmittal Detail
15. Correspondence Register
16. Correspondence Detail
17. Ask DocLogix
18. Relationship Explorer
19. Impact Center
20. Migration Studio
21. Migration Mapping
22. Migration Exceptions
23. Numbering Configuration
24. Metadata Configuration
25. Workflow Designer
26. Status/Suitability Configuration
27. Distribution Groups
28. Audit Explorer
29. Retention/Legal Hold
30. Desktop Sync Center

## Y. Definition of Done for Every Feature

A feature is not complete until it has: approved UX states; authorization rules; validation; audit events; API contract; database migration; automated unit/integration tests; concurrency/error tests where applicable; accessibility checks; telemetry; documentation; and migration/backward-compatibility consideration.

AI features additionally require an evaluation dataset, confidence behavior, evidence display, model/prompt version logging, failure/fallback behavior and permission-leakage tests.

## Z. Delivery Plan

### Phase 0 — Foundation
Tenant/project security, object storage, upload service, document/revision model, metadata framework, audit/outbox, processing workers and baseline viewer.

### Phase 1 — Sellable CDE MVP
Register, numbering, revision control, statuses/suitability, workflows, reviews, transmittals, full-text search, AI metadata extraction, Ask DocLogix with citations, relationship model and first migration path.

### Phase 2 — Differentiation
Revision Intelligence, Impact Center, semantic relationship discovery, analytics, compliance dashboards, desktop sync/offline and additional migration connectors.

### Phase 3 — Lifecycle Intelligence
Handover completeness, O&M/asset records, deeper DrawLogix/ScheduleLogix/CostLogix automation, owner/operations transition and predictive project information risk.

## AA. Recommended Initial Sprint Sequence

**Sprint 0:** architecture, schemas, ADRs, CI/CD, storage spike, security model.  
**Sprint 1:** Document/Revision/File aggregates, upload, checksum, audit.  
**Sprint 2:** metadata framework, register grid, search baseline.  
**Sprint 3:** numbering, status/suitability, revision creation/locking.  
**Sprint 4:** workflow engine and review inbox.  
**Sprint 5:** viewer markup and review workspace.  
**Sprint 6:** transmittals, manifests, acknowledgement.  
**Sprint 7:** AI extraction/indexing and evidence model.  
**Sprint 8:** Ask DocLogix and permission-aware retrieval.  
**Sprint 9:** relationship graph and cross-module APIs/events.  
**Sprint 10:** Migration Studio MVP and reconciliation.  
**Sprint 11:** hardening, performance, security, UAT and pilot migration.

## AB. MVP Release Gate

Do not call DocLogix MVP complete unless a pilot project can be migrated, users can find the authoritative current revision, a controlled review can be completed, an immutable transmittal can be issued and acknowledged, AI search can answer with source evidence, and the audit trail can reconstruct who uploaded/revised/reviewed/issued/accessed the information.

---

# END — DOCLOGIX ENGINEERING PRD / PCM v1.0

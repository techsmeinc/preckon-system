# Preckon DrawLogix — Studio + Web Architecture & UX Design
## Version 1.0 — Client Architecture Baseline

**Product:** Preckon  
**Module:** DrawLogix  
**Scope:** Downloadable desktop application + browser-based application  
**Parent artifacts:** Preckon Complete Platform Blueprint v1.1, PCM Engineering Blueprint v1.1, DrawLogix Complete Blueprint v1.0  
**Audience:** Product, Architecture, UX, CAD/BIM Engineering, Platform Engineering, AI/ML, QA, DevOps, Security

---

# 1. Executive Decision

DrawLogix will support two first-class client experiences:

1. **DrawLogix Studio** — downloadable desktop engineering application
2. **DrawLogix Web** — browser-based project, review, collaboration and progressive-authoring application

A third experience, **DrawLogix Field**, is reserved for later mobile/tablet delivery.

The architecture must enforce one principle:

> **One Preckon platform. Multiple optimized clients. One PCM.**

Studio and Web must never evolve into two disconnected products or two incompatible model formats.

The desktop application is the preferred environment for heavy design/BIM production because it can provide superior GPU access, memory control, filesystem integration, multi-monitor usability, keyboard workflows, offline capability and large-model responsiveness.

The browser experience remains essential because most project participants should be able to access DrawLogix instantly without installing engineering software.

---

# 2. Product Positioning

## 2.1 DrawLogix Studio

Primary purpose:

> Professional design, BIM authoring, coordination and intensive engineering work.

Primary users:

- architects
- BIM modelers
- CAD technicians
- structural engineers
- MEP engineers
- design engineers
- BIM coordinators
- advanced quantity/coordination users

Studio should feel like a serious engineering workstation rather than a web page placed inside a desktop wrapper.

## 2.2 DrawLogix Web

Primary purpose:

> Universal access to the same project model for viewing, review, collaboration, AI analysis, quantities and progressive editing.

Primary users:

- project managers
- estimators
- quantity surveyors
- commercial teams
- consultants
- clients
- procurement
- design reviewers
- site/project engineers

## 2.3 DrawLogix Field — Future

Primary purpose:

> Site execution, redlines, installation tracking, inspection, photos and field validation.

This client is not part of the initial implementation but the shared platform architecture must leave room for it.

---

# 3. Functional Allocation

| Capability | Studio | Web |
|---|---|---|
| Large BIM models | Primary | View / progressive edit |
| Complex 2D drafting | Full | Moderate |
| 3D/BIM authoring | Full | Progressive |
| Parametric regeneration | Local + cloud | Cloud |
| DWG/DXF processing | Full/local-assisted | Server-assisted |
| IFC import/export | Full | Server-assisted |
| Large PDF sets | Full | Full viewing |
| AI Copilot | Full | Full |
| Quantity | Full | Full |
| BOQ visibility | Full | Full |
| Model review | Full | Primary |
| Markup/comments | Full | Primary |
| Approvals | Full | Primary |
| RFIs/submittals | Integrated | Primary |
| Offline work | Full working-package mode | Limited |
| Multi-monitor workflows | Excellent | Browser-dependent |
| GPU acceleration | Maximum available | Browser/WebGPU-dependent |
| Filesystem integration | Native | Limited |
| Local plugins/connectors | Supported | Restricted |
| Field/site accessibility | Limited | Strong |
| Installation required | Yes | No |

---

# 4. Shared Platform Architecture

```text
                        PRECKON CLOUD
+-------------------------------------------------------------------+
| PCM Platform                                                       |
| Project / Identity / Permissions / Audit                           |
| Object Model / Relationships / Requirements / Revisions            |
| Quantity / BOQ / Cost / TenderLogix / Delivery integrations        |
| AI Agent Services / Knowledge Graph / Event Infrastructure         |
+-------------------------------+-----------------------------------+
                                |
                       PCM APIs + Event Sync
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
+-----------------------------+       +-----------------------------+
| DrawLogix Studio            |       | DrawLogix Web               |
| Downloadable desktop        |       | Browser                     |
|                             |       |                             |
| Shared DrawLogix Core       |       | Shared DrawLogix Core       |
| Native Geometry Runtime     |       | Web Geometry Runtime        |
| Local PCM Cache             |       | Browser/Edge Cache          |
| GPU Renderer                |       | WebGPU/WebGL Renderer       |
| File System Integration     |       | Server File Services        |
| Offline Sync Engine         |       | Online-first Sync           |
+-----------------------------+       +-----------------------------+
```

No client owns the canonical project state.

**Canonical state = PCM.**

Clients may hold optimized local representations and working caches.

---

# 5. Shared DrawLogix Core

The following behavior should be shared by Studio and Web whenever technically possible:

- PCM SDK
- domain object contracts
- command schemas
- validation contracts
- object selection/query model
- permission model
- AI tool contracts
- quantity invalidation rules
- revision metadata
- ChangeSet model
- event schemas
- object property editors
- issue/comment models
- design-review components
- reusable UI design system
- semantic shortcuts/actions
- telemetry contracts

Shared code does not mean every runtime component must be written in the same language.

Performance-critical geometry/rendering layers may have native and web implementations behind common contracts.

---

# 6. DrawLogix Studio — Target Architecture

```text
+------------------------------------------------------------------+
|                        DRAWLOGIX STUDIO                           |
+------------------------------------------------------------------+
| Desktop Shell / Window Manager                                   |
| Project Navigator | Canvas | Properties | AI | Quantity | Issues  |
+------------------------------------------------------------------+
| Shared Application Layer                                         |
| Commands | Selection | Undo/Redo | Validation | Tools | Context  |
+------------------------------------------------------------------+
| Native Geometry / BIM Runtime                                    |
| 2D Kernel | 3D Kernel | Parametrics | Tessellation | Constraints |
+------------------------------------------------------------------+
| Native Rendering Runtime                                         |
| GPU Scene | Picking | LOD | Sections | Overlays | Annotation     |
+------------------------------------------------------------------+
| Local Working Model                                              |
| PCM Cache | Geometry Cache | File Cache | Search Cache            |
+------------------------------------------------------------------+
| Sync / Collaboration Runtime                                     |
| ChangeSets | Event Sync | Presence | Conflict Handling            |
+------------------------------------------------------------------+
| Cloud Connectors                                                 |
| PCM APIs | AI Services | Quantity | BOQ | Tender | Documents      |
+------------------------------------------------------------------+
```

---

# 7. DrawLogix Studio — UX Design

## 7.1 Main Layout

```text
+----------------------------------------------------------------------------------+
| PRECKON  DrawLogix Studio | Project | Save/Sync | Rev | Discipline | Publish     |
+--------------------+------------------------------------------+-------------------+
| PROJECT NAVIGATOR  |                                          | AI COPILOT        |
|                    |                                          |                   |
| Project            |                                          | Ask about model   |
|  > Site            |                                          | Suggested actions |
|  > Buildings       |             MAIN CANVAS                  | Validations       |
|  > Levels          |                                          | Change impact     |
|  > Views           |          2D / 3D / BIM / PDF             |                   |
|  > Sheets          |                                          | Preview           |
|  > Models          |                                          | Apply             |
|  > Components      |                                          |                   |
|  > Issues          |                                          |                   |
+--------------------+------------------------------------------+-------------------+
| Properties | Layers | Constraints | Quantities | BOQ | Links | History | Issues |
+----------------------------------------------------------------------------------+
| Status: Synced | Local Cache: Healthy | GPU: Active | PCM Rev 0148               |
+----------------------------------------------------------------------------------+
```

## 7.2 Multi-Monitor Mode

Recommended support:

- Monitor 1: design canvas
- Monitor 2: properties + AI + quantity/BOQ
- Monitor 3: sheet/reference/document viewer

Panels should be detachable and dockable.

## 7.3 Core Interaction Patterns

### Mouse
- click select
- shift multi-select
- drag marquee
- middle-button pan
- wheel zoom
- orbit in 3D
- drag grips/handles
- context menu

### Keyboard
Support user-configurable shortcuts and command palette.

Examples:
- `W` wall
- `D` door
- `M` move
- `RO` rotate
- `DI` dimension
- `/` AI command palette
- `Ctrl+Z` undo
- `Ctrl+Shift+Z` redo
- `F` focus selection
- `Esc` cancel

Do not reproduce legacy CAD command syntax merely for imitation, but allow familiar aliases where useful.

## 7.4 Command Palette

```text
[ Search commands, objects, sheets, AI actions... ]

> Create Wall
> Create Door
> Open Level 03
> Show all fire-rated doors
> Compare Rev 147 vs 148
> Ask AI...
```

The command palette should merge deterministic application commands and AI-assisted intent.

---

# 8. Studio — Local Working Model

Studio requires a local working representation for responsive operation.

Recommended logical stores:

```text
Local Project Workspace
|
+-- Project Manifest
+-- PCM Working Cache
+-- Geometry Cache
+-- Tessellation Cache
+-- Drawing Files
+-- Imported References
+-- Thumbnail Cache
+-- Search Index
+-- Pending ChangeSets
+-- Offline Event Queue
```

An embedded transactional database may be used for local metadata, but the specific technology should be selected after benchmarking.

The local cache is **not canonical**.

---

# 9. Studio — Offline Mode

## 9.1 Working Package

Users may explicitly download a working package.

```text
Open Project
    ↓
Select Offline Package
    ↓
Levels / Models / Sheets / Documents downloaded
    ↓
Local PCM snapshot established
    ↓
Work offline
    ↓
Pending ChangeSets stored locally
    ↓
Connection restored
    ↓
Fetch server revisions
    ↓
Conflict analysis
    ↓
Rebase / Resolve / Merge
    ↓
Commit to PCM
```

## 9.2 Offline Rules

While offline:

- geometry edits may continue
- local validation may continue
- cached specifications/requirements may be used
- AI cloud features may be unavailable or degraded
- server-dependent quantity/cost services show stale/offline state
- publishing an official revision is blocked unless policy allows local provisional issue
- external approvals are blocked

The UI must clearly distinguish:

**Local**, **Pending Sync**, **Conflict**, **Server Current**, **Stale**.

---

# 10. Studio — Rendering Strategy

The desktop client should use a native or high-performance GPU rendering runtime.

Required capabilities:

- very large object counts
- view frustum culling
- occlusion optimization
- level-of-detail
- geometry instancing
- object picking
- outlines/highlights
- transparency
- clipping planes
- sections
- exploded views later
- 2D overlays
- annotations
- comparison overlays
- issue markers

Model navigation should remain smooth while non-visible data is lazily loaded.

---

# 11. Studio — File Integration

Native integrations should support:

- drag/drop drawings
- OS file picker
- watch/import folders
- local export
- open referenced documents
- link external models
- temporary conversion workspace
- file checksum and source tracking

Imported source files must remain immutable or versioned once used as provenance for published project state.

---

# 12. Studio — AI Execution Design

```text
User Prompt
   ↓
Context Builder
   ↓
Preckon AI Cloud
   ↓
Structured Tool Plan
   ↓
Studio validates permissions/context
   ↓
Native DrawLogix command execution
   ↓
Geometry recalculation locally
   ↓
Preview shown instantly
   ↓
User accepts
   ↓
ChangeSet committed/synchronized
```

This gives AI cloud reasoning while preserving local execution speed.

Example:

> “Change all Level 4 corridor walls to approved acoustic partition.”

AI returns a typed selection + `ChangeType` command plan.

Studio performs geometry regeneration locally and shows the model diff before commit.

---

# 13. DrawLogix Web — Target Architecture

```text
+------------------------------------------------------------------+
|                         DRAWLOGIX WEB                             |
+------------------------------------------------------------------+
| Browser Application                                              |
| Navigator | Canvas | Review | AI | Quantity | Issues | Sheets    |
+------------------------------------------------------------------+
| Shared DrawLogix Application Layer                               |
| Commands | Selection | Validation UI | Review | Collaboration    |
+------------------------------------------------------------------+
| Web Geometry Runtime                                             |
| WebGPU/WebGL | Streaming Scene | Picking | LOD | Overlays         |
+------------------------------------------------------------------+
| Browser/Edge Cache                                               |
| Metadata | View State | Recently Used Geometry | Thumbnails       |
+------------------------------------------------------------------+
| Cloud Execution                                                  |
| Heavy Geometry | Conversion | Recognition | Clash | Export         |
+------------------------------------------------------------------+
| PCM / Preckon APIs                                               |
+------------------------------------------------------------------+
```

Web is online-first.

---

# 14. DrawLogix Web — UX Design

## 14.1 Main Layout

```text
+----------------------------------------------------------------------------------+
| PRECKON | DrawLogix Web | Project | Dashboard | Draw | Quantity | Documents      |
+--------------------+------------------------------------------+-------------------+
| PROJECT            |                                          | CONTEXT / AI      |
| Drawings           |                                          |                   |
| Models             |             WEB CANVAS                   | Object details    |
| Levels             |                                          | AI questions      |
| Sheets             |        2D / 3D / PDF / BIM VIEW          | Issues            |
| Revisions          |                                          | Review             |
| Issues             |                                          | Impact             |
+--------------------+------------------------------------------+-------------------+
| Markup | Compare | Quantity | BOQ | Comments | Links | History                    |
+----------------------------------------------------------------------------------+
```

The browser should have fewer permanent engineering controls than Studio.

Priority: clarity, review and rapid project access.

## 14.2 Web Primary Workflows

1. open current coordinated model
2. inspect object
3. ask AI about object/model
4. review quantity/BOQ relationship
5. compare revisions
6. markup/comment
7. create issue
8. approve/reject review package
9. make light semantic edit
10. publish review feedback

---

# 15. Web — Progressive Authoring

## Phase 1
- model/drawing viewer
- properties
- markups
- comments
- AI query
- revision compare
- quantities
- issue workflows

## Phase 2
- move object
- change object type
- edit properties
- add basic wall/opening
- annotations
- dimensions
- simple sheet edits

## Phase 3
- broader BIM authoring
- parametric modifications
- component placement
- browser-based drafting

Complex operations may remain server-assisted.

---

# 16. Web Rendering

Use the strongest browser-supported GPU path practical, with graceful fallback.

Capabilities:

- scene streaming
- geometry tiling
- level-of-detail
- instancing
- selection/picking
- clipping/sections
- markup overlays
- revision overlays
- measurement
- issue pins

Do not force the browser to download an entire federated project before displaying useful content.

---

# 17. Web Cloud Execution

Heavy operations should run in cloud workers/services:

- DWG/DXF conversion
- IFC processing
- drawing recognition
- heavy parametric regeneration
- clash detection
- large export
- sheet package generation
- batch quantity recalculation
- advanced optimization

Web submits a job and receives progressive status/results.

---

# 18. Studio vs Web Synchronization

Both use the same revision semantics.

```text
Studio User edits model
        ↓
ChangeSet committed
        ↓
PCM revision 149
        ↓
Domain events emitted
        ↓
Web client receives revision notification
        ↓
Affected scene/object chunks refreshed
        ↓
Web user sees Rev 149
```

Reverse direction:

```text
Web reviewer changes approved property
        ↓
ChangeSet
        ↓
PCM revision 150
        ↓
Studio receives event
        ↓
Local workspace checks active changes
        ↓
Auto-apply or conflict notification
```

---

# 19. Conflict Handling

Conflicts should operate at semantic object/property level wherever possible.

Examples:

- different users changed different objects → auto-merge
- same object, different properties → potentially auto-merge
- same property modified differently → explicit conflict
- geometry/topology change vs hosted object change → dependency conflict
- deleted object vs modified object → blocking conflict

Conflict UI should explain meaning, not just display JSON diffs.

```text
Wall W-204

Your local change:
Type = Acoustic 150

Server change:
Wall deleted in Rev 152

[Keep deletion] [Restore wall with your change] [Inspect revisions]
```

---

# 20. Identity, Permissions and Licensing

One account should work across Studio and Web.

Permission checks must occur server-side even when Studio caches permissions locally.

Example roles:

- Viewer
- Reviewer
- Editor
- BIM Author
- Discipline Lead
- Design Manager
- Publisher
- Project Admin

License policy may distinguish Studio authoring seats from universal Web collaboration access, but the architecture must not embed commercial assumptions into the domain model.

---

# 21. Publishing Model

Editing and publishing are separate actions.

```text
Working Changes
    ↓
Validated Revision Candidate
    ↓
Review
    ↓
Approved
    ↓
Published Revision
    ↓
Issued Drawing / Model Package
```

Studio may create revisions rapidly, while published issue packages follow project governance.

Web reviewers should participate directly in review/approval.

---

# 22. Document & Sheet Delivery

Both clients should display:

- latest published revision
- current working revision where authorized
- previous revisions
- issue history
- revision clouds
- approval state

Exports:

- PDF sheet sets
- IFC
- supported DWG/DXF outputs
- schedules
- quantity reports
- model review packages

---

# 23. Browser and Desktop AI UX

AI must be contextual to the model.

Instead of a generic chatbot:

```text
Selected:
Wall W-304
Level 03
Office Corridor

Ask AI:
"Why is this wall flagged?"

AI:
"The tender requirement TR-118 requires corridor partitions
to achieve the approved acoustic rating. W-304 is assigned
WT-GYP-100, which does not satisfy the project's mapped rule.

Suggested action:
Change to WT-ACOUSTIC-150

Affected:
12.8 m² quantity
BOQ item 09-2216
1 shop drawing

[Preview Change]
```

Studio can execute geometry locally; Web may invoke cloud execution.

---

# 24. Shared Design System

Studio and Web should share:

- typography
- icons
- object colors/themes
- panel patterns
- property editors
- status indicators
- issue cards
- approval controls
- AI suggestion cards
- diff visualization
- terminology

Studio may use denser layouts and richer menus. Web should prioritize simplicity.

---

# 25. Client Packaging

## Studio

Target packaging should eventually include:

- Windows installer first
- signed application packages
- auto-update
- enterprise update channels
- rollback capability
- crash reporting
- optional offline package storage
- managed deployment support

macOS support should be evaluated based on target design-user demand and geometry/runtime technology.

## Web

- standard Preckon SaaS deployment
- CDN/edge delivery
- progressive loading
- supported modern browsers
- WebGPU capability detection
- fallback renderer where practical

---

# 26. Desktop Technology Evaluation

Before locking implementation, benchmark at least these patterns:

### Option A — Native shell + web UI + native geometry
Advantages:
- UI reuse
- fast product iteration
- native performance where needed

### Option B — Fully native desktop UI
Advantages:
- maximum control/performance
- strong workstation UX
Disadvantages:
- lower Web UI reuse
- larger engineering burden

### Option C — Desktop wrapper around mostly web runtime
Advantages:
- fastest shared UI
Disadvantages:
- risk of turning Studio into a browser with an installer
- weaker large-model/native integration if poorly architected

**Recommended direction:** Option A.

The architecture decision should be validated with a prototype containing a real representative model—not with a hello-world benchmark.

---

# 27. Geometry Kernel Decision

The team must explicitly evaluate:

- kernel licensing
- B-rep/solid support
- booleans
- tessellation quality
- geometry robustness
- parametric integration
- IFC/DWG interoperability compatibility
- Windows/macOS/browser constraints
- server-side execution
- long-term cost

The kernel is a foundational ADR and should not be chosen simply based on developer familiarity.

---

# 28. Local Cache & Sync Requirements

Minimum synchronization metadata:

```text
Workspace
  projectId
  serverBaseRevision
  localHeadRevision
  synchronizedAt
  cachedObjectRanges
  cachedDocuments
  pendingChangeSets[]
  pendingUploads[]
  conflicts[]
  offlinePackageVersion
```

Use incremental synchronization rather than full model replacement whenever feasible.

---

# 29. Event Model

Relevant client events:

- ProjectRevisionAvailable
- ObjectChanged
- ObjectDeleted
- ValidationResultChanged
- QuantityRecalculated
- BOQImpactUpdated
- IssueCreated
- CommentAdded
- ReviewRequested
- ApprovalChanged
- SheetPublished
- ImportCompleted
- ConflictDetected

Studio should consume events through the sync runtime. Web can use realtime connections plus REST/query fallback.

---

# 30. Security

Desktop-specific:

- signed binaries
- secure update chain
- protected local credentials/tokens
- encrypted sensitive cache where required
- workspace access controls
- malware-safe file imports
- enterprise device policy compatibility

Web-specific:

- strong browser session controls
- CSP and secure headers
- sandboxed file processing
- signed upload URLs
- server-side authorization
- protection against untrusted model/document content

Both:
- audit every material state change
- enforce tenant/project isolation
- AI tools must honor user permissions
- publishing requires explicit authorization

---

# 31. Performance Design Targets

## Studio
- continuous smooth navigation on representative production models
- immediate visual response for local selection
- common geometry edit preview target under 1 second
- ordinary PCM commit target p95 under 2 seconds excluding heavy remote processing
- incremental regeneration
- no whole-model reload for routine edit

## Web
- meaningful initial view before whole-project download
- progressive scene loading
- responsive review/markup interaction
- server-assisted heavy operations
- geometry chunk refresh after revisions

Targets must be proven using actual AIGCC-style projects.

---

# 32. Failure Modes

Both clients must handle:

- network loss
- cloud service unavailable
- AI unavailable
- partial model download
- corrupted imported file
- geometry command failure
- revision conflict
- stale quantity
- stale BOQ impact
- export failure
- permission changed during session

Never leave a project in an ambiguous partially committed state.

---

# 33. Telemetry & Observability

Track:

- model open time
- time-to-first-render
- FPS/navigation quality bands
- geometry command duration
- local regeneration duration
- sync latency
- conflict frequency
- AI tool success/failure
- import fidelity issues
- crash rate
- memory/GPU usage bands
- browser capability
- quantity update latency
- publish duration

Telemetry must respect organizational privacy policies.

---

# 34. Testing Matrix

## Shared
- PCM contract
- ChangeSets
- permission rules
- quantity invalidation
- revision semantics
- AI tool contracts

## Studio
- installer/update
- filesystem
- offline packages
- GPU rendering
- local cache recovery
- sync/rebase
- multi-monitor
- large model memory
- crash recovery

## Web
- browser compatibility
- WebGPU/WebGL fallback
- streaming
- cloud jobs
- realtime events
- reconnect behavior

## Cross-client
A revision created in Studio must render identically in Web at the semantic model level, and vice versa.

---

# 35. Implementation Roadmap

## Phase A — Shared Foundation
- PCM SDK
- command schemas
- revision/ChangeSet contracts
- object/property UI primitives
- identity/permissions
- event contracts

## Phase B — Studio Technical Spike
- desktop shell
- native geometry prototype
- GPU canvas
- local cache
- open representative PDF/DWG/IFC
- create/edit wall
- commit to PCM

## Phase C — Web Viewer
- model streaming
- PDF/model viewer
- object selection
- properties
- comments/issues
- AI contextual query

## Phase D — Sync
- Studio local workspace
- incremental model sync
- event update
- conflict proof-of-concept
- offline working package

## Phase E — Shared AI Tools
- semantic selection
- typed command plan
- preview
- impact explanation
- Studio local execution
- Web cloud execution

## Phase F — Web Light Editing
- properties
- move/change type
- wall/opening
- annotation
- simple dimensions

## Phase G — Production Hardening
- installers
- auto-update
- security
- telemetry
- recovery
- performance benchmark
- enterprise deployment

---

# 36. First UX Prototype Set

The product design team should create these first:

## Studio
1. Project open/home
2. Main 2D workspace
3. Main 3D workspace
4. Object properties
5. AI contextual panel
6. Change preview
7. Revision compare
8. Quantity/BOQ impact
9. Offline/sync state
10. Conflict resolution
11. Sheet/document workspace
12. Import/recognition verification

## Web
1. Project dashboard
2. Drawing/model viewer
3. Object detail
4. AI contextual panel
5. Revision compare
6. Markup/comment
7. Issue creation
8. Review/approval
9. Quantity/BOQ view
10. Light edit
11. Sheet viewer
12. Cloud-job progress

---

# 37. Studio Reference Workflow

```text
Architect opens DrawLogix Studio
 ↓
Project loads from local cache
 ↓
Server revision check
 ↓
Level 04 opened
 ↓
Architect selects corridor walls
 ↓
AI: "Change to approved acoustic partition"
 ↓
AI returns semantic selection + typed ChangeType command
 ↓
Native geometry runtime previews result
 ↓
Validation runs
 ↓
Quantity impact estimated
 ↓
Architect commits
 ↓
Local revision created
 ↓
PCM synchronization
 ↓
Server revision published to collaborators
 ↓
Web project manager receives updated model
```

---

# 38. Web Reference Workflow

```text
Project Manager opens Preckon Web
 ↓
Latest coordinated model streams immediately
 ↓
Selects modified wall
 ↓
Sees revision + requirement + quantity + BOQ link
 ↓
Opens comparison
 ↓
Adds review comment
 ↓
Assigns issue to design manager
 ↓
Studio receives issue event
 ↓
Designer resolves
 ↓
Web reviewer approves
```

---

# 39. North-Star Client Architecture

```text
                        PRECKON
                           |
                           v
                          PCM
                           |
       +-------------------+-------------------+
       |                   |                   |
       v                   v                   v
DrawLogix Studio      DrawLogix Web      DrawLogix Field
Engineering           Universal Access    Site Execution
Design/BIM            Review/Commercial   Inspect/Install
Coordination          AI/Collaboration    Redline/Capture
       |                   |                   |
       +-------------------+-------------------+
                           |
                    Same Project Truth
```

---

# 40. Architecture Decision Summary

**Decision 1:** Desktop is a first-class engineering client, not merely an optional wrapper.

**Decision 2:** Web is a first-class project client, not merely a read-only viewer.

**Decision 3:** PCM remains canonical.

**Decision 4:** Studio owns local responsiveness, not canonical state.

**Decision 5:** Studio and Web share domain contracts, commands, AI tools and design language.

**Decision 6:** Performance-sensitive geometry/rendering may use different runtimes behind common interfaces.

**Decision 7:** AI cloud reasoning and local deterministic execution should coexist.

**Decision 8:** Offline capability is a Studio feature from the architecture level, even if implemented after initial online MVP.

**Decision 9:** Heavy Web operations are cloud/server-assisted.

**Decision 10:** DrawLogix Field is a planned third client so today's architecture must not block mobile/site workflows.

---

# 41. Engineering Definition of Done

The Studio + Web architecture is successful when:

- one project can be opened by both clients
- both display the same authoritative PCM state
- Studio can work responsively on realistic models
- Web can stream and review the model without full download
- a Studio edit becomes a PCM revision and appears in Web
- a Web-authorized edit appears in Studio
- AI uses the same typed tool contracts in both clients
- Studio supports disconnected working packages without corrupting canonical state
- semantic conflicts are detectable/resolvable
- quantities and downstream impacts trace back to design objects
- publishing remains governed
- the application clearly communicates stale, local, synced and published states

---

# 42. Final Product Principle

> **DrawLogix Studio is where professionals build.**  
> **DrawLogix Web is where the project collaborates.**  
> **PCM is where the project becomes one connected source of truth.**

This architecture preserves Preckon's original end-to-end vision while giving DrawLogix the workstation-class experience required to become a credible alternative to fragmented CAD/BIM + AI + construction workflows.

---

**End of Preckon DrawLogix Studio + Web Architecture & UX Design v1.0**

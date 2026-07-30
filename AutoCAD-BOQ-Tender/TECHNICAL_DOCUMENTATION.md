# DrawLogix / TenderLogix — Technical Documentation

Developer reference for the platform: architecture, data models, algorithms, the API surface, and how to extend it.

- **Audience:** engineers working on the codebase.
- **Scope:** the whole monorepo, with depth on **DrawLogix** (drawings + BIM), which is where the recent work lives.
- **Companion docs:** `USER_GUIDE.md` (plain English), `PROJECT_DOCUMENTATION.md` (capabilities overview).

---

## 1. Services, ports, and repository layout

```
AutoCAD-BOQ-Tender/                 pnpm monorepo (TypeScript)
├─ artifacts/boq-platform/          Portal SPA — Vite + React        :5173
│   └─ vite.config.ts               proxies /drawlogix→:3001, /api→:5000; base=BASE_PATH
├─ artifacts/api-server/            Express API                       :5000
│   └─ src/routes/                  boq.ts, multi-agent-boq.ts, documents.ts …
├─ lib/db/                          Drizzle schema + CPM/calendar engines (MySQL/MariaDB)
├─ services/cad-extractor/          Python FastAPI + ezdxf sidecar
│   └─ app.py, extractor.py, editor.py, document_extractor.py, pdf_extractor.py
├─ DrawLogix/                       Next.js 15 app  basePath /drawlogix   :3001
│   ├─ app/                         routes: /(editor), /projects, /projects/[id], /studio
│   │   └─ _components/             dxf-editor, cad-viewport, project-workspace,
│   │                               bim-studio, bim-viewport, bim-plan, projects-home
│   ├─ src/ai/                      agent.ts (architect), dxf-copilot.ts, model.ts
│   ├─ src/bim/                     model.ts (+CATALOG), commands.ts, agent.ts, agents.ts
│   ├─ src/domain/                  drafting.ts, floorplan.ts, concept.ts, freeform.ts,
│   │                               dxf-model.ts, ifc.ts, cad-export.ts, persist.ts, …
│   ├─ src/db/                      schema.ts (Drizzle), client.ts, tenant.ts
│   ├─ src/server/actions.ts        all server actions (the app's API surface)
│   └─ tools/compose_cad.py         ezdxf → professional DXF → DWG (ODA)
├─ start-servers.bat                one-click launcher (DrawLogix + portal)
```

**Ports / env:** DrawLogix `:3001` (Next, basePath `/drawlogix`), portal `:5173` (needs `PORT`, `BASE_PATH`), API `:5000`, Python sidecar (FastAPI). DrawLogix reads `DATABASE_URL`, `ANTHROPIC_API_KEY`, optional `OPENAI_API_KEY`, `DRAWLOGIX_ODA`, `DRAWLOGIX_MODEL` from `DrawLogix/.env.local`.

---

## 2. Runtime architecture

The portal is the single origin the user hits. It **iframes** DrawLogix and **proxies** two prefixes:

```
Browser ── :5173 (portal, Vite)
             ├─ /api/*        → :5000  (Express API: BOQ, documents, CAD)
             └─ /drawlogix/*  → :3001  (Next.js DrawLogix, iframed in the DrawLogix tab)
                                   └─ shares the same MariaDB as the platform
```

- **CSRF note:** Next Server Actions check the request `Origin` against `next.config.ts → experimental.serverActions.allowedOrigins`. The portal origin (`localhost:5173`, `127.0.0.1:5173`, the VPS host, or `DRAWLOGIX_ALLOWED_ORIGINS`) must be listed or actions fail with "Invalid Server Actions request".
- **Production vs dev:** run DrawLogix with `next start` (production). `next dev` compiles Server Actions on demand, so the first call after a route compiles can throw *"An unexpected response was received from the server"* — the client wraps action calls in a small **retry** helper to absorb that and transient network blips.

---

## 3. DrawLogix drawing engine (2D)

### 3.1 The editable DXF model — `src/domain/dxf-model.ts`
The in-memory, framework-free model used by the CAD editor and the copilot.

```ts
type Entity =
  | { kind:"line"; layer; x1,y1,x2,y2; id? }
  | { kind:"poly"; layer; pts:{x,y}[]; closed; id? }
  | { kind:"text"; layer; text; x,y,h; id? }
interface DxfModel { layers: {name,aci,visible}[]; entities: Entity[]; insunits: number }
```

Key functions:
- `parseToModel(dxfParserResult)` — converts a `dxf-parser` result to a `DxfModel`; skips 3D/mesh polylines, cleans MTEXT formatting codes, de-dupes coincident labels.
- `serializeModel(m)` — writes a clean **R12 DXF** string (LAYER table + LINE/POLYLINE/TEXT).
- `modelToSvg(m)` — a **faithful** entity→SVG renderer (ACI colours, Y-flipped) used to persist copilot geometry edits without re-wrapping in a sheet.
- `applyOp(m, op)` — applies one copilot **EditOp** (see 3.4).
- `buildSummary(m)` — a compact model summary (layers, texts, per-entity `{kind,layer,cx,cy,w,h}`, bounds, insunits) sent to the copilot so it can target specific entities.

### 3.2 Floor-plan solver — `src/domain/floorplan.ts`
`solveFloorPlan(program, envelope?)` turns a **room programme** (rooms with area, kind, count, en-suite, adjacency) into real geometry: a **double-loaded corridor** plan — a central circulation spine with rooms on both sides, vestibules at the ends, repeated rooms expanded, en-suites nested, exterior walls vs partitions, doors to the corridor, windows on external walls. Areas are preserved (footprint ≈ programme m²), so dimensions are truthful. `resolvePlan(rows)` derives doors/windows/extents for rendering.

### 3.3 The drafting engine — `src/domain/drafting.ts`
One drawing routine emits to two "pens" (a `Pen` interface with `line/pline/circle/fill/text`): a **DXF pen** (R12) and an **SVG pen** (metres→px, Y-flip). This guarantees the DXF and the on-screen SVG always match.

Produces AutoCAD-grade sheets:
- Double-line **walls** with real thickness; room polylines on `A-AREA`.
- **Dimension chains** on both axes (per-bay + overall) drawn as graphics (extension lines, arch ticks, mm text).
- **Column grid** with A/B/C·1/2/3 bubbles; room/door/window tags.
- **North arrow**, adaptive **scale bar** (`niceStep`), **title block**, per-storey **level labels**, and a **stacking diagram** for multi-storey.
- `buildProjectDxf/Svg(floors, construction, name)` for floor plans; `buildFreeformSheetDxf/Svg(model, name, con)` gives the same sheet furniture to freeform/site drawings (`composeFreeformSheet` strips old furniture on `A-TTLB`/`A-GRID`, redraws, auto-dimensions the overall extents, and bumps tiny text to ~1% of span so labels stay legible at site scale).
- `Construction = { extWallMm, intWallMm, floorToFloorM, storeys, unit }`. Persisted on the drawing by encoding a `cfg:{json}` sentinel in the `traceability` column (no schema change); `ScheduleRow.floor?` groups multi-storey.

### 3.4 The DXF edit copilot — `src/ai/dxf-copilot.ts` + `applyOp`
`editDxf(summary, instruction, attachments)` → `{ reply, operations: EditOp[] }`. Claude is forced to call `apply_edits`; the client applies the ops deterministically with `applyOp`. Op set (add **anything**, remove **anything**):
`rename_layer, set_layer_color, hide/show/delete_layer, replace_text, delete_text, add_text, add_rectangle, add_line, add_circle, move, scale, delete_region{x,y,x2,y2}, …`. Because the summary carries per-entity **extents** (`w,h`), the model can delete a whole named room (outline poly + walls + labels) via a correctly-sized `delete_region`, not just the text label.

### 3.5 Concept generation flow — `src/domain/generate.ts`, `src/ai/agent.ts`
1. `extractDesignFromDocuments(docs)` builds **multimodal** Claude content (text blocks + native image blocks from `data:` URLs) and offers **two tools** (`tool_choice:{type:"any"}`): `submit_design` (room programme + construction params + per-room floor) or `submit_freeform` (primitive entities). Returns a tagged `ExtractedResult`.
2. `generateConceptAI` branches on the tag:
   - **floorplan:** group rooms by floor → `solveFloorPlan` per storey (shared envelope) → `buildProjectDxf/Svg`.
   - **freeform:** `buildFreeformSvg/Dxf` (entities stored raw in `schedule` for later export).
3. The Projects **assistant** (`src/domain/copilot.ts → sendCopilotMessage`) routes any drawing with a stored `dxf` through the geometry copilot (`parseToModel → editDxf → applyOp → saveDrawingGeometry`), so add/remove works on **both** floor plans and site plans. `runArchitectAgent` (room-programme editing) is now used only for design-from-brief.

### 3.6 Professional export — `src/domain/cad-export.ts`, `tools/compose_cad.py`, `src/domain/ifc.ts`
- **DWG / pro-DXF:** `composeCad(drawing)` builds a structured plan JSON and spawns `python tools/compose_cad.py <plan.json> <outDir> <odaExe>`. The Python composer uses **ezdxf** to write a DXF with **real associative DIMENSION entities**, a proper `DIMSTYLE`/text style, layers, double-line walls, hatches, grid and title block, then converts to native **DWG** via the **ODA File Converter** CLI. `freeformEntitiesFor` reconstructs primitives from the stored DXF if raw entities weren't saved.
- **IFC (Revit):** `buildDrawingIfc(drawing)` hand-writes an **IFC4** STEP model — `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey` per floor, with `IfcSlab`, `IfcSpace` per room, and `IfcWallStandardCase` walls as extruded solids. *(Native `.rvt` cannot be written outside Revit — IFC is the interchange.)*

---

## 4. The BIM subsystem (`src/bim/`, `app/studio`, `app/_components/bim-*`)

An AI-native, multi-discipline 3D BIM model. Its whole design rests on **commands as data**.

### 4.1 Canonical model — `src/bim/model.ts`
One generic element covers every discipline:

```ts
type Discipline = "architectural"|"structural"|"civil"|"electrical"|"mechanical"|"plumbing"|"fire"|"general"
type GeomKind   = "linear"|"area"|"point"|"hosted"
interface Geometry { kind; start?,end?; outline?; at?,rot?; host?,offset?,sill?;
                     width?,depth?,height?,thickness?,elevation? }   // only kind-relevant fields used
interface Element  { id; discipline; category; name?; level?; geom:Geometry; params:Record<…> }
interface BimDocument { elements: Record<Id,Element>; order: Id[]; seq:number; units:"m" }
```

The **CATALOG** maps each `category` → `{ discipline, kind, label, color, defaults }`. ~60 items across 7 disciplines (wall, beam, column, footing, road, fence, light, socket, duct, diffuser, wc, sprinkler, …). **Adding a construction item is a catalog entry, not new code.** Helpers: `list`, `byDiscipline`, `catalogByDiscipline`, `levels`, `levelElev`, `linLength`, and `describe(doc)` — a bulletproof text summary for the AI (safe number formatting; tolerates partial/legacy elements).

### 4.2 Commands + interpreter + undo — `src/bim/commands.ts`
```ts
type Command =
  | {name:"add"; args:{category, …geometry fields, level?, name?}}
  | {name:"add_room"; args:{x,y,width,depth,height?,wallThickness?,level?,name?}}
  | {name:"add_level"; args:{name,elevation}}
  | {name:"set_param"; args:{id,key,value}}
  | {name:"move"; args:{id,dx,dy}}
  | {name:"delete"; args:{id}}
  | {name:"clear"; args:{}}
applyCommand(doc, cmd): BimDocument            // pure; unknown → unchanged; uses CATALOG defaults
```
Undo/redo is a pure snapshot bus: `History{doc,past,future}` with `run(h,cmds)`, `undo`, `redo`. **The toolbar and the AI both emit `Command` objects and go through `applyCommand`** — so any manual capability is automatically an AI capability.

### 4.3 Rendering
- **3D** — `bim-viewport.tsx` (three.js, Z-up). Renders by `geom.kind`: `linear`→oriented box; `area`→`ExtrudeGeometry`/`ShapeGeometry`; `point`→box; `hosted`→panel on host wall. Orbit controls, click-select via raycaster. Each element render is wrapped in `try/catch` so one malformed element can't crash the scene.
- **2D** — `bim-plan.tsx` (SVG, top-down, Y-flip). Walls as bands, doors with swing arcs, windows as sills, columns/equipment/fixtures as symbols, MEP linework, dashed grids. Wheel-zoom (non-passive, toward cursor), drag-pan, click-select, auto-fit.
- `bim-studio.tsx` hosts both with a **3D / 2D / Split** toggle, a **Legend** (only categories present, grouped by discipline, with colour swatches + counts), per-discipline visibility, a catalog toolbar organized by **discipline ribbon tabs**, a properties panel, undo/redo, and mobile drawers (responsive). `app/studio/error.tsx` is a route error boundary (Retry / Reload).

### 4.4 The agent — `src/bim/agent.ts` + specialists `src/bim/agents.ts`
`runBimAgent(doc, instruction, attachments, specialist)` is a **multi-step** tool loop:
1. System prompt = shared operating rules + the **specialist role** (`SPECIALISTS[specialist].system`) + a **scoped catalog** (`catalogList(spec)` shows only that discipline's categories for a specialist).
2. Loop (≤6 steps): Claude calls `apply_commands{commands[],done,reply}`; commands are parsed, **scoped**, applied incrementally to a working doc; the updated `describe(working)` is fed back as the tool result so the agent can host doors/MEP on just-created walls; stops on `done` or a text reply.
3. **Command scoping** (`allowedCommand`): for a specialist, only `add` of its own discipline's categories, `set_param/move/delete` of its own elements, and `add_level` are allowed; `clear` and `add_room` (architect-only) are gated. Out-of-remit commands are silently dropped and reported ("N ignored — outside your Electrical remit"). The **Coordinator** (`"all"`) bypasses scoping.

**Specialists:** Coordinator, Architect, Structural, Civil, Electrical, Mechanical (HVAC), Plumbing, Fire — each with domain heuristics baked into its prompt (grid spacing, light density, sprinkler spacing, corridor widths, etc.).

---

## 5. Server actions (the app API surface) — `src/server/actions.ts`

All are `"use server"` functions callable from client components (tenant-gated via `requireOrgId()`):

| Action | Purpose |
|---|---|
| `createProjectAction`, `archiveProjectAction` | Project CRUD |
| `uploadDocumentsAction(formData)` | Multi-file upload; text/PDF/DOCX/Excel → text, images → `data:` URLs |
| `addDocumentAction`, `archiveDocumentAction` | Document management |
| `generateConceptAction(projectId)` | Run concept generation (AI or rule-based fallback) |
| `sendCopilotAction(projectId, text, attachments)` | Drawing assistant (geometry copilot) |
| `dxfCopilotAction(summary, instruction)` | Stateless CAD-editor copilot |
| `exportCadAction(projectId, "dwg"\|"dxf"\|"ifc")` | Professional export; returns base64 |
| `transcribeAudioAction(formData)` | Whisper transcription (needs `OPENAI_API_KEY`) |
| `pdfToDxfAction(formData)` | Vector PDF → editable DXF |
| **`bimAgentAction(doc, instruction, attachments, specialist)`** | Run a BIM division specialist; returns the updated document |

---

## 6. Database — `DrawLogix/src/db/schema.ts` (Drizzle, MariaDB)

Shared `construction_intelligence` DB. DrawLogix owns a typed view of these tables (all carry `id, org_id, created_at, updated_at, archived_at`):

- `drawing_projects` — `name, client, description, status`
- `drawing_documents` — `project_id, name, doc_type, content (longtext), file_key, status` *(images stored as `data:` URLs in `content`)*
- `drawing_requirements` — `project_id, ref, seq, category, title, detail, source_document_id`
- `drawings` — `project_id, title, kind (concept_plan|freeform_sketch), lifecycle_state, svg, dxf, schedule (JSON), traceability (JSON), ai_confidence, generation_method`
- `drawing_messages` — `project_id, role, content`

`ScheduleRow = { ref, room, areaSqm, requirementRef?, kind?, x?,y?,w?,h?, floor? }`. Multi-tenancy is enforced by `withTenant`/`requireOrgId` (org scoping on every query).

*(The BIM model is currently client-side session state, not persisted — see §9.)*

---

## 7. AI configuration

- **Model:** `src/ai/model.ts → MODEL = DRAWLOGIX_MODEL ?? "claude-opus-4-8"`. Used by the architect agent, the DXF copilot, the concept extractor, and the BIM agent.
- **Provider:** direct Anthropic (`@anthropic-ai/sdk`). Thinking is off; `max_tokens` tuned per call; `tool_choice` forced where structured output is required.
- **Vision:** images travel as `{type:"image", source:{type:"base64", media_type, data}}` blocks (strip the `data:<mime>;base64,` prefix). Claude reads images & PDFs natively; **audio is transcribed client-side (Web Speech) or via Whisper — never sent to Claude**.

---

## 8. Extension guide

**Add a construction item (any discipline):** add one entry to `CATALOG` in `src/bim/model.ts`:
```ts
it("cable_ladder", "electrical", "linear", "Cable ladder", 0xf59e0b, { width:0.4, height:0.1, elevation:2.8 })
```
It immediately appears in the toolbar, is placeable by the tool button, renders in 2D/3D, shows in the legend, and the Electrical agent can add it — no other code.

**Add a command:** extend the `Command` union and the `applyCommand` switch in `src/bim/commands.ts`, add its schema to the `apply_commands` tool in `src/bim/agent.ts`, and (optionally) a toolbar button.

**Add a specialist:** add an entry to `SPECIALISTS` in `src/bim/agents.ts` and (if a new discipline) to `DISCIPLINES`/`CATALOG`. Scoping in `allowedCommand` keys off `discipline`, so it works automatically.

**Add a drawing edit op (2D):** extend `EditOp`/`applyOp` in `dxf-model.ts` and the `apply_edits` tool schema in `dxf-copilot.ts`.

---

## 9. Known limitations & gotchas

- **BIM persistence:** the BIM model lives in React state; it isn't saved to the DB or exported to DWG/IFC yet (the drawing side is). Adding a `bim_models` JSON table + a BIM→IFC exporter is the next step.
- **Copilot on multi-storey floor plans:** an architect-agent text edit re-solves as a single combined floor (the room-programme agent is floor-unaware). Generation is multi-storey; refine-by-text collapses floors.
- **Dev-mode flakiness:** run `next start`, not `next dev` (on-demand action compilation → "unexpected response"). The client retries transient failures.
- **Servers are separate processes:** DrawLogix (`:3001`) and the portal (`:5173`) must both be up; `start-servers.bat` launches both with the required `PORT`/`BASE_PATH`/`DRAWLOGIX_ODA` env vars.
- **`describe()` / rendering** must tolerate partial elements — use safe number formatting and guard `el.geom`; a single bad element previously crashed the server action and the viewport (now hardened).
- **Windows/MSYS:** Git Bash converts a leading `/` (e.g. `BASE_PATH=/`) into a path — set such vars via PowerShell or the `.bat`.
- **ODA required for DWG:** without the ODA File Converter (`DRAWLOGIX_ODA`), export falls back to DXF only.

---

## 10. Build & run

```bash
# DrawLogix (production — stable)
cd DrawLogix && npm install --legacy-peer-deps && npm run build && npm start   # :3001

# Portal
cd artifacts/boq-platform && PORT=5173 BASE_PATH=/ pnpm dev                     # :5173

# Python CAD toolchain (for DWG export)
pip install ezdxf                    # 1.3.5
# set DRAWLOGIX_ODA to ODAFileConverter.exe
```
Or double-click **`start-servers.bat`** at the repo root. Type-check/build gate: `npm run typecheck && npm run build` in `DrawLogix/`.

---

*This document reflects the codebase as built to date. Keep it in sync when you add catalog items, commands, specialists, or server actions.*

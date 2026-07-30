# TenderLogix + DrawLogix — Project Documentation

*AI-native construction-tech platform: tender documents & CAD → priced BOQ → drawings → multi-discipline 3D BIM.*

---

## 1. Executive summary

**TenderLogix** is a construction-technology platform that turns uploaded **tender documents and AutoCAD drawings** into a **priced Bill of Quantities (BOQ)** and a styled Excel quotation — automating work that normally takes a Quantity Surveyor days per project.

**DrawLogix** is a sub-application inside the same platform that adds the **drawing side**: it generates **construction concept drawings** from a plain brief (text / image / Excel / voice), lets you edit them with **AutoCAD-like CAD tools**, exports to **DWG, DXF and IFC (Revit)**, and now includes an **AI-native, multi-discipline 3D BIM Studio** driven by division-specialist AI agents.

Together they cover the estimating-and-design workflow of a construction firm: **understand the tender → quantify & price → draw & model → export to industry tools.**

---

## 2. System architecture

A **pnpm monorepo** (TypeScript throughout) with a Python CAD sidecar.

| Layer | Tech | Role |
|---|---|---|
| Portal (web app) | **Vite + React** (`artifacts/boq-platform`, port **5173**) | The user-facing UI: projects, BOQ, programme, narrative, CAD viewer, DrawLogix tab |
| API server | **Express** (`artifacts/api-server`, port **5000**) | BOQ pipelines, documents, CAD routes, agentic loops |
| Database | **MySQL / MariaDB** (`construction_intelligence`) + **Drizzle ORM** (`lib/db`) | Tenants, documents, extractions, chunks, drawings, programme |
| CAD sidecar | **Python FastAPI + ezdxf 1.3.5** (`services/cad-extractor`) | Parse/measure DXF/DWG, render, edit geometry, DWG conversion (ODA) |
| DrawLogix | **Next.js 15** (`DrawLogix`, port **3001**, basePath `/drawlogix`) | Concept drawings, CAD editor, exports, BIM Studio — iframed in the portal |
| AI | **Anthropic Claude** (Opus 4.8) via `@anthropic-ai/sdk`; OpenAI embeddings/Whisper | All generation, agents, vision, transcription |

**Data flow:** the portal (5173) proxies `/drawlogix` → DrawLogix (3001) and `/api` → API server (5000). DrawLogix shares the same MariaDB.

---

## 3. TenderLogix — the BOQ / tender platform

### 3.1 What it does
Uploads a tender package (RFP / SOW / specs / schedules) and AutoCAD drawings, **understands** them, and produces a **priced BOQ** exported as a styled **Excel quotation** (JTC layout; default currency KWD; Roman → Letter → Number category nesting).

### 3.2 BOQ generation pipelines
- **`/generate-boq`** — single-shot LLM over document text (fast, text-only).
- **`/generate-boq-multi`** — the agentic, CAD-aware pipeline: **7 domain-specialist agents + a completeness verifier**, each running a ReAct-style tool-calling loop. It is **SOW-driven** (dynamic section agents derived from the Scope of Work) and can export to **AIGCC** format.

### 3.3 CAD ingestion, retrieval & agentic take-off
- **Python sidecar** (`ezdxf`) `POST /extract` → structured JSON: layers, block instance counts, text/dimensions, schedules, title-block fields. DWG needs the **ODA File Converter**.
- **Storage in MySQL**: `cad_extractions` (summary JSON) + `cad_chunks` (retrieval units with JSON-array embeddings). No external vector DB.
- **Embeddings**: OpenAI `text-embedding-3-small`; falls back to BM25-only if absent.
- **Hybrid retrieval**: BM25 + cosine fused with **Reciprocal Rank Fusion** (k=60) + a structural boost for layer/block names.
- **Agent tools**: `list_layers`, `count_blocks`, `get_text_on_layer`, `get_schedules`, `get_drawing_metadata`, `search_drawing`, `get_layer_geometry`. Block counts & schedules drive fixture/door/window quantities; length aggregates drive piping/conduit/wall quantities. Items carry `drawingReferences` for QS traceability.
- **Block/xref take-off**: the extractor measures geometry **inside blocks and xrefs** (fixed the "everything qty = 1" problem).

### 3.4 Multimodal vision pre-pass
A **VLM pre-pass** rasterizes every ingested PDF page (drawings **and** tender/RFP/SOW/spec docs) and stores **vision findings** as chunks the section agents retrieve — recovering equipment photos, scanned schedules and image-only tables the text extractor loses. Works across Ollama, OpenAI, OpenRouter.

### 3.5 In-portal CAD viewer & editors
Three layers, opened from each `.dwg`/`.dxf` row:
- **Viewer** — client-side **WebGL** (`dxf-viewer` / three.js) with a parsing web-worker, native layers/linetypes/hatches, layer toggles, robust MAD-window bounds fit; **SVG fallback** on failure.
- **Markup editor** — rect/arrow/cloud/pen/text/highlight + distance/area/angle on an SVG overlay (persisted in `cad_annotations`).
- **Geometry editor** — edits **real** model-space geometry (line/polyline/circle/arc/text/insert); saves via the sidecar (`ezdxf` → ODA) as a **new versioned drawing**; original never mutated.

### 3.6 Work Programme (CPM scheduler)
A real **Critical Path Method** scheduler: typed FS/SS/FF/SF dependency links, derived dates, critical path; **P6-style resource assignment**, **% complete**, and a **calendar engine** (GCC weekends/holidays, resource cost/power, leave & auto-extend).

### 3.7 Technical Narrative
Bid narrative sections **grounded in real data** — the project's CAD chunks + priced BOQ + work programme — via a context-gathering step (not hallucinated prose).

### 3.8 Providers & deployment
- **Direct Anthropic provider** (official SDK via an OpenAI-shape adapter); **Opus 4.8** recommended for BOQ (best SOW→quantity reasoning, 1M context, native vision). Sonnet/Haiku also selectable.
- **Standard units** normalisation (m, m², m³, kg, ton, EA, Set, LS, PM) with grounded (non-hallucinated) quantities.
- **VPS deployment**: systemd services, MariaDB 10.5, nginx (with `.mjs` MIME for PDF preview), packet size raised to 64M.

---

## 4. DrawLogix — concept drawing studio

A self-contained **Next.js** app (port 3001, basePath `/drawlogix`) sharing the platform's MariaDB, **iframed** in the portal's DrawLogix tab. Its moat: **brief → measured, priced drawing → export, licence-free in a browser** — end-to-end, which ArchiLabs/AutoCAD/Augmenta/Dalux don't do.

### 4.1 Multi-modal concept generation
Attach a mixed brief — **text, images, Excel schedules, and voice** — and the AI generates a drawing:
- **Ingestion**: text/PDF/DOCX + **Excel** (SheetJS → per-sheet CSV) + **images** stored as `data:` URLs (read by Claude vision) + **audio** (browser Web Speech dictation live, or **OpenAI Whisper** for uploaded voice notes).
- **AI picks the drawing type**: a **measured floor plan** (room programme → solved plan) *or* **freeform** geometry (site plan / schematic / detail) — chosen per brief via two tools (`submit_design` / `submit_freeform`).
- **Refine with the assistant**: image/PDF/text prompts add or remove **anything** on the drawing.

### 4.2 Professional drafting engine (`drafting.ts`)
Renders AutoCAD-grade drawings from one routine to both **DXF** and **SVG** (a shared "Pen"):
- **Double-line walls** with real thickness ("depth")
- **Full dimension strings** on both axes (every bay + overall, ticks, mm text)
- **Column grid** with A·B·C / 1·2·3 bubbles, room / door / window tags
- **North arrow, graphic scale bar, title block**, per-storey level labels
- **Multi-storey** — one plan per floor + a **stacking diagram**
- **Freeform/site plans** get the same sheet treatment (frame, auto overall dimensions, sized furniture, readable labels)

### 4.3 Professional CAD export
- **DWG** — native AutoCAD, via the Python **`compose_cad.py` (ezdxf)** → **ODA File Converter**.
- **DXF** — professional, with **real associative DIMENSION entities**, dimension/text styles, layers.
- **IFC** — a **BIM model for Revit** (`Open IFC`): storeys, slabs, spaces, walls (hand-written IFC4).
- *(RVT note: there is no supported way to write native `.rvt` outside Revit — IFC is the industry path.)*

### 4.4 CAD editor + AI copilot
The live **DXF/PDF editor** (`dxf-editor.tsx` + `cad-viewport.tsx`) is a full AutoCAD-like 2D tool: **draw** (line, polyline, rect, circle, text, **dimension**, hatch), **modify** (move, copy, rotate, scale, mirror), **layers**, **object-snap (F3) / ortho (F8) / polar (F10)**, measure, undo/redo, PDF→DXF, and a live **priced BOQ take-off** panel. Generated concept drawings open here via **"Edit in CAD."**
- The **AI copilot** turns natural-language (text/voice/image) into edit operations and can **add anything and remove anything** — including deleting a whole named room (outline + walls + labels), on both floor plans and site plans.

### 4.5 Projects workspace (UI)
A polished, guided workflow: drag-drop brief panel, **🎙 dictate** + **audio upload**, file chips, one-tap **example briefs**, a **generating** state, an interactive **drawing viewer** (zoom / pan / fit / fullscreen), one-tap **edit suggestions**, and export buttons (DWG / DXF / IFC). Exports open in AutoCAD / Revit.

---

## 5. DrawLogix BIM Studio — AI-native, multi-discipline 3D BIM

Route: **`/studio`**. A Revit-like, **AI-first** 3D BIM system where anything a user can do by hand, the AI can do by voice/text — across **every construction division**.

### 5.1 The core principle — commands as data
Every operation is a **typed command** (`{ name, args }`). **One interpreter** turns a command into a new document. The **manual toolbar and the AI emit the same commands**, so the AI is capable of everything the UI is, with no special-casing. **Undo/redo** snapshots the document and works across both.

### 5.2 The canonical BIM model + catalog
One generic **Element** (`discipline` + `category` + `geometry` archetype + params) covers **~60 construction items** across **7 disciplines**, defined in a **CATALOG** (adding an item = a catalog entry, not new code):
- **Architectural** — wall, partition, curtain wall, door, window, floor, roof, ceiling, room, stair, railing, furniture
- **Structural** — column, beam, structural slab, pad/strip footing, pile, retaining/shear wall, brace, truss
- **Civil** — site pad, road, parking, sidewalk, curb, fence, gate, drainage pipe, manhole, catch basin, light pole, tree
- **Electrical** — light, spotlight, socket, switch, distribution board, main panel, cable tray, conduit, generator, transformer
- **Mechanical (HVAC)** — duct, diffuser, FCU, AHU, VRF unit, chiller, exhaust fan
- **Plumbing** — pipe, WC, basin, sink, shower, floor drain, water tank, pump, water heater
- **Fire** — sprinkler, smoke detector, fire alarm, hydrant, fire pump

### 5.3 Views
- **3D viewport** (three.js, Z-up) — orbit, click-select, renders every geometry archetype in catalog colours.
- **2D plan view** — a top-down architectural plan generated from the same model: walls as bands, doors with swings, windows, columns/equipment/fixtures as symbols, MEP linework, grids.
- **3D / 2D / Split** toggle; a live **Legend** (colour key of what's actually in the model); per-discipline show/hide.

### 5.4 The AI agent team (division specialists)
A **multi-step agent** reads the model, emits commands, sees the result, and continues — so it can build complex, coordinated models (place walls, then host doors/MEP on them). You choose **who you're handing the model to** from a specialist dropdown:

| Specialist | Remit | Sample expertise baked in |
|---|---|---|
| **Coordinator** | All disciplines | Sequences arch → structure → MEP → fire → civil |
| **Architect** | Arch elements | ≥0.9 m doors, 1.2–1.5 m corridors, daylight, egress |
| **Structural Engineer** | Structure | 5–8 m grid, beam ≈ span/12, footing under each column |
| **Civil / Site Engineer** | Site works | 6 m roads, 2.5×5 m bays, drainage to manholes ~30 m |
| **Electrical Engineer** | Power & lighting | ~1 light/10–12 m², switch by each door, DB per zone |
| **HVAC / Mechanical** | Air-con & vent | 1 diffuser/~15–25 m², FCUs, ducts in ceilings |
| **Plumbing Engineer** | Water & drainage | fixtures in wet rooms, tanks, pumps, falls |
| **Fire Protection** | Fire safety | sprinklers on a 3–4 m grid, detectors, hydrants |

**Each specialist is scoped to its own discipline** — it reads the whole model for coordination but can only add/edit its own elements; out-of-remit commands are ignored (e.g. the Electrical agent will place lights/sockets but *refuse* to add columns or fences, and say so). This mirrors handing a package to the responsible engineer in a construction firm.

### 5.5 UX & resilience
- **Responsive** — on phones/narrow windows the Tools and AI panels become slide-in drawers with toggle buttons; Split stacks vertically.
- **Voice** — 🎙 dictation feeds the assistant.
- **Crash-hardened** — the viewport/plan skip malformed elements instead of dying; a route **error boundary** offers Retry / Reload instead of a dead page.

---

## 6. The AI stack (all the agents in one place)

| Agent | Where | Job |
|---|---|---|
| BOQ section specialists (×7) + verifier | API server | SOW-driven priced BOQ from docs + CAD |
| Vision pre-pass (VLM) | API server | Read drawings/scans/tables from PDF pages |
| Concept design extractor | DrawLogix | Multimodal brief → floor plan or freeform |
| Architect copilot | DrawLogix | Edit the room programme → solved plan |
| DXF edit copilot | DrawLogix | NL/voice/image → add/remove any geometry |
| BIM Coordinator + 7 division specialists | DrawLogix BIM | Build/edit the 3D BIM model, scoped by discipline |

Model: **Claude Opus 4.8** (configurable via `DRAWLOGIX_MODEL`). Embeddings/transcription: OpenAI (`text-embedding-3-small`, `whisper-1`).

---

## 7. Toolchain & standards

- **ezdxf 1.3.5** (Python) — professional DXF with real dimensions.
- **ODA File Converter** — DXF ⇄ DWG (native AutoCAD). Local: `C:\Users\IKIO\ODA\ODAFileConverter.exe` (`DRAWLOGIX_ODA`).
- **three.js** — 3D BIM viewport. **dxf-parser / dxf-viewer** — 2D CAD.
- **IFC4** — hand-written BIM export for Revit.
- **Web Speech API** (browser dictation) + **Whisper** (audio files).
- Standard BOQ units; AIA-style CAD layers (A-WALL, A-DOOR, A-GLAZ, A-DIMS, A-ANNO, A-GRID, A-TTLB…).

---

## 8. Running the system

**One-click (recommended):** double-click **`start-servers.bat`** at the repo root — it launches DrawLogix (:3001) and the portal (:5173) in two windows with the correct env vars, then open **http://localhost:5173/drawlogix/studio**.

**Manually:**
- DrawLogix — in `DrawLogix/`: `npm run build && npm start` *(production is stable; avoid `npm run dev`, which has an on-demand-compile race)*.
- Portal — in `artifacts/boq-platform/`: set `PORT=5173`, `BASE_PATH=/`, then `pnpm dev`.
- API server — `:5000`; MariaDB running; `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`) in `DrawLogix/.env.local`.

**Entry points:**
- BIM Studio → `/drawlogix/studio`
- Projects (concept drawings) → `/drawlogix/projects`
- CAD editor → `/drawlogix`
- Main BOQ platform → `/`

---

## 9. Where things live (key files)

```
artifacts/boq-platform/     Portal UI (Vite/React) — vite.config.ts proxies /drawlogix, /api
artifacts/api-server/       Express API: routes/boq.ts, multi-agent-boq.ts, documents.ts
lib/db/                     Drizzle schema, CPM & calendar engines
services/cad-extractor/     Python ezdxf sidecar: app.py, extractor.py, editor.py
DrawLogix/
  src/domain/               drafting.ts, freeform.ts, cad-export.ts, concept.ts, floorplan.ts, ifc.ts, dxf-model.ts
  src/ai/                   agent.ts (architect), dxf-copilot.ts, model.ts
  src/bim/                  model.ts (+CATALOG), commands.ts, agent.ts, agents.ts (specialists)
  app/                      projects/, studio/, _components/ (bim-studio, bim-viewport, bim-plan, dxf-editor, project-workspace)
  tools/compose_cad.py      ezdxf → DWG professional composer
start-servers.bat           One-click launcher (DrawLogix + portal)
```

---

## 10. Roadmap / what's next

- **BIM:** "Build all disciplines in sequence" one-click; per-discipline package export (each division to its own DXF/IFC layer); per-level plan tabs (Ground/First/Roof); plan dimensions & annotations; parametric constraints (move a grid → columns follow).
- **Deeper BIM engine:** web-ifc (IFC.js) + OpenCascade.js for real solid modelling; DWG/IFC **import** & round-trip.
- **Coordination:** clash detection between disciplines; quantity/BOQ take-off directly from the BIM model.
- **2D concept:** per-level plans, richer annotation, and DWG export of the interactive plan viewer.

---

*Document generated as a running record of the TenderLogix + DrawLogix build. It reflects the platform (BOQ/tender automation) and the DrawLogix drawing + BIM work completed to date.*

# DrawLogix — Solution Options for the "ArchiLabs-like AI Architectural Copilot" Requirement

**Status:** discovery / options paper · **Date:** 2026-07-02
**Author:** engineering
**Audience:** client stakeholder + delivery team — read this to pick a direction before we build.

> This document lays out **every credible way** we can satisfy the client's ask, with the
> trade-offs of each, so we choose the path deliberately instead of drifting into one. It does
> **not** commit to an implementation. Section 8 is the recommendation; Section 9 is what we still
> need the client to answer.

---

## 1. The client problem, stated plainly

The client wants DrawLogix to become **"a system like ArchiLabs"**: an AI copilot for architects
where **natural-language chat drives the building design** — generate and edit floor plans and BIM,
rather than a fixed rule-based concept generator.

ArchiLabs, as a reference point, is an **AI copilot that lives inside/alongside a BIM authoring tool
(Revit)** and lets an architect say things like *"add a 3 m corridor between these two wings"* or
*"lay out 20 hotel rooms on this floor to code"* and have the model actually change the BIM. Its
value is: **less manual drafting, faster iteration, and documentation/QA automation** on top of real
BIM geometry.

So the gap we must close is between:

| | **DrawLogix today** | **ArchiLabs-like target** |
|---|---|---|
| Design object | An **area schedule** (rooms + m²) rendered to a simple SVG/DXF/IFC block layout | **Real building geometry** — walls, doors, windows, levels, grids, MEP |
| AI role | Edits the room programme via tool-calls (`add/remove/resize/rename/generate_layout`) | Edits real geometry, runs code checks, produces documentation |
| Output fidelity | Concept / block plan | Coordinated, buildable, standards-compliant model |
| Host | Standalone web app (browser SVG + basic 3D) | BIM authoring environment (or a faithful web BIM engine) |

The honest framing: **DrawLogix already has the *shape* of an ArchiLabs copilot** (a real Claude
tool-calling agent editing a structured model — see `src/ai/agent.ts`). What it lacks is **geometric
and BIM depth**. The decision this paper drives is *how far up the fidelity curve we go, and how.*

## 2. What exists today (baseline — verified against the code)

- **Standalone Next.js app** on port 3001, connects to the shared `construction_intelligence`
  MariaDB, org-scoped via `withTenant` (no login; dev org selector).
- **Real Claude tool-calling agent** (`src/ai/agent.ts`, `claude-sonnet-4-6`, manual
  `tool_use → tool_result` loop) that manipulates a room programme.
- **Document → design extraction** (`extractDesignFromDocuments`) — reads SOW/spec PDFs, returns
  structured requirements + a room programme with counts, en-suites, adjacency (`connectsTo`),
  and room `kind`.
- **Rule-based concept generator** (`src/domain/concept.ts`) as the no-API-key fallback.
- **Rendering**: SVG (in-app), DXF export, a basic 3D viewer (wall slabs), and **IFC4 export**
  (`buildIfc`).
- Rides the artifact lifecycle (AI Generated → Draft → … → Archived).

**Implication:** the cheapest options below *reuse this spine* and deepen it; the most ambitious
ones replace the rendering/geometry core.

## 3. The decision axes (what actually differentiates the options)

Every option is really a set of choices on these axes:

1. **Geometry fidelity** — block/bubble diagram → dimensioned 2D walls → full parametric BIM.
2. **Where BIM lives** — our own web geometry engine vs. a real BIM kernel (Revit / IFC toolkit /
   Speckle) vs. a Revit plugin.
3. **Agent capability** — programme edits (today) → 2D geometric edits → true BIM operations +
   code-compliance + documentation.
4. **Interop** — how the output leaves the system: DXF/IFC export (today) vs. live round-trip with
   Revit/Speckle.
5. **Compliance depth** — none → advisory rules (adjacency, egress) → real code checking.

## 4. Solution options

### Option A — Deepen the concept studio (2D geometric copilot)
**Idea:** Keep the standalone web app and the room-programme model, but make the AI operate on
**real 2D geometry** — walls with thickness, doors/windows as openings, dimensioned rooms,
adjacency-driven auto-layout — instead of abstract m² blocks. Add agent tools like
`place_wall`, `add_opening`, `set_adjacency`, `auto_arrange`.

- **Fidelity:** dimensioned 2D + extruded 3D (what we already extrude).
- **Interop:** improved DXF/IFC (already have IFC4 export).
- **Effort:** **Low–Medium** — extends the existing agent + layout engine.
- **Pros:** fastest to a visibly "ArchiLabs-like" demo; reuses the whole current spine; no new
  infra; stays inside Phase-0 platform laws easily.
- **Cons:** still *concept-grade* — not a coordinated buildable model; no MEP/structure; not
  interoperable with a real BIM workflow beyond file export.
- **Best when:** the client's real need is **fast early-stage massing/space-planning**, not
  construction documentation.

### Option B — Web BIM engine (IFC-native, in-browser)
**Idea:** Adopt an open web BIM stack — **IFC.js / That Open Engine (web-ifc)** or **Speckle** — so
the design object *is* real IFC geometry rendered in the browser. The agent edits IFC entities
(spaces, walls, storeys) through tools; the viewer is a true 3D BIM viewer.

- **Fidelity:** real BIM entities (IfcSpace, IfcWall, IfcDoor…), 2D+3D from one model.
- **Interop:** native IFC round-trip; opens in Revit/ArchiCAD/Navisworks.
- **Effort:** **Medium–High** — new geometry core, migrate rendering, richer agent tools.
- **Pros:** genuinely BIM (not just a block plan); open standard, no Autodesk licensing;
  stays a web app (no plugin); strong future ceiling (clash, quantities, MEP later).
- **Cons:** significant rebuild of the rendering/geometry layer; IFC editing is fiddly;
  auto-layout to real geometry is hard AI+algorithm work.
- **Best when:** the client wants a **standalone web BIM copilot** and values openness/portability
  over deep Revit parity.

### Option C — Revit plugin + AI copilot (closest to ArchiLabs' actual product)
**Idea:** Build a **Revit add-in** (C#/pyRevit) that exposes a chat panel; the Claude agent calls
tools that drive the **Revit API** directly (create/modify families, walls, rooms, sheets). This is
architecturally what ArchiLabs itself is.

- **Fidelity:** full production BIM — the architect's real model.
- **Interop:** native; it *is* Revit.
- **Effort:** **High** — new C#/.NET codebase, Revit API, packaging, a different runtime from our
  TS/Python platform.
- **Pros:** true parity with ArchiLabs; drops into an architect's real workflow; highest ceiling
  (documentation automation, sheet generation, schedules).
- **Cons:** Autodesk lock-in + licensing; a whole new tech stack outside the platform's TS/Python
  seam; desktop deployment/updates; hardest to keep inside our tenancy/audit laws (state lives in
  Revit, not our DB).
- **Best when:** the client's architects **live in Revit** and want the copilot *there*, not a
  separate web app.

### Option D — Hybrid: web copilot + Speckle/Revit bridge
**Idea:** Keep the AI copilot and design authoring in our web app (Option A/B), but add a
**Speckle** (or IFC) **bridge** so designs round-trip to Revit for detailing. Architects concept in
DrawLogix, push to Revit, pull changes back.

- **Fidelity:** concept/BIM in web, production detailing in Revit.
- **Effort:** **Medium–High** — Option A or B *plus* a sync connector.
- **Pros:** best of both — our controlled web/AI experience + real-tool detailing; no full plugin
  rebuild; leverages Speckle's existing connectors.
- **Cons:** two-tool workflow with sync semantics (conflicts, versioning); Speckle dependency.
- **Best when:** the client wants **AI-driven concepting in the web** but keeps Revit for CD.

### Option E — Managed BIM API service (Autodesk Platform Services / Forge)
**Idea:** Use **Autodesk Platform Services** (Design Automation for Revit, Model Derivative, Viewer)
so the agent drives Revit **server-side in the cloud** and we embed the APS viewer in the web app —
no desktop plugin, but real Revit under the hood.

- **Fidelity:** real Revit geometry, cloud-executed.
- **Effort:** **High** + ongoing APS cost/quota.
- **Pros:** real Revit without shipping a desktop plugin; stays web-delivered; fits our async-job
  law (Law #9) cleanly — each Revit op is a job.
- **Cons:** Autodesk cost + rate limits + credential complexity; Design Automation is batch, not
  interactive; heaviest external dependency.
- **Best when:** the client wants **Revit-grade output delivered through the web** and will fund APS.

## 5. Option comparison

| | Fidelity | Interop | Effort | External dep | Fits platform laws | ArchiLabs parity |
|---|---|---|---|---|---|---|
| **A** Deepen 2D copilot | Concept+ | DXF/IFC export | **Low–Med** | none | ✅ easy | Low–Med |
| **B** Web BIM (IFC.js/Speckle) | BIM | IFC round-trip | Med–High | open-source | ✅ good | Med–High |
| **C** Revit plugin | Full BIM | native | **High** | Autodesk | ⚠️ hard (state in Revit) | **Highest** |
| **D** Hybrid + Speckle bridge | Concept→BIM | round-trip | Med–High | Speckle | ✅ good | High |
| **E** APS / Forge cloud | Full BIM | native (cloud) | High | Autodesk $$ | ✅ (async jobs) | High |

## 6. Cross-cutting concerns (apply to *whichever* option)

- **Agent design.** Today's manual `tool_use` loop is the right pattern; deepen the **tool set** to
  the chosen geometry model and add **read tools** (query current geometry) so the agent grounds
  edits. Use the latest models — per platform guidance, **Opus 4.8 / Sonnet 5 / Haiku 4.5** (the
  code currently pins `claude-sonnet-4-6`; worth bumping).
- **Compliance / codes.** ArchiLabs' pull is partly *"lay out to code."* Decide the depth: none →
  advisory heuristics (egress distance, min room sizes, adjacency) → real code engine. This can be
  its own agent tool layer independent of the geometry choice.
- **Platform laws (if/when folded back into the monorepo).** DrawLogix is standalone today, but the
  target platform requires: **tenant isolation** via the scoped repository's `org_id` predicate (no
  RLS in MariaDB — the app-side filter is load-bearing), **audit** on every lifecycle transition,
  **async jobs** for anything touching a model/document (Law #9), and **no secrets in source** (the
  `ANTHROPIC_API_KEY` currently in `.env.local` must be env-injected, not committed).
- **Document → design pipeline.** Already strong (`extractDesignFromDocuments`). It's an asset for
  every option — feed extracted requirements/adjacency into the geometry generator.
- **Cost & latency.** Geometry-editing agents make many tool round-trips; budget token/latency and
  keep edits incremental (the current loop cap of 6 steps will need raising thoughtfully).

## 7. What is *not* the answer

- Rebuilding the **rule-based concept generator** — it's already the fallback; the client explicitly
  wants the AI-driven path to lead.
- A bigger regex/keyword parser — the memory note is explicit that the **Claude agent replaces the
  regex parser**; don't regress toward rules.

## 8. Recommendation (phased, lowest-regret path)

Do **A → B**, keep **D** as the interop escape hatch, and treat **C/E** as client-funded upgrades:

1. **Phase 1 (now): Option A.** Deepen the copilot to real dimensioned 2D geometry + extruded 3D.
   Fast, reuses everything, gives the client a tangible "ArchiLabs-like" copilot to react to. This
   also *de-risks the agent/tool design* before we invest in a heavy geometry core.
2. **Phase 2: Option B.** Move the design object onto an **IFC-native web engine** (IFC.js/That Open
   or Speckle) so it's genuinely BIM and interoperable — the biggest fidelity jump without Autodesk
   lock-in.
3. **Phase 3 (conditional): Option D or E.** If architects need Revit-grade CD, add the
   **Speckle/Revit bridge (D)** or **APS (E)** — chosen by whether the client will fund Autodesk.

**Only jump straight to Option C** if discovery (Section 9) shows the client's architects work
*exclusively* in Revit and won't adopt a separate web tool — then the web app is the wrong host and
a plugin is the honest answer.

## 9. Open questions for the client (answer these before committing)

1. **Where do your architects work today** — Revit, ArchiCAD, AutoCAD, SketchUp, or nothing yet?
   (Decides web-app vs. plugin, i.e. A/B/D vs. C.)
2. **Concept design or construction documentation?** Do you need buildable, coordinated,
   code-checked models, or fast early-stage space planning and options?
3. **What must the output *be*** — a shareable concept, a DWG/IFC handoff, or a live BIM model your
   team keeps detailing?
4. **Code compliance** — is "lays it out to code" a hard requirement (which codes/jurisdiction), or
   advisory?
5. **Autodesk** — do you have Revit/APS licensing and budget, or is Autodesk-free (open IFC) a
   requirement?
6. **Building types** — general, or a focused vertical (clinics, hotels, dorms, offices)? A narrow
   vertical makes the AI *far* better, faster.
7. **Standalone or folded into the Construction Intelligence platform** (which brings the tenancy /
   audit / async laws back into scope)?

---

*Appendix — note on the `task_reminders.py` file open in the editor:* it is an overdue-task reminder
engine for a separate system (IQProject-Sync / `app_v2.py`) and is **unrelated to DrawLogix**. If it
was meant to be part of this request, say so and I'll fold it in.

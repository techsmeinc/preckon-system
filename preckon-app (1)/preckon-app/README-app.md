# Preckon — Tenant App (prototype)

The product your customers use: the branded, white-labelable app where a contractor's preconstruction team turns tender documents into a priced, procurement-ready bid. This is the **Tenant** plane of the Host/Tenant model — the counterpart to the dark Host Console operators use.

Single self-contained file: **`preckon-app.html`** — built on the DS-01 design system, **light by default** (with a dark toggle), mock data throughout, no build step.

## How to use it
Open the file and sign in — the form is prefilled, just click **Sign in** (or Continue with SSO). Navigate with the left sidebar or **⌘K**. The logged-in workspace is **Cedar & Stone Builders**, a tenant that also exists in the Host Console — the two apps are consistent.

## The chain — the heart of the product
Open any project (try **Tower B — Residential**) to enter its workspace. The tab bar *is* the preconstruction chain, each tab carrying a status dot:

**Documents → Drawings (DrawLogix) → BOQ (QuantLogix) → Estimate (CostLogix) → Schedule (PlanLogix) → Procurement (ProcureLogix)**

Every stage traces back to the one before it, with a human reviewing AI proposals throughout.

- **Overview** — a clickable chain-progress stepper (the "line becomes the number"), an attention panel, and project details.
- **Documents** — an upload dropzone and the processed document set.
- **Drawings / DrawLogix** — an interactive SVG structural plan: **pan (drag), zoom (wheel / buttons / fit)**, a recognition overlay you can toggle, click any element to inspect its measurement, confidence, and the BOQ line it feeds. Low-confidence elements are flagged; accept the boundary or correct it.
- **BOQ / QuantLogix** — a dense, mono, traceable bill. Flagged lines open a **review drawer**: the AI proposal, the source drawing, and Accept / Correct — plus "Accept all ≥90%". Summary recomputes live.
- **Estimate / CostLogix** — the priced bill with **rate-source chips** (Library / Historical / Manual), and a **live cost buildup** (direct → prelims → OH&P → contingency → tender total) that recalculates as you edit the percentages.
- **Schedule / PlanLogix** — the construction programme, **derived from the BOQ**: each activity's duration is quantity ÷ output rate, sequenced into a Gantt with a critical path. Every bar traces to the lines that sized it; flagged durations open a review drawer where adjusting the output rate **re-sequences the whole programme live**.
- **Procurement / ProcureLogix** — the estimate grouped into buyout **packages**, each with scope, suggested vendors, and an RFQ send flow.

Gating is honest: stages that aren't reached yet show clean empty states, and each project has its own chain state, so they tell different stories (Northgate is at procurement; Eastside is still uploading).

## Around the chain
- **Dashboard** — an estimator's landing: KPIs, a **human-in-the-loop review queue**, projects with chain-stage progress, deadlines, activity.
- **Projects** — every bid, filterable by status, searchable.
- **Copilot** — a docked Construction Copilot (topbar or nav) that answers with **source citations**.
- **Admin** — Team & roles; **Branding** with a live brand-colour control that recolours the whole app in real time (maps to the Host Console's `tenant_theme`); Plan & usage.
- **Library** — rate libraries, historical bids, and standards (NRM2, CESMM4, NBS…) — the reference data the AI prices against.
- **Settings** — profile, notification toggles, theme / language / currency preferences.

## White-labelling
The accent is a single `--brand` CSS variable. **Admin → Branding** changes it live — every primary button, active nav item, chain node, and progress bar follows. In production this is injected per-tenant from `tenant_theme`, provisioned in the Host Console.

## Mock limitations (wire up on port)
Accept/correct, RFQ sends, invites, and saves are front-end only and reset on reload. The drawing is a synthetic SVG plan, not a real DWG/PDF. Copilot replies are canned. Rate/BOQ data is a generic structural sample shown for every project.

## Porting notes (Next.js / Turborepo `apps/tenant`)
- Serve on `app.preckon.com`; auth via Better Auth with the tenant RBAC roles (Owner-Admin / Estimator / QS-Reviewer / Viewer).
- Replace the mock arrays (`PROJECTS`, `BOQ`, `EST`, `SCHED`, `PROC`, `DWG`, `TEAM`, `LIB`) with API calls to the FastAPI backend; the chain stages map to the module services.
- Feature-gate tabs and Admin sections by the tenant's edition (defined in the Host Console).
- Inject `--brand` and the logo per-tenant from `tenant_theme` at load.
- The DrawLogix viewer becomes a real drawing renderer (PDF/DWG tiles) with the recognition overlay driven by the model's output; keep the accept/correct interaction — the correction feeds the learning loop.

*Built on DS-01. Light-default, branded, white-labelable. One file, the whole preconstruction chain, a human in the loop at every step.*

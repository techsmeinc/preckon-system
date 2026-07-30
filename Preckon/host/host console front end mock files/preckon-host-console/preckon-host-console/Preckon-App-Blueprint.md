# Preckon Application — Product Blueprint

**Purpose:** the plan for the **product app** (`app.preckon.com`) — the workspace where preconstruction teams actually run bids. This is distinct from the marketing site. It locks the app's information architecture, roles, shell, design direction, and the review UX that is the core of the product, then sequences the wireframe/frontend build.

**What already exists (don't re-plan):** the backend foundation is built — Next.js 15 / FastAPI, Better Auth, Drizzle + Postgres/pgvector, row-level-security multi-tenancy, arq/Redis queue, MinIO/R2, Langfuse, Turborepo/pnpm, CI. This blueprint is about the **frontend product UI + UX**, built on DS-01 with mock data first, then wired to the APIs.

---

## 1. Two planes: Host and Tenant

Preckon is multi-tenant, so there are **two administrative planes** — the same Host/Tenant model you know from ASP.NET Zero:

- **Host (platform operator)** — you / TechSME. Defines the *product itself* — editions, features, pricing — and manages every tenant plus your own internal staff. Lives in a separate, hardened **Host console** (see §8).
- **Tenant (customer org)** — a contractor or QS firm. Runs bids and manages *their own* users, branding, and usage.

**Host roles**

| Role | Does |
|---|---|
| **Platform Admin** | Full host control — editions, features, pricing, tenants, host users |
| **Support** | Tenant health, diagnostics, audited impersonation |
| **Billing / Finance** | Subscriptions, invoices, revenue, dunning |
| **Sales** | Trials, tenant provisioning, plan changes |

**Tenant roles**

| Role | Does |
|---|---|
| **Owner / Admin** | Tenant settings, branding, users, their billing view, security |
| **Preconstruction lead / Estimator** | Creates projects, runs the chain, reviews, generates outputs |
| **Quantity surveyor / Reviewer** | Reviews & corrects quantities and costs |
| **Viewer** | Read-only (clients, executives) |

Maps to the Better Auth / RBAC foundation. Every screen is role-gated — and in the tenant app, features are *additionally* gated by the tenant's **edition** (§8).

---

## 2. Information architecture (tenant app)

*This is the **tenant app** — what a customer sees. The Host console has its own IA in §8.*

**App areas (left sidebar):**
- **Dashboard** — throughput, deadlines, activity, usage at a glance.
- **Projects** — the bid list → the project workspace.
- **Copilot** — global conversational access (also docked in-project).
- **Library** — rate libraries, method-of-measurement templates, spec standards, historical data the AI learns from.
- **Admin** *(role-gated)* — users & roles, branding, billing & usage, audit, integrations, security.
- **Settings** — profile, notifications, theme, language.

**Project workspace (the heart)** — one project, stepped by the chain:
Overview · Documents · **Tender** (TenderLogix) · **Drawings** (DrawLogix) · **Specs** (DocLogix) · **BOQ** (QuantLogix) · **Estimate** (CostLogix) · **Procurement** (ProcureLogix) · Activity/Audit — with the **Copilot** docked throughout.

---

## 3. Key journeys

1. **First run** — sign in → onboarding (org, branding, invite team) → dashboard.
2. **Run a bid** — New project → upload the set → chain runs (queued jobs) → review each module output (human-in-the-loop) → generate BOQ / estimate / procurement → export.
3. **Admin** — manage users/roles, set white-label branding, watch usage & billing, review the audit trail.

---

## 4. App shell

- **Left sidebar** (collapsible, icon + label): the areas above; tenant/workspace switcher at top; Copilot + settings pinned at the bottom.
- **Top bar**: project/breadcrumb context, global search + **⌘K command palette**, notifications, theme toggle, user menu. Enterprise: tenant logo (white-label).
- **⌘K palette**: jump to any project, run actions, open Copilot.
- **Responsive**: sidebar collapses to icons; mobile is review/approve-focused, not authoring.

---

## 5. Design direction — extending DS-01 for a work tool

The app inherits the Preckon brand but shifts from airy marketing to **dense productivity** — think Linear / Retool, not Stripe.

- **Same tokens** — navy/teal, mono-for-data, the Set-Out P, the measured-line motif. DS-01 is the base; we already have light + dark.
- **Dark-first is welcome here** — long work sessions. Ship both; default to system.
- **Density** — compact rows (36–40px), tighter spacing scale, data-first layouts.
- **Mono for all data** — the signature is *made* for this: every quantity, code, rate and total in JetBrains Mono.
- **Status system** — pipeline states get one consistent colour language: `queued` (slate), `processing` (teal pulse), `needs review` (amber), `approved` (teal), `error` (red).
- **New components over DS-01** — data table (TanStack), split-panel review layout, drawing canvas/viewer, docked Copilot drawer, upload dropzone, inline accept/correct controls, confidence indicators, toasts, empty states, skeletons.
- **The review pattern is the app's signature interaction** — AI proposal on one side, the source (drawing / spec / clause) on the other, accept or correct inline. Every correction feeds learning. This is what makes Preckon *explainable and human-controlled* rather than a black box.

---

## 6. The module workspace (the crux)

Every module is a **review surface**: AI output + its source + controls to accept/correct.

- **Drawings — DrawLogix** *(the hardest, highest-value screen)* — pan/zoom the drawing (PDF/CAD), recognized elements overlaid as teal boxes, click an element to see its measurement and trace, correct boundaries, read dimension annotations. Plan this as its own deep build.
- **BOQ — QuantLogix** — dense mono table grouped by section / method of measurement, each line traceable to its source element, inline edit, confidence flags.
- **Estimate — CostLogix** — BOQ + rates (from Library) → live totals; every rate shows its source; override with audit.
- **Procurement — ProcureLogix** — group scopes into packages, generate RFQs, manage the vendor list.
- **Tender — TenderLogix** — the requirement register with mandatory/submittal/deadline tags.
- **Specs — DocLogix** — spec browser with clause ↔ item mapping.
- **Copilot drawer** — ask in plain language, answers cite the drawing/clause and link straight to it.

---

## 7. Tenant admin

*What the customer's own admin manages — scoped entirely to their org.*

- **Users & roles** — invites, RBAC assignment.
- **Branding / white-label** — tenant logo + brand colour → `tenant_theme`, injected as CSS variables. *(Already a first-class backend capability — surface it here.)*
- **Billing & usage** — plan, usage metered per drawing / BOQ / estimate / package, invoices.
- **Audit log** — the immutable audit spine, made browsable.
- **Integrations / API keys** and **Security** — SSO, MFA policy, sessions.

---

## 8. The Host console (platform operator)

Your side of the platform — a **separate, hardened surface** (own subdomain, own auth context, impersonation always audited). This is where the *product* is defined and every tenant is managed. It's the piece the tenant app depends on.

**The commercial model it configures:**

> **Feature** (catalog) → bundled into an **Edition** (+ limits) → priced by **Pricing** → assigned to a tenant as a **Subscription** → the tenant's UI is **feature-gated** accordingly.

**Screens:**
- **Overview** — platform KPIs: tenants, revenue (plan + usage), active bids, module usage, trials, growth.
- **Tenants** — every customer org: edition, subscription status (active / trial / past-due / suspended), users, usage, health. Create, suspend, and **impersonate** (audited) for support.
- **Editions** — define plans (Starter / Professional / Enterprise / custom): included features, limits (seats, usage caps), trial length, visibility. Your product catalog.
- **Features** — the catalog editions draw from: the six modules, Copilot, white-labeling, SSO, API access, usage limits — each a toggle or limit an edition can enable. Feature flags live here.
- **Pricing** — per edition: base plan price (monthly / annual), usage rates (per drawing / BOQ / estimate / package), currency, regional pricing, coupons. *(This is where the site's "pricing in flux" becomes real, managed numbers.)*
- **Subscriptions & billing** — assign editions to tenants, manage trials, invoices, payment gateway, dunning, revenue.
- **Host users & roles** — your internal staff and their RBAC (Platform Admin / Support / Billing / Sales).
- **Host settings** — global config: default AI provider keys & routing, email/SMTP templates, default branding, security-policy defaults, maintenance mode, announcements.
- **Observability** — queue health, job throughput, error rates, Langfuse links, per-tenant diagnostics for support.
- **Host audit** — an immutable log of host-side actions (who changed an edition's price, who impersonated whom).

**Feature-gating contract:** the tenant app resolves *tenant → edition → feature set*, then hides or locks anything not included (with an upgrade prompt). One source of truth, set here — so editions/features/pricing defined in the Host console directly shape every tenant's experience.

---

## 9. Tech

- **Next.js 15 App Router** in the Turborepo (`apps/app`), **Tailwind v4 + shadcn/ui**, DS-01 tokens as the theme, **TanStack Table** for grids, **TanStack Query** for data/caching, **Better Auth** (sessions + RBAC), Framer Motion sparingly.
- **Drawing viewer** — pdf.js (or a WebGL canvas) with a custom element-overlay layer.
- **Multi-tenant via RLS**; tenant context lives in the shell; white-label theming via CSS variables.
- **Async work** — chain runs as queued jobs (arq); the UI shows live status via polling or websockets.
- Wireframes/frontend are built with **mock data first**, then wired to FastAPI endpoints.

---

## 10. Build sequence (gated — one screen at a time)

1. **App shell + Login/Auth** — the frame everything lives in (sidebar, top bar, ⌘K, theme; login / signup / reset). *(Build first.)*
2. **Dashboard** — overview, throughput, activity, usage.
3. **Projects list → New Project → Documents / upload**.
4. **Project Overview** + the chain-progress view.
5. **Module review surfaces** — start with **QuantLogix (BOQ)** to show the payoff, then **DrawLogix (viewer)** as the deep one, then Tender / Doc / Cost / Procure.
6. **Copilot drawer**.
7. **Tenant admin** — the customer's users & roles, branding, their billing view, audit.
8. **Host console** — editions, features, pricing, tenants, subscriptions, host users/roles. *(Can be sequenced early — it defines the commercial model and feature-gating the tenant app reads.)*

Each gated on your sign-off, same rhythm as the site.

---

## 11. Decisions to confirm before we build

1. **Default theme for the app** — system (dark-leaning), or force one? *(I lean system, dark-leaning for a work tool.)*
2. **First build** — I recommend **App shell + Login** so every later screen has a frame to slot into. Confirm or redirect.
3. **Drawing viewer depth** — a fully interactive pan/zoom/overlay prototype, or a simpler annotated first pass to start? *(Affects effort; the interactive one is the real product moment.)*
4. **Where it lives** — `apps/app` in the existing Turborepo, served at `app.preckon.com`? *(Assumed.)*
5. **Host console placement** — a separate app on its own subdomain (`host.preckon.com` / `admin.preckon.com`), or a hardened area inside the same app? *(I recommend a separate, hardened surface — cleaner security boundary and it's a different audience.)*
6. **Host build order** — after the tenant core (my default), or **first**, to lock editions/features/pricing before the tenant app reads them? *(If the commercial model isn't settled, building Host first can de-risk it.)*

---

*One design system, extended for density. Roles, shell, and the review pattern locked. Ready to wireframe — starting with the shell + login.*

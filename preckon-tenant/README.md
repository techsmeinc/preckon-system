# Preckon — Tenant Plane (Preckon Core + Construction pack)

A **working** implementation of the Preckon tenant plane from the design decks
(`Preckon/tenant/tenant/*.md`): an AI-native construction operating system where
**agents propose and humans dispose**, built on a domain-neutral kernel with the
Construction domain loaded as data.

- **Stack:** Next.js 15 (App Router, API + UI) · MySQL 8 · **phpMyAdmin** · a
  separate stateless AI worker · Better Auth · Docker.
- **Not static files** — every screen reads the real Core API, which reads MySQL.
- **Deterministic stub agents** — no LLM/API keys needed; the whole runtime
  (gates, provenance, stale/re-plan, audit, map fan-out, personas) runs and is
  tested deterministically. Swapping in real Claude calls is a change to
  `worker/src/agents.mjs` only.

---

## Quick start (Docker — one stack)

```bash
cd preckon-tenant
docker compose up --build -d          # MySQL + phpMyAdmin + app + worker
docker compose run --rm seed          # register the pack + seed demo tenant/owner/project
```

Then open:

| What | URL | Notes |
|---|---|---|
| **App** | http://localhost:3100 | login `owner@riverside.build` / `preckon-tenant-2026` (tenant owner — a customer identity, separate from Host staff) |
| **phpMyAdmin** | http://localhost:8081 | server `db`, user `root`, password `preckon` |
| MySQL | `localhost:3308` → 3306 | database `preckon_tenant` |
| Worker | http://localhost:4000/healthz | stateless; no DB access |

Try it: sign in → pick the **Riverside School** project → open **TenderLogix** in
the sidebar → **▶ TenderLogix (walking skeleton)** → confirm the `tender_summary`
in the review queue (watch the pursuit advance `received → qualifying`) → confirm
the `boq_line`s → edit the confirmed summary and hit **Re-run stale** to watch the
re-plan.

---

## The one deliberate divergence: phpMyAdmin ⇒ MySQL ⇒ no RLS

The design is written for **PostgreSQL Row-Level Security** as the tenant-isolation
backbone. phpMyAdmin only manages **MySQL/MariaDB**, which has no RLS. Per the
chosen requirement (phpMyAdmin), tenancy is instead enforced in the **application
repository layer**:

- Every tenant-scoped table keeps `tenant_id`.
- Every scoped query carries `AND tenant_id = ?` (see `src/lib/store.ts`,
  `src/lib/context.ts` — `requireProject()` is the choke point).
- The `test/tenancy.test.ts` suite asserts a cross-tenant read returns zero rows.

Everything else in the design is preserved (see the translation header in
`db/schema.sql`). `pgvector` semantic search is the other MySQL casualty —
retrieval is stubbed (a `FULLTEXT` index stands in), which the skeleton + pack
don't need.

---

## Architecture (maps 1:1 to the design)

```
 Browser (Next.js UI, src/app/page.tsx)
    │  /api/v1/*  (cookie session)
    ▼
 Preckon Core  (Next.js API + src/lib/*)  ── trusted process ──┐
    • artifact store (§2)      • ABI syscalls (§3)              │  MySQL 8
    • workflow runtime (§4)    • orchestration/jobs (§5)        │  (all tenant
    • personas (§6)            • ingestion (§7)                 │   tables)
    • entitlements (§8)        • audit hash-chain (§9)          │
    • memory/library (§M)      • domain pack loader (§D)        │
    │  enqueueJob → HTTP  ▲ POST /api/internal/jobs/{id}/result │
    ▼                     │  (service token)                    ▼
 AI Worker (worker/, separate container) ── stateless, NO DB access (§5.1) ──
    • deterministic stub agents for every job_type
```

- **ABI (§3):** four syscalls only — `emitArtifact`, `readArtifacts`,
  `enqueueJob`/`onJobResult`, `requestReview` (`src/lib/abi.ts`). Core materializes
  the worker's proposals; the worker never writes the store.
- **Trust boundary (§5.1):** the worker package has **no** DB driver at all
  (`test/trust-boundary.test.ts` asserts this structurally).
- **Runtime (§4):** deterministic fixpoint scheduler — agent steps, review gates
  (`awaiting_review` → resume on confirm), `map` fan-out/fan-in, partial re-runs.
- **Lifecycle (§1.6/§2):** the bid-pursuit state machine is **pack data**; Core
  validates transitions, never their meaning.
- **Audit (§9):** append-only, per-tenant SHA-256 hash chain via the
  `append_audit_event` MySQL procedure; `GET /api/v1/audit/verify` re-walks it.

## The Construction pack (all data, no Core change — §D)

Registered by `scripts/seed.mjs` from `src/lib/pack/construction.ts`:
**16 artifact types**, **19 agents** (15 workers + Knowledge service + 3 supervisor
personas), **11 workflows** + the walking skeleton, the **bid-pursuit lifecycle**,
the **6-role template** (+ `bid.approve`), and library collections. The manifest is
the authoritative declaration (one `domain` row).

---

## Local development (without Docker for the app)

```bash
cp .env.example .env         # then set DATABASE_PORT=3308 to reach the compose DB
npm install
docker compose up -d db      # just MySQL (loads db/schema.sql on first init)
npm run seed                 # register pack + demo tenant
# Run the worker and app in two terminals:
node worker/src/server.mjs   # :4000
npm run dev                  # :3100  (set PORT=3100)
```

## Tests

```bash
docker compose up -d db && npm run seed   # tests need a seeded MySQL on :3308
npm test
```

| Suite | Proves |
|---|---|
| `test/skeleton.test.ts` | the 7 §S steps end-to-end: ingest → tender → **gate pause** → confirm → **resume** → boq → gate, **provenance**, **stale propagation**, **supersede/re-run**, and **audit chain verifies** |
| `test/tenancy.test.ts` | app-layer tenant isolation (cross-tenant read → 0 rows) — the RLS-equivalent |
| `test/trust-boundary.test.ts` | the worker declares no DB dependency and imports no store module (§5.1) |

The skeleton test drives the real runtime with an **in-process dispatcher** (runs
the worker's deterministic compute directly), so it needs no worker container and
is fully deterministic.

## Selected API surface (`/api/v1`, cookie-authenticated)

`GET /entitlements` · `GET /workflows` · `GET /personas` ·
`GET/POST /projects` · `GET /projects/{pid}/lifecycle` ·
`POST /projects/{pid}/runs` · `GET /projects/{pid}/runs/{rid}` ·
`POST …/runs/{rid}/rerun-stale` · `POST …/runs/{rid}/review` ·
`GET /projects/{pid}/review-queue` ·
`POST /projects/{pid}/artifacts/{id}/confirm|reject` · `PATCH …/artifacts/{id}` ·
`GET …/artifacts/{id}/trace` (defensibility view) ·
`POST /projects/{pid}/files` (upload + ingest) ·
`…/conversations` + `/messages` (persona chat) ·
`GET/POST …/deviations/{id}/approve` · `GET /audit` · `GET /audit/verify`.
Service-to-service: `POST /api/internal/jobs/{id}/result`, `POST /api/internal/entitlements`.

## Project layout

```
db/schema.sql                 all tenant tables + audit procedure + views
scripts/seed.mjs              registers the pack + seeds demo tenant/owner/project
src/lib/                      Core: db, abi, store, runtime, jobs, lifecycle,
                              persona, entitlements, audit, context, http, ...
src/lib/pack/                 the Construction pack as data (+ core permission catalog)
src/app/api/                  the /api/v1 + /api/internal + /api/auth routes
src/app/login/                sign-in screen (DS-01)
src/app/(app)/                the product app: shell (workspace switcher, ⌘K,
                              docked Copilot) + one page per area
  overview (dashboard) · projects · library · admin · settings
  projects/[pid]/             project workspace — the tab bar IS the chain, and
                              nothing else: overview · documents ·
                              modules/[key] (one per licensed module).
                              The machine room — runs/[rid] · trace · standards ·
                              colleagues — is linked from the project overview,
                              off the tab bar.
src/lib/surfaces/             the seven purpose-built module screens —
                              tender · drawings · specs · boq · estimate ·
                              schedule · procurement (+ generic fallback and
                              common.tsx, the shared review drawer/trace)
src/lib/chain.ts              derives each stage's state from real artifacts+runs
src/lib/bundles.ts            per-project fan-out for the dashboard/list views
src/lib/shell.tsx             ⌘K command palette + Copilot drawer
src/lib/brand.ts              --brand white-label accent + local display prefs
src/lib/ui.tsx                shared kit (useApi/Toast/StatusChip/Drawer/Skeleton) — ported from Host
src/lib/apiclient.ts          typed fetch client · lib/catalog.tsx  purpose-built artifact tables
src/app/globals.css           DS-01 design system, light-default with a dark toggle
worker/                       the stateless AI worker (no DB) + stub agents
test/                         vitest integration + trust-boundary tests
e2e/                          Playwright — login + full core-loop journey
docker-compose.yml            db · phpmyadmin · app · worker · seed
```

## The product app (what an estimator sees)

Built from the app blueprint: dense, data-first, mono for every number, one
status colour language (`queued` slate · `processing` blue · `needs review`
amber · `approved` teal). Light by default, dark on the toggle.

- **Dashboard** — the cross-project review queue (oldest proposal first), bid
  deadlines read from each tender's submission date, chain progress per project,
  and the activity feed off the audit chain.
- **Project workspace** — the tab bar *is* the chain, each stage carrying a
  status dot derived from its own artifacts. Stages come from the tenant's
  **licensed modules**, so an edition without CostLogix simply has no Estimate tab.
- **The seven surfaces** — TenderLogix requirement register · **DrawLogix**
  pan/zoom viewer with a recognition overlay · DocLogix clause browser ·
  QuantLogix bill of quantities · CostLogix priced bill + live cost buildup ·
  PlanLogix Gantt with a computed critical path · ProcureLogix packages with
  their real BOQ scope. Every one shares the same review pattern: the proposal,
  its provenance, accept or correct.
- **Copilot** (⌘/) and the **⌘K palette** are global; Copilot threads are real
  supervisor-persona conversations, so answers cite the artifacts they read.
- **Admin** — team & roles, white-label branding (`--brand`, saved workspace-wide
  via `PUT /settings`), plan & usage resolved from the entitlement snapshot.

### Languages — English · العربية · Français

The whole app chrome is localized, and Arabic runs the layout right-to-left.

- **Two levels.** An admin sets the workspace language under **Admin → Branding**
  (stored in `tenant_setting.theme.locale`, served by `/api/v1/settings`); each
  person can override it for themselves under **Settings → Preferences**. Leaving
  the personal setting on *Workspace default* means a later admin change reaches
  them without their doing anything.
- **RTL is layout, not a mirror image.** `globals.css` uses logical properties
  throughout, so `<html dir="rtl">` flips the shell, tables, drawers and Gantt on
  its own; only transforms and directional glyphs (`.dir-flip`) need explicit
  rules. The **drawing canvas is deliberately not mirrored** — a plan is a plan,
  and flipping it would misrepresent the geometry and its grid references.
- **Numbers follow the locale** via `Intl` (`lib/i18n`), with one deliberate
  exception: Arabic keeps Western digits. A bill of quantities is read against
  drawings, rate books and exports that all use them, and mixing numeral systems
  invites transcription errors on figures that end up in a submitted price.
- **One key = one whole sentence** (`lib/i18n/en.ts` is the source of truth;
  `Dict` is derived from it, so a missing translation is a compile error).
  Sentences are never assembled from fragments — word order differs per language
  and Arabic reverses it. Counts use CLDR plural forms, including Arabic's six.
- **Project content is not translated.** BOQ descriptions, clauses and activity
  names are whatever the agents wrote; only the product's own words change.

### Where the UI is honest about a gap

- **DrawLogix is a schematic.** `drawing_measurement` carries no vector geometry,
  so elements are laid out on a representative plan; the banner on screen says
  so. The measurement, confidence, status and trace you act on are all real.
- **Procurement stops at the package.** There is no vendor or RFQ entity in the
  schema, so no vendor list is shown.
- **Cost mark-ups and notification toggles are device-local** — they are
  estimator chrome, deliberately outside the audited store.

## Notes & known simplifications

- File upload collapses the design's presigned-URL + async MinIO ingestion into a
  synchronous local-FS upload + text extraction (dev shape; noted in
  `src/app/api/v1/projects/[pid]/files/route.ts`).
- Semantic retrieval (`pgvector`) is stubbed — not required by the skeleton/pack.
- Agents are deterministic stubs; confidence is fixed at 0.82 so review gates
  actually pause for a human in the demo.

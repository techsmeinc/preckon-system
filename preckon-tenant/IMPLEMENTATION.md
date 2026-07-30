# Preckon — Implementation & Pipeline Document

**One document, everything in it:** what was built, how the design maps to code, and every pipeline (build, runtime, provisioning, request). This is the implementation companion to the design decks in `Preckon/tenant/tenant/` (the master spec `preckon-tenant-platform-design.md` and the pack deck `preckon-construction-pack-design.md`).

- **Tenant plane (the workspace):** `preckon-tenant/` — Next.js 15 + MySQL 8 + a stateless AI worker.
- **Host plane (the control plane):** `preckon-host/` — pre-existing; extended here to provision tenants.
- **Status:** working, Dockerised, tested (backend vitest 5/5, frontend Playwright 2/2), both planes connected.

---

## 1. What Preckon is (in one paragraph)

Preckon is an **AI-native construction operating system**. A construction company bids on tenders; normally that means days of manual work reading documents, measuring drawings, building a bill of quantities, pricing it, checking compliance, and writing a proposal. Preckon does that work with **AI agents that propose**, while **a human confirms every step** — *agents propose, humans dispose*. The engine (**Preckon Core**) is domain-neutral; **construction is loaded as data (a "pack")**. Everything is auditable end-to-end, which is what makes an AI-produced bid defensible.

---

## 2. The two planes and how they connect

```
        ┌──────────────────────────────┐        provision (§1.5)         ┌──────────────────────────────┐
        │      HOST  (control plane)    │  POST /internal/tenants/{id}/   │     TENANT  (the workspace)   │
        │      preckon-host  :3000      │  bootstrap  (service token)     │     preckon-tenant :3100      │
        │                              │ ───────────────────────────────▶ │                              │
        │  • editions / features        │   host.docker.internal:3100     │  • Preckon Core (kernel)      │
        │  • tenants (create/list)      │                                 │  • Construction pack (data)   │
        │  • entitlements               │                                 │  • the AI worker (:4000)      │
        │  • staff identity pool        │                                 │  • tenant identity pool       │
        │    admin@techsme.com          │                                 │    owner@riverside.build      │
        └──────────────────────────────┘                                 └──────────────────────────────┘
                MySQL :3307                                                       MySQL :3308 · phpMyAdmin :8081
```

- **Separate identity pools (design §0.2):** Host *staff* (`admin@techsme.com`) and tenant *users* (`owner@riverside.build`) live in different databases and different Better-Auth instances. The Host admin email is **rejected** on the tenant (401).
- **The Host provisions tenants:** creating a tenant in the Host calls the tenant plane's bootstrap endpoint, which creates the owner in the tenant identity pool, seeds roles/settings, and caches the entitlement snapshot (licensed modules derived from the Host edition).
- **Same tenant id in both planes:** a tenant is one id; the Host lists it, the tenant plane runs it.

---

## 3. Stack & deliberate divergences from the design

| Concern | Design spec | This implementation | Why |
|---|---|---|---|
| App framework | Next.js 15 + Drizzle | Next.js 15 (App Router), `mysql2` | Mirrors the Host's proven pattern |
| Database | PostgreSQL 16 + RLS | **MySQL 8 + phpMyAdmin** | Requested; MySQL has no RLS |
| Tenant isolation | Postgres Row-Level Security | **App-layer** — every scoped query carries `AND tenant_id = ?` (`lib/context.ts`, `lib/store.ts`) | MySQL has no RLS; enforced in the repository layer instead |
| Auth | Better Auth | Better Auth (unchanged) | — |
| AI worker | Python/FastAPI + arq/Redis | **Node HTTP worker, no DB** (`worker/`) | Preserves the §5.1 trust boundary with fewer moving parts |
| Agents | LLM (Opus/Haiku) | **Deterministic stub agents** | Build-plan M1: prove the kernel without model nondeterminism; swap-in is one file |
| Object storage | MinIO/R2 presigned | **Local filesystem** (`/app/.uploads`) | Dev/self-hosted collapse |
| Retrieval | pgvector semantic search | **MySQL FULLTEXT stand-in** | No pgvector in MySQL |
| Audit chain | plpgsql | **MySQL stored procedure** `append_audit_event` (per-tenant hash chain) | Same tamper-evident property |

Everything else follows the spec faithfully: the artifact store, the four-syscall ABI, the deterministic runtime, gates/map/re-plan, personas, entitlements, audit, and the whole construction pack.

---

## 4. The design → code map (Preckon Core)

| Design section | What it is | Implemented in |
|---|---|---|
| §0/§X conventions | UUIDv7, money-minor, error envelope, use-case skeleton | `lib/ids.ts`, `lib/errors.ts`, `lib/usecase.ts`, `lib/db.ts`, `lib/http.ts` |
| §1 IAM / RBAC | app_user, roles, permissions, project membership | `db/schema.sql`, `lib/context.ts`, `/api/v1/me`, `/users`, `/roles` |
| §1.5 Provisioning | Host bootstraps a tenant | `lib/provisioning.ts`, `/api/internal/tenants/[id]/bootstrap` |
| §1.6 / §2 lifecycle | opaque project state machine | `lib/lifecycle.ts`, `/lifecycle` |
| §2 Artifact store | versioned graph, provenance, stale re-plan | `lib/store.ts` (emit/read/confirm/reject/edit/markDownstreamStale) |
| §2.1 Type registry | artifact-type vocabulary + JSON schemas | `lib/pack/schemas.ts`, seeded to `artifact_type` |
| §3 Agent ABI | four syscalls, unforgeable context | `lib/abi.ts` (emitArtifact/readArtifacts/requestReview) |
| §4 Workflow runtime | deterministic scheduler, gates, map, rerun-stale | `lib/runtime.ts` |
| §5 AI orchestration | job envelope/result, tier routing, confidence, auto-accept | `lib/jobs.ts`, `worker/`, `/api/internal/jobs/[id]/result` |
| §6 Orchestrator / personas | supervisor contract, deviations, chat | `lib/persona.ts`, `/personas`, `/conversations`, `/deviations` |
| §7 Ingestion / retrieval | upload, text extraction, chunks | `/api/v1/projects/[pid]/files`, `chunk` table |
| §8 Entitlements | Host snapshot → licensed workflows/personas | `lib/entitlements.ts`, `/entitlements`, `/api/internal/entitlements` |
| §9 Audit | append-only, hash-chained, verify | `lib/audit.ts`, `append_audit_event` proc, `/audit`, `/audit/verify` |
| §M Memory | library (rate books, precedent), decision outcomes | `library_entry`, `decision_outcome`, `/library` |
| §D Domain pack | the whole construction pack as data | `lib/pack/construction.ts` (+ `core.ts`, `schemas.ts`) |

**The construction pack (data, §D):** 16 artifact types · 19 agents (15 workers, Knowledge service, 3 personas) · 11 workflows (7 Logix + BidQualification/RiskReview/BidAssembly/ClarificationLoop) · the bid-pursuit lifecycle · 6-role template · `bid.approve` permission add. Registered by `lib/provisioning.ts::seedCatalog()`.

---

## 5. Build pipeline — how it was implemented, in order

### 5a. Backend / walking skeleton (the kernel first)
Built against the §S walking skeleton so nothing entered the ABI that the slice didn't need.

```
schema  →  core lib  →  artifact store  →  ABI  →  runtime  →  job seam  →  pack data  →  worker  →  API routes
(§2 tables)  (db/errors/  (§2 emit/read/  (§3)   (§4 gates/  (§5 envelope/ (§D 16/19/11) (stub)   (30+ endpoints)
             audit/ctx)    stale)                map/rerun)  callback)
```

**Milestones (from the build plan):**
- **M1 — Kernel proof (no AI):** store + runtime + gates + job seam driven by a **stub** so the deterministic machinery was proven before any model nondeterminism.
- **M2 — Real (stub) agents:** the 3 skeleton agents (Document → Tender → BOQ) behind the seam; then the full pack's agents.
- **M3 — UX + eval:** review UI and tests.

Verified by `test/skeleton.test.ts` (all 7 §S steps: gate pause/resume, provenance, stale propagation, supersede), `test/tenancy.test.ts` (app-layer isolation), `test/trust-boundary.test.ts` (worker has no DB).

### 5b. Frontend console (8 phases, DS-01, verified each)
Rebuilt from a single cramped page into a proper multi-screen console on the **Host's design system** (teal `#15C2A8` on ink-navy, General Sans/Inter/JetBrains Mono), reusing the Host's shared-kit pattern.

| Phase | Delivered | Files |
|---|---|---|
| 1 Foundation | DS-01 `globals.css`, `_ui` kit (`useApi`/`Toast`/`StatusChip`/`Drawer`/`Skeleton`), API client, console shell, login, `/me` | `lib/ui.tsx`, `lib/apiclient.ts`, `app/(app)/layout.tsx`, `app/login/` |
| 2 Project workspace | header + 7-tab sub-nav + **pursuit stepper board** | `app/(app)/projects/[pid]/layout.tsx` + `page.tsx`, `lib/project.tsx` |
| 3 Core loop | runs (start/list), **run detail timeline** (gates/map/deviations), **review queue** (confirm/reject/edit/inspect), rerun-stale | `projects/[pid]/runs`, `.../review` |
| 4 Module workspaces | module grid + per-Logix workspace with **purpose-built output tables** | `projects/[pid]/modules`, `lib/catalog.tsx` |
| 5 Colleagues | persona roster + chat + scoped review lens | `projects/[pid]/colleagues` |
| 6 Documents & Trace | upload+ingest, artifact graph, **defensibility trace** | `projects/[pid]/documents`, `.../trace` |
| 7 Tenant admin | Library, Users & roles, Settings/plan | `app/(app)/library`, `users`, `settings` |
| 8 Proof | Playwright e2e (login + core loop) | `e2e/core-loop.spec.ts` |

---

## 6. Runtime pipeline — how one run flows end-to-end

```
User clicks "Start run"  (UI: Runs tab → Start a run)
        │  POST /projects/{pid}/runs  {workflow_key}   (perm workflow.run + entitlement check)
        ▼
startRun():  create workflow_run + a workflow_run_step per node  ──▶  advanceRun()  (deterministic scheduler)
        │
        ▼  dispatch each ready agent step
enqueueJob():  write ai_job(queued) → inline confirmed inputs → POST envelope to the worker (:4000)
        │                                           (worker has NO DB — trust boundary §5.1)
        ▼
Worker (stub agent):  compute schema-valid outputs  →  POST /api/internal/jobs/{id}/result  (service token)
        │
        ▼
onJobResult():  materialise outputs via the ABI emitArtifact  →  step completed  →  advanceRun()
        │            (auto-accept if confidence ≥ threshold, else status=pending)
        ▼
Gate node:  run → awaiting_review   (event_outbox: gate.awaiting)
        │
        ▼  human in the Review queue
POST /artifacts/{id}/confirm  →  resumeGates()  →  advanceRun()  (next step dispatches)
        │                        + advanceLifecycle()  → project state e.g. received → qualifying
        ▼
all steps complete  →  run completed
```

**Re-plan (§2.4):** editing a confirmed artifact (`PATCH /artifacts/{id}`) supersedes it and marks everything reachable via provenance edges **stale** (recursive CTE); `POST …/rerun-stale` re-runs only the stale-producing steps, superseding their outputs with fresh versions.

**Every hop is audited** on the per-tenant hash chain; every artifact traces back to its provenance, producing job (model, confidence), and the human who confirmed it (`/artifacts/{id}/trace`).

---

## 7. Provisioning pipeline — Host manages tenants (tight)

```
Host admin (localhost:3000) → Tenants → "New tenant"  (name, subdomain, owner email, edition)
        │  POST /host/v1/tenants                                   (perm tenant.create)
        ▼
Host inserts tenant record  →  derives licensed modules from the edition's module.* features
        │
        ▼  tenantPlane.bootstrap()  (lib/integrations.ts, service token, host.docker.internal:3100)
POST /api/internal/tenants/{id}/bootstrap   (tenant plane)
        │
        ▼  bootstrapTenant()  (idempotent by tenant_id):
        │    1) seed 6 roles + permission presets from the pack template
        │    2) tenant_setting from pack defaults
        │    3) create owner in the TENANT identity pool (Better Auth) + app_user(active) + owner role
        │    4) cache entitlement_snapshot (licensed_modules from the edition)
        │    5) tenant_bootstrap marker + audit tenant.bootstrapped
        ▼
Host UI shows the owner's sign-in + "Open workspace ↗"  →  owner logs into :3100 immediately
```

**Verified live:** Host created "Acme"/"Bluewater" → tenant bootstrapped (real call) → those owners logged into :3100 with the Owner role and edition-licensed modules. The demo **Riverside** tenant is registered in the Host with the *same* id (`00000000-…-01`) so the Host lists the very workspace you log into. Best-effort: a tenant-plane outage never fails the Host record (retryable).

---

## 8. Request pipeline — how every API call is scoped & audited

```
Request (Better Auth session cookie)
   → route() wrapper (lib/http.ts)
   → getAuthContext(): resolve app_user by (auth_user_id, tenant_id) → load permission set → set ctx.tenantId
   → requirePermission(ctx, 'x')            (§1.2 — may)
   → requireProject(ctx, pid)               (membership or project.read_all — app-layer tenancy)
   → assertWorkflowLicensed()               (§8 — licensed) where relevant
   → useCase(actor, (conn, audit) => { … mutation … audit(spec) })
        → the mutation and its audit event(s) commit in ONE transaction on the per-tenant hash chain
   → error → toErrorEnvelope() → { error: { code, message } }
```

Internal endpoints (`/api/internal/*`) use `serviceRoute()` + a shared bearer token instead of a user session.

---

## 9. Data model (MySQL) — the tables

Better Auth (`user`/`session`/`account`/`verification`) · **catalog** (`domain`, `artifact_type`, `agent`, `workflow`, `supervisor_profile`, `tenant_permission`) · **IAM** (`app_user`, `tenant_role`, `tenant_role_permission`, `user_role`, `tenant_invite`, `project`, `project_member`, `tenant_bootstrap`, `tenant_setting`) · **graph** (`artifact`, `artifact_provenance`) · **runtime** (`workflow_run`, `workflow_run_step`, `ai_job`) · **orchestrator** (`orchestrator_conversation`, `orchestrator_message`, `run_deviation`) · **ingestion** (`file`, `file_page`, `chunk`) · **entitlements** (`entitlement_snapshot`, `usage_outbox`) · **memory** (`library_entry`, `decision_outcome`) · **audit** (`audit_event` + `append_audit_event` proc) · **eventing** (`event_outbox`). Views: `user_effective_permission`, `review_queue`, `calibration_stat`. Full DDL in `db/schema.sql`.

---

## 10. Testing & verification

| Suite | What it proves | Command |
|---|---|---|
| `test/skeleton.test.ts` | All 7 §S steps: gate pause/resume, provenance, stale propagation, supersede, audit-chain verifies | `npm test` |
| `test/tenancy.test.ts` | Cross-tenant read returns zero rows (app-layer isolation) | `npm test` |
| `test/trust-boundary.test.ts` | The worker package declares no DB driver / imports no store | `npm test` |
| `e2e/core-loop.spec.ts` | Real browser: login → start run → gate → review → confirm | `npm run test:e2e` |

All green: **backend 5/5, e2e 2/2.** Both images build clean; `tsc --noEmit` passes.

---

## 11. How to run (both planes)

```bash
# Tenant plane (workspace)
cd preckon-tenant
docker compose up --build -d          # mysql · phpmyadmin · app · worker
docker compose run --rm seed          # catalog + construction pack + demo tenant/owner/project
# → http://localhost:3100   login  owner@riverside.build / preckon-tenant-2026
# → http://localhost:8081   phpMyAdmin (server: db, root/preckon)

# Host plane (control plane)
cd preckon-host
docker compose up --build -d
docker compose run --rm seed          # owner staff + registers the demo tenant (matching id)
# → http://localhost:3000   login  admin@techsme.com / preckon-admin-2026
```

**Try the loop:** tenant → open the Demo project → **Runs** → *Start a run* → "TenderLogix (walking skeleton)" → **Review** → Confirm the `tender_summary` (pursuit advances) → Confirm the BOQ lines → run completes → **Trace** shows any line's provenance + model + who confirmed.

**Try provisioning:** Host → **Tenants** → **New tenant** (unique subdomain + owner email) → get the owner's credentials + **Open workspace ↗** to their tenant at :3100.

---

## 12. Ports & credentials (quick reference)

| Thing | URL / port | Login |
|---|---|---|
| Tenant app | http://localhost:3100 | owner@riverside.build / preckon-tenant-2026 |
| Tenant phpMyAdmin | http://localhost:8081 | root / preckon (server `db`) |
| Tenant MySQL | localhost:3308 | root / preckon |
| Tenant AI worker | localhost:4000 | (service token) |
| Host console | http://localhost:3000 | admin@techsme.com / preckon-admin-2026 |
| Host MySQL | localhost:3307 | root / preckon |

---

## 13. Module / file map (tenant plane)

```
preckon-tenant/
  db/schema.sql                 all tables + append_audit_event proc + views
  scripts/seed.mjs              seedCatalog + bootstrapTenant + demo project
  src/lib/
    db · errors · ids · http · auth · context · usecase · audit   (core)
    store.ts                    §2 artifact store
    abi.ts                      §3 four syscalls
    runtime.ts                  §4 scheduler (gates/map/rerun-stale/lifecycle)
    jobs.ts                     §5 job seam
    persona.ts · entitlements.ts · lifecycle.ts · provisioning.ts
    pack/{core,schemas,construction}.ts   §D construction pack (data)
    ui.tsx · apiclient.ts · icons.tsx · catalog.tsx · project.tsx   (frontend kit)
  src/app/api/                  /v1 (user) · /internal (service) · /auth
  src/app/(app)/                the console: overview · projects · library · users · settings
    projects/[pid]/             pursuit · documents · modules/[key] · runs/[rid] · review · colleagues · trace
  worker/                       stateless AI worker (no DB) + stub agents
  test/ · e2e/                  vitest + playwright
  docker-compose.yml · Dockerfile · worker/Dockerfile
```

---

*This document is the single, self-contained implementation + pipeline reference. The authoritative design remains `Preckon/tenant/tenant/preckon-tenant-platform-design.md` (Core) and `preckon-construction-pack-design.md` (the pack); everything above is how those were realised as working, tested, Dockerised software.*

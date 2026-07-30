# Preckon Tenant Platform — Backend Design

**Document:** `preckon-tenant-platform-design.md`
**Version:** 1.1 (generic framework). Domain-neutral; each domain pack is a separate implementation deck. §6.4 adds the persona roster — the supervisor generalization behind a "digital company."
**Status:** Complete and closed. Preckon Core — IAM (§1), the three keystones (§§2–4), AI orchestration (§5), the Orchestrator/Copilot (§6), ingestion + retrieval (§7), entitlements (§8), audit + observability (§9), Memory/flywheel (§M), the domain-pack mechanism (§D), and cross-cutting conventions (§X). This document is the **domain-neutral framework**; the contents of any one pack — agents, workflows, artifact types, and the persona roster — are specified in that pack's own implementation deck (Construction is the first).
**Companion:** `preckon-host-backend-design.md` v1.0 (the platform/control plane). This doc is the tenant plane.

---

## North star

> **Preckon** is not a collection of construction modules. It is an AI-native construction operating system where **workflow products** — TenderLogix, QuantLogix, DrawLogix, CostLogix — are powered by specialized digital construction agents running on **Preckon Core**. Agents perform the work. Humans approve the decisions. Preckon Core remembers and improves every time.

Everything in this spec serves that statement. **Preckon** is the product; **Preckon Core** is the engine at its center — the artifact store, the ABI, the workflow runtime, orchestration, audit, and Memory. Core plays the operating-system *kernel* role; **agents** and **workflows** are *userland*. A **workflow** is the internal object; a **workflow product** is what the customer buys. The "remembers and improves" line is a named Core concern — the **flywheel** (see §M in What's next).

One consequence is load-bearing: **Preckon Core is domain-neutral.** Nothing in §§1–5 knows about construction — the store, ABI, runtime, and orchestration are generic infrastructure. Every construction concept lives in *userland*: the artifact-type vocabulary (`boq_line`, `drawing_measurement`, …), the agents, and the workflows. The one construction-named element on the platform is **Construction Copilot**, itself a userland supervisor agent — which is why the supervisor's Core-level contract is just the generic `Orchestrator` role (§6). Keeping Core clean of domain is deliberate: it's what makes adding a workflow a data change, and it makes a whole domain a **pack** — a namespaced bundle of types, agents, workflows, role templates, and library collections loaded onto generic Core (§D). Construction is the first such pack; the same Core could carry legal review, underwriting, or diligence without a rewrite.

---

## Reading order

The tenant plane is an **operating system**, and **Preckon Core** is its engine. Core runs *workflows*; workflows compose *agents*; agents read and write one shared, per-project **artifact graph**. Business logic is split in two: **agents** (reusable capabilities, defined by their I/O) and **workflows** (data-only DAGs that wire agents together). A project runs whichever workflows it needs; every run writes the same graph. In OS terms, Core is the *kernel*; agents and workflows are *userland*.

This chunk fixes the three load-bearing keystones and nothing else:

- **§2 — the artifact store + type registry** (the filesystem)
- **§3 — the Agent Contract / ABI + agent registry** (the syscall surface)
- **§4 — the workflow schema, runtime + `workflow_run`** (the process model)

Everything is designed *against* **§S, the walking skeleton** — a thin TenderLogix slice driven through every syscall. Anything §S does not need is not in the ABI. That is what keeps this an operating system and not framework astronautics.

**Deferred to the next chunks** (called out so they are not gold-plated here): Appendices A/B/C (agent catalog, workflow catalog, ER + Host contract).

---

## §0 — Conventions & architecture

Inherited from the Host spec unless noted.

**Plane.** Single PostgreSQL 16 database. All tenant-plane tables live under **Row-Level Security (RLS)**. Host/platform tables (editions, features, pricing, tenants, host users) live in the platform schema **outside** tenant RLS and are never joined to from here — the tenant plane only *reads resolved entitlements* over the service-to-service contract (§8, deferred).

**Identity of a row.** App-layer **UUIDv7** primary keys (Drizzle-generated). DDL shows `id uuid primary key` with no DB default — the application supplies the value. This preserves time-ordering without exposing sequences.

**Scoping.** Every tenant-plane row carries `tenant_id uuid not null`. Most domain rows also carry `project_id uuid not null` — the **project is the namespace** a run and its artifacts live in. Two GUCs are set per transaction by the `withTenant()` / `withProject()` scoped repositories:

```
set local app.tenant_id  = '<uuid>';
set local app.project_id = '<uuid>';   -- for project-scoped work
```

RLS enforces tenant isolation in the database; project scoping and membership are enforced at the repository layer plus, where shown, an RLS predicate on `app.project_id`. An agent **never** receives a raw connection — it only calls the ABI (§3), which sets these GUCs from the run context. Tenancy is therefore a hard boundary, not a convention.

**Money & time.** Integer minor units in `bigint`, currency explicit, no FX (tenant plane touches money only in cost lines). Timestamps `timestamptz not null default now()`. History is append-only: artifacts are versioned by supersession, never mutated in place (§2).

**Cross-cutting conventions** — API surface, error model, concurrency, security/isolation, eventing, and data lifecycle — span all sections and are consolidated in **§X**.

**Enums.** Native Postgres enums for closed sets; `text` + check for evolving sets.

```sql
create type artifact_source as enum ('human', 'agent');
create type artifact_status as enum ('pending', 'confirmed', 'rejected', 'stale', 'superseded');
create type agent_kind      as enum ('worker', 'service', 'supervisor');
create type run_status       as enum ('running', 'awaiting_review', 'completed', 'failed', 'cancelled');
create type step_kind        as enum ('agent', 'gate', 'map');
create type step_status      as enum ('pending', 'running', 'awaiting_review', 'completed', 'skipped', 'failed');
```

**Project namespace stub.** Full IAM/provisioning is §1 below. Core needs only the namespace primitive up front, defined here so the artifact store's FKs resolve (§1.4 makes this table canonical and adds membership):

```sql
create table project (
  id          uuid primary key,
  tenant_id   uuid not null,
  name        text not null,
  code        text,
  client_name text,
  status      text not null default 'active',
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table project enable row level security;
create policy project_tenant_isolation on project
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Every scoped table below follows the same `enable row level security` + `tenant_id = current_setting('app.tenant_id')::uuid` policy pattern; the artifact table shows it explicitly, the rest are elided for length but assumed.

---

## §S — The walking skeleton (the forcing function)

The ABI is exactly what this slice needs — no more. It runs end-to-end before any second module is written.

**Slice: minimal TenderLogix.**

1. A `project` exists. A user uploads one tender PDF.
2. **Document Agent** classifies/splits it → emits `document` artifacts (non-reviewable, auto-confirmed).
3. **Tender Agent** reads the documents → emits one `tender_summary` **proposal** (three fields: submission deadline, format, one mandatory requirement), `status = pending`, with `confidence` and provenance edges to the source documents.
4. **Review gate.** The workflow pauses (`awaiting_review`). A human confirms `tender_summary` (or edits it → new version).
5. **BOQ Agent** reads the *confirmed* `tender_summary` → emits 2–3 `boq_line` **proposals**, provenance → the summary.
6. Human confirms the BOQ lines. Downstream can now `readArtifacts({ type: 'boq_line', status: 'confirmed' })`.
7. **Re-plan check.** Human edits the confirmed `tender_summary`. Every downstream artifact (the BOQ lines) is marked `stale`. Re-running the BOQ step supersedes them with fresh versions.

This exercises, and thereby *defines*, the four syscalls: `emitArtifact` (proposal + provenance + confidence + scope-from-context), `readArtifacts` (current confirmed upstream), `enqueueJob` / `onJobResult` (the LLM call behind each agent), `requestReview` (surface proposals / auto-accept). It exercises the store (versioning, provenance, stale propagation), the run table (stepping through an agent node, a gate node, resume-on-confirm), and RLS. Everything in §§2–4 earns its place by being on this path.

---

## §1 — Tenant IAM, RBAC, invites & provisioning

The substrate the keystones sit on: who a tenant's people are, what they may do, how they get in, and how a tenant comes into existence. This section also closes the provisioning-contract gap left open in the Host spec.

### §1.1 Users & the auth boundary

**Authentication is Better Auth; authorization is Preckon Core.** Better Auth owns the credential tables (`user`, `session`, `account`, `verification`) — password/SSO, session issuance, verification. Those are referenced, never redefined here. The tenant plane owns the **authorization** record: `app_user` is the tenant-scoped profile that carries status and links to roles. A user belongs to exactly one tenant (single-tenant users; multi-tenant membership is a deliberate non-goal for now).

```sql
create table app_user (
  id           uuid primary key,
  tenant_id    uuid not null,
  email        text not null,
  name         text,
  avatar_url   text,
  status       text not null default 'invited'
    check (status in ('invited', 'active', 'suspended')),
  auth_user_id text,               -- soft link to the Better Auth user, null until first sign-in
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, email)
);

alter table app_user enable row level security;
create policy app_user_tenant_isolation on app_user
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

On each request: Better Auth resolves the authenticated identity → Core resolves `app_user` by (`auth_user_id`, `tenant_id`) → loads the effective permission set (§1.2) → sets `app.tenant_id` / `app.project_id`. An `invited` user exists in `app_user` before ever authenticating (so invites can be issued and role-assigned up front); `auth_user_id` is filled on first sign-in.

### §1.2 RBAC

Roles are tenant-scoped; the **permission catalog is platform-level** (first-party, fixed set, like `artifact_type`) so authorization keys can't diverge per tenant.

```sql
create table tenant_role (
  id         uuid primary key,
  tenant_id  uuid not null,
  key        text not null,          -- 'owner','admin','precon_lead','estimator','qs_reviewer','viewer', or custom
  name       text not null,
  tier       text not null
    check (tier in ('owner_admin', 'delivery', 'review', 'view')),
  is_system  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table tenant_permission (
  key         text primary key,      -- 'project.create', 'artifact.confirm', ...
  domain      text not null,         -- 'project','artifact','workflow','library','admin','billing','tenant'
  description text not null,
  created_at  timestamptz not null default now()
);

create table tenant_role_permission (
  tenant_id      uuid not null,
  role_id        uuid not null references tenant_role(id),
  permission_key text not null references tenant_permission(key),
  primary key (role_id, permission_key)
);

create table user_role (
  tenant_id  uuid not null,
  user_id    uuid not null references app_user(id),
  role_id    uuid not null references tenant_role(id),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create view user_effective_permission as
select distinct ur.tenant_id, ur.user_id, rp.permission_key
from user_role ur
join tenant_role_permission rp on rp.role_id = ur.role_id;
```

An authz check is one lookup: does `(user_id, permission_key)` exist in `user_effective_permission`. Workflow/agent runs additionally check the **entitlement** read from the Host (§8) — permission says *may*, entitlement says *is licensed to*.

**The permission catalog (seeded):**

| Key | Domain | Grants |
|---|---|---|
| `project.create` | project | create projects |
| `project.read` | project | read projects the user is a member of |
| `project.read_all` | project | read every project in the tenant |
| `project.update` | project | edit project metadata |
| `project.archive` | project | archive/restore projects |
| `project.member.manage` | project | add/remove project members |
| `artifact.read` | artifact | read artifacts + review queue |
| `artifact.confirm` | artifact | confirm/reject proposals |
| `artifact.edit` | artifact | edit artifacts (new version) |
| `workflow.read` | workflow | view workflows, runs, agents |
| `workflow.run` | workflow | start / cancel / re-run workflows |
| `library.read` | library | read reference data |
| `library.manage` | library | edit rate books, standards, precedent |
| `admin.users` | admin | manage users, invites, role assignments |
| `admin.branding` | admin | white-label (logo, brand colour) |
| `admin.settings` | admin | tenant settings (incl. auto-accept threshold) |
| `billing.view` | billing | view plan & usage (read-only from Host) |
| `tenant.transfer_ownership` | tenant | transfer the Owner role |

**System roles & presets** — these six are the **Construction pack's role template**, not Core (§D): Core owns the RBAC *mechanism* and the permission catalog; the *personas* are pack data, so another domain ships its own. They cluster into four tiers (Owner/Admin · Precon lead/Estimator · QS/Reviewer · Viewer):

| Permission | owner | admin | precon_lead | estimator | qs_reviewer | viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| project.create / update / archive / read_all / member.manage | ✓ | ✓ | ✓ | | | |
| project.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| artifact.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| artifact.confirm / edit | ✓ | ✓ | ✓ | ✓ | ✓ | |
| workflow.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workflow.run | ✓ | ✓ | ✓ | ✓ | | |
| library.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| library.manage | ✓ | ✓ | ✓ | | | |
| admin.users / branding / settings | ✓ | ✓ | | | | |
| billing.view | ✓ | ✓ | | | | |
| tenant.transfer_ownership | ✓ | | | | | |

Tiers: `owner_admin` = {owner, admin}, `delivery` = {precon_lead, estimator}, `review` = {qs_reviewer}, `view` = {viewer}. The distinctions that matter: **owner** alone transfers ownership; **estimator** runs workflows but **qs_reviewer** only reviews their output; **precon_lead** is project admin without tenant admin. Tenants may add custom roles later (the tables already allow it; UI/endpoints are deferred). The seed set comes from the tenant's domain pack at bootstrap (§D.4), not from hardcoded Core.

### §1.3 Invites & onboarding

```sql
create table tenant_invite (
  id          uuid primary key,
  tenant_id   uuid not null,
  email       text not null,
  role_id     uuid not null references tenant_role(id),
  token_hash  text not null,          -- store the hash, never the raw token
  status      text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by  uuid,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create unique index tenant_invite_active_idx
  on tenant_invite (tenant_id, email) where status = 'pending';

alter table tenant_invite enable row level security;
create policy tenant_invite_tenant_isolation on tenant_invite
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Flow: an admin issues an invite (creates the `app_user` as `invited` + a `tenant_invite`, emails a link carrying the raw token). On accept, the user authenticates via Better Auth; Core matches the pending invite by `token_hash`, links `auth_user_id`, sets `app_user.status = 'active'`, assigns the role, and marks the invite `accepted`. The partial unique index guarantees one live invite per email.

### §1.4 Project namespace (full)

The `project` table defined in §0 is canonical (it was placed there so §2's FKs resolve — it is not a throwaway). §1 adds **membership**, which decides visibility:

```sql
create table project_member (
  tenant_id  uuid not null,
  project_id uuid not null references project(id),
  user_id    uuid not null references app_user(id),
  added_by   uuid,
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
```

Access model: a user may act on a project if they are a `project_member`, **or** hold `project.read_all` (owner/admin/precon_lead see every project). Project-scoped repositories set `app.project_id` and enforce this; `project.read` alone without membership sees nothing.

### §1.5 Provisioning — the bootstrap contract

This is the gap the Host spec left open. When the Host provisions a tenant (creates the platform-plane tenant record, assigns an edition), it calls Preckon Core to bootstrap the tenant's IAM. Service-to-service, signed, **idempotent by `tenant_id`**.

```sql
create table tenant_bootstrap (
  tenant_id       uuid primary key,
  domain_key      text not null,           -- the domain pack this tenant runs (§D); e.g. 'construction'
  bootstrapped_at timestamptz not null default now(),
  source          text not null
    check (source in ('host_provision', 'manual')),
  idempotency_key text
);
```

**Contract:** `POST /internal/tenants/{tenantId}/bootstrap` (service auth, not user-facing).

```jsonc
{
  "tenant_id": "…",
  "tenant_name": "…",
  "owner": { "email": "…", "name": "…" },
  "edition_ref": "…",          // for entitlement resolution (§8)
  "domain_key": "construction", // the domain pack this tenant runs (§D)
  "locale": "en-CA",
  "idempotency_key": "…"        // Host-supplied, for safe retry
}
```

**Transaction (atomic):**
1. If `tenant_bootstrap` already has this `tenant_id` → no-op, return current state (idempotent).
2. Seed the system roles (`is_system = true`) from the **tenant's domain pack** `role_template` (§D.4) — for a construction tenant, the six above.
3. Seed `tenant_role_permission` from the preset matrix above.
4. Create the Owner `app_user` (`invited`) and a pending `tenant_invite` for the owner email; assign the `owner` role via `user_role`.
5. Insert the `tenant_bootstrap` marker (`source = 'host_provision'`, `idempotency_key`).
6. Emit a `tenant.bootstrapped` event to the audit spine (§9).

**Post-conditions (invariants, asserted by the transaction):**
- Exactly one user holds the `owner` role.
- All six system roles exist with `is_system = true`.
- Every system role's permission preset is applied.
- `tenant_bootstrap` marks the tenant done; re-invoking is a no-op. The `tenant_id` PK plus the `idempotency_key` make Host retries safe.

### §1.6 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| POST | `/internal/tenants/{tid}/bootstrap` | *service auth* | idempotent provisioning tx above; `tenant.bootstrapped` audit |
| GET | `/users` | `admin.users` | list tenant users + roles |
| POST | `/invites` | `admin.users` | create `app_user`(invited) + invite; email token; audit |
| POST | `/invites/{id}/revoke` | `admin.users` | invite `→ revoked`; audit |
| POST | `/invites/accept` | *authenticated* | match by token, link `auth_user_id`, activate, assign role, invite `→ accepted` |
| GET | `/roles` | `admin.users` | list roles + presets |
| POST | `/users/{id}/roles` | `admin.users` | assign role; audit |
| DELETE | `/users/{id}/roles/{roleId}` | `admin.users` | revoke role; audit |
| POST | `/users/{id}/suspend` | `admin.users` | `status → suspended`; audit |
| POST | `/tenant/transfer-ownership` | `tenant.transfer_ownership` | move `owner` role (requires confirmation); audit |
| POST | `/projects` | `project.create` | create project + creator as member; audit |
| GET | `/projects` | `project.read` | member projects, or all with `project.read_all` |
| GET | `/projects/{pid}` | `project.read` | project detail |
| PATCH | `/projects/{pid}` | `project.update` | edit metadata; audit |
| POST | `/projects/{pid}/archive` | `project.archive` | `status → archived`; audit |
| GET | `/projects/{pid}/members` | `project.read` | list members |
| POST | `/projects/{pid}/members` | `project.member.manage` | add member; audit |
| DELETE | `/projects/{pid}/members/{userId}` | `project.member.manage` | remove member; audit |

---

## §2 — Artifact store & type registry

The filesystem. One shared graph per project; every value an agent or human produces is an **artifact**.

### §2.1 Type registry — the shared vocabulary

Agents compose through a **workflow-independent** type vocabulary, not through workflows. `BOQ Agent` is used by both TenderLogix and QuantLogix, so its I/O is defined once. The registry is platform-level (first-party, not tenant-scoped) — the vocabulary is shared across all tenants.

```sql
create table artifact_type (
  key            text primary key,          -- e.g. 'document', 'tender_summary', 'boq_line'
  name           text not null,
  payload_schema jsonb not null default '{}'::jsonb,  -- JSON Schema the payload is validated against
  is_reviewable  boolean not null default true,       -- false => agent output is canonical on emit
  created_at     timestamptz not null default now()
);
```

Seeded type keys (skeleton subset shown; full set in Appendix A): `document`, `tender_summary`, `spec_clause`, `drawing_index`, `drawing_measurement`, `boq_line`, `cost_line`, `schedule_activity`, `procurement_package`, `rfi`, `compliance_item`, `proposal_doc`.

### §2.2 The artifact

```sql
create table artifact (
  id              uuid primary key,
  tenant_id       uuid not null,
  project_id      uuid not null references project(id),
  type_key        text not null references artifact_type(key),
  payload         jsonb not null,                 -- validated against artifact_type.payload_schema
  source          artifact_source not null,       -- human | agent
  source_agent_key text,                           -- which agent, when source = agent
  source_run_id   uuid,                            -- soft ref to workflow_run (no FK: human artifacts have none)
  source_step_id  uuid,                            -- soft ref to workflow_run_step
  status          artifact_status not null default 'pending',
  confidence      numeric(4,3),                    -- agent proposals only, 0.000–1.000
  version         int not null default 1,
  supersedes_id   uuid references artifact(id),    -- prior version this replaces
  created_by      uuid,
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index artifact_scope_idx   on artifact (tenant_id, project_id, type_key, status);
create index artifact_run_idx      on artifact (source_run_id);
create index artifact_current_idx  on artifact (tenant_id, project_id, type_key)
  where status <> 'superseded';

alter table artifact enable row level security;
create policy artifact_tenant_isolation on artifact
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Lifecycle.** Artifacts are immutable; change means a new row.

| From | Event | To | Notes |
|---|---|---|---|
| — | agent emits (reviewable) | `pending` | with `confidence`; surfaced to review queue |
| — | agent emits (non-reviewable, or confidence ≥ auto-accept) | `confirmed` | `confirmed_by = null` (system) |
| `pending` | human confirms | `confirmed` | sets `confirmed_by`, `confirmed_at` |
| `pending` | human rejects | `rejected` | terminal |
| `confirmed` | an upstream artifact changes | `stale` | via provenance walk (§2.4) |
| any current | human edits / agent re-derives | `superseded` | a new row `version + 1`, `supersedes_id → old` |

"Current" = latest row per logical artifact that is not `superseded`.

### §2.3 Provenance — the edges

```sql
create table artifact_provenance (
  id                 uuid primary key,
  tenant_id          uuid not null,
  artifact_id        uuid not null references artifact(id),        -- the derived artifact
  source_artifact_id uuid not null references artifact(id),        -- an input it was derived from
  created_at         timestamptz not null default now(),
  unique (artifact_id, source_artifact_id)
);

create index artifact_prov_src_idx on artifact_provenance (source_artifact_id);
create index artifact_prov_art_idx on artifact_provenance (artifact_id);
```

A `boq_line`'s provenance points to the `drawing_measurement`s and `spec_clause`s it came from; a `cost_line`'s points to its `boq_line` and the applied rate; and so on. The edges are the DAG.

### §2.4 Re-plan propagation

When an artifact is edited or superseded, every artifact reachable through provenance edges is marked `stale`. The transitive set:

```sql
with recursive downstream as (
  select p.artifact_id
  from artifact_provenance p
  where p.source_artifact_id = $1
  union
  select p.artifact_id
  from artifact_provenance p
  join downstream d on p.source_artifact_id = d.artifact_id
)
select artifact_id from downstream;
```

```sql
update artifact
set status = 'stale', updated_at = now()
where id in (
  with recursive downstream as (
    select p.artifact_id from artifact_provenance p where p.source_artifact_id = $1
    union
    select p.artifact_id from artifact_provenance p
    join downstream d on p.source_artifact_id = d.artifact_id
  )
  select artifact_id from downstream
)
and status <> 'superseded';
```

The app-layer service `markDownstreamStale(artifactId)` runs this inside the edit/supersede transaction. Stale artifacts are re-derived by re-running the producing step (§4.4) — a **partial re-run**, not the whole workflow.

### §2.5 The review queue is a projection

Not a table — a view over pending proposals. This is the "human-in-the-loop" claim made real in the schema.

```sql
create view review_queue as
select id, tenant_id, project_id, type_key, source_agent_key, confidence, source_run_id, created_at
from artifact
where status = 'pending';
```

**Auto-accept:** on emit, if `confidence >= tenant.auto_accept_threshold` (a tenant setting, §9) *and* the type is reviewable, the artifact is written `confirmed` with `confirmed_by = null`; it never enters the queue. The threshold is a tenant policy, not agent logic.

### §2.6 Endpoints (user-facing artifact ops)

| Method | Path | Permission | Side effects |
|---|---|---|---|
| GET | `/projects/{pid}/artifacts?type=&status=` | `artifact.read` | — |
| GET | `/projects/{pid}/review-queue` | `artifact.read` | reads the `review_queue` view, scoped to project |
| POST | `/projects/{pid}/artifacts/{id}/confirm` | `artifact.confirm` | `pending → confirmed`; audit; may resume a paused run (§4) |
| POST | `/projects/{pid}/artifacts/{id}/reject` | `artifact.confirm` | `pending → rejected`; audit |
| PATCH | `/projects/{pid}/artifacts/{id}` | `artifact.edit` | new version supersedes current; `markDownstreamStale`; audit |

---

## §3 — Agent Contract (ABI) & agent registry

Agents are userland programs. Each is defined by its **I/O over the type vocabulary** — that declaration is the contract that lets the workflow resolver type-check wiring before a run.

### §3.1 Agent registry

```sql
create table agent (
  key             text primary key,          -- 'agent.document', 'agent.tender', 'agent.boq', ...
  name            text not null,
  kind            agent_kind not null,        -- worker | service | supervisor
  consumes        jsonb not null default '[]'::jsonb,   -- artifact_type keys read
  produces        jsonb not null default '[]'::jsonb,   -- artifact_type keys emitted
  job_types       jsonb not null default '[]'::jsonb,   -- AI job definitions it enqueues (§5)
  permission_keys jsonb not null default '[]'::jsonb,   -- caller must hold these
  entitlement_key text,                        -- capability required (read from Host, §8)
  version         int not null default 1,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);
```

`kind`: **worker** (a pipeline step — Document, Tender, Specification, Drawing, BOQ, Cost, Schedule, Procurement, RFI, Compliance, Proposal), **service** (called by other agents, not a pipeline step — Knowledge), **supervisor** (the `Orchestrator` role — §6; currently one instance, `agent.construction_copilot`, not a worker). Full catalog in Appendix A.

### §3.2 The ABI — four syscalls, nothing else

An agent receives a scoped **context** from the runtime (`tenant_id`, `project_id`, `run_id`, `step_id`, `agent_key`) and these four calls. It gets no DB handle, no ability to set scope, no way to write SQL. Preckon Core scopes, validates, journals, and gates every call.

```ts
// The entire surface an agent may touch.
interface AgentContext {
  // set by the runtime; unforgeable by the agent
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly agentKey: string;
}

emitArtifact(input: {
  type: string;                 // must be in this agent's `produces`
  payload: object;              // validated against artifact_type.payload_schema
  provenance: string[];         // artifact ids this was derived from
  confidence?: number;          // 0..1, for reviewable proposals
}): Promise<string>;            // -> new artifact id

readArtifacts(query: {
  type: string;                 // must be in this agent's `consumes`
  status?: 'confirmed';         // default 'confirmed'; agents read facts, not other proposals
  filter?: object;
}): Promise<Artifact[]>;        // current (non-superseded), this project only

enqueueJob(jobType: string, envelope: object): Promise<string>;  // -> job id (§5)
onJobResult(result: JobResult): void;                            // runtime-delivered callback

requestReview(artifactIds: string[]): Promise<void>;             // surface proposals / auto-accept
```

| Syscall | Core guarantees |
|---|---|
| `emitArtifact` | rejects `type` not in `produces`; validates payload vs schema; sets `source=agent`, `source_agent_key/run/step` from context; `status=pending` unless non-reviewable or auto-accept; writes provenance edges; scopes `tenant_id/project_id` from context (**agent cannot set them**); journals to audit |
| `readArtifacts` | rejects `type` not in `consumes`; returns current confirmed artifacts in the run's project only; cross-project/cross-tenant reads impossible |
| `enqueueJob` / `onJobResult` | envelope routed to arq/Redis; LLM tier-routed and Langfuse-traced by Core; result returned to the step (§5) |
| `requestReview` | marks listed proposals surfaced; auto-accepts any ≥ threshold; idempotent |

Because a module only calls the ABI, it implements **none** of tenancy, provenance, audit, or entitlement gating. Those live in Preckon Core, once.

### §3.3 Endpoints (agent registry, read-only to tenants; managed platform-side)

| Method | Path | Permission | Side effects |
|---|---|---|---|
| GET | `/agents` | `workflow.read` | lists enabled agents visible under the tenant's entitlements |
| GET | `/agents/{key}` | `workflow.read` | manifest (consumes/produces/perms/entitlement) |

Agent definitions are first-party and compiled in; the table is the runtime's and Host's read model, not a tenant-editable store.

---

## §4 — Workflow schema, runtime & the run table

A workflow is **data**: a DAG that wires agents. The seven Logix names are **workflows**, not modules. Adding a workflow is registering a definition — no Core change, no re-threading.

### §4.1 Workflow definition

```sql
create table workflow (
  key             text primary key,          -- 'workflow.tenderlogix', 'workflow.quantlogix', ...
  name            text not null,
  module_key      text not null,             -- external capability name (Host catalog / marketing map)
  version         int not null default 1,
  definition      jsonb not null,            -- the DAG (nodes, edges, gates, map-steps)
  entitlement_key text,                       -- edition -> workflow gate (§8)
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);
```

`definition` schema (jsonb):

```jsonc
{
  "nodes": [
    { "id": "ingest",  "kind": "agent", "agent_key": "agent.document" },
    { "id": "tender",  "kind": "agent", "agent_key": "agent.tender" },
    { "id": "gate_scope", "kind": "gate", "gate_types": ["tender_summary"] },   // placeable anywhere
    { "id": "boq",     "kind": "agent", "agent_key": "agent.boq" }
  ],
  "edges": [
    { "from": "ingest", "to": "tender" },
    { "from": "tender", "to": "gate_scope" },
    { "from": "gate_scope", "to": "boq" }
  ]
}
```

A **map** node (`"kind": "map", "over": "drawing"`) fans out one child step per artifact of that type; its downstream agent node fans in by reading all children's outputs. A **gate** node references the artifact types that must be `confirmed` to pass. Gates are declarable at *any* position — you approve extracted scope before spending agent cycles deriving a BOQ from it, not only at the end.

**Resolver.** Before a run starts, the resolver checks each agent node's `consumes` against the `produces` reachable upstream (from agent manifests, §3.1). A workflow that wires incompatible types fails to register — wiring errors are caught at authoring, not runtime.

### §4.2 The run — the process table

```sql
create table workflow_run (
  id               uuid primary key,
  tenant_id        uuid not null,
  project_id       uuid not null references project(id),
  workflow_key     text not null references workflow(key),
  workflow_version int not null,
  status           run_status not null default 'running',
  context          jsonb not null default '{}'::jsonb,
  started_by       uuid,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create index workflow_run_scope_idx on workflow_run (tenant_id, project_id, status);
```

```sql
create table workflow_run_step (
  id                 uuid primary key,
  tenant_id          uuid not null,
  run_id             uuid not null references workflow_run(id),
  node_id            text not null,                      -- the definition node id
  kind               step_kind not null,
  agent_key          text references agent(key),         -- null for gate nodes
  parent_step_id     uuid references workflow_run_step(id),  -- set on map children
  map_index          int,                                -- child ordinal within a map fan-out
  status             step_status not null default 'pending',
  attempt            int not null default 0,
  input_artifact_ids  jsonb not null default '[]'::jsonb,
  output_artifact_ids jsonb not null default '[]'::jsonb,
  job_id             uuid,                                -- the AI job, when running (§5)
  gate_types         jsonb,                               -- for gate steps: types that must be confirmed
  started_at         timestamptz,
  ended_at           timestamptz,
  created_at         timestamptz not null default now()
);

create index run_step_run_idx on workflow_run_step (run_id, status);
```

### §4.3 Runtime semantics

The runtime is **Preckon Core's scheduler** — deterministic, **no LLM**. (The one supervisory agent that plans and cross-checks fills the `Orchestrator` role, §6, a separate thing.)

1. On start: create `workflow_run`, materialize a `workflow_run_step` per node.
2. Dispatch agent steps whose upstream steps are `completed`. An agent step runs the agent, which calls `enqueueJob`; the step goes `running` with a `job_id`.
3. On `onJobResult`: the agent calls `emitArtifact` (writing proposals) and the step goes `completed`, recording `output_artifact_ids`.
4. At a **gate** step: set the step and the run to `awaiting_review`. The run pauses until every artifact of `gate_types` is `confirmed` (via the §2.6 confirm endpoint). Confirming the last one resumes the run — the gate goes `completed` and downstream dispatches.
5. **Map** nodes fan out to child steps (one per `over`-typed artifact), each with `parent_step_id` and `map_index`; the fan-in agent reads all children's `confirmed` outputs.
6. Terminal: all steps `completed` → run `completed`; any step `failed` past retry → run `failed`; user cancels → `cancelled`.

### §4.4 Partial re-runs

When a human edits an upstream artifact, `markDownstreamStale` (§2.4) marks the downstream `stale`. `rerunStale(runId)` re-executes only the steps whose `output_artifact_ids` are now stale, superseding those artifacts with fresh versions — the rest of the run is untouched. This is why "change a rate and the programme re-plans" costs one step, not a full re-run.

### §4.5 Per-project workflow selection

A user starts a workflow on a project → a `workflow_run`. Multiple workflows can run on one project; all write the **same** artifact graph, so a project accretes state across runs (TenderLogix's confirmed BOQ is readable by a later CostLogix run).

### §4.6 Endpoints

| Method | Path | Permission | Entitlement | Side effects |
|---|---|---|---|---|
| GET | `/workflows` | `workflow.read` | — | workflows enabled under the tenant's edition |
| POST | `/projects/{pid}/runs` | `workflow.run` | `workflow.<key>` | resolves + starts a run; dispatches ready steps; audit |
| GET | `/projects/{pid}/runs/{rid}` | `workflow.read` | — | run + steps status |
| GET | `/projects/{pid}/runs` | `workflow.read` | — | runs on the project |
| POST | `/projects/{pid}/runs/{rid}/cancel` | `workflow.run` | — | `→ cancelled`; audit |
| POST | `/projects/{pid}/runs/{rid}/resume` | `workflow.run` | — | explicit resume; gates normally resume implicitly on confirm |
| POST | `/projects/{pid}/runs/{rid}/rerun-stale` | `workflow.run` | `workflow.<key>` | partial re-run of stale-producing steps; audit |

---

## §5 — AI orchestration internals

The machinery behind the `enqueueJob` / `onJobResult` syscalls (§3.2) and the auto-accept mechanics referenced in §2.5. This is where the LLM work actually happens.

### §5.1 The trust boundary

Two processes, one hard line between them:

- **Preckon Core (trusted).** The TypeScript runtime — workflow runtime, artifact store, ABI, IAM, audit. It owns `emitArtifact` / `readArtifacts` / `requestReview` and the **dispatch + tracking** half of `enqueueJob`. Everything with store access lives here.
- **The AI worker (stateless).** The Python/FastAPI + arq service. It consumes a **JobEnvelope**, resolves prompt + tier + model, calls the LLM with its tools (Langfuse-traced), and returns a **JobResult**. It has **no artifact-store access** — it cannot write anywhere.

This refines §3.2: an agent's LLM reasoning runs in the worker, but the worker only *proposes* outputs. On `onJobResult`, **Core validates each proposed output against the agent's `produces` and materializes it through `emitArtifact`** — so provenance, scoping, audit, schema validation, and auto-accept all happen in the trusted process, never in the worker. "The agent emits" (§3.2) means exactly this: the runtime emits the worker's proposals on the agent's behalf, through the ABI.

### §5.2 The JobEnvelope / JobResult contract

**JobEnvelope** — dispatched Core → worker:

```jsonc
{
  "job_id": "…",
  "job_type": "tender.extract_summary",   // declared in agent.job_types
  "agent_key": "agent.tender",
  "tenant_id": "…", "project_id": "…", "run_id": "…", "step_id": "…",
  "tier": "deep",                          // requested; router may override (§5.5)
  "prompt_ref": "tender.extract_summary@v3",
  "inputs": {
    "artifacts": [ { "id": "…", "type": "document", "payload": { } } ],  // resolved by Core, read-only
    "params": { }
  },
  "idempotency_key": "…"
}
```

Core resolves and inlines the input artifacts (the worker never reads the store). **JobResult** — returned worker → Core:

```jsonc
{
  "job_id": "…",
  "status": "succeeded",                   // | failed
  "outputs": [
    { "type": "tender_summary",
      "payload": { },                      // validated vs artifact_type.payload_schema by Core
      "provenance": ["<input artifact id>"],
      "confidence": 0.91 }                 // computed by the worker (§5.6), not free-form model text
  ],
  "usage": { "model": "<resolved>", "input_tokens": 4210, "output_tokens": 380, "cost_minor": 1234 },
  "trace_id": "lf_…",
  "error": null
}
```

### §5.3 The job table & tenant settings

```sql
create type ai_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type ai_tier       as enum ('routing', 'standard', 'deep');

create table ai_job (
  id              uuid primary key,
  tenant_id       uuid not null,
  project_id      uuid not null references project(id),
  run_id          uuid,                 -- soft ref workflow_run
  step_id         uuid,                 -- soft ref workflow_run_step
  agent_key       text not null references agent(key),
  job_type        text not null,        -- declared in agent.job_types
  status          ai_job_status not null default 'queued',
  tier            ai_tier not null,
  model           text,                 -- resolved model id (from config, never hardcoded in schema)
  attempt         int not null default 0,
  max_attempts    int not null default 3,
  envelope        jsonb not null,       -- the JobEnvelope
  result          jsonb,                -- the JobResult, on success
  error           jsonb,                -- structured error, on failure
  prompt_ref      text,                 -- versioned prompt id (Langfuse prompt mgmt)
  trace_id        text,                 -- Langfuse trace
  input_tokens    int,
  output_tokens   int,
  cost_minor      bigint,               -- integer minor units, for metering
  idempotency_key text,
  queued_at       timestamptz not null default now(),
  started_at      timestamptz,
  ended_at        timestamptz
);

create index ai_job_scope_idx on ai_job (tenant_id, project_id, status);
create index ai_job_run_idx   on ai_job (run_id);
create index ai_job_step_idx  on ai_job (step_id);
create unique index ai_job_idem_idx on ai_job (tenant_id, idempotency_key)
  where idempotency_key is not null;

alter table ai_job enable row level security;
create policy ai_job_isolation on ai_job
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Tenant-level AI policy lives in one row (auto-accept + default tier; branding and other settings extend `extra` / live in their own tables later):

```sql
create table tenant_setting (
  tenant_id             uuid primary key,
  auto_accept_threshold numeric(4,3) not null default 0.900,   -- global default
  type_thresholds       jsonb not null default '{}'::jsonb,    -- { "<artifact_type>": <0..1> } overrides
  default_tier          ai_tier not null default 'deep',
  extra                 jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table tenant_setting enable row level security;
create policy tenant_setting_isolation on tenant_setting
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

### §5.4 Dispatch & transport

`enqueueJob` (Core) writes an `ai_job` (`queued`) and pushes the JobEnvelope to a **Redis tier lane** — one queue per tier (`q:routing`, `q:standard`, `q:deep`) so a burst of slow `deep` jobs never starves fast `routing` calls; worker pools are sized per lane. The arq worker consumes, sets `running`, runs the LLM call, and returns the JobResult via an **internal result callback** — `POST /internal/jobs/{jobId}/result` (service auth), idempotent by `job_id`. The callback is the seam that fires `onJobResult`: Core records `result`/`usage`/`trace_id`, materializes outputs through `emitArtifact` (§5.1), and advances the step (§4.3). HTTP callback keeps the TS↔Python boundary language-agnostic; the Redis lanes carry dispatch.

### §5.5 Tier routing — the AI tier orchestrator

Tiers are an abstraction over model classes, resolved to concrete model ids **in config, not schema** (so a model swap is a config change): `routing` → a fast/cheap class (e.g. Haiku), `standard` → mid (e.g. Sonnet), `deep` → the primary reasoning class (e.g. Opus). Each `job_type` declares a default tier. A cheap `routing`-tier pre-classifier can inspect an input and *promote or demote* the heavy step's tier (simple document → `standard`, complex/ambiguous → `deep`) — this is the Haiku-routes-Opus pattern. Editions may cap the maximum tier (a lower edition tops out at `standard`); that cap is read from entitlements (§8) and clamped at dispatch. `tenant_setting.default_tier` is the fallback when a job_type declares none.

### §5.6 Confidence & auto-accept

Confidence is **computed by the worker per output**, not lifted from model prose — a `job_type`-defined score in [0,1] combining signals like required-field completeness, validator/tool agreement, and model-reported certainty, normalized. On `emitArtifact` (§2.5), for a reviewable type, Core resolves the threshold — `tenant_setting.type_thresholds[type]` if present, else `auto_accept_threshold` — and:

- `confidence ≥ threshold` → artifact written `confirmed`, `confirmed_by = null` (system); never enters the review queue.
- otherwise → `pending`; surfaced to the queue for a human.

Thresholds are tenant policy, set via `admin.settings`. Calibration over time (were high-confidence proposals actually right?) is a **Memory/flywheel** concern (§M): confirm/reject history re-tunes both the scoring and the recommended thresholds. Non-reviewable types (`is_reviewable = false`, e.g. `document`) skip all of this and land `confirmed` on emit.

### §5.7 Retries, timeouts, idempotency, cancellation

A failed job returns `status: "failed"` with a structured `error`; Core increments `attempt` and, while `attempt < max_attempts`, re-enqueues with exponential backoff (arq-native). On final failure the job is `failed`, its step `failed`, and the run `failed` and surfaced — no half-written artifacts, because emit only happens on success. Per-tier timeouts bound run time. `idempotency_key` (unique per tenant) dedupes re-enqueues from `rerun-stale` (§4.4) or Host/worker retries — a duplicate returns the existing job. On run cancel (§4.6), in-flight jobs are marked `cancelled` and the worker honours a best-effort cancellation check.

### §5.8 Cost & tracing

Every `ai_job` records resolved `model`, `input_tokens`, `output_tokens`, `cost_minor`, and the Langfuse `trace_id` — so any artifact traces to the exact job, prompt version, and model that produced it. Per-job usage rolls up to the Host usage-metering contract (§8) for billing, and feeds §M. `prompt_ref` pins a **versioned** prompt per workflow version, so a re-run of an old workflow version is reproducible.

### §5.9 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| POST | `/internal/jobs/{jobId}/result` | *service auth* | idempotent by job id; record result/usage/trace; materialize outputs via `emitArtifact`; advance step |
| GET | `/projects/{pid}/jobs?run_id=&status=` | `workflow.read` | list jobs |
| GET | `/projects/{pid}/jobs/{id}` | `workflow.read` | job detail incl. trace link |
| POST | `/projects/{pid}/jobs/{id}/retry` | `workflow.run` | re-enqueue a failed job (respects `max_attempts`); audit |
| GET | `/settings/ai` | `admin.settings` | read auto-accept threshold, overrides, default tier |
| PATCH | `/settings/ai` | `admin.settings` | update `tenant_setting`; audit |

---

## §6 — The Orchestrator role (Core), Construction Copilot (userland) & the persona roster

The supervisor. Two layers, split on the domain line: Core provides a **generic supervisor contract** (§6.1, no construction knowledge); **Construction Copilot** is the userland agent that fills it (§6.2, all construction judgment). §6.4 generalizes the single supervisor to a **roster of personas** — the mechanism behind a "digital company" — while changing none of the guardrails.

### §6.1 The Orchestrator role — Core's supervisor contract

A worker agent (§3) operates on one step's typed I/O and is stateless per step. A **supervisor** is different in exactly two ways, and Core's contract grants exactly those two things and nothing more:

1. **Whole-run visibility.** Where a worker sees only its declared inputs, a supervisor sees the entire run — every step, every current artifact, the review queue, the stale set — read-only.
2. **A continuous chat surface + bounded control.** A supervisor holds a conversation with a human across the life of a run, and may **propose deviations** to the run from a **closed set** — never edit the DAG, never write facts, never confirm.

Consistent with the §5.1 trust boundary, a supervisor is realized the same way every agent is: **Core assembles a whole-run context into the JobEnvelope, the worker returns content + deviation proposals in the JobResult, and Core materializes them.** The supervisor calls no syscalls mid-job; it cannot bypass anything. The worker ABI (four syscalls, §3.2) is untouched. What changes for `kind = supervisor` jobs is only the *shape* of the envelope in and the result out.

**Whole-run context** (Core inlines this into a supervisor's envelope, in place of a worker's single-step inputs):

```jsonc
{
  "run":    { "id": "…", "workflow_key": "…", "status": "awaiting_review" },
  "steps":  [ { "node_id": "…", "agent_key": "…", "status": "completed", "output_artifact_ids": ["…"] } ],
  "artifacts": [ { "id": "…", "type": "boq_line", "status": "confirmed", "confidence": 0.9, "summary": "…" } ],
  "review_queue": ["<pending artifact id>"],
  "stale":        ["<stale artifact id>"]
}
```

**Supervisor JobResult** (adds a chat turn and deviation proposals; no domain-artifact outputs):

```jsonc
{
  "job_id": "…", "status": "succeeded",
  "message":    { "role": "assistant", "content": "…", "referenced_artifact_ids": ["…"] },
  "deviations": [ { "kind": "flag", "target_step_id": "…", "rationale": "…", "payload": { } } ],
  "usage": { }, "trace_id": "lf_…"
}
```

**Chat state** (Core-hosted, domain-neutral):

```sql
create type chat_role as enum ('user', 'assistant', 'system');

create table orchestrator_conversation (
  id         uuid primary key,
  tenant_id  uuid not null,
  project_id uuid not null references project(id),
  run_id     uuid,                 -- optional: a run-scoped thread (else project-scoped)
  title      text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table orchestrator_message (
  id                      uuid primary key,
  tenant_id               uuid not null,
  conversation_id         uuid not null references orchestrator_conversation(id),
  role                    chat_role not null,
  content                 text not null,
  referenced_artifact_ids jsonb not null default '[]'::jsonb,
  referenced_step_ids     jsonb not null default '[]'::jsonb,
  job_id                  uuid,     -- the ai_job that produced an assistant turn
  author_user_id          uuid,     -- for user turns
  created_at              timestamptz not null default now()
);

create index orchestrator_message_conv_idx on orchestrator_message (conversation_id, created_at);

alter table orchestrator_conversation enable row level security;
create policy orchestrator_conversation_isolation on orchestrator_conversation
  using (tenant_id = current_setting('app.tenant_id')::uuid);
alter table orchestrator_message enable row level security;
create policy orchestrator_message_isolation on orchestrator_message
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

A user posts a message → Core assembles the whole-run context → enqueues a supervisor job (`deep` tier) → JobResult returns the assistant turn (+ any deviation proposals) → Core appends the message and records deviations. All on the §5 machinery — no new execution path.

**Deviations — bounded control** (the guardrail is the closed `kind` set):

```sql
create type deviation_kind   as enum ('rerun_step', 'insert_review_gate', 'skip_step', 'request_review', 'flag');
create type deviation_status as enum ('proposed', 'approved', 'rejected', 'applied', 'auto_applied');

create table run_deviation (
  id             uuid primary key,
  tenant_id      uuid not null,
  project_id     uuid not null references project(id),
  run_id         uuid not null references workflow_run(id),
  proposed_by    text not null,          -- supervisor agent key
  kind           deviation_kind not null,
  target_step_id uuid,                    -- step acted on (null for run-level)
  rationale      text not null,           -- human-readable justification
  payload        jsonb not null default '{}'::jsonb,
  status         deviation_status not null default 'proposed',
  decided_by     uuid,                    -- human approver
  decided_at     timestamptz,
  applied_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index run_deviation_run_idx on run_deviation (run_id, status);

alter table run_deviation enable row level security;
create policy run_deviation_isolation on run_deviation
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

| Deviation kind | Effect on the run | Default policy |
|---|---|---|
| `flag` | raise an inconsistency for human attention — **no run change** | auto-applied |
| `rerun_step` | re-execute a step, superseding its outputs (via §4.4) | human approval (`workflow.run`) |
| `insert_review_gate` | inject a review gate before a node | human approval |
| `skip_step` | mark an **optional** step skipped | human approval (rejected if node is required) |
| `request_review` | pause for named artifacts to be confirmed | human approval |

**Guardrails (v1), enforced by Core:**
- The `kind` set is closed. A supervisor cannot propose anything outside it — in particular it **cannot add/remove agents or edit the workflow definition**. Dynamic composition is v2.
- A supervisor **cannot confirm artifacts, edit facts, or apply its own deviations.** On approval, the **deterministic runtime** (§4) applies the deviation — never the supervisor.
- Editions/tenants may downgrade any kind to forbidden (read from entitlements, §8).
- This is the north star's "humans approve the decisions," enforced structurally: the chat surface can be persuasive, but it has no more authority than any other agent.

### §6.2 Construction Copilot — the userland instance

`agent.construction_copilot`, `kind = supervisor`, is the **first persona** (§6.4) filling the Orchestrator role today. Everything construction lives here; Core knows none of it.

- **`consumes`: `["*"]`** — supervisors read the whole run (via the §6.1 context), not a declared type list. **`produces`: `[]`** domain-wise — its outputs are chat turns and deviation proposals, not domain artifacts.
- **Job types:**
  - `copilot.respond` — a chat turn: answer the user, grounded in the whole-run context, and propose deviations where warranted.
  - `copilot.review_run` — a proactive consistency sweep, triggered at defined points (run completion, a pre-submission gate) or on demand. Emits `flag` deviations + a summary chat message.
- **The construction judgment** — all in the worker's prompt + tools for these job types, invisible to Core: does the proposal narrative reconcile with the priced BOQ? Does the compliance checklist cover every mandatory submission requirement? Are quantities sane against the drawing takeoff? Is any scope in the specs missing from the BOQ? These checks *are* the domain knowledge, and they surface as `flag` deviations and chat, for a human to act on.
- **Reactive and proactive**, but never autonomous: it responds and it sweeps; it proposes and flags; a human always decides. v1 keeps the workflow static — the Copilot proposes deviations *within* a defined workflow, it does not compose new ones.

### §6.3 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| GET | `/projects/{pid}/conversations` | `workflow.read` | list Copilot threads |
| POST | `/projects/{pid}/conversations` | `workflow.read` | start a thread (project- or run-scoped) |
| GET | `/projects/{pid}/conversations/{cid}` | `workflow.read` | messages |
| POST | `/projects/{pid}/conversations/{cid}/messages` | `workflow.read` | append user turn; enqueue `copilot.respond`; append assistant turn on result |
| POST | `/projects/{pid}/runs/{rid}/review` | `workflow.run` | enqueue `copilot.review_run` (proactive sweep); audit |
| GET | `/projects/{pid}/runs/{rid}/deviations` | `workflow.read` | list proposed/decided deviations |
| POST | `/projects/{pid}/deviations/{id}/approve` | `workflow.run` | `proposed → approved`; runtime applies it; audit |
| POST | `/projects/{pid}/deviations/{id}/reject` | `workflow.run` | `proposed → rejected`; audit |

### §6.4 The persona roster

§6.1 grants **one** supervisor contract; nothing binds it to one instance. A **persona** is a supervisor agent (§3, `kind = supervisor`) plus a declared **scope**, **deviation authority**, and **lens** — a digital colleague that presides over a slice of the work, holds its own conversations, and proposes within its remit. The single Copilot (§6.2) is the first persona; this mechanism is domain-neutral, and a pack ships its roster as data (e.g. the Construction pack's Bid Manager, Commercial, Portfolio — see that deck). This is the "digital company" surface — an **orchestration + experience** layer over the deterministic spine, never a replacement for it.

#### §6.4.1 What a persona adds to a supervisor

Three declarations, all *data* on a supervisor agent — no new syscall and no new execution path. The §6.1 job shape is unchanged; only **context assembly in** and **result routing out** become scoped:

- **Scope** — the slice it presides over: a set of `module_key`s / `workflow_key`s / `artifact_type`s. Core assembles the §6.1 whole-run context **filtered to this scope** (Portfolio sees across runs; Commercial sees cost/margin/risk artifacts). Scope narrows what a persona *sees* — it is a view, never ownership.
- **Deviation authority** — the subset of the closed `deviation_kind` set this persona may propose (a review-only critic: `flag` + `request_review` only; a Bid Manager: all). Always a subset of §6.1's set, never a superset.
- **Lens** — a persona-scoped projection of the `review_queue` view (§2.5): the pending proposals within its scope. The per-colleague "what needs my attention" surface.

#### §6.4.2 The propose–dispose invariant (the whole safety story)

A persona **proposes** (chat, deviations, flags into its lens). A **human with the matching permission disposes** — `artifact.confirm` to confirm/reject, `workflow.run` to run or to approve a deviation — and *that human action* is what the audit spine records (§9). No persona ever holds `artifact.confirm` or `workflow.run`; §6.1's guardrails already forbid a supervisor from confirming, editing, or applying, and the roster changes none of that. **Adding ten colleagues adds ten advisors, not one autonomous actor.** This is why a persona can be a QS-style *critic that flags* but never a QS that *signs*: the defensible-bid property (§9) is "AI proposed, a licensed human confirmed," and the roster preserves it by construction.

#### §6.4.3 Why personas may overlap freely

A run or artifact can sit in several personas' scopes at once (Bid Manager spans the chain; Commercial spans cost; both watch the same `cost_line`). This is safe precisely because **personas never produce** — one-producer-per-artifact (§2.2, §5.1) is a property of *worker* agents, and supervisors emit nothing, so they are exempt. Scope overlap is view overlap; there is no ownership to contend. The opposite design — persona *as* producer — would have two colleagues both claim the BOQ, and re-plan (§2.4) would have no single step to re-run. The roster sidesteps that entirely by keeping personas purely supervisory.

#### §6.4.4 Schema — one column, reusing everything else

`run_deviation.proposed_by` already attributes a deviation to its supervisor. The only additions are a thin profile table and one column attributing a conversation to its persona:

```sql
create table supervisor_profile (
  agent_key       text primary key references agent(key),   -- a kind = supervisor agent
  scope           jsonb not null default '{}'::jsonb,   -- { module_keys[], workflow_keys[], artifact_types[] }; {} = whole run
  deviation_kinds jsonb not null default '[]'::jsonb,   -- allowed subset of deviation_kind; [] = all §6.1 kinds
  is_default      boolean not null default false,       -- the persona a fresh conversation opens with
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

alter table orchestrator_conversation
  add column supervisor_key text references agent(key);   -- which persona owns this thread (null = default persona)
```

- `scope = {}` is whole-run visibility (today's Copilot). A populated scope narrows both the assembled context and the lens.
- `deviation_kinds = []` is the full §6.1 set; a subset caps the persona's authority, and Core rejects a proposed kind outside it — the same clamp as the edition downgrade (§6.1 guardrail).
- `supervisor_profile` is **populated at bootstrap from the pack manifest's `personas` array** (§D) — pack data, exactly like the agent registry. Core ships the table (the mechanism); the roster is domain data.
- Personas gate transitively by `scope.module_keys` (§8): premium colleagues are licensed per edition, precisely like premium workflows.

The persona-scoped lens is `review_queue` intersected with scope — no new object, just a filter:

```sql
select rq.* from review_queue rq
where rq.project_id = current_setting('app.project_id')::uuid
  and rq.type_key = any (:scope_artifact_types);   -- :scope_artifact_types from supervisor_profile.scope
```

#### §6.4.5 Endpoints (persona-aware; extends §6.3)

| Method | Path | Permission | Side effects |
|---|---|---|---|
| GET | `/personas` | `workflow.read` | the roster visible under the tenant's entitlements (key, name, scope, allowed deviations, is_default) |
| GET | `/projects/{pid}/personas/{key}/review-queue` | `artifact.read` | the persona's scoped lens (`review_queue` ∩ scope) |

The §6.3 conversation endpoints take an optional `supervisor_key` (defaulting to the `is_default` persona); a project or run may carry one open thread per persona. The deviation and review endpoints are unchanged — `proposed_by` already records which colleague proposed. Beneath the roster, the human roles (§1.2) and the deterministic runtime (§4) are untouched: the "digital company" is a layer of advisors on the same spine.

---

## §7 — Document ingestion & retrieval

The entry point to the chain and the substrate under semantic search. The domain line holds here too: **Core owns storage, extraction, and vector retrieval — all generic.** Classifying a file into a construction `document` (drawing vs spec vs tender letter) is a *userland* job the **Document Agent** does; querying the index for relevant context is what the **Knowledge Agent** does. Core turns bytes into text, chunks, and embeddings, and answers similarity queries — it never knows what a drawing is.

### §7.1 Object storage & the file model

Files live in S3-compatible object storage (MinIO in dev, Cloudflare R2 in prod) under a tenant/project-scoped key prefix. Core never proxies large bytes — uploads and downloads use **presigned URLs**.

```sql
create type file_status  as enum ('pending', 'uploaded', 'ingesting', 'ingested', 'failed');
create type chunk_source as enum ('file_page', 'artifact', 'library');

create table file (
  id          uuid primary key,
  tenant_id   uuid not null,
  project_id  uuid not null references project(id),
  storage_key text not null,           -- tenant/project-scoped object key
  filename    text not null,
  mime        text,
  size_bytes  bigint,
  checksum    text,                     -- sha256, verified on complete
  status      file_status not null default 'pending',
  page_count  int,
  uploaded_by uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index file_scope_idx on file (tenant_id, project_id, status);

alter table file enable row level security;
create policy file_isolation on file
  using (tenant_id = current_setting('app.tenant_id')::uuid);

create table file_page (
  id         uuid primary key,
  tenant_id  uuid not null,
  file_id    uuid not null references file(id),
  page_no    int not null,
  text       text,
  raster_key text,                      -- object key for the page image (drawings / OCR)
  method     text,                      -- 'native' | 'ocr'
  width_px   int,
  height_px  int,
  created_at timestamptz not null default now(),
  unique (file_id, page_no)
);

alter table file_page enable row level security;
create policy file_page_isolation on file_page
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Upload lifecycle:** `POST /files` creates a `pending` row and returns a presigned PUT URL → client uploads directly to storage → `POST /files/{id}/complete` → Core verifies checksum + size, sets `uploaded`, and enqueues an ingestion job.

### §7.2 Ingestion pipeline

Ingestion runs on the same arq worker fleet as AI jobs (§5) but is **non-LLM**: per page it extracts native text, or rasterizes + OCRs scanned pages (writing `file_page.raster_key` for images — the substrate DrawLogix later reads), and detects tables. It then chunks the text and embeds it (§7.3). On completion the worker calls back `POST /internal/files/{id}/ingested` (service auth, idempotent), which writes `file_page` rows + chunks and sets the file `ingested`. `file.status` is the job tracker — no separate job table needed. Output is **generic extracted text**; the Document Agent (userland) reads it to classify and split into `document` artifacts (§7.4).

### §7.3 Retrieval — chunks, embeddings, semantic search

The retrieval store is domain-neutral and **polymorphic in its source**, so search spans three things at once: uploaded documents, the artifact graph itself, and Library reference data. That breadth is exactly what the Knowledge Agent needs and what feeds the flywheel (§M).

```sql
create extension if not exists vector;

create table chunk (
  id          uuid primary key,
  tenant_id   uuid not null,
  project_id  uuid not null references project(id),
  source_kind chunk_source not null,    -- file_page | artifact | library
  source_id   uuid not null,            -- the file_page / artifact / library entry
  ordinal     int not null default 0,   -- position within the source
  text        text not null,
  embedding   vector(1024),             -- dimension fixed by the configured Voyage model
  token_count int,
  created_at  timestamptz not null default now()
);
create index chunk_scope_idx  on chunk (tenant_id, project_id, source_kind);
create index chunk_source_idx on chunk (source_kind, source_id);
create index chunk_embedding_idx on chunk using hnsw (embedding vector_cosine_ops);

alter table chunk enable row level security;
create policy chunk_isolation on chunk
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Embeddings come from Voyage AI; the `vector` dimension is fixed by the configured model (1024 for a voyage-3-class model) — swapping models is a migration, not a config toggle, since the column dimension is fixed. Semantic search is a cosine-distance top-k within the current project, optionally filtered by `source_kind`:

```
select id, source_kind, source_id, text,
       1 - (embedding <=> :query_vec) as similarity
from chunk
where project_id = current_setting('app.project_id')::uuid
  and (:kind is null or source_kind = :kind)
order by embedding <=> :query_vec
limit :k;
```

Chunks derived from an artifact follow that artifact's lifecycle: when an artifact is superseded (§2.2), its chunks are re-embedded from the new version and the old ones removed, so retrieval never returns stale facts.

### §7.4 The domain seam

Core hands userland two capabilities and stays neutral:

- **Document Agent** (userland worker) — reads a file's extracted `file_page` text → classifies and splits it into `document` artifacts (each referencing `file_id` + a page range in its payload/provenance), auto-confirmed (non-reviewable). The classification vocabulary (drawing, specification, tender letter, addendum, …) is domain data in the agent, not in Core.
- **Knowledge Agent** (userland service, `kind = service`) — given a query from any other agent, calls Core's semantic search over chunks (project graph + uploaded docs + Library) and returns retrieved context. It is not a pipeline step; other agents call it (e.g. BOQ Agent asks for precedent before proposing lines).

### §7.5 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| POST | `/projects/{pid}/files` | `artifact.edit` | create `pending` file; return presigned PUT URL |
| POST | `/files/{id}/complete` | `artifact.edit` | verify checksum/size; `→ uploaded`; enqueue ingestion |
| GET | `/projects/{pid}/files` | `artifact.read` | list files + status |
| GET | `/files/{id}` | `artifact.read` | metadata + presigned GET URL |
| GET | `/files/{id}/pages` | `artifact.read` | extracted page text/rasters |
| POST | `/projects/{pid}/search` | `artifact.read` | semantic search → top-k chunks (the Knowledge substrate) |
| POST | `/internal/files/{id}/ingested` | *service auth* | idempotent; write pages + chunks/embeddings; `→ ingested` |

---

## §8 — Entitlements & the Host seam

Where **permission** ends and **licensing** begins. Permission (§1.2) says a user *may* do a thing; entitlement says the tenant is *licensed* to. The Host control plane owns licensing (edition → entitlement, decoupled from billing, Stripe as source of truth — see the Host spec); the tenant plane **reads a resolved snapshot** and enforces it. This section is the whole Host↔tenant contract: entitlements in, usage out.

### §8.1 The resolution split

The Host knows **edition → licensed modules**. The tenant plane knows **workflow → agents** (from its own §3/§4 registries). So transitivity is split cleanly and neither side needs the other's internals:

- **Host returns** the licensed `module_key` set plus caps (tier, seats, usage limits, features, forbidden deviations).
- **The tenant plane resolves** licensed **workflows** (`workflow.module_key` ∈ licensed set) and, transitively, the **agents** those workflows reference in their definitions. An agent is available iff some licensed workflow uses it (plus always-on service/supervisor agents whose module is licensed).

```jsonc
// The resolved snapshot the Host pushes to the tenant plane.
{
  "tenant_id": "…",
  "edition_ref": "growth",
  "version": 42,                          // monotonic; cache-invalidation key
  "licensed_modules": ["tenderlogix", "quantlogix", "costlogix"],
  "max_tier": "deep",                     // AI tier cap (§5.5)
  "seats": 25,                            // max active users
  "limits": { "runs_per_month": 500, "tokens_per_month": 50000000, "mode": "hard" },
  "features": { "white_label": true, "sso": true, "custom_roles": false },
  "forbidden_deviations": [],             // e.g. ["skip_step"] (§6.1)
  "resolved_at": "…"
}
```

### §8.2 The snapshot cache

The tenant plane can't call the Host per request, so it caches one resolved snapshot per tenant and treats it as authoritative-but-cached.

```sql
create table entitlement_snapshot (
  tenant_id            uuid primary key,
  edition_ref          text not null,
  version              bigint not null,       -- from Host; monotonic
  licensed_modules     jsonb not null default '[]'::jsonb,
  max_tier             ai_tier not null default 'deep',   -- reuses the §5 enum
  seats                int,
  limits               jsonb not null default '{}'::jsonb,
  features             jsonb not null default '{}'::jsonb,
  forbidden_deviations jsonb not null default '[]'::jsonb,
  resolved_at          timestamptz not null,
  fetched_at           timestamptz not null default now()
);

alter table entitlement_snapshot enable row level security;
create policy entitlement_snapshot_isolation on entitlement_snapshot
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Freshness — push + pull:** the Host pushes the full snapshot on any license change (`POST /internal/entitlements`, service auth), upserted by `tenant_id`; an **older `version` is ignored** (out-of-order protection). As a fallback, the tenant plane re-pulls from the Host on a short TTL. Licensed workflows resolve against the snapshot (app-layer; illustrative form, using jsonb array containment):

```
select w.* from workflow w, entitlement_snapshot e
where e.tenant_id = current_setting('app.tenant_id')::uuid
  and w.enabled
  and e.licensed_modules @> to_jsonb(w.module_key);
```

### §8.3 Enforcement points

One snapshot, checked at each seam — always *after* the permission check, never instead of it:

| Check | Where | On violation |
|---|---|---|
| workflow licensed | `POST /runs` (§4.6) | `403 entitlement_required` |
| AI tier cap | job dispatch (§5.5) | clamp requested tier down to `max_tier` |
| deviation allowed | approve deviation (§6.1) | `403` if kind ∈ `forbidden_deviations` |
| seat cap | `POST /invites`, activate (§1.3) | `403 seat_limit` if active users ≥ `seats` |
| usage cap | run / job start | `hard`: block with `402 usage_limit`; `soft`: warn + meter |
| feature flag | white-label, SSO, custom roles | feature `403` / hidden if flag false |

### §8.4 Usage metering — the reverse direction

Every `ai_job` carries `input_tokens`/`output_tokens`/`cost_minor` (§5.8) and every completed run is a billable event. These flow back to the Host (owner of `usage_record`) through a local outbox, so a Host outage never loses usage and never blocks a run:

```sql
create table usage_outbox (
  id          uuid primary key,
  tenant_id   uuid not null,
  event_type  text not null,           -- 'run.completed' | 'job.succeeded'
  quantity    bigint not null,
  unit        text not null,           -- 'run' | 'input_token' | 'output_token' | 'cost_minor'
  ref_id      uuid,                     -- run_id / job_id
  occurred_at timestamptz not null,
  reported_at timestamptz,              -- null until pushed to Host
  created_at  timestamptz not null default now()
);
create index usage_outbox_unreported_idx on usage_outbox (reported_at) where reported_at is null;

alter table usage_outbox enable row level security;
create policy usage_outbox_isolation on usage_outbox
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

A background pusher batches unreported rows to `POST {host}/internal/usage` (idempotent on the Host by event id), then stamps `reported_at`. Current-period usage for the §8.3 caps is summed from this ledger.

### §8.5 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| POST | `/internal/entitlements` | *service auth* | Host pushes snapshot; upsert by tenant; ignore stale `version` |
| GET | `/entitlements` | `billing.view` | current plan: licensed modules, caps, features (snapshot projection) |
| GET | `/settings/usage` | `billing.view` | current-period usage vs limits |

Outbound calls the tenant plane makes to the Host (not endpoints here): a TTL re-pull of the snapshot, and the batched usage push.

---

## §9 — Audit & observability

Every side-effecting endpoint in §§1–8 lists "audit" as a consequence. This is what that means. Audit is domain-neutral Core, and together with artifact provenance (§2) and job traces (§5) it makes a bid **defensible**: who decided what, when, and on what basis — provable.

### §9.1 The audit spine

Append-only, hash-chained, one chain per tenant. Tamper-evident: altering or deleting any row breaks the chain from that point forward.

```sql
create type audit_actor_kind as enum ('user', 'service', 'agent', 'system');

create table audit_event (
  id          uuid primary key,
  tenant_id   uuid not null,
  seq         bigint not null,          -- monotonic per tenant
  actor_kind  audit_actor_kind not null,
  actor_id    text,                      -- user id / service name / agent key
  action      text not null,             -- 'artifact.confirm', 'run.start', 'deviation.approve', …
  target_kind text,                       -- 'artifact' | 'run' | 'user' | 'tenant' | …
  target_id   uuid,
  project_id  uuid,                       -- null for tenant-level events
  summary     jsonb not null default '{}'::jsonb,   -- action-specific detail (before/after refs)
  prev_hash   text,                        -- hash of the prior row in this tenant's chain (null for seq 1)
  hash        text not null,               -- sha256(canonical(row fields) || prev_hash)
  created_at  timestamptz not null default now(),
  unique (tenant_id, seq)
);
create index audit_event_scope_idx  on audit_event (tenant_id, project_id, created_at);
create index audit_event_target_idx on audit_event (target_kind, target_id);

alter table audit_event enable row level security;
create policy audit_event_isolation on audit_event
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Append semantics.** On write, inside a transaction holding a per-tenant advisory lock (so appends serialize and `seq` never races): read the tenant's last row, set `prev_hash = last.hash` and `seq = last.seq + 1`, compute `hash = sha256(canonical_json(fields) || prev_hash)` over a deterministic (sorted-key) serialization of `{tenant_id, seq, actor_kind, actor_id, action, target_kind, target_id, project_id, summary, created_at}`. The table grants **no UPDATE or DELETE** — enforced by a guard trigger, so the append-only property holds even against a compromised app role:

```
create trigger audit_event_no_mutate
before update or delete on audit_event
for each row execute function raise_append_only();   -- raises; audit rows are immutable
```

### §9.2 What is audited

Every state change and every human decision — never reads (except deliberate exports). By family:

| Family | Example actions |
|---|---|
| IAM | `tenant.bootstrapped`, `invite.create`, `role.grant`, `user.suspend`, `tenant.transfer_ownership` |
| Projects | `project.create`, `project.archive`, `member.add` |
| Artifacts | `artifact.confirm`, `artifact.reject`, `artifact.edit` (human decisions — the defensibility core) |
| Runs | `run.start`, `run.cancel`, `run.rerun_stale` |
| Deviations | `deviation.approve`, `deviation.reject` |
| Settings | `settings.ai.update`, `branding.update` |
| Exports | `export.generate` (a deliverable left the system) |

AI *proposals* are recorded as artifacts (§2) with their producing job (§5); the audit chain records the *decisions* on them. Together they answer "the machine proposed X at confidence C from sources S; person P confirmed it at time T."

### §9.3 Verification & the lineage view

**Chain verification** walks a tenant's events from `seq = 1`, recomputing each `hash` and confirming `prev_hash` linkage; it returns ok, or the first broken `seq`. Run periodically and on demand.

**The defensibility view** stitches the three record systems for any artifact: its **provenance** graph (§2 — what it was derived from), its **producing job** (§5 — model, prompt version, confidence, Langfuse trace), and the **audit events** that touched it (§9 — who confirmed/edited, when). One endpoint returns the full chain from raw source document to final priced line — the thing that makes a Preckon bid stand up to scrutiny.

### §9.4 Observability

- **Langfuse (LLM).** Every `ai_job` carries a `trace_id` (§5.8); traces link job → step → run → artifact, capturing prompt version, model, tokens, latency, and cost. This is the primary window into agent behaviour.
- **Metrics & logs.** OpenTelemetry-style app telemetry: request latency and error rates, queue depth per tier lane, job success/retry rates, run throughput. Not schema — infra.
- **Eval harness.** Confirm/reject outcomes and golden datasets feed Langfuse datasets/scores, scoring each agent's quality over time. This is the CI **eval gate** (an agent/prompt change must clear score thresholds to ship) and the calibration signal for §M — production decisions become training and evaluation data.

### §9.5 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| GET | `/audit` | `admin.settings` | tenant audit log (filter by action/target/date) |
| GET | `/projects/{pid}/audit` | `artifact.read` | project audit trail |
| GET | `/audit/verify` | `admin.settings` | run chain verification; returns ok or first broken `seq` |
| GET | `/projects/{pid}/artifacts/{id}/trace` | `artifact.read` | the §9.3 lineage view: provenance + job/trace + audit |

---

## §M — Memory & the flywheel

"Preckon Core remembers and improves every time" — made concrete, not magic. Memory-the-mechanism is domain-neutral Core; the construction-specific reference *types* (rate books, standards) are userland data sitting in the generic containers below, exactly like the artifact-type vocabulary sits in a platform-level registry. Three tiers, each a real mechanism:

- **Project memory** — the persistent artifact graph itself (§2). A project accretes confirmed state across every run (§4.5); this tier already exists and needs nothing new.
- **Cross-project memory** — reusable knowledge promoted above a single project: curated reference data and promoted precedent (§M.1).
- **Learning** — confirm/reject/edit outcomes that recalibrate confidence and feed evals (§M.2).

### §M.1 Cross-project memory — one store

Reference data and promoted precedent share one versioned, provenance-linked, retrievable container. The Knowledge Agent already retrieves over it (`chunk.source_kind = 'library'`, §7.3), so tenant-wide knowledge is searchable the moment it lands.

```sql
create type library_status as enum ('active', 'superseded');

create table library_entry (
  id                 uuid primary key,
  tenant_id          uuid not null,
  collection         text not null,          -- 'rate_book' | 'standard' | 'precedent_bid' | 'template' | … (userland domain)
  entry_key          text,                    -- optional stable key within a collection
  payload            jsonb not null,
  version            int not null default 1,
  supersedes_id      uuid references library_entry(id),
  source_artifact_id uuid,                     -- provenance: the confirmed artifact that created/updated this
  status             library_status not null default 'active',
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index library_entry_scope_idx on library_entry (tenant_id, collection, status);

alter table library_entry enable row level security;
create policy library_entry_isolation on library_entry
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Reference data** (human-curated: rate books, standards, templates) is edited directly. **Precedent** is *promoted* from a confirmed artifact — `POST …/artifacts/{id}/promote` copies it into `library_entry` (`collection = 'precedent'`, `source_artifact_id` set), making one project's confirmed work reusable across all of the tenant's projects. Both are versioned by supersession (§2's pattern); superseded entries drop out of retrieval, so search never returns stale reference values.

**Feedback into reference data.** When a human confirms or corrects a value that came from a reference entry (e.g. an estimator overrides a unit rate in CostLogix), the module can write a new `library_entry` version with `source_artifact_id` pointing at the confirmation — so the rate book learns from real decisions, with provenance. Because a cost line records the exact `library_entry` version it used, updating a rate marks the cost lines that used the old version `stale` (a targeted re-plan, §2.4). Artifact-to-artifact provenance stays clean (§2.3); the rate→cost dependency is carried by that recorded reference. Full mechanics live in the CostLogix/QuantLogix module docs.

### §M.2 Learning — calibration from decisions

Every decision on a proposal is captured for analytics — separate from the tamper-evident audit chain (§9), which is not an analytics surface.

```sql
create type decision_outcome_kind as enum ('confirmed', 'rejected', 'edited', 'auto_accepted');

create table decision_outcome (
  id             uuid primary key,
  tenant_id      uuid not null,
  project_id     uuid not null references project(id),
  artifact_id    uuid not null,               -- soft ref
  agent_key      text,                         -- producing agent (null if human-authored)
  type_key       text not null,                -- artifact_type
  confidence     numeric(4,3),                 -- confidence at emit (null if human-authored)
  outcome        decision_outcome_kind not null,
  edit_magnitude numeric(4,3),                 -- 0..1, how much a human changed it (edited only)
  decided_by     uuid,
  decided_at     timestamptz not null default now()
);
create index decision_outcome_calib_idx on decision_outcome (tenant_id, agent_key, type_key, outcome);

alter table decision_outcome enable row level security;
create policy decision_outcome_isolation on decision_outcome
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Aggregated per (agent, artifact type), this is the calibration signal — how often an agent's proposals survive review unchanged, and at what confidence:

```sql
create view calibration_stat as
select tenant_id, agent_key, type_key,
       count(*) as decisions,
       avg(case when outcome = 'confirmed' then 1 else 0 end) as accept_rate,
       avg(confidence) as avg_confidence
from decision_outcome
where agent_key is not null
group by tenant_id, agent_key, type_key;
```

This drives three things: **suggested** auto-accept thresholds per type (§5.6), **eval** datasets and scores that gate agent/prompt changes in CI (§9.4), and prioritisation of which agents most need improvement.

### §M.3 Guardrails

The flywheel is powerful and therefore fenced:

- **Tenancy isolation is absolute.** Precedent, reference data, and decision signal are tenant-scoped under RLS. One tenant's confirmations never influence another's. Cross-tenant (aggregate, anonymised) learning is explicitly out of scope.
- **No silent drift.** Calibration *suggests*; it never auto-tunes production thresholds. An admin reviews and applies suggestions (`admin.settings`) — consistent with "humans approve the decisions." This prevents a feedback loop from quietly degrading quality.
- **Precedent is opt-in.** A confirmed artifact becomes cross-project precedent only by explicit promotion, never automatically — a tenant controls what becomes reusable knowledge.

### §M.4 Endpoints

| Method | Path | Permission | Side effects |
|---|---|---|---|
| GET | `/library?collection=` | `library.read` | list reference/precedent entries |
| POST | `/library` | `library.manage` | create a reference entry; chunk + embed for retrieval; audit |
| PATCH | `/library/{id}` | `library.manage` | new version supersedes; re-embed; mark dependent artifacts stale; audit |
| POST | `/projects/{pid}/artifacts/{id}/promote` | `library.manage` | promote a confirmed artifact to precedent; audit |
| GET | `/calibration` | `admin.settings` | `calibration_stat` + suggested thresholds |
| POST | `/settings/ai/apply-suggested` | `admin.settings` | apply suggested thresholds (explicit; never automatic); audit |

---

## §D — Domain packs

Core (§§1–9, §M) contains no construction. This section makes that operational: a **domain pack** is the namespaced bundle that turns generic Core into a working product. Construction is the first pack; the same Core carries any domain shaped like "AI agents derive reviewable artifacts through workflow DAGs, with human-in-the-loop and memory" — legal review, underwriting, diligence, medical coding, RFP response. This is the minimal layer that makes that true — no more.

### §D.1 What a pack bundles

A pack is one declared, namespaced unit of everything Core treats as data:

- **artifact types** — the vocabulary (schemas) written into the §2.1 registry
- **agents** — the §3.1 registry entries (I/O manifests) and their prompts/tools
- **workflows** — the §4.1 DAG definitions
- **personas** — the supervisor roster (§6.4): each a scope + deviation authority + review lens, seeded into `supervisor_profile`
- **library collections** — the §M.1 reference kinds (`rate_book`, `standard`, …)
- **role template** — the system roles + permission presets seeded at bootstrap (§1.2)
- **permission additions** — optional, beyond the Core catalog (the 18 in §1.2 are Core)
- **settings** — pack defaults (tier, auto-accept threshold)

### §D.2 The domain catalog & manifest

Packs are first-party and compiled in, but registered in a catalog so the runtime, bootstrap, and Host can read them.

```sql
create table domain (
  key        text primary key,          -- 'construction'
  name       text not null,
  version    text not null,              -- pack version, e.g. '1.0.0'
  manifest   jsonb not null,             -- the bundle declaration (below)
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
```

```jsonc
// domain.manifest for the Construction pack
{
  "domain": "construction",
  "version": "1.0.0",
  "artifact_types": ["construction.document", "construction.tender_summary", "construction.boq_line", "…"],
  "agents":         ["construction.agent.document", "construction.agent.tender", "…", "construction.agent.construction_copilot"],
  "workflows":      ["construction.workflow.tenderlogix", "construction.workflow.quantlogix", "…"],
  "personas":       ["construction.persona.bid_manager", "construction.persona.commercial", "…"],
  "library_collections": ["rate_book", "standard", "precedent_bid", "template"],
  "role_template": [
    { "key": "owner",        "name": "Owner",        "tier": "owner_admin", "permissions": ["*"] },
    { "key": "precon_lead",  "name": "Precon Lead",  "tier": "delivery",    "permissions": ["project.*", "artifact.*", "workflow.*", "library.*"] },
    { "key": "estimator",    "name": "Estimator",    "tier": "delivery",    "permissions": ["project.read", "artifact.*", "workflow.run", "library.read"] }
    // … qs_reviewer, viewer, admin
  ],
  "permissions": [],                       // no construction-specific permissions in v1
  "settings": { "default_tier": "deep", "auto_accept_threshold": 0.9 }
}
```

The manifest **is** the authoritative declaration of what the domain owns — "list the workflows in domain X" reads the manifest, no string-parsing.

### §D.3 Namespacing

Every pack-owned key is prefixed with its domain — `construction.boq_line`, `construction.workflow.tenderlogix`, `construction.agent.tender` — so two packs never collide even though the registries share one table. Single-column keys stay PKs (every FK in §§2–9 is intact); the prefix guarantees uniqueness and the manifest records membership. *(The illustrative bare keys in §§2–9 — `boq_line`, `agent.tender` — are short forms of their namespaced value.)*

### §D.4 Binding a tenant to a domain

A tenant runs exactly one domain, fixed at provisioning. The Host's bootstrap payload carries `domain_key` (§1.5), stored on `tenant_bootstrap.domain_key`. Bootstrap then seeds roles from **that pack's** `role_template` — this is what removes the construction personas from Core. The tenant's licensed workflows (§8) are resolved within its domain.

### §D.5 The Core/pack boundary

| Concern | Core (generic mechanism) | Domain pack (data) |
|---|---|---|
| artifact store · versioning · provenance · re-plan | ✓ | type keys + schemas |
| ABI · workflow runtime · gates · map/fan-in | ✓ | agent logic · workflow definitions |
| orchestration · tiers · confidence · review queue | ✓ | prompts · confidence functions |
| the Orchestrator role | ✓ | the supervisor instance (Construction Copilot) |
| storage · ingestion · retrieval | ✓ | document classification vocabulary |
| entitlements · audit · memory mechanism | ✓ | library collections |
| RBAC mechanism · permission catalog (18) | ✓ | role template (personas) · permission additions |

### §D.6 Construction — the first pack

Its full contents — the agents (13, I/O-typed), the seven Logix workflows + the TenderLogix DAG, and the artifact-type schemas + ER reconciliation + Host workflow↔module map — are specified in the **Construction pack implementation deck** (`preckon-construction-pack-design.md`), not here. That deck is pack data authored against this finished, generic ABI; this document defines only the mechanism a pack plugs into (§D.1–§D.5).

### §D.7 Deliberately not built (the fence)

To keep this a minimal layer, not a platform-within-a-platform:

- **No runtime pack loader.** Packs are first-party, compiled in — not a third-party plugin store (that remains the YAGNI call from earlier).
- **No per-domain isolation beyond tenant RLS.** A tenant is in one domain; multi-domain-per-tenant is out of scope.
- **No domain-aware Host modeling.** The Host passes `domain_key`; representing domains/packs Host-side (per-domain editions, catalogs) is a future note, not this doc.
- **No cross-domain sharing or learning.** Memory (§M) is already tenant-isolated; domains add no new sharing surface.

---

## §X — Cross-cutting conventions

The platform-wide concerns that span every section above. Consolidated here so §§1–D stay focused on their models.

### §X.1 API surface

- **Base path & versioning.** All user endpoints under `/v1`; `/internal/*` is the service-to-service surface (§X.4). Breaking changes bump to `/v2`; additive changes don't.
- **Auth & tenant resolution.** A request carries a Better Auth session (bearer); Core resolves `app_user` → tenant → roles → GUCs (§1.1). No endpoint trusts a client-supplied `tenant_id`.
- **Pagination.** List endpoints are cursor-paginated: `?limit=&cursor=` → `{ items, next_cursor }`. Cursors are opaque, keyset-based on `(created_at, id)`. No offset paging.
- **Filtering & sorting.** Documented per endpoint via query params; default sort is `created_at desc`.
- **Idempotency.** Mutating requests accept an `Idempotency-Key` header; Core dedupes by (tenant, key) so client retries are safe (already mandatory on `/internal` job/bootstrap/entitlement calls).
- **Health.** `/healthz` (liveness) and `/readyz` (readiness — DB, Redis, storage reachable) are unauthenticated and tenant-less.

### §X.2 Error model

One envelope, canonical codes:

```jsonc
{ "error": { "code": "version_conflict", "message": "…", "details": { } } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | malformed input |
| 401 | `unauthenticated` | no/invalid session |
| 403 | `forbidden` | permission check failed (§1.2) |
| 403 | `entitlement_required` | not licensed (§8.3) |
| 403 | `seat_limit` | seat cap reached (§8.3) |
| 402 | `usage_limit` | hard usage cap hit (§8.3) |
| 404 | `not_found` | absent or out-of-tenant (RLS makes these identical — no existence leak) |
| 409 | `version_conflict` | optimistic-lock mismatch (§X.3) |
| 409 | `stale_artifact` | acting on a superseded/stale artifact |
| 422 | `schema_invalid` | payload fails its `artifact_type` schema |
| 429 | `rate_limited` | throttled |
| 500 | `internal` | unexpected |

### §X.3 Concurrency & optimistic locking

Artifacts are immutable-by-supersession (§2.2), so concurrent writers must not both fork the same current version. `confirm`, `reject`, and `edit` (§2.6) take the version they act on (`If-Match` / `expected_version`); if the current row has moved on, Core returns `409 version_conflict` and the client re-reads. Confirming an already-superseded or rejected proposal returns `409 stale_artifact`. The audit append (§9.1) serialises via a per-tenant advisory lock; job/entitlement/usage writes are idempotent (§5, §8). These are the only contended paths.

### §X.4 Security & isolation

- **RLS fails closed.** Every tenant table's policy is `tenant_id = current_setting('app.tenant_id')::uuid`. If the GUC is unset, `current_setting` **raises** — a query with no tenant context fails rather than leaking. The `withTenant()`/`withProject()` repositories set the GUCs with `SET LOCAL` inside each transaction; with pgbouncer transaction pooling this is required per transaction (never session-level).
- **The one bypass.** A single `BYPASSRLS` system role exists for migrations, Core-catalog/pack seeding, and internal jobs that legitimately cross tenants — it always sets tenant context explicitly and is never reachable from a user request.
- **Service-to-service auth.** `/internal/*` endpoints (bootstrap, job result, entitlement push, usage) require a short-lived signed token from the Host/worker trust domain, not a user session; they are network-isolated and never exposed to tenant users.
- **Secrets.** Stored as references to a secret manager, never as values (inherited from the Host spec) — API keys, storage creds, signing keys.

### §X.5 Eventing & notifications

The human-in-the-loop loop needs a push, not just the pollable `review_queue` (§2.5). Core emits domain events through a generic outbox; the Host's notification domain delivers them (email/in-app), and the tenant app renders an in-app feed as a query over recent events.

```sql
create table event_outbox (
  id           uuid primary key,
  tenant_id    uuid not null,
  project_id   uuid,
  event_type   text not null,          -- 'proposal.pending' | 'gate.awaiting' | 'run.completed' | 'run.failed' | 'deviation.proposed'
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  delivered_at timestamptz,             -- null until the notifier consumes it
  created_at   timestamptz not null default now()
);
create index event_outbox_undelivered_idx on event_outbox (delivered_at) where delivered_at is null;

alter table event_outbox enable row level security;
create policy event_outbox_isolation on event_outbox
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Events fire on the moments a person needs to act: a proposal enters the queue, a gate is awaiting review, a run completes or fails, a deviation is proposed. Same reliable-outbox pattern as usage (§8.4) — a Host outage delays notifications, never loses them or blocks work.

### §X.6 Run robustness

- **Acyclicity.** The workflow resolver (§4.1) rejects a cyclic DAG at registration. Provenance edges (§2.3) must also stay acyclic; the stale-propagation CTE (§2.4) is cycle-safe via `union`, and Core rejects an `emitArtifact` whose provenance would close a loop.
- **Stalled runs & gate SLA.** A review gate can carry an optional SLA; on expiry the run isn't auto-advanced (humans approve) but is surfaced as *stalled* and an event fires. A dashboard query lists runs in `awaiting_review` beyond threshold so nothing sits silently forever.
- **Empty map.** A `map` node over zero artifacts completes immediately with no children; its fan-in agent runs with an empty input set (agents handle the empty case).
- **Agent disabled mid-run.** A run pins `workflow_version` (§4.2); an agent disabled after a run starts still completes that run from the pinned definition. New runs won't schedule a disabled agent.
- **Retry exhaustion** is covered in §5.7 (job → step → run failure, surfaced, no half-writes).

### §X.7 Data lifecycle

- **Migrations.** Drizzle-managed, forward-only, reviewed; enum changes are additive (new value appended, never renamed in place). Pack content is versioned separately via `domain.version` (§D).
- **Seeding.** Two seed contracts: the **Core catalog** (the 18 permissions, the built-in enums) and each **domain pack** (its artifact types, agents, workflows, role template, collections). Seeds are idempotent and run at deploy / provision.
- **Retention & erasure.** The audit chain (§9) is append-only, which tensions with erasure rights (PIPEDA/GDPR). Resolved by construction: the chain's `summary` stores **references and ids, never raw PII**, so erasing a person (tombstoning their `app_user` and PII columns) leaves every `hash` intact — the chain never hashed the erased values. Object-storage blobs and their derived chunks are deletable on erasure; the audit records only that a deletion occurred.
- **Backups.** Standard PITR on Postgres; object storage versioned/lifecycle-managed. Not schema — infra.

---

## Closing — a domain-neutral framework

This document is **Preckon Core**: the complete, generic tenant-plane framework. Nothing in §§1–M knows about construction — the store, ABI, runtime, orchestration, retrieval, entitlements, audit, and Memory are domain-neutral infrastructure, and §D defines the single mechanism by which a domain becomes a working product.

**The framework is closed here.** What remains is *pack* work, and it lives in per-domain **implementation decks**, one per vertical, each authored against this finished ABI:

- **Construction (first pack)** → `preckon-construction-pack-design.md`: the 13 agents (I/O-typed), the seven Logix workflow DAGs + the full TenderLogix DAG, and the artifact-type schemas + ER reconciliation + Host workflow↔module map.
- **Future packs** (legal review, underwriting, diligence, …) → their own decks, same shape, zero Core change.

The seam is §D: a deck declares a `domain` manifest (§D.2) — types, agents, workflows, role template, library collections — that this framework loads without modification.

---

## Glossary — acronyms & platform vocabulary

Every abbreviation and coined term used in this spec, so nothing is undefined at handover.

### Acronyms & abbreviations

| Term | Full form | In this spec |
|---|---|---|
| ABI | Application Binary Interface | the four-syscall surface an agent may call; the hard Preckon Core boundary (§3) |
| API | Application Programming Interface | the HTTP endpoints exposed to the tenant app |
| BOQ | Bill of Quantities | measured/priced line items; the `boq_line` artifact, QuantLogix output |
| CTE | Common Table Expression | the `with recursive` used to walk downstream provenance (§2.4) |
| DAG | Directed Acyclic Graph | the shape of a workflow, and of the artifact-provenance graph |
| DDL | Data Definition Language | the `create table` / `create type` SQL in this spec |
| ER | Entity–Relationship | the data model; Appendix C reconciles it against the ER map |
| FK | Foreign Key | referential constraints between tables |
| FX | Foreign Exchange | currency conversion — explicitly not done; currency is always explicit |
| GUC | Grand Unified Configuration (variable) | Postgres session settings `app.tenant_id` / `app.project_id` that drive RLS |
| IAM | Identity and Access Management | tenant users, roles, sessions, provisioning (§1) |
| I/O | Input / Output | an agent's declared `consumes` / `produces` artifact types |
| JSON | JavaScript Object Notation | payload and definition format |
| JSONB | JSON Binary | the Postgres binary-JSON column type used for payloads, manifests, definitions |
| LLM | Large Language Model | the model behind each AI job; run and tier-routed by Core, not the agent |
| OCR | Optical Character Recognition | a Document Agent step for scanned files |
| PK | Primary Key | the `id uuid primary key` on every table (app-supplied UUIDv7) |
| QS | Quantity Surveyor | a tenant role; reviews and corrects quantities and costs |
| RBAC | Role-Based Access Control | the tenant permission model |
| RFI | Request for Information | clarification questions; the `rfi` artifact, RFI Agent output |
| RFP | Request for Proposal | the tender package a project is bidding on |
| RFQ | Request for Quotation | vendor pricing requests; ProcureLogix output |
| RLS | Row-Level Security | Postgres per-row tenant isolation, enforced by the `tenant_id` policy |
| SaaS | Software as a Service | the delivery model |
| SQL | Structured Query Language | the database language |
| SSO | Single Sign-On | tenant identity federation (§1) |
| TS | TypeScript | the ABI signatures (§3.2) are written in pseudo-TypeScript |
| UUIDv7 | Universally Unique Identifier, version 7 | time-ordered, app-layer primary keys |
| YAGNI | You Aren't Gonna Need It | rationale for the registry being first-party, not a third-party app store |

### Platform vocabulary — coined terms

| Term | Meaning in this spec |
|---|---|
| Preckon Core | the engine at the center of the product — artifact store, ABI, workflow runtime, orchestration, audit, and Memory; the parts a module cannot bypass. Plays the OS *kernel* role. Short form: "Core" |
| Kernel / userland | the OS metaphor: **Core** is the kernel; **agents** and **workflows** are userland — first-party programs that run on Core only via the ABI |
| Memory | the Preckon Core subsystem that retains and reuses project state and confirmed signal across runs and projects; the substrate the flywheel runs on (§M) |
| Flywheel | the "remembers and improves every time" property — every human confirmation becomes reusable signal (confirmed rate → Library, won bid → precedent, edit → better future proposal) |
| Workflow product | the customer-facing name for a workflow (e.g. TenderLogix); internally a *workflow*, externally a *workflow product* |
| Domain pack | a namespaced bundle — artifact types, agents, workflows, role template, library collections — loaded onto generic Core to make a working product; Construction is the first (§D) |
| Domain | the namespace a pack owns (e.g. `construction`); every pack-owned key is prefixed with it, and a tenant runs exactly one (§D) |
| Agent | a reusable capability defined by its typed I/O; kinds: **worker** (pipeline step), **service** (called by other agents, e.g. Knowledge), **supervisor** (fills the Orchestrator role, e.g. Construction Copilot) |
| Workflow | a data-only DAG that wires agents; the seven Logix names are workflows, not modules |
| Artifact | any value in a project — versioned, sourced (human or agent), linked by provenance |
| Provenance | the edges recording which artifacts a derived artifact came from; drives re-plan |
| Proposal | an agent-emitted artifact in `pending` status, awaiting human confirmation or auto-accept |
| Review queue | the live projection (a view) of all `pending` proposals |
| Auto-accept threshold | the per-tenant confidence bar above which a proposal is confirmed with no human |
| Stale / supersede | an artifact invalidated by an upstream change / replaced by a newer version |
| Walking skeleton | the thin end-to-end TenderLogix slice (§S) that defines the minimum ABI |
| Orchestrator (role) | Preckon Core's **domain-neutral** supervisor contract: one supervisor agent per run, with whole-run visibility, deviation-within-guardrails, and the chat surface. Filled by a `kind = supervisor` agent (§6) |
| Persona | a supervisor agent plus a declared scope, deviation authority, and review lens — a "digital colleague" presiding over a slice of the work; the roster (§6.4) generalizes the single Orchestrator to N. Proposes, never disposes; pack data, seeded into `supervisor_profile` |
| Construction Copilot | the userland supervisor agent (`agent.construction_copilot`) that fills the Orchestrator role for construction — cross-checks a run's outputs and is the customer-facing chat product |
| Deviation | a supervisor's proposed control action on a run, from a **closed** set (rerun/insert-gate/skip/request-review/flag); a human approves, the runtime applies (§6.1) |
| Entitlement | what the tenant is **licensed** to (from the Host snapshot) — vs a **permission**, what a user *may* do. Both are checked; permission first, then entitlement (§8) |
| Audit spine | the append-only, hash-chained, per-tenant record of every state change and human decision; tamper-evident, and the backbone of a defensible bid (§9) |
| Event outbox | the reliable-delivery table Core writes domain events to (proposal pending, gate awaiting, run done/failed); the Host notifier consumes it to alert people (§X.5) |
| Module (external) | the customer-facing name (Host catalog / marketing) that a workflow maps to; entitlements gate on it |
| JobEnvelope / JobResult | the request / response contract for an AI job dispatched to arq/Redis (§5) |
| AI worker | the stateless Python/arq service that runs LLM calls; no store access — it proposes outputs, Core emits them (§5.1) |
| Tier (routing / standard / deep) | the model-class abstraction a job runs at, resolved to a concrete model in config (§5.5) |

### Stack proper nouns

**PostgreSQL 16** (database, RLS), **pgvector** (embeddings/retrieval, §7), **Drizzle** (ORM, generates UUIDv7 PKs), **Better Auth** (auth tables — user/session/account, §1), **arq** + **Redis** (async job queue behind AI jobs, §5), **MinIO / Cloudflare R2** (object storage for uploads, §7), **Voyage AI** (embedding model, §7), **Langfuse** (LLM tracing/observability, §9). Auth and object-storage tables are owned by those systems and referenced, not redefined, here.

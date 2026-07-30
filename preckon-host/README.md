# Preckon Host — Multi-Tenant Control Plane

The platform-operator backend + console for Preckon, implemented from the
[backend design spec v1.0](../Preckon/host/back%20end%20technical%20design%20files/preckon-host-backend-design.md).
This is the **Host plane** of the Host/Tenant model (§0.2): where TechSME defines
the product (features → editions → pricing), manages every tenant, runs billing,
and operates the platform. The tenant application is a separate plane that
consumes exactly one thing from here — **resolved entitlements**.

- **Stack:** Next.js 15 (App Router, TypeScript) · **MySQL 8** (managed with phpMyAdmin) · Better Auth (host-only identity) · React console reusing the DS-01 design system.
- **Commercial model (the contract the tenant plane reads):** `Feature → Edition (+limits) → Pricing → Subscription → resolved Entitlements → feature-gated tenant app`.

## What's in the box

| Layer | Where |
|---|---|
| **Full MySQL schema** — 32 tables across 10 domains + Better Auth tables, the append-only **hash-chained audit** (stored procedure + immutability triggers), the entitlement **resolution view**, partial-unique emulation via generated columns | [`db/schema.sql`](db/schema.sql) |
| **Seed** — permission catalog, system roles, feature registry, 3 editions + matrix, currencies, prices, usage rates, coupons, settings, AI routing, sample tenants/subscriptions/invoices/notifications | [`db/seed.sql`](db/seed.sql) |
| **API** — the full `/api/host/v1` surface (10 domains), all audited, RBAC-gated | [`src/app/api/host/v1/`](src/app/api/host/v1/) |
| **Shared libs** — db pool, auth, use-case skeleton (mutation+audit in one tx), error envelope, cursor pagination, idempotency, entitlement resolution, integration stubs | [`src/lib/`](src/lib/) |
| **Console** — the 11-screen React app on DS-01 | [`src/app/(console)/`](src/app/) |

## Prerequisites

- **Node.js 20+**
- A MySQL-protocol database — **either** works, both validated:
  - **MariaDB 10.4+** — this is what **XAMPP** ships as "MySQL". No extra install needed. ✅ tested on 10.4.32.
  - **MySQL 8.0.19+** — standalone/MAMP/Docker.
- **phpMyAdmin** (bundled with XAMPP at `http://localhost/phpmyadmin`) is the DB admin UI.

> The schema/seed were written to run on **both** engines: `utf8mb4_unicode_ci` collation, `VALUES()`-form upserts, `GROUP_CONCAT` instead of `JSON_ARRAYAGG`, and a driver-side JSON parse (MariaDB stores JSON as `LONGTEXT`, MySQL 8 as native `JSON`) so route code always gets objects.

## Setup (5 steps)

```bash
cd preckon-host
npm install
cp .env.example .env          # then edit DB creds + secrets
```

**1 · Create the database & schema.** Either:

- **phpMyAdmin:** Import → choose `db/schema.sql`, then Import → `db/seed.sql`. *(schema.sql creates the `preckon_host` database itself.)*
- **or CLI:** `npm run db:import` (runs schema + seed using `.env` creds).

`db/seed.sql` loads **platform configuration only** (permissions, roles, the feature/edition catalog, pricing, currencies, settings, AI routing) — **no sample tenants or business data**, so the console starts clean and you create your own. Want demo rows (fake tenants, invoices, notifications) to explore with? Also import **`db/seed-demo.sql`** (phpMyAdmin Import, or `mysql -u root preckon_host < db/seed-demo.sql`).

**2 · Set a Better Auth secret** in `.env` (`BETTER_AUTH_SECRET`) — any 32+ char random string.

**3 · Run the app:**

```bash
npm run dev            # http://localhost:3000
```

**4 · Create the first Owner staff account** (dev server must be running):

```bash
npm run seed:owner     # → admin@techsme.com / preckon-admin-2026
# override: OWNER_EMAIL=you@techsme.com OWNER_PASSWORD='min-12-chars' npm run seed:owner
```

**5 · Sign in** at http://localhost:3000 with those credentials. You land on the Host Console.

> If you use XAMPP/phpMyAdmin, that's all — the running MySQL/MariaDB is what the app connects to. The `.env` defaults (`root` / empty password / `preckon_host`) already match a stock XAMPP install.

## Run with Docker

A multi-stage [`Dockerfile`](Dockerfile) builds a small standalone Next.js image;
[`docker-compose.yml`](docker-compose.yml) brings up the app **and** MySQL 8 with the
schema + seed auto-imported on first boot.

```bash
docker compose up --build          # builds the image, starts db + app
docker compose run --rm seed       # create the first Owner staff account
```

- App → http://localhost:3000  ·  MySQL → `localhost:3307`
- Default Owner login: `admin@techsme.com` / `preckon-admin-2026`
  (override via `OWNER_EMAIL` / `OWNER_PASSWORD` on the `seed` service).

The DB schema and **platform seed** (`db/schema.sql`, `db/seed.sql`) load once, on the
first `db` init, via MySQL's `docker-entrypoint-initdb.d`. To reset everything:
`docker compose down -v` (drops the `db_data` volume), then `up --build` again.

> **Before deploying anywhere real,** change `BETTER_AUTH_SECRET`, `INTERNAL_SERVICE_TOKEN`,
> and `MYSQL_ROOT_PASSWORD` in `docker-compose.yml` (or supply them via an env file /
> your orchestrator's secrets). The compose defaults are for local use only.

Build just the image (no compose):

```bash
docker build -t preckon-host .
docker run -p 3000:3000 --env-file .env preckon-host
```

## Architecture notes (how the spec maps to MySQL)

The design spec is PostgreSQL-specific; the load-bearing pieces were translated, not dropped:

| Spec (Postgres) | Here (MySQL 8) |
|---|---|
| UUIDv7 PKs | `CHAR(36)`, generated in-app (`uuidv7()`), still time-ordered |
| `citext` email | table collation `utf8mb4_0900_ai_ci` (case-insensitive) |
| `jsonb` | `JSON` |
| `timestamptz` (UTC) | `DATETIME(3)`, pool `timezone:'Z'` reads/writes UTC |
| `bytea` sha256 | `CHAR(64)` hex (`SHA2(...,256)`) |
| `text[]` | `JSON` array |
| sequences | `AUTO_INCREMENT` (`audit_event.seq`) |
| partial unique indexes | **STORED generated column + UNIQUE** (one active impersonation / one live subscription) |
| plpgsql audit chain + advisory lock | stored procedure `append_audit_event` + `GET_LOCK` + `BEFORE UPDATE/DELETE` immutability triggers |
| resolution view | `tenant_entitlement_resolved` view |

**The five invariants from the spec are preserved:**
1. **Two planes, two identity pools** — host staff live in Better Auth + `host_user`; tenant users never appear here (§0.2).
2. **Every mutation is audited in the same transaction** — enforced by `useCase(ctx, (conn, audit) => …)` (§0.4). There is no write path without an audit event.
3. **Tamper-evident audit** — hash chain; `GET /api/host/v1/audit-events/verify` re-walks and detects any break.
4. **Entitlements are computed, never stored, and never depend on Stripe** — the resolution view ⊕ overrides; Stripe only mirrors money (§7.0).
5. **RBAC on every endpoint** — `requirePermission(ctx, key)`; the console UI gating is convenience only.

## Integrations

Stripe, email, and object storage run in **logged mock mode** when their env keys
are blank (see `src/lib/integrations.ts`) — the whole control plane is exercisable
with no external accounts. Fill in `STRIPE_SECRET_KEY`, `EMAIL_API_KEY`, `STORAGE_*`
in `.env` and complete the clearly-marked `TODO(prod)` boundaries to go live.
Observability (`/observability/*`) is a read-through facade returning realistic
shapes until arq/Redis + Langfuse are wired.

## The tenant plane's one dependency

```
GET /api/host/v1/internal/entitlements/{tenant_id}
Authorization: Bearer <INTERNAL_SERVICE_TOKEN>
```

Returns the resolved entitlement snapshot (§5.3) the tenant app caches and enforces against.

## Project layout

```
preckon-host/
├─ db/{schema.sql, seed.sql}          # phpMyAdmin-importable
├─ scripts/{db-import.mjs, seed-owner.mjs}
├─ docs/BUILD-CONTRACT.md             # conventions every route/screen follows
└─ src/
   ├─ lib/                            # db, auth, context, usecase, audit, errors, http, entitlements, integrations
   └─ app/
      ├─ page.tsx                     # login
      ├─ (console)/                   # the 11 screens + shell
      └─ api/{auth, host/v1}/         # Better Auth + the control-plane API
```

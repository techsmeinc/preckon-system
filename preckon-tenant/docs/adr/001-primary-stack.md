# ADR-001 — Next.js + TypeScript + MySQL 8 is the primary stack

**Status:** accepted · **Date:** 2026-08-20

## Context

Three blueprints specify three different stacks:

- **Master Blueprint §6.1** — .NET 9 core APIs, PostgreSQL, OpenSearch, NATS/RabbitMQ, Temporal
- **PCM Engineering §34** — PostgreSQL with PostGIS; its DDL uses `JSONB` and `TIMESTAMPTZ` in 18 places
- **AI Fabric §3** — Node 20 / Next.js 15 / TypeScript / MySQL 8, plus Python/FastAPI/arq/Redis

What is actually built and deployed is a fourth thing: **Next.js 15.5,
TypeScript strict, MySQL 8, a Node worker, no Redis, no message broker,
no separate search cluster.**

This is not a small inconsistency. PCM is labelled "engineering baseline
for implementation" and its schemas will not execute on MySQL. An
engineer implementing it literally, as instructed, produces code that
does not run. Master Blueprint Appendix F states that child documents
"should not silently contradict its core principles" — they already do,
down to the DDL.

## Decision

**Next.js 15.x + TypeScript strict + MySQL 8 + a Node worker** is the
stack. PCM's DDL and Master §6.1 are to be amended to match, not the
other way round.

Reasons, in order of weight:

1. **It is what exists and is deployed**, carrying real project data.
   Migrating a working system to satisfy a document is a cost with no
   customer-visible benefit.
2. **On-prem ships as one compose file.** Every additional component —
   Redis, a broker, a search cluster — is another thing a customer's IT
   department has to run, monitor and back up. The AI Fabric blueprint
   itself warns against adding infrastructure before a measured need
   (§3, §50).
3. MySQL 8 has JSON columns, generated columns, CTEs and window
   functions. Nothing the domain needs today requires PostgreSQL.

## Consequences

- **PostGIS is not available.** Spatial queries use bounding boxes in
  ordinary indexed columns. If genuine geometric querying is needed,
  that is a new decision with its own ADR, not an assumption.
- **No row-level security.** MySQL has none, so tenant isolation is
  app-layer and must be verified statically — see ADR-008.
- **`JSONB` / `TIMESTAMPTZ` in PCM must be read as `JSON` / `DATETIME(3)`.**
- Python remains in use for the CAD sidecar, where the library ecosystem
  (LibreDWG, ezdxf) is the reason. That is a deliberate exception, not a
  second stack.

# ADR-008 — Isolation is app-layer and statically verified

**Status:** accepted · **Date:** 2026-08-20

## Context

PCM §45 suggests PostgreSQL row-level security as defence in depth.
ADR-001 chose MySQL, which has none. Isolation therefore rests entirely
on every query carrying a tenant predicate — a property that holds only
as long as every developer remembers.

## Decision

Isolation is enforced in the application and **verified statically**.
`test/tenant-scoping.test.ts` reads every SQL statement in `src/` and
fails if one touches a tenant-scoped table without a tenant constraint.
The scoped-table list is derived from `db/schema.sql` rather than
hand-kept.

## Consequences

- **`db/schema.sql` is part of the security boundary.** A table created
  only in a migration is invisible to the guard, so every query against
  it goes unchecked while the test still passes green.

  This is not hypothetical. The seven DocLogix tables were added in
  migration 019 and the guard passed vacuously over all of them; adding
  them to `schema.sql` immediately surfaced six real violations. A
  further five tables — `bim_document`, `cad_extraction`,
  `project_programme`, `learned_lesson` and `pcm_coordinate_system` —
  had been drifted since as early as migration 004, meaning their
  queries had never been checked at all.

  `test/schema-drift.test.ts` now fails if the two files disagree. That
  test is a security control, not housekeeping.

- Isolation by *provenance* (an id obtained from an already-scoped
  query) is weaker than isolation by *constraint*. Prefer stating the
  constraint even when a join implies it: it costs nothing and does not
  depend on a future edit preserving the reasoning.
- A raw SQL console has no protection. Operational database access is a
  separate control and is not addressed here.

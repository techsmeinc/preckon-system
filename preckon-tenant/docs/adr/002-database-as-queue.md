# ADR-002 — The database is the job queue

**Status:** accepted · **Date:** 2026-08-20

## Context

AI Fabric §3 and §31 prescribe Redis with `arq` for the AI job queue.
The implementation uses MySQL: `ai_job` rows claimed by a conditional
`UPDATE`, with leases and a reconciler.

## Decision

Keep the database as the queue. The dispatcher stays behind an
interface so a broker can be slotted underneath if a measured need
appears.

The row *is* the queue: MySQL is already the durability boundary for
everything else, a claim is one conditional `UPDATE`, and recovery is a
query. Redis would add a component that can lose jobs on restart in
exchange for throughput this workload does not need.

## Consequences

- Throughput is bounded by the database. Acceptable: these jobs take
  seconds to minutes, not milliseconds.
- Polling has latency a push-based broker would not. Bounded by the
  dispatch interval and irrelevant at this job duration.
- **A stuck job is visible in SQL**, which is a real operational
  advantage over inspecting a broker.
- On-prem gains nothing to install.

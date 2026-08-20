# ADR-006 — Usage is recorded per attempt, append-only

**Status:** accepted · **Date:** 2026-08-20

## Context

`ai_job` carries `input_tokens`, `output_tokens` and `cost_minor`, and
it looked sufficient. It is not: there is **one row per job** and those
columns are overwritten on every retry.

A job that spends tokens on attempt 1, fails validation, retries and
succeeds on attempt 2 records only attempt 2. Attempt 1's spend
disappears — and failed attempts are disproportionately the expensive
ones, because they are the ones that got retried.

So AI cost has been under-counted by exactly the amount most worth
seeing, and `ai-cost.ts` reports on that under-count. Any budget checked
against it permits more than the customer agreed to, and the gap widens
with every retry.

AI Fabric §20 asks for "an immutable usage event for every AI execution
attempt".

## Decision

`ai_usage_ledger`: append-only, one row per **attempt**, never updated.
Carries tenant, project, job, attempt number, module, task type,
execution class, model alias, prompt version, sensitivity, policy
version, token counts, cost, latency, cache hit and outcome.

`ai_job` keeps its columns as the *last-attempt summary* the job list
reads. The two answer different questions and both are wanted.

## Consequences

- Cost reporting must read the ledger, not `ai_job`. Until `ai-cost.ts`
  is migrated it continues to under-report.
- The ledger grows without bound and needs a retention policy of its
  own — deliberately not solved here.
- Spend limits become meaningful, because they are measured against what
  was actually spent.

# ADR-009 — Governance features ship report-only before they ship enforcing

**Status:** accepted · **Date:** 2026-08-21

## Context

Three features now sit between a request and a model call: the data
policy ([005](005-tenant-policy.md)), the budget ceiling, and the
response cache ([007](007-cache-key-safety.md)). Each of them can
*change what the system does* — refuse a job, or serve a stored answer
instead of computing one.

Each was also switched on for the first time against live tenant data
that nobody had checked it against. The policy is the clearest case: on
day one it would have blocked every job, because unclassified data
defaults to `confidential` and the SaaS profile forbids sending
confidential data to an external provider. That default is correct. It
would still have taken the product down.

The cache has the same shape of risk in the other direction. Serving a
stored answer is a real behaviour change, and the failure mode is quiet:
nobody notices reuse that should not have happened until an estimator
asks why two runs disagree.

## Decision

A feature that changes dispatch behaviour ships in two stages, with the
**observation stage on by default and the acting stage behind a flag**.

- **Policy** — evaluated always, ledger row written always, refusal
  thrown only when `AI_POLICY_ENFORCE` is set. The live metric
  `preckon_ai_policy_rejected_24h` counts what it *would* have stopped.
- **Cache** — every completed job writes its answer back
  (`AI_CACHE_WARM`, on by default). Reuse is served only when
  `AI_CACHE_REUSE` is set. The hit counters accumulate either way, so
  `preckon_ai_cache_saved_minor` shows what reuse is worth before
  anyone turns it on.

The observation stage is not a lesser version of the feature. It is the
only way to answer "what will this do to us" with evidence rather than
with an argument.

## Consequences

- Two switches per feature instead of one, and a period where the code
  computes something it does not act on. That cost is one insert and one
  branch.
- The metrics have to be worth reading, or the observation stage is
  theatre. Both features expose counters on `/api/v1/metrics`
  specifically so the decision to enforce is made from data.
- A flag that is never turned on is a feature that was never delivered.
  These are staging posts, not permanent homes, and a flag still off in
  six months is a decision nobody took.
- Cache warming on by default means the table fills before anything
  reads it. Storage is cheap and a cold cache on the day reuse is
  enabled would make the first week look worthless.

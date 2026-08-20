# ADR-007 — Every dimension that changes an answer is in the cache key

**Status:** accepted · **Date:** 2026-08-20

## Context

AI Fabric §9.13 is unusually firm: a semantic similarity match alone is
never sufficient to reuse an answer.

On a construction project this is a liability question, not a quality
one. Reusing an answer computed against Rev B after Rev C is issued
produces a statement the documents no longer support — delivered with
exactly the confidence of a fresh answer, which is what makes it
dangerous.

## Decision

The key is a SHA-256 over tenant, project, task type, normalised input,
sorted source revision keys, sensitivity, policy version, prompt
version, schema version and model alias.

Everything that could change the answer is **in the key**, not in a
validity check afterwards and not in a TTL — so a mismatch cannot
produce a hit at all. §19: do not use TTL alone to guarantee
correctness.

`canReuse()` exists as a second explicit check, because a cache is
precisely where a future optimisation ("skip the revision check, it is
usually fine") is tempting, and because when reuse is refused somebody
deserves to know which dimension moved.

## Consequences

- Hit rates are lower than a similarity-only cache. That is the cost of
  the guarantee and it is worth paying.
- Revision keys are sorted, so the same evidence set keys identically
  whichever order retrieval returned it in.
- Invalidation is scoped by trigger — issuing one drawing must not
  discard every cached answer on the project, but must discard the ones
  computed from that drawing.

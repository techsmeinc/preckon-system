# ADR-010 — Prompt registry v1 records identity, not prompt text

**Status:** accepted · **Date:** 2026-08-21

## Context

`ai_prompt_version` has existed since migration 021 and stayed empty.
The usage ledger kept `prompt_key` and `prompt_version` columns for it
and wrote NULL into both, so the question the registry exists to answer
— *which prompt produced this output* — had no answer at all.

Populating it means deciding what a version-1 row contains. The prompt
bodies live in the worker service, not here. Two options:

1. Copy the prompt text into `prompt_json` so v1 is complete.
2. Record only identity, and leave the body empty until a prompt is
   genuinely authored through the registry.

Option 1 is tempting because it makes the table look finished.

## Decision

**v1 records identity and provenance only.** `prompt_json` carries the
task type and tier; `prefix_hash` is NULL because there is no prefix
here to hash.

The reason is narrow and decisive: any text written into that column
today would be a *reconstruction*, and it would be indistinguishable
from the real thing to whoever reads it next. Somebody debugging a bad
output six months from now would read a prompt that never reached a
model and conclude the prompt was fine. An empty column says "we do not
have this"; a plausible column says something false.

So the version number carries meaning: **v1 is the un-migrated
baseline** — whatever the worker shipped with — and **v2 onward is
governed**, with real content, a prefix hash and an eval version.
`resolvePrompt()` picks up v2 with no code change.

Status is `approved` rather than `draft` because these *are* what runs
in production. Marking the live prompts as drafts would make the one
honest status value in the table a lie.

## Consequences

- The ledger now records prompt provenance for every construction-pack
  task, which is what the columns were for.
- Template-pack tasks (`intake.capture`, `<stage>.run`) are not seeded:
  they are generated per configured domain and their task types are not
  knowable at migration time. `resolvePrompt()` falls back to the
  caller's reference, which is exactly the unregistered behaviour it was
  built to degrade to.
- Migrating a prompt into the registry is a real piece of work per
  prompt, not a bulk import. That is the honest cost and it is
  deferrable per task.
- `prefixDrifted()` exists to catch a prefix edited in place rather than
  versioned — the failure that silently discards provider prompt-cache
  reuse and multiplies input cost.

# ADR-004 — Application code names aliases, never models

**Status:** accepted · **Date:** 2026-08-20

## Context

AI Fabric P-09 and §51.12 require application code to reference
`preckon-reasoning`, not `claude-opus-4-8`. Four files currently name
concrete models: the bim/agent, cad/agent and cad/assistant routes, and
`src/lib/jobs.ts` lines 65-67.

So replacing a model is a code change and a deploy, and the blueprint's
claim that "any individual base model can be replaced" is not true of
this codebase.

## Decision

Models are referenced by alias. `ai_model_registry` maps an alias to a
provider, provider model, boundary, capabilities and a rate card.
`src/lib/ai/registry.ts` resolves them.

**Resolution fails loudly.** An unknown alias throws rather than falling
back to a default — a silent fallback means a typo routes production
traffic to the wrong model and nothing says so until the bill arrives.

Prices live in the registry, not in code. §9.11 is explicit that
provider pricing is mutable configuration; a price compiled into a build
is wrong the day the provider changes it, and every cost report built on
it is quietly wrong afterwards.

## Consequences

- Swapping or repricing a model is a data change.
- Retired models still resolve, so historical usage rows can be priced
  and explained. A ledger entry naming a model nobody can look up is a
  hole in the audit trail.
- The four files above still need migrating. Until they are, the rule is
  documented but not enforced — a static test asserting no route names a
  concrete model is what would make it real.

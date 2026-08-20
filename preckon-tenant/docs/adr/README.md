# Architecture Decision Records

The blueprints call for roughly fifty ADRs across three documents
(Master §44, PCM §65, AI Fabric Appendix C). None existed, which is why
three of those documents specify three different technology stacks
without anyone having to reconcile them.

These are the ones that resolve a question the codebase has already
answered in practice, or that a future change could get wrong silently.
Written after the fact where the decision was already made — an ADR that
records why the code is as it is has most of the value of one written in
advance, and none of the cost of pretending we knew earlier.

| ADR | Decision |
|---|---|
| [001](001-primary-stack.md) | Next.js + TypeScript + MySQL 8 is the stack |
| [002](002-database-as-queue.md) | The database is the job queue; no broker |
| [003](003-ai-non-authoritative.md) | AI proposes; it never commits business state |
| [004](004-model-aliases.md) | Application code names aliases, never models |
| [005](005-tenant-policy.md) | Data policy decides eligibility before quality |
| [006](006-per-attempt-ledger.md) | Usage is recorded per attempt, append-only |
| [007](007-cache-key-safety.md) | Every dimension that changes an answer is in the key |
| [008](008-tenant-isolation.md) | Isolation is app-layer and statically verified |

Format: context, decision, consequences. Short on purpose — an ADR
nobody reads has failed regardless of how thorough it is.

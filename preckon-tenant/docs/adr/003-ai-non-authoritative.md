# ADR-003 — AI proposes; it never commits authoritative state

**Status:** accepted · **Date:** 2026-08-20

## Context

Stated as non-negotiable in every blueprint (AI Fabric P-02, PCM §1.2,
Complete Platform §5, Master §45.2). Worth an ADR anyway, because it is
the rule most likely to be eroded by a well-meaning "just this one
low-risk case" change.

## Decision

An AI execution may produce **proposals, extracted facts,
classifications, drafts and confidence metadata**. It may never write
authoritative business state directly.

Every mutation goes: propose → validate → human review → apply → audit.
Enforced by `bim_proposal`, `pcm_change_set`, the artifact review queue,
and `audit_chain`.

## Consequences

- Every AI-derived value carries provenance and a review state.
- A model cannot be given database write credentials, ever.
- Bulk AI work needs a bulk review surface, or review becomes the
  bottleneck. That is a UX problem to solve, **not a reason to relax the
  rule.**
- "Low-risk auto-apply" proposals must be an explicit, audited,
  per-task-class policy decision — never a default and never implicit.

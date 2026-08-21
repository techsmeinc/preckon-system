# ADR-011 — Analysis proposes; it never rewrites the programme or the price

**Status:** accepted · **Date:** 2026-08-21

## Context

[ADR-003](003-ai-non-authoritative.md) settled that AI proposes and
never commits business state. A second class of module now raises the
same question without involving a model at all: deterministic analysis
that computes a *better* answer.

Resource levelling can compute a schedule that fits the available gangs.
BAFO assessment can compute a price that meets the client's target.
Delay analysis can compute an entitlement. All three are arithmetic, not
inference — so the ADR-003 reasoning about model reliability does not
apply, and it would be easy to conclude they may therefore write.

`resources.ts` had already taken a position on this in a comment, before
any of these existed: it computes the demand curve and refuses to level,
on the grounds that "a tool that silently rescheduled a programme to fit
its own resource assumptions would be worse than one that says you need
eleven bricklayers on the 14th and you have six."

## Decision

**Deterministic analysis returns proposals with consequences stated. It
does not mutate the artifact it analysed.**

- `levelling.level()` returns moves; `asProposal()` marks anything that
  shifts completion as requiring approval.
- `bafo.assess()` returns a recommendation and can return
  `do_not_submit`; it does not adjust the price.
- `delay.analyse()` states entitlement *under a named rule* and returns
  contested periods unresolved.
- `budget.forecast()` computes three forecasts and keeps them side by
  side rather than blending them.

The distinction that matters is not confidence, it is **authority**. A
levelled programme is a commercial commitment about a completion date. A
BAFO is an offer. Correct arithmetic does not make the tool the right
party to commit to either, and the person who has to defend the result
to a client cannot defend "the optimiser decided".

This also constrains the algorithms. Levelling uses the serial method
rather than an optimiser because it is deterministic and explicable;
being marginally better while being unexplainable would be worse.

## Consequences

- Every one of these modules has an extra output shape — the proposal —
  and a review gate stands between it and the artifact.
- Where methods legitimately disagree, the disagreement is surfaced
  rather than resolved. Concurrency in delay analysis is selectable
  between Malmaison, apportionment and dominant cause because they give
  different answers on purpose, and defaulting silently would bury a
  six-figure decision in a config value.
- Some outputs are deliberately uncomfortable. A BAFO tool that computed
  the revised total and stopped would help produce exactly the
  submission the module exists to prevent.
- Auto-apply remains possible later for genuinely reversible cases, but
  it is a separate decision with its own audit requirements, not
  something to arrive at by relaxing this one.

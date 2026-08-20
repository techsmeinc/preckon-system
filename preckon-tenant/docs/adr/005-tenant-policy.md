# ADR-005 — Data policy decides eligibility before quality

**Status:** accepted · **Date:** 2026-08-20

## Context

AI Fabric P-08: a model is ineligible if tenant policy or data
classification does not permit that deployment boundary, however much
better it is. Nothing in the platform knew data had a classification, so
nothing could stop tender pricing reaching an external model — not
because anyone decided that was acceptable, but because the question was
never asked.

Preckon Private AI and Preckon Sovereign AI (§37) are sold on this
distinction. Without it they are slides.

## Decision

`ai_tenant_policy` stores a deployment mode (saas / private / sovereign)
and per-classification boundary rules. `src/lib/ai/policy.ts` evaluates
eligibility.

Three properties, each with a test:

1. **Eligibility is decided before scoring.** A router that scores first
   and filters afterwards will eventually leak, because somebody will
   add a fast path.
2. **A tenant may narrow, never widen.** Otherwise a sovereign install
   could configure itself back into calling a third party and the mode
   would mean nothing.
3. **Unclassified is treated as confidential, not public.** On a
   construction project the unclassified thing is usually tender pricing
   somebody uploaded without thinking, and the cost of being wrong is
   asymmetric.

The most restricted item in a request sets the request's classification.
Averaging permits exactly the leak classification exists to prevent.

## Consequences

- A sovereign tenant may find no model can serve a request. That is the
  correct outcome and is reported as such, not worked around.
- Every rejection carries the rule that produced it — "the good model
  was not used" is a question people ask, and "policy" is not an answer.
- Classification has to come from somewhere. Documents carry
  `confidentiality`; requests touching several take the worst.

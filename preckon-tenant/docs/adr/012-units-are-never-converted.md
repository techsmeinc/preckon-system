# ADR-012 — Mismatched units are reported, never silently converted

**Status:** accepted · **Date:** 2026-08-21

## Context

Three modules built in the same week each hit the same decision
independently.

The quantity traceback reconciles a billed figure against the
measurements cited for it. Some cited measurements arrive in a different
unit from the bill — millimetres against metres, m³ against m².

The narrative grounding checker compares figures in submission prose
against the artifacts they cite. "18 weeks" and "18 days" are the same
number.

The P6 importer reads durations stored in hours and needs them in days,
where the divisor depends on the activity's calendar.

In each case the convenient behaviour is to convert and carry on. The
arithmetic then works, the report is clean, and nothing is flagged.

## Decision

**Where two figures should be comparable and their units differ, the
mismatch is reported and the figure is excluded from the total. It is
not converted.**

A unit difference between two things that were supposed to describe the
same quantity is almost always an *error upstream* — a measurement taken
at the wrong scale, a value read from the wrong column, a prose figure
copied from a different document. Converting fixes the sum and hides the
mistake that produced it, and the mistake is the finding.

Concretely:

- `traceback.trace()` sums only sources sharing the bill's unit, returns
  the rest in `unitMismatches`, and reports `unit_mismatch` where none
  match. A measurement in mm against a bill in m is a thousand-fold
  error waiting to happen.
- `narrative.reviewSection()` compares claims only against facts in the
  same normalised unit. A checker ignoring units would report
  contradictions as agreement roughly as often as the reverse.
- Known synonyms *are* normalised — `lm`/`m`, `sqm`/`m²`, `no`/`nr` —
  because flagging those is noise, and noise is what teaches people to
  dismiss the real findings.

Conversion is legitimate exactly where the source *declares* the unit it
stores and the target unit, which is the P6 hours-to-days case: the file
states hours, the calendar states hours-per-day, and the conversion is
the file's own arithmetic rather than a guess about intent. Even there,
an assumed calendar is reported rather than absorbed.

## Consequences

- Reports show more findings, some of which are data-entry problems
  rather than bugs. That is the correct place to fix them.
- Every totalling function needs a canonical-unit helper and a synonym
  table, and the synonym table is a judgement call that must stay short.
  A long one is conversion by another name.
- A caller who genuinely wants a conversion must do it explicitly, at
  which point it is visible in a diff.

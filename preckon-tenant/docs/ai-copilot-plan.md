# AI Design Copilot — staged implementation plan

Target: the copilot described in `Preckon_DrawLogix_Complete_Blueprint_v1.0.md` §9,
built on the BIM agent already in `src/lib/bim/`.

Status: **plan only, nothing built.** Phase 0 is a survey of what exists today.

---

## Phase 0 — where we actually are

The blueprint's authoring pipeline (§7) is:

```
User Intent → AI Interpretation → Typed Command → Geometry/Parametric Engine
→ Validation → Preview Diff → Commit → PCM ChangeSet + Revision + Events
```

What `src/lib/bim/` implements today:

```
User Intent → AI Interpretation → Typed Command → applyCommand → doc
                                                  ╰─ no validation
                                                  ╰─ no preview diff
                                                  ╰─ no ChangeSet / revision / events
```

Present and working — these are the load-bearing pieces, and they are sound:

| Piece | Where | Note |
|---|---|---|
| Multi-step tool loop with model feedback | `agent.ts:130-161` | Agent creates a wall, reads the updated model back, then hosts a door on it. The hard part, already correct. |
| Commands as data, one interpreter | `commands.ts:82-155` | Toolbar and AI emit identical commands. Do not break this. |
| Discipline scoping | `agent.ts:56-75` | Specialists cannot touch other disciplines; drops are reported, not silent. |
| Propose-then-apply | `proposal.ts` | Already the blueprint's `APPLY_WITH_USER_APPROVAL` mode. |
| Undo/redo | `commands.ts:161-181` | Pure history bus, 99 states. |

Gaps, each traced to a blueprint section:

1. **The agent is blind to identity.** `model.ts:218` `describe()` emits id, discipline,
   category, geometry, level — but not `name` or `params`, though `Element` carries both
   and `commands.ts:113` sets `name` on rooms. Consequence: no instruction that refers to
   an element by name ("room 307", "the acoustic wall type") can resolve. This is the
   single highest-value fix in the whole plan.
2. **7 commands, blueprint lists 26** (§8). Missing the entire annotation and
   documentation family: `CreateTag`, `CreateDimension`, `CreateView`, `CreateSheet`,
   `GenerateSchedule`; plus `RotateObject`, `CopyObject`, `ChangeType`, `ApplyConstraint`.
3. **No query/selection.** §9 requires "query and semantically select objects". Today the
   whole model is dumped into the prompt every turn — correct at 50 elements, untenable at
   5,000, and it makes set operations ("all fire doors") a parsing exercise for the model.
4. **No validation engine.** §17 defines 10 validation layers and 4 severities. Nothing
   detects an omission, so the copilot can only act when told precisely what to do.
5. **Two execution modes, blueprint defines five** (§9): `READ_ONLY`, `PROPOSE`,
   `PREVIEW`, `APPLY_WITH_USER_APPROVAL`, `POLICY_AUTHORIZED_AUTOMATION`.
6. **No ChangeSet / revision / events** (§18, §24). Every mutation should carry base
   revision, author, commands, diff, validation and impact.
7. `MAX_STEPS = 6` (`agent.ts:23`) caps multi-step work well below what §9's examples need.

---

## Phase 1 — identity and retrieval

*Makes any name-referring instruction resolvable. Everything later depends on this.*

- `model.ts` — `describe()` emits `name` and meaningful `params`. Guard width: a 5,000-element
  model must not blow the context window, which forces Phase 1b.
- `model.ts` — new `query(doc, filter)`: by category, discipline, level, name pattern,
  param predicate, spatial bounds. Pure, no AI.
- `agent.ts` — new `query_model` tool alongside `apply_commands`, so the agent retrieves
  instead of receiving a dump. Prompt changes from "here is everything" to "here is a
  summary; query for detail".
- Selection sets: a named, reusable result ("all fire doors on L2") the agent can act on
  as a unit.

Done when: the agent resolves "room 307" against a 2,000-element model without the full
model in context.

## Phase 2 — the annotation and documentation commands

*The family the video's example needs.*

- `add_tag` — hosted on any element, with a positioning rule; the `Tag` element type does
  not exist yet and needs adding to `CATALOG` in `model.ts`.
- `add_dimension` — between two points/elements, with witness lines.
- `rotate`, `copy`, `change_type`, `apply_constraint` — completing §8's mutation set.
- `create_view`, `create_sheet`, `generate_schedule` — these overlap substantially with
  `sheets.tsx` (771 lines, already parses schedules from CAD); reuse rather than reimplement.

Open question: `sheets.tsx` currently *reads* schedules out of imported drawings.
Generating them is the inverse. Whether these share a representation needs a decision
before either is built.

## Phase 3 — validation engine

*Turns "do what I said" into "notice what is wrong".*

- `lib/bim/rules.ts` — rule as data, not code: applicable selector, predicate, severity
  (`INFO | WARNING | ERROR | BLOCKING`), remediation command template.
- Start with §17 layers 1-5 (geometry integrity, parametric constraints, host/dependency
  validity, system connectivity, discipline rules). Layers 6-8 need TenderLogix
  requirement extraction and should not be attempted here.
- `GET /bim/audit` — findings with affected objects, evidence, remediation.
- Agent gains `run_validation`; a finding carries its own fix command, so "fix all
  untagged rooms" becomes a loop over findings rather than open-ended reasoning.

Done when: an untagged room is reported *without being asked*, with a one-click fix.

## Phase 4 — execution modes and ChangeSets

- Five modes per §9. `PREVIEW` needs a diff the UI can render — computed by applying
  commands to a *copy* and diffing, which the pure-function design already permits.
- ChangeSet per §18: base revision, author/source, commands, object diffs, validation,
  impact summary. States `DRAFT → PREVIEWED → VALIDATED → APPROVED → COMMITTED`.
- Domain events per §24: `ModelObjectCreated/Changed/Deleted`, `ValidationFailed`,
  `QuantityInvalidated`. `QuantityInvalidated` matters most — it links the model back to
  BOQ and is what makes "compare Rev 8 vs Rev 7 and show cost impact" possible.
- Raise `MAX_STEPS`, with a token/step budget rather than a flat cap.

---

## Sequencing note

Phases 1 and 2 are independently useful and low-risk. Phase 3 depends on Phase 1's query
layer. Phase 4 touches persistence and is the only one that needs a schema migration —
worth a separate review before starting.

The constraint from §7 holds throughout and should be treated as inviolable:

> LLMs never directly write authoritative geometry.

The agent emits commands; the engine writes geometry. Every phase preserves that.

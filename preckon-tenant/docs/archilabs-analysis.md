# ArchiLabs — what the ten demo videos show

Source: `Preckon-system/archilabs/*.mp4` — ten silent screen recordings, 1814×1078, ~23 min
total, all recorded 24 Sep 2025 by user `brianVCXJG`.

Method: no audio track exists, so everything here is read off the screen. Frames were
extracted with ffmpeg and inspected — roughly 30 frames sampled across the ten videos,
concentrated on the prompt, the tool calls and the final response. **This is a sample, not
a frame-by-frame transcript**; short intermediate states between samples may be missed.

---

## The single most important fact

**ArchiLabs is a Revit add-in, not a standalone application.**

It appears as an `ArchiLabs` tab in the Revit ribbon (next to `pyRevit`), with a docked
"ArchiLabs Chat" panel on the right of the Revit window. The model is Autodesk's; every
tool is a call into the Revit API. Test model throughout is *Snowdon Towers Sample
Architectural*.

Consequence for Preckon: the **interaction pattern** transfers directly. The **tools do
not** — ArchiLabs' tools wrap Revit; Preckon's would wrap `BimDocument`. Do not plan on
porting tool implementations.

---

## The ten tasks

| # | Conversation title | Instruction (verbatim) |
|---|---|---|
| 1 | Tag Room 307 | "Please tag room 307 -- it is missing a room tag" |
| 2 | Align Viewports to Common Datum L3 | "The viewports on my current sheet are misaligned. Please align them by a common datum -- I see L3 appears to be common amongst all of the viewports" |
| 3 | Color Fire Rated Walls in Active View | "Make all my fire rated walls red in my active view" |
| 4 | Update Sheet Dates Except Life Safety Plans | "Update all my sheet issue dates for all my sheets to today's date, except for the life safety plan sheets, keep those as is" |
| 5 | Active View Door Schedule | "Make a schedule of all the doors in my active view" |
| 6 | Create 3D Views for All Rooms | "Make 3d views for all the rooms in my current view" |
| 7 | A405 Wall Sections Sheet Layout | "Create a sheet called A405 - Wall Sections and place all the Section views with the words 'Existing to New' onto the sheet… 4 columns… evenly spaced 1.5" in from the left and 6" in from the right. Make sure all the viewports are aligned by a common datum." |
| 8 | Update Room Names To RM Numbers | "Update all the room names in my active view…" |
| 9 | Level 3 Rentable Area Plan | "Create an Area Plan on Level 3 using the Rentable area scheme." |
| 10 | Columns at Grid Intersections | "Place 4 structural columns at every grid intersection in the active view: one in the view vertical direction, one in the down, one right, one left, offset 1 foot from the intersection point" |

Conversation titles are auto-generated — the panel subtitle starts as "General Assistance"
and is rewritten once the intent is understood.

---

## Architecture, as visible on screen

### Tools live in a searchable registry, grouped into modules

This is the core design, and it differs fundamentally from Preckon's current single
`apply_commands` tool.

Every tool call renders a card showing: display name, status (`Running` → `Completed`),
the owning **module**, a **scope badge**, the trigger line, collapsible `Input`
("Show input"), and the raw JSON `Result`. Each card has an external-link icon, which
implies the tool definition is openable.

Modules observed, with the tools seen inside them:

| Module | Scope | Tools seen |
|---|---|---|
| `Tagging` | GLOBAL | `tag_specific_elements` |
| `Filled Region` | GLOBAL | `list_rooms_in_active_view` |
| `View Creation Alignment` | GLOBAL | `align_viewports_by_datum` |
| `Filtering_QA_QC_And_Parameters` | GLOBAL | `set_parameter_values_tool` |
| `Sheet_Management` | GLOBAL | `place_views_with_regions_tool` |
| `3D Views and Sections` | GLOBAL | `get_rooms_in_view_tool` |
| `Selection Helpers` | GLOBAL | `get_active_view_info_tool` |
| `Room Renaming` | **PERSONAL** | `rename_rooms_by_pattern` |
| `tool test` | **PERSONAL** | `list_area_plan_views_tool` |

Two observations worth carrying over:

- **GLOBAL vs PERSONAL scope.** Users author their own tools. `tool test` is visible in a
  demo recording, which tells you personal tools are first-class, not hidden.
- **Module assignment is loose.** `list_rooms_in_active_view` sits under `Filled Region`,
  which has nothing to do with rooms. Modules are an authoring convenience, not a
  taxonomy — do not over-engineer this.

### Tool discovery is an explicit, visible step

Every conversation shows a `Discovering tools` card (spinner, "Running…") that resolves to
`Discovered tools` (green check, expandable). The agent does **not** carry every tool in
context — it searches a registry per task.

The agent narrates the search in the open. Video 3:

> "I'll look for a tool that can find fire-rated walls in the active view and override
> their graphics to red. **If both a direct tool and a configurable workflow exist, I'll
> present the options.** Proceeding to search for the right tool now."

This is what makes the tool count scalable. Preckon's current design puts every command in
the system prompt and the entire model in the user turn — neither survives growth.

### Two modes

The greeting states them:

> "In **authoring mode**, I can help you create and edit automations. In **agent mode**, I
> can help you run workflows or do tasks for you."

A mode dropdown sits bottom-left of the composer (showing `Agent` in all ten videos).
Authoring mode is how the PERSONAL tools get made — the product is partly a tool-building
environment, not only a tool-using one.

### Query-then-act, without exception

All ten videos follow the same shape: a read tool first, then an action tool.

```
list_rooms_in_active_view  →  tag_specific_elements
get_active_view_info_tool  →  place columns
list sheets                →  set_parameter_values_tool
get_rooms_in_view_tool     →  rename_rooms_by_pattern
```

Retrieval is never skipped, and the model is never dumped wholesale into the prompt.

### Transparency surfaces

- `Thought for N seconds` — collapsed reasoning, one card per step (video 10 shows 7s, 3s,
  3s in succession).
- `Thinking…` — expanded, streaming, markdown-formatted. Video 2 exposes real reasoning:
  > "**Aligning using common datum** — I noticed that 'L3' is common across all viewports…
  > For plans, I want to align along grid L3 to line up columns, so that means setting the
  > datum type to 'Grid' and using 'L3' for my annotation. I'll align it on the X-axis
  > since it's a vertical datum. First, I need to get the active sheet info to…"
- Raw JSON results, collapsed by default, with element IDs visible
  (`{"tag_id": 2652983, "element_id": 829862, "element_category": "Rooms"}`).

---

## Five agent behaviours worth copying

**1. Ask when the model is ambiguous — and offer a manual route.**
Video 3, the agent cannot tell which parameter marks a wall fire-rated:

> "Quick question: Which parameter carries the wall fire rating in your project?"
> Options to proceed:
> • **Fast apply**: Tell me the exact parameter name…
> • **Guided UI**: I can open the View Graphics Controller workflow so you can pick the
>   filter and color interactively.

The user answered "You figure it out" — so it guessed (`Type Name contains "HR"`), applied
it, then *said what it had assumed* and offered to switch. Never silently guesses.

**2. Gate large actions on explicit confirmation.**
Video 10, having computed the blast radius before acting:

> "I found 54 grid intersections in the active view 'L2'. Placing 4 columns per
> intersection will create 216 structural columns.
> My default choices (since you said 'you pick'): Column type W10X49 · Level L2 ·
> Offsets 1'-0" …
> **This is a large action. Shall I proceed to place 216 W10X49 columns on L2 with those
> settings?**"

Count first, state defaults, then ask. The threshold appears to be scale-based.

**3. Report what was assumed, not just what was done.**
Video 3's completion carries a `Notes:` section explaining the `"HR"` heuristic and how to
correct it. Video 5 states it created a new shared parameter. Video 10 gives counts:
grids 16, intersections 54, columns 216, failures 0.

**4. Compose around platform limits.**
Video 5 is the standout. Revit schedules cannot natively filter to "visible in active
view", so the agent: created a Yes/No shared parameter "In Active View" bound to Doors →
marked the 18 doors visible in L2 → built "Door Schedule - L2" → added filter
`In Active View = Yes`. That is invented mechanism, not a canned recipe.

**5. Prefer reuse over duplication.**
Video 9: "The **reused** Area Plan view (ID 853466) is named 'L3'." It found an existing
view rather than creating a second one.

Every completion ends with concrete follow-up offers ("Want me to tag these columns, adjust
base/top constraints, or filter them for review?").

---

## What this changes about the Preckon plan

The earlier phased plan in `ai-copilot-plan.md` assumed *extending the command language* —
more commands in the `Command` union, richer `describe()`. The videos show a different
shape, and it is the better one:

| | Preckon today | ArchiLabs |
|---|---|---|
| Tool surface | one `apply_commands` tool | many named tools in a searchable registry |
| Tool selection | all commands listed in system prompt | runtime discovery per task |
| Model context | entire model dumped every turn | retrieved per task by read tools |
| Extensibility | edit `Command` union + interpreter | author a tool, no core change |
| Ambiguity | not handled | explicit question + manual fallback |
| Large actions | applied directly | counted, then gated on confirmation |

The pieces of the existing plan that survive unchanged: `describe()` must emit `name` and
`params` (nothing works without identity), and query/selection is needed first.

The piece that should change: rather than growing the `Command` union to 26 members, build
a **tool registry** where each tool is a named, described, individually-schema'd unit that
compiles down to commands. Commands stay the authoritative write path — which preserves
blueprint §7's "LLMs never directly write authoritative geometry" — but they stop being the
agent's interface.

Open question for Preckon specifically: ArchiLabs rides on Revit's model, so its read tools
are cheap API calls. Preckon owns `BimDocument`, so equivalent read tools are pure
functions over an in-memory document. That is *easier*, not harder — but it means the
registry, not the command language, is where the design effort belongs.

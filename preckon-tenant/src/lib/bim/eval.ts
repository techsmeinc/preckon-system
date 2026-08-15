/**
 * Evaluation for the assistant's deterministic half.
 *
 * Four AI surfaces are in production and none had a regression measure. That is
 * the gap this closes — but only the part of it that can be measured HONESTLY
 * without a model call.
 *
 * ── WHAT THIS MEASURES, AND WHY IT IS THE RIGHT HALF ─────────────────────────
 *
 * The agent's behaviour is model-dependent and varies run to run. Its TOOL
 * SELECTION is not: the registry search is a pure function of the instruction
 * and the catalogue, so it can be scored exactly, offline, on every commit.
 *
 * That matters more than it sounds. Tool selection is the first thing to break
 * as the catalogue grows — a new tool whose description overlaps an existing one
 * quietly steals its ranking, and the symptom is not an error but an assistant
 * that reaches for the wrong thing. The catalogue went from one tool to thirty
 * over a few days, which is exactly the condition that produces it.
 *
 * Grounding is the second half: a tool must never return an id that is not in
 * the document. A model can hallucinate; a tool must not be able to. That is
 * checkable by construction, so it is checked exhaustively rather than sampled.
 *
 * ── WHAT IT DELIBERATELY DOES NOT MEASURE ────────────────────────────────────
 *
 * Extraction accuracy, BOQ completeness and citation fidelity need real model
 * calls against fixture projects with known-correct answers. Those belong in a
 * scheduled evaluation with an API key, not in the commit gate — and pretending
 * to measure them here, without a model, would be worse than not measuring them:
 * a green tick nobody has earned.
 */

import type { ToolRegistry } from "./registry";

// ── Tool selection ───────────────────────────────────────────────────────────

export interface SelectionCase {
  /** The instruction as somebody would actually type it. */
  instruction: string;
  /** Tools that would be a correct first reach. Any one of them counts. */
  expect: string[];
  /** Where the phrasing came from, so a failing case can be judged rather than deleted. */
  source: "recording" | "estimator" | "ambiguous";
}

/**
 * The corpus.
 *
 * Phrasings from the ArchiLabs recordings are used verbatim where they exist —
 * they are the closest thing to real user input available, and a paraphrase
 * would be scoring the paraphraser. The rest are phrasings an estimator would
 * plausibly use for capabilities the recordings do not cover.
 *
 * `expect` lists alternatives rather than one answer because several tasks have
 * more than one honest first step: "what is in this model" is served by
 * model_overview or find_elements, and insisting on one would be scoring a
 * preference rather than a capability.
 */
export const SELECTION_CORPUS: SelectionCase[] = [
  // ── from the recordings, verbatim ──
  { instruction: "Please tag room 307 -- it is missing a room tag", expect: ["resolve_reference", "tag_elements", "find_untagged"], source: "recording" },
  { instruction: "Make all my fire rated walls red in my active view", expect: ["override_graphics"], source: "recording" },
  { instruction: "Make a schedule of all the doors in my active view", expect: ["create_schedule"], source: "recording" },
  { instruction: "Make 3d views for all the rooms in my current view", expect: ["create_views_for_elements"], source: "recording" },
  { instruction: "Create a sheet called A405 - Wall Sections", expect: ["create_sheet"], source: "recording" },
  { instruction: "The viewports on my current sheet are misaligned. Please align them by a common datum", expect: ["align_viewports", "sheet_contents"], source: "recording" },
  { instruction: "Create an Area Plan on Level 3 using the Rentable area scheme", expect: ["create_area_plan"], source: "recording" },
  { instruction: "Update all the room names in my active view", expect: ["rename_by_pattern", "set_parameter", "find_elements"], source: "recording" },
  { instruction: "Place 4 structural columns at every grid intersection in the active view", expect: ["grid_intersections", "place_at_points"], source: "recording" },
  { instruction: "Update all my sheet issue dates for all my sheets to today's date, except for the life safety plan sheets", expect: ["set_parameter", "find_elements"], source: "recording" },

  // ── phrasings an estimator would use ──
  { instruction: "what is in this model", expect: ["model_overview", "find_elements"], source: "estimator" },
  { instruction: "how many walls are there", expect: ["model_overview", "find_elements", "create_schedule"], source: "estimator" },
  { instruction: "which rooms have no tag", expect: ["find_untagged"], source: "estimator" },
  { instruction: "find the corridor", expect: ["resolve_reference", "find_elements"], source: "estimator" },
  { instruction: "delete every wall on level 2", expect: ["delete_elements", "find_elements"], source: "estimator" },
  { instruction: "move the columns two metres east", expect: ["move_elements"], source: "estimator" },
  { instruction: "dimension all the external walls", expect: ["dimension_elements"], source: "estimator" },
  { instruction: "add a door to the north wall", expect: ["place_elements", "find_elements", "resolve_reference"], source: "estimator" },
  { instruction: "list the views in this project", expect: ["list_views"], source: "estimator" },
  { instruction: "what is on sheet A405", expect: ["sheet_contents", "list_views"], source: "estimator" },
  { instruction: "rename the rooms to RM-101, RM-102 and so on", expect: ["rename_by_pattern"], source: "estimator" },
  { instruction: "colour the structural columns blue", expect: ["override_graphics"], source: "estimator" },
  { instruction: "give me a room schedule with names and areas", expect: ["create_schedule"], source: "estimator" },
  { instruction: "where do the grid lines cross", expect: ["grid_intersections"], source: "estimator" },
  { instruction: "set the fire rating on every corridor wall to 2 HR", expect: ["set_parameter", "find_elements"], source: "estimator" },
];

export interface SelectionResult {
  /** The expected tool was the single highest-ranked result. */
  top1: number;
  /** The expected tool appeared in the first three. */
  recallAt3: number;
  /** It appeared anywhere in the returned set. */
  recallAtK: number;
  total: number;
  misses: { instruction: string; expected: string[]; got: string[]; source: string }[];
}

/**
 * Score the registry's search against the corpus.
 *
 * Reported at three depths on purpose. Top-1 is what the agent usually acts on,
 * but the agent sees the whole discovered set and can pick from it — so a case
 * that is top-3 but not top-1 is a weaker signal than a case that is missing
 * altogether, and collapsing them into one number would hide which is which.
 */
export function scoreToolSelection(registry: ToolRegistry, corpus: SelectionCase[] = SELECTION_CORPUS): SelectionResult {
  const r: SelectionResult = { top1: 0, recallAt3: 0, recallAtK: 0, total: corpus.length, misses: [] };

  for (const c of corpus) {
    const got = registry.search(c.instruction).map((t) => t.name);
    const hit = (n: number) => got.slice(0, n).some((g) => c.expect.includes(g));

    if (hit(1)) r.top1++;
    if (hit(3)) r.recallAt3++;
    if (got.some((g) => c.expect.includes(g))) r.recallAtK++;
    else r.misses.push({ instruction: c.instruction, expected: c.expect, got: got.slice(0, 5), source: c.source });
  }
  return r;
}

/** A readable line for CI output and the scheduled run's log. */
export function formatSelection(r: SelectionResult): string {
  const pct = (n: number) => `${((n / r.total) * 100).toFixed(0)}%`;
  const head = `tool selection — top1 ${pct(r.top1)} · top3 ${pct(r.recallAt3)} · found ${pct(r.recallAtK)} (${r.total} cases)`;
  if (!r.misses.length) return head;
  return head + r.misses.map((m) => `\n  MISS [${m.source}] "${m.instruction}"\n    wanted one of: ${m.expected.join(", ")}\n    got: ${m.got.join(", ") || "(nothing)"}`).join("");
}

/**
 * Project Work-Programme (time-schedule) builder.
 *
 * Takes the SOW outline + project scope and asks the LLM to produce a complete
 * project work programme: an ordered list of activities grouped into phases,
 * each with a calendar-day duration and a start offset (days from project
 * commencement), plus milestones. The AIGCC Excel export turns this into a
 * week-by-week Gantt on a dedicated "Programme" sheet.
 *
 * Durations/offsets are CALENDAR DAYS from day 0 (commencement). The generator
 * always returns something usable: if the LLM call or JSON parse fails it falls
 * back to a sequential programme derived straight from the outline sections.
 */
import { extractJSON, type AIClient } from "./ai-provider";
import type { SowOutline, SowSectionNode } from "./sow-outline";

/** Relationship types for a typed predecessor link (matches the CPM engine). */
export type DraftRelType = "FS" | "SS" | "FF" | "SF";

/** A predecessor link expressed by the LLM as a 1-based index into the activity list. */
export interface DraftDependency {
  /** 1-based position of the predecessor activity in the returned `activities` array. */
  on: number;
  type: DraftRelType;
  /** Lag in days (may be negative for a lead). */
  lag: number;
}

export interface ScheduleActivityDraft {
  /** Grouping phase, e.g. "Mobilization", "Construction", "Testing & Commissioning". */
  phase: string;
  /** SOW section this activity maps to (optional). */
  sowRef: string | null;
  activity: string;
  /** Duration in calendar days (0 for a milestone). */
  durationDays: number;
  /** Start offset in calendar days from commencement (day 0). */
  startOffsetDays: number;
  /** Human predecessor note, e.g. "after Mobilization". */
  predecessor: string | null;
  /** Typed predecessor links (index-based) forming the schedule network → CPM/critical path. */
  dependsOn: DraftDependency[];
  isMilestone: boolean;
  notes: string | null;
}

const DRAFT_REL_TYPES: readonly DraftRelType[] = ["FS", "SS", "FF", "SF"];
function normDraftRel(t: unknown): DraftRelType {
  const s = String(t ?? "").toUpperCase();
  return (DRAFT_REL_TYPES as readonly string[]).includes(s) ? (s as DraftRelType) : "FS";
}

export interface ProjectSchedule {
  activities: ScheduleActivityDraft[];
  totalDurationDays: number;
  isFallback: boolean;
}

/** Minimal BOQ-item shape the programme builder needs to ground activities in priced scope. */
export interface ScheduleBoqItem {
  category: string;
  description: string;
  unit: string;
  quantity: number | string;
}

export interface BuildScheduleOpts {
  client: AIClient;
  model: string;
  projectName: string;
  projectScope: string;
  outline: SowOutline;
  /** Trimmed SOW/RFP/spec text — gives the model duration cues the outline lacks. */
  sowText?: string;
  /** Priced BOQ items — the real, quantified scope the programme must cover. */
  boqItems?: ScheduleBoqItem[];
}

const SCHEDULE_SCHEMA = `Return ONLY a raw JSON object. No markdown fences, no commentary.

You are producing a realistic PROJECT WORK PROGRAMME (time schedule) for ONE specific construction/engineering project, grounded in that project's own source technical document. This is a PLANNING TIMELINE, not a bill of quantities — no prices, no quantities.

Strict shape:
{
  "totalDurationDays": <integer — total project duration in calendar days, from commencement to completion>,
  "activities": [
    {
      "phase": "<grouping phase named after THIS project's real structure / any phasing the document defines>",
      "sowRef": "<the SOW section ref this activity comes from, or null>",
      "activity": "<the activity name, specific to this project's actual scope>",
      "durationDays": <integer calendar days; use 0 ONLY for milestones>,
      "startOffsetDays": <integer calendar days after commencement when this activity starts (day 0 = first day)>,
      "predecessor": "<short note on what must finish first, e.g. 'after Site survey', or null>",
      "dependsOn": [
        { "on": <1-based position of an EARLIER activity in THIS list that must precede this one>, "type": "FS"|"SS"|"FF"|"SF", "lag": <integer days of lead/lag, 0 if none> }
      ],
      "isMilestone": <true for zero-duration milestones like 'Commencement', 'Substantial Completion', 'Handover'; false otherwise>,
      "notes": "<cite the document basis when a duration/date/sequence is stated (e.g. 'contract period stated as 18 months'); write '(estimated)' when you inferred it. Or null.>"
    }
  ]
}

Rules:
  • GROUND THE PROGRAMME IN THE SOURCE DOCUMENT. The activities, their order, their durations, the total duration, the phases and the milestones must reflect what THIS document actually describes — its trade/discipline, its scope areas, and any time information it states. Two different projects must produce visibly different programmes; never emit a generic template.
  • USE STATED TIME INFORMATION VERBATIM. If the document states a contract/construction period, time for completion, sectional/phased completion dates, mobilization period, possession dates, lead times, milestone deadlines, or a required sequence, honour those exactly — do not invent a different total and do not reorder against a stated sequence. Quote the basis in that activity's "notes".
  • ESTIMATE ONLY WHERE THE DOCUMENT IS SILENT. Where no duration is given, estimate realistically from the scope size and trade, and mark that activity's "notes" with "(estimated)".
  • DERIVE PHASES FROM THE ACTUAL PROJECT. Name phases after the real structure of THIS project and any phasing the document defines. Do NOT force a fixed template — a fit-out, a roads/infrastructure package, an MEP retrofit, a marine work and a structural build do not share the same phases or the same activities.
  • BUILD A CONNECTED DEPENDENCY NETWORK — this is what produces the critical path. EVERY activity except the very first (Commencement at day 0) MUST list at least one predecessor in "dependsOn", referencing another activity by its 1-based position in the "activities" array. Use FS (finish-to-start) for normal sequence, SS for activities that start together, FF for activities that must finish together, and a non-zero "lag" for lead/lag in days. The network MUST be acyclic (only ever depend on activities that come earlier / finish earlier) and MUST chain all the way through to the final completion milestone, so there is one continuous longest path from Commencement to Completion.
  • KEEP DATES CONSISTENT WITH THE LINKS: an activity's "startOffsetDays" must equal the latest of its predecessors' (finish + lag) — i.e. the dates you give must be exactly what the dependencies imply. Activities that genuinely run in parallel share a common predecessor and get overlapping startOffsetDays/durationDays.
  • Every meaningful scope area in the breakdown should map to one or more activities. Add mobilization, testing/commissioning and handover only where appropriate to this project type.
  • COVER THE PRICED BOQ. The Bill of Quantities lists the actual, quantified work for this project. Every BOQ category with real work volume must be represented by at least one activity, and the larger/heavier categories should drive longer activity durations. The programme is the time dimension of the same scope the BOQ prices — keep them consistent.
  • The latest (startOffsetDays + durationDays) across all activities MUST equal totalDurationDays.
  • Include the milestones the document implies (Commencement at day 0, any sectional completions it names, Substantial/Practical Completion, Handover/Final Completion).
  • Keep it to a sensible number of activities (roughly 8-30), not one per tiny sub-item.`;

const SYSTEM_PROMPT = `You are a Senior Planning Engineer preparing the baseline work programme for ONE specific construction/engineering project. You work strictly from the project's own scope-of-work and source technical document: you read what the document actually says about scope, phasing, durations, milestones and sequence, and you build a programme that reflects THAT project — never a generic template. When the document states time information you use it exactly; where it is silent you estimate and say so.

${SCHEDULE_SCHEMA}`;

/** Flatten the outline into compact "ref — title (basis) :: scopeNotes" lines. */
function outlineDigest(outline: SowOutline): string {
  const lines: string[] = [];
  const walk = (nodes: SowSectionNode[], depth: number) => {
    for (const n of nodes) {
      const indent = "  ".repeat(depth);
      const notes = n.scopeNotes ? ` :: ${n.scopeNotes.slice(0, 160)}` : "";
      lines.push(`${indent}${n.sowRef} ${n.title} [${n.measurementBasis}]${notes}`);
      if (n.subsections && n.subsections.length > 0) walk(n.subsections, depth + 1);
    }
  };
  walk(outline.sections, 0);
  return lines.join("\n");
}

/**
 * Summarise the priced BOQ by category so the programme is grounded in the
 * project's ACTUAL quantified scope (not just the outline). We roll up per
 * category — count of items + a few representative descriptions + the units in
 * play — rather than dumping every line, keeping the prompt compact while still
 * telling the planner where the real work volume sits.
 */
function boqDigest(items: ScheduleBoqItem[], maxChars = 4000): string {
  if (!items || items.length === 0) return "";
  const byCat = new Map<string, { count: number; units: Set<string>; samples: string[] }>();
  for (const it of items) {
    const cat = (it.category || "Uncategorised").trim();
    const entry = byCat.get(cat) ?? { count: 0, units: new Set<string>(), samples: [] };
    entry.count++;
    if (it.unit) entry.units.add(it.unit.trim());
    if (entry.samples.length < 4 && it.description) entry.samples.push(it.description.trim().slice(0, 80));
    byCat.set(cat, entry);
  }
  const lines: string[] = [];
  let used = 0;
  for (const [cat, e] of byCat) {
    const units = [...e.units].slice(0, 6).join(", ");
    const line = `• ${cat} — ${e.count} item(s)${units ? ` [${units}]` : ""}: ${e.samples.join("; ")}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/**
 * Words/phrases that flag a line as carrying schedule / time / programme signal.
 * Used to pull the document's real timing clues to the FRONT of the prompt so
 * they survive truncation, instead of being lost somewhere in the middle of a
 * long concatenated tender.
 */
const TIME_SIGNAL =
  /\b(programme|program|gantt|milestone|phase|phased|phasing|stage|stages|duration|commence|commencement|mobiliz|mobilis|completion|sectional|handover|hand[-\s]?over|week|weeks|month|months|\d+\s*day|calendar|deadline|by\s+\d|within\s+\d|no later than|practical completion|substantial completion|defects?\s+liability|testing|commissioning|snagging|occupancy|possession|lead[-\s]?time|delivery\s+period|construction\s+period|contract\s+period|time\s+for\s+completion|critical\s+path|float|sequence|prior to|concurrent)\b/i;

/**
 * Pull the lines/sentences that carry timing, phasing, sequence or milestone
 * information out of the raw technical text, deduped and length-capped. These
 * are the literal clues the programme must be built around.
 */
function extractProgrammeSignals(sowText: string, maxChars = 6000): string {
  if (!sowText) return "";
  const seen = new Set<string>();
  const kept: string[] = [];
  let used = 0;
  const pieces = sowText
    .split(/\r?\n|(?<=[.;:])\s+/)
    .map(s => s.trim().replace(/\s+/g, " "))
    .filter(s => s.length >= 8 && s.length <= 320);
  for (const p of pieces) {
    if (!TIME_SIGNAL.test(p)) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(p);
    used += p.length + 1;
    if (used >= maxChars) break;
  }
  return kept.join("\n");
}

/**
 * Fallback programme derived purely from the outline: each top-level section
 * becomes one sequential activity with a default duration, bracketed by
 * commencement + handover milestones. Used when the LLM call/parse fails.
 */
function fallbackSchedule(outline: SowOutline): ProjectSchedule {
  const PER_SECTION_DAYS = 21;
  const activities: ScheduleActivityDraft[] = [];
  activities.push({
    phase: "Mobilization", sowRef: null, activity: "Project Commencement",
    durationDays: 0, startOffsetDays: 0, predecessor: null, dependsOn: [], isMilestone: true, notes: null,
  });
  let offset = 0;
  for (const s of outline.sections) {
    // Sequential fallback: each activity follows the previous one (FS), so even
    // the heuristic programme is a connected chain with a critical path.
    activities.push({
      phase: "Execution", sowRef: s.sowRef, activity: s.title,
      durationDays: PER_SECTION_DAYS, startOffsetDays: offset,
      predecessor: null, dependsOn: [{ on: activities.length, type: "FS", lag: 0 }], isMilestone: false,
      notes: "(heuristic fallback — generated from the SOW outline; durations are placeholders)",
    });
    offset += PER_SECTION_DAYS;
  }
  activities.push({
    phase: "Handover & Closeout", sowRef: null, activity: "Substantial Completion & Handover",
    durationDays: 0, startOffsetDays: offset, predecessor: null,
    dependsOn: [{ on: activities.length, type: "FS", lag: 0 }], isMilestone: true, notes: null,
  });
  return { activities, totalDurationDays: offset, isFallback: true };
}

function coerceActivity(a: Partial<ScheduleActivityDraft> & { dependsOn?: unknown }): ScheduleActivityDraft | null {
  if (!a || typeof a.activity !== "string" || !a.activity.trim()) return null;
  const isMilestone = a.isMilestone === true;
  const duration = Math.max(0, Math.round(Number(a.durationDays) || 0));
  const dependsOn: DraftDependency[] = Array.isArray(a.dependsOn)
    ? (a.dependsOn as unknown[])
        .map((d) => {
          const rec = d as { on?: unknown; type?: unknown; lag?: unknown };
          return { on: Math.round(Number(rec?.on)), type: normDraftRel(rec?.type), lag: Math.round(Number(rec?.lag) || 0) };
        })
        .filter((d) => Number.isFinite(d.on) && d.on >= 1)
    : [];
  return {
    phase: typeof a.phase === "string" && a.phase.trim() ? a.phase.trim() : "General",
    sowRef: typeof a.sowRef === "string" && a.sowRef.trim() ? a.sowRef.trim() : null,
    activity: a.activity.trim(),
    durationDays: isMilestone ? 0 : Math.max(1, duration),
    startOffsetDays: Math.max(0, Math.round(Number(a.startOffsetDays) || 0)),
    predecessor: typeof a.predecessor === "string" && a.predecessor.trim() ? a.predecessor.trim() : null,
    dependsOn,
    isMilestone,
    notes: typeof a.notes === "string" && a.notes.trim() ? a.notes.trim() : null,
  };
}

/**
 * Sanitise the index-based dependency links once the full activity list is
 * known: drop links that point out of range, at themselves, or forward in the
 * list (the network must be acyclic — only ever depend on EARLIER activities),
 * and de-duplicate by predecessor index.
 */
function sanitizeDependencies(activities: ScheduleActivityDraft[]): void {
  activities.forEach((a, i) => {
    const seen = new Set<number>();
    a.dependsOn = a.dependsOn.filter((d) => {
      const idx0 = d.on - 1; // 1-based → 0-based
      if (idx0 < 0 || idx0 >= activities.length || idx0 === i || idx0 > i) return false;
      if (seen.has(d.on)) return false;
      seen.add(d.on);
      return true;
    });
  });
}

export async function generateProjectSchedule(opts: BuildScheduleOpts): Promise<ProjectSchedule> {
  const { client, model, projectName, projectScope, outline, sowText, boqItems } = opts;

  // Pull the document's real timing clues to the front so they survive
  // truncation, then give the model a generous slice of the source text as the
  // PRIMARY basis. The scope outline is supporting structure, not the driver.
  const signals = extractProgrammeSignals(sowText ?? "", 6000);
  const boq = boqDigest(boqItems ?? [], 4000);
  const GENERAL_BUDGET = 18000;
  const generalExcerpt = sowText && sowText.length > GENERAL_BUDGET
    ? `${sowText.slice(0, GENERAL_BUDGET)}\n[... truncated ...]`
    : (sowText ?? "");

  const userPrompt = `Project name: "${projectName}"

## PROJECT SCOPE
${projectScope || "(not provided)"}

## SCHEDULE / TIME SIGNALS FOUND IN THE DOCUMENT
(These are the literal timing, phasing, sequence and milestone clues lifted from the source. Build the programme around them; honour any stated period/dates/sequence exactly.)
${signals || "(none explicitly stated — derive durations and sequence from the scope below and mark them '(estimated)')"}

## SOURCE TECHNICAL DOCUMENT (primary basis — read it for scope, phasing, durations, sequence)
${generalExcerpt || "(no source text available)"}

## SCOPE-OF-WORK BREAKDOWN (supporting structure — ensure every meaningful area is covered)
${outlineDigest(outline)}

## PRICED BILL OF QUANTITIES (the actual quantified scope — every category with real volume must map to an activity)
${boq || "(no BOQ items available — base the programme on the scope breakdown above)"}

Produce the baseline work programme for THIS specific project as JSON per the schema. It must reflect this document's actual scope and timing — not a generic template.`;

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 6000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(extractJSON(raw)) as { activities?: unknown; totalDurationDays?: unknown };
    if (!parsed || !Array.isArray(parsed.activities) || parsed.activities.length === 0) {
      return fallbackSchedule(outline);
    }
    const activities = (parsed.activities as Partial<ScheduleActivityDraft>[])
      .map(coerceActivity)
      .filter((a): a is ScheduleActivityDraft => a !== null);
    if (activities.length === 0) return fallbackSchedule(outline);
    sanitizeDependencies(activities);

    // Derive total from activities if the model's figure is missing/inconsistent.
    const derivedTotal = activities.reduce((m, a) => Math.max(m, a.startOffsetDays + a.durationDays), 0);
    const claimedTotal = Math.round(Number(parsed.totalDurationDays) || 0);
    const totalDurationDays = Math.max(derivedTotal, claimedTotal);

    return { activities, totalDurationDays, isFallback: false };
  } catch {
    return fallbackSchedule(outline);
  }
}

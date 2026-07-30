/**
 * Dynamic Agent Roster — per-project specialist + verifier design.
 *
 * The multi-agent BOQ pipeline used to run a generic "Senior Quantity
 * Surveyor" prompt against every SOW section, regardless of what the
 * project was about. We replaced that with a *dynamic* design pass: the
 * LLM reads the actual SOW (plus the section outline + document
 * inventory) and INVENTS the roster of specialists this specific project
 * needs — their names, expertise, vocabulary, measurement guidance, and
 * which SOW sections they own. There is no fixed archetype list, no
 * fixed specialist catalogue, no fixed discipline checklist. Everything
 * is generated per project.
 *
 * For a Kennel Repair project the designer might output:
 *   • Kennel Flooring Specialist (owns sections 2.4, 5.2)
 *   • Submersible Pump Specialist (owns 2.4, 5.3)
 *   • Site Survey Specialist (owns 2.1)
 *
 * For a Data-Centre Fit-Out the same code path might output:
 *   • Raised-Floor Specialist
 *   • Containment & Cabinet Specialist
 *   • Cooling Distribution Specialist
 *   • Fire-Suppression Specialist
 *
 * Same code — completely different roster, decided by the LLM from the
 * uploaded documents.
 */
import { extractJSON, type AIClient } from "./ai-provider";
import { jsonrepair } from "jsonrepair";

// ─────────────────────────────────────────────────────────────────────────────
// Types — what the designer produces.
// ─────────────────────────────────────────────────────────────────────────────

export interface DynamicSpecialist {
  /** Unique slug, used as agent key + matching. e.g. "submersible-pump-specialist". */
  key: string;
  /** UI label, e.g. "Submersible Pump Specialist". */
  label: string;
  /** Free-text description of what this specialist knows / is responsible for. */
  expertise: string;
  /** Domain-specific terms the section agent should reach for. */
  vocabulary: string[];
  /** How items in this specialist's scope are typically measured/quantified. */
  measurementGuide: string;
  /** Examples of items this specialist commonly produces. */
  typicalItems: string[];
  /**
   * Which SOW section refs this specialist owns. A specialist may own zero,
   * one, or many sections. A section may be owned by one specialist or
   * shared by several (pipeline handles ties by using the first match).
   */
  ownedSectionRefs: string[];
}

export interface VerifierCheck {
  /** Unique slug for this check. */
  key: string;
  /** What this check looks for, e.g. "Synthetic turf installation". */
  topic: string;
  /** Plain-English description used in the verifier prompt. */
  description: string;
  /** Why this check matters for THIS project — designer's justification. */
  rationale: string;
  /** Optional hint about typical units/quantities (e.g. "sq.m", "Nos with capacity"). */
  measurementHint?: string;
}

export interface AgentRoster {
  /** Free-text description of what the project actually is. */
  projectDescription: string;
  /** Free-text project type — invented per project, not from an enum. */
  projectType: string;
  /** Major scope areas the designer identified. */
  scopeAreas: string[];
  /** The dynamically-designed roster of specialists. */
  specialists: DynamicSpecialist[];
  /** Dynamic verifier checks specific to THIS project. */
  verifierChecks: VerifierCheck[];
  /** The designer's narrative reasoning (one paragraph). */
  reasoning: string;
  /** True if the designer call failed and we fell back to a minimal default. */
  isFallback: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The designer LLM call — invents the roster from project documents.
// ─────────────────────────────────────────────────────────────────────────────

const DESIGNER_SCHEMA = `Return ONLY a raw JSON object — no markdown, no preamble.

Schema:
{
  "projectDescription": "<2-3 sentence factual description of what this project actually is, grounded in the SOW>",
  "projectType": "<free-text project type — invent the right phrase, do NOT pick from a fixed list. e.g. 'Outdoor Kennel Facility Repair', 'Data-Centre White-Space Fit-Out', 'Lift Station Pump Replacement'>",
  "scopeAreas": ["<major scope area 1>", "<major scope area 2>", ...],
  "reasoning": "<one paragraph: how you decided on the specialist roster below, citing SOW phrasing>",
  "specialists": [
    {
      "key": "<slug, e.g. 'submersible-pump-specialist'>",
      "label": "<human label, e.g. 'Submersible Pump Specialist'>",
      "expertise": "<what this specialist knows; tailor to THIS project — pump sizing, kennel flooring, raised-floor layout, whatever the project actually needs>",
      "vocabulary": ["<domain term 1>", "<domain term 2>", ...],
      "measurementGuide": "<one sentence on how items in this scope are typically measured/quantified for THIS project>",
      "typicalItems": ["<example item description 1>", "<example item description 2>", ...],
      "ownedSectionRefs": ["<sowRef of a section this specialist owns>", ...]
    }
  ],
  "verifierChecks": [
    {
      "key": "<slug, e.g. 'synthetic-turf-present'>",
      "topic": "<short topic, e.g. 'Synthetic turf installation'>",
      "description": "<what the verifier should confirm exists in the BOQ>",
      "rationale": "<why this matters for THIS project, citing SOW phrasing>",
      "measurementHint": "<optional, e.g. 'sq.m of turf area' — omit if not applicable>"
    }
  ]
}`;

const DESIGNER_SYSTEM = `You are a Principal Construction Consultant designing the optimal multi-agent system for pricing a Bill of Quantities for one specific project.

You will receive: (a) the SOW text, (b) the section outline extracted from it, and (c) the document inventory. You decide who the specialists should be, what they know, which sections they own, and what the verifier should check at the end — all tailored to THIS specific project.

Hard rules:
  • Specialists are INVENTED per project. Do NOT default to a fixed list of trades. If the project is about training-area turf, the specialist might be "Synthetic Turf Specialist" — not "Architectural Specialist". If it's about pump replacement, it might be "Submersible Pump Specialist" — not generic "Plumbing Specialist".
  • Every SOW section in the outline MUST be owned by exactly one specialist (use the section's sowRef). Distribute ownership so each specialist gets a coherent scope.
  • For standard preamble sections (Site Survey, 65%/95%/100% Design, Mobilization/Demobilization, As-Built, DD Form 1354) you can use generic specialists ("Site Survey Specialist", "Design Submittal Specialist", "Mobilization Specialist", "Closeout Specialist") — they appear in nearly every project. For project-specific sections, invent project-specific specialists.
  • Aim for 5–12 specialists total. More than 12 fragments the work; fewer than 5 makes any one specialist too broad.
  • Verifier checks must be SPECIFIC to this project, grounded in SOW phrasing — not generic "is electrical covered?" boilerplate. e.g. "Does the BOQ include sub-base preparation for the new training-area turf?" — quote SOW where possible.
  • Aim for 6–12 verifier checks. Each one should map to a concrete, falsifiable BOQ item that ought to exist.
  • Be CONSERVATIVE about scope. If the SOW does not mention electrical work, do not invent an Electrical Specialist. If it doesn't mention HVAC, do not include HVAC checks.

${DESIGNER_SCHEMA}`;

/**
 * Design the agent roster for a specific project. Returns a fallback roster
 * (one generic QS per section, no extra checks) if the LLM call or parsing
 * fails — the pipeline must always have SOME roster to run with.
 */
export async function designAgentRoster(
  client: AIClient,
  model: string,
  projectName: string,
  sowText: string,
  outlineSections: Array<{ sowRef: string; title: string; scopeNotes: string; disciplines: string[]; measurementBasis: string }>,
  docInventory: string[],
): Promise<AgentRoster> {
  const fallback = (): AgentRoster => {
    const generic: DynamicSpecialist = {
      key: "generic-quantity-surveyor",
      label: "Quantity Surveyor (generic)",
      expertise:
        "Generic QS fallback used when the dynamic agent designer failed. Reads the SOW for each section and produces standard AIGCC-style line items.",
      vocabulary: ["lump sum", "as required", "supply and installation", "all-inclusive"],
      measurementGuide: "Use whichever unit the SOW implies — LS for indeterminate scope, Nos / LM / m2 / m3 for quantified items.",
      typicalItems: ["Site Supervision and engineering (LS, qty=1)", "Mobilization to site (LS, qty=1)"],
      ownedSectionRefs: outlineSections.map(s => s.sowRef),
    };
    return {
      projectDescription: `Project "${projectName}" — designer fell back; the SOW outline has ${outlineSections.length} section(s).`,
      projectType: "General Construction Project (fallback)",
      scopeAreas: ["fallback — designer did not produce a roster"],
      specialists: [generic],
      verifierChecks: [],
      reasoning: "Agent designer call failed or produced unparseable output — fell back to a single generic specialist covering every section.",
      isFallback: true,
    };
  };

  const trimmedSow = (sowText ?? "").trim();
  if (trimmedSow.length < 100 || outlineSections.length === 0) return fallback();

  const outlineDigest = outlineSections
    .map(s => `  • ${s.sowRef} ${s.title} [${s.measurementBasis}]${s.disciplines.length > 0 ? ` — disciplines: ${s.disciplines.join(", ")}` : ""}\n      ${s.scopeNotes.slice(0, 220)}`)
    .join("\n");

  const userPrompt = `Project: "${projectName}"

Document inventory:
${docInventory.length > 0 ? docInventory.map(d => `  • ${d}`).join("\n") : "  (none)"}

SOW EXCERPT (first ~5000 chars):
${trimmedSow.slice(0, 5000)}

SOW SECTION OUTLINE (every section here MUST be owned by exactly one specialist in your roster):
${outlineDigest}

Now design the optimal specialist roster + verifier checks for THIS specific project. Output JSON only.`;

  let content = "";
  try {
    const resp = await client.chat.completions.create({
      model,
      // Designer roster is bounded — typically 5-12 specialists × ~250
      // tokens + 6-12 verifier checks × ~150 tokens. 4500 tokens is
      // comfortably above what any well-formed roster consumes. Without
      // this cap, providers pre-reserve the model's full output budget
      // against your credit balance.
      max_tokens: 4500,
      messages: [
        { role: "system", content: DESIGNER_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });
    content = resp.choices[0]?.message?.content ?? "";
  } catch {
    return fallback();
  }

  type DesignerResp = Partial<AgentRoster>;
  let parsed: DesignerResp | null = null;
  try {
    parsed = JSON.parse(extractJSON(content)) as DesignerResp;
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(extractJSON(content))) as DesignerResp;
    } catch {
      return fallback();
    }
  }

  // Validate the parsed roster: every section must be owned, specialists must
  // have a non-empty label + key + ownedSectionRefs. If validation fails,
  // we either patch (fill in missing owners with generic specialists) or
  // bail to fallback.
  const specialists: DynamicSpecialist[] = Array.isArray(parsed?.specialists)
    ? parsed.specialists
        .filter((s): s is DynamicSpecialist => Boolean(s && typeof s === "object" && (s as DynamicSpecialist).label && (s as DynamicSpecialist).key))
        .map(s => ({
          key: String(s.key).trim(),
          label: String(s.label).trim(),
          expertise: String(s.expertise ?? "").trim(),
          vocabulary: Array.isArray(s.vocabulary) ? s.vocabulary.map(String) : [],
          measurementGuide: String(s.measurementGuide ?? "").trim(),
          typicalItems: Array.isArray(s.typicalItems) ? s.typicalItems.map(String) : [],
          ownedSectionRefs: Array.isArray(s.ownedSectionRefs) ? s.ownedSectionRefs.map(String) : [],
        }))
    : [];

  if (specialists.length === 0) return fallback();

  // Find unowned sections and assign them to an "Other" specialist so no
  // section is dropped.
  const ownedRefs = new Set<string>();
  for (const sp of specialists) for (const r of sp.ownedSectionRefs) ownedRefs.add(r);
  const unowned = outlineSections.filter(s => !ownedRefs.has(s.sowRef));
  if (unowned.length > 0) {
    specialists.push({
      key: "unassigned-section-specialist",
      label: "Unassigned Section Specialist",
      expertise: "Catch-all for SOW sections the designer did not assign to a named specialist.",
      vocabulary: [],
      measurementGuide: "Use whichever unit the SOW implies.",
      typicalItems: [],
      ownedSectionRefs: unowned.map(s => s.sowRef),
    });
  }

  const verifierChecks: VerifierCheck[] = Array.isArray(parsed?.verifierChecks)
    ? parsed.verifierChecks
        .filter((c): c is VerifierCheck => Boolean(c && typeof c === "object" && (c as VerifierCheck).topic))
        .map(c => ({
          key: String(c.key ?? c.topic).trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60),
          topic: String(c.topic).trim(),
          description: String(c.description ?? "").trim(),
          rationale: String(c.rationale ?? "").trim(),
          measurementHint: c.measurementHint ? String(c.measurementHint).trim() : undefined,
        }))
    : [];

  return {
    projectDescription: String(parsed?.projectDescription ?? `Project "${projectName}"`).trim(),
    projectType: String(parsed?.projectType ?? "Construction Project").trim(),
    scopeAreas: Array.isArray(parsed?.scopeAreas) ? parsed.scopeAreas.map(String) : [],
    specialists,
    verifierChecks,
    reasoning: String(parsed?.reasoning ?? "").trim(),
    isFallback: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section → specialist routing from the dynamic roster.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up which specialist in the roster owns a given SOW section.
 * Returns null if no specialist claims it (shouldn't happen — designer assigns
 * every section, and the validator patches gaps with an Unassigned specialist).
 */
export function pickSpecialistForSection(
  roster: AgentRoster,
  sectionSowRef: string,
): DynamicSpecialist | null {
  for (const sp of roster.specialists) {
    if (sp.ownedSectionRefs.includes(sectionSowRef)) return sp;
  }
  return null;
}

/**
 * Render a dynamic specialist as a system-prompt fragment that prepends to the
 * generic QS prompt. Returns empty string if no specialist is supplied.
 */
export function renderSpecialistContext(
  specialist: DynamicSpecialist | null,
  projectDescription: string,
): string {
  if (!specialist) return "";
  const vocab = specialist.vocabulary.length > 0 ? specialist.vocabulary.join(", ") : "(none specified)";
  const typical = specialist.typicalItems.length > 0
    ? specialist.typicalItems.map(t => `  • ${t}`).join("\n")
    : "  (none supplied — invent items grounded in the SOW)";
  return `SPECIALIST ROLE — ${specialist.label}
${specialist.expertise}

Project context (for grounding your domain knowledge): ${projectDescription}

Vocabulary to reach for in this discipline:
  ${vocab}

Measurement guidance for this specialist's scope:
  ${specialist.measurementGuide}

Reference items in this specialist's house style (adapt to the actual SOW — do not copy verbatim):
${typical}
`;
}

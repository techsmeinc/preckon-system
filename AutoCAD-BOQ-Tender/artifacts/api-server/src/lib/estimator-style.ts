/**
 * Estimator-style enrichment & quality assurance for the multi-agent BOQ.
 *
 * The SOW-driven section agents reliably produce *correct* lines, but left to
 * themselves they write "consultant-generic" descriptions ("Supply and
 * installation of complete domestic cold water system") instead of the
 * "execution-and-pricing" lines a human estimator writes ("Supply, install &
 * connect 63 mm PEX cold-water main to existing supply, incl. shutoff valves,
 * fittings & water-hammer arrestor; testing & commissioning").
 *
 * This module pushes the pipeline toward the human style in TWO token-free ways:
 *
 *   1. ESTIMATOR_DESCRIPTION_GUIDE / ESTIMATOR_DECOMP_GUIDE — prompt fragments
 *      injected into the section-agent + verifier prompts. They teach the
 *      estimator description pattern and system→line decomposition.
 *
 *   2. inferScopeType() + assessItemQuality() — pure-code (zero LLM tokens)
 *      classifiers run AFTER generation. They tag each line with a scope type
 *      (Supply & Install / Testing & Commissioning / Demolition / …) and score
 *      its description against the human-BOQ quality rules, flagging generic
 *      lines, missing material/size, MEP systems with no testing line, fixtures
 *      with no accessories, and measurable work mis-priced as a lump sum.
 *
 * Nothing here changes a quantity or a unit — those stay owned by the section
 * agents and boq-units.ts. This layer only enriches descriptions (via prompts)
 * and judges quality (via code).
 */

import { classifyDiscipline } from "./discipline-checklist";

// ─────────────────────────────────────────────────────────────────────────────
// Prompt fragments — injected into generation + verification prompts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The estimator description pattern. Injected into every section-agent system
 * prompt so generated lines read like a QS's priced BOQ, not a consultant's
 * scope narrative.
 */
export const ESTIMATOR_DESCRIPTION_GUIDE = `WRITE EACH DESCRIPTION LIKE A HUMAN QS WRITING A PRICED BOQ — plain, crisp, specific, instantly readable. NOT consultant / spec / AI prose. One short line (6–18 words).

WRITE LIKE THIS:
  • Everyday construction English. Name the item, what it's made of, and the ONE key size. Start "Supply & install …" (or "Supply, install & connect …" for pipes / cables / services). Simple catalogue items can be just the item + spec ("Angle valve", "Chrome water-heater tap").
  • Keep only the few accessories that matter, joined naturally with "with" or "including" — e.g. "with shutoff valves & fittings". Not every fitting.

NEVER (these make it read AI / SOW):
  • NO references in the text — no "as per SOW 12.2", "per spec 08 11 13", "(SOW 20.2)", clause / section / drawing numbers. The SOW ref goes in the sowRef field, NOT the description.
  • NO standards / codes (UFC, ASTM, NFPA, IPC, SSPC, RAL numbers) unless that IS the product's name.
  • NO "c/w", NO em-dashes (—), NO "complete with all accessories required", NO coordination / method / installation prose, NO room-by-room lists.
  • Put any extended detail (full standards, coordination notes, every sub-component) in NOTES, never the description. Don't invent specs; keep the real sizes & materials.

GOOD (match this voice & length):
  "Supply, install & connect PEX cold water line to 24 toilets & laundry, with shutoff valves & fittings"
  "Supply & build 190 mm reinforced CMU external wall up to 3 m high, with grout & reinforcement"
  "Supply & install 2x2 ft recessed LED troffer, 20 W, with driver & supports"
  "Supply & install 30-min fire-rated hollow metal door, 910 x 2205 mm, with frame, hinges, lockset & closer"
  "Water hammer arrestor"   /   "Testing & commissioning of domestic water system"
BAD — generic (no specifics):  "Supply and installation of complete domestic cold water supply system."  /  "Exterior CMU wall assembly."
BAD — AI/SOW prose:  "Supply, install & connect telecommunications service entrance conduits — 100 mm dia Schedule 80 PVC (min 2 No.), laid 915 mm below grade … all per SOW 20.2 Item 4. (Coordinate with…)."`;

/**
 * The system→line decomposition rule. Stops the agents from collapsing a whole
 * MEP system into one "complete system — LS" line; pushes them to break it into
 * the measurable supply lines + accessories + fixtures + a testing line.
 */
export const ESTIMATOR_DECOMP_GUIDE = `DECOMPOSE SYSTEMS INTO MEASURABLE LINES — do NOT emit one big "complete system — LS".
A human BOQ breaks a system into its priceable parts. E.g. a plumbing scope is NOT one "Complete plumbing — LS"; it is:
  • PEX cold-water supply line incl. fittings, shutoff valves & connections — m
  • PEX hot-water supply line incl. recirculation loop — m
  • CPVC waste / drain / vent piping — m
  • Electric storage water heaters, 120 US-gal, incl. drain pan & relief valve — EA
  • Floor drains with trap primers & SS grates — EA
  • Cleanouts to each bathroom / laundry / mech room — EA
  • Water-hammer arrestors, angle/ball valves, hose bibs — EA
  • Pressure testing, flushing, chlorination & commissioning — LS
Always emit a dedicated TESTING & COMMISSIONING line for every MEP system (plumbing, HVAC, electrical, fire, low-voltage). Equipment/fixture lines must spell out their included accessories. Reserve LS for genuine lump deliverables only (mobilization, design, submittals, testing, making-good, "as-required" allowances).`;

/** Compact version for the verifier prompt (where context budget is tighter). */
export const ESTIMATOR_VERIFIER_HINT = `Any missing line you add must be estimator-style: [Action] + [material/spec] + [size/rating] + including [accessories] + as per [SOW ref] — never a generic "complete system" sentence. For an MEP gap, prefer a specific measurable line (and a testing & commissioning line) over one lump LS.`;

// ─────────────────────────────────────────────────────────────────────────────
// Scope-type taxonomy (pure-code classifier)
// ─────────────────────────────────────────────────────────────────────────────

export type ScopeType =
  | "Supply & Install"
  | "Supply Only"
  | "Install Only"
  | "Testing & Commissioning"
  | "Demolition / Disposal"
  | "Connection to Existing"
  | "Design / Submittal"
  | "Allowance / Provisional"
  | "Temporary Works"
  | "General";

const reAny = (words: string[]) => new RegExp(`\\b(${words.join("|")})`, "i");

const RE_TESTING = reAny([
  "test", "testing", "commission", "t&c", "tab", "balanc", "flush", "chlorinat",
  "disinfect", "snag", "making good", "making-good", "handover", "hand-over",
]);
const RE_DEMOLITION = reAny([
  "demol", "dismantl", "remov", "strip out", "strip-out", "break out", "break-out",
  "cart away", "carting away", "dispos", "haul away", "clear and grub",
]);
const RE_CONNECTION = /\b(connect|tie[ -]?in|tap into|tapping)\b|to existing\b/i;
const RE_DESIGN = reAny([
  "design", "submittal", "shop drawing", "as-built", "as built", "o&m", "o & m",
  "calculation", "dd 1354", "dd form", "method statement", "sample board", "mock-?up",
  "warrant", "documentation",
]);
// Unambiguous design/closeout *deliverable* phrases. These win even when the
// line also carries an incidental physical verb ("…design package for
// construction", "Provide … submittal") — the failure we saw on §2.1. Kept
// narrow (no bare "drawings"/"shop drawings", which appear in physical lines as
// references) so it never re-tags a real supply line.
const RE_DESIGN_STRONG = reAny([
  "design submittal", "design submission", "design analysis", "design package",
  "design complete", "interim .{0,8}design", "final .{0,8}design", "submittal register",
  "dd[ -]?1354", "dd form 1354", "o&m manual", "o & m manual", "as-?built drawing",
  "65% design", "95% design", "100% design", "65%\\)", "95%\\)", "100%\\)",
]);
const RE_ALLOWANCE = reAny([
  "allowance", "provisional", "prime cost", "p\\.?c\\.? sum", "as required", "as-required",
  "contingency", "miscellaneous", "sundr",
]);
const RE_TEMPORARY = reAny([
  "mobiliz", "mobilis", "demobiliz", "demobilis", "temporary", "hoarding", "site office",
  "site setup", "staging area", "welfare", "scaffold",
]);
const RE_SUPPLY = /\b(supply|supplied|supplying|provide|provided|provision|furnish|deliver|procure)\b/i;
// Whole-word forms (incl. the common noun/participle spellings) so "Supply and
// installation of …" reads as Supply & Install — but "fixture" never trips
// "fix" because the \b boundaries require complete words. NOTE: the noun
// "construction" is deliberately EXCLUDED (only the verb construct/-ed/-ing) —
// design-submittal lines routinely say "…for construction" and must not be
// mis-read as install work.
const RE_INSTALL =
  /\b(install|installation|installed|installing|erect|erected|construct|constructed|constructing|lay|laid|laying|fix|fixed|fixing|mount|mounted|mounting|apply|applied|application|place|placed|placing|cast|casting)\b/i;
// A line that LEADS with a testing verb is a testing & commissioning line even
// if it later says "provide/supply" (e.g. "Test & commission … provide
// certificates"). Anchored to the description start so a "Supply, install, test
// & commission …" equipment line is NOT swept up.
const RE_TESTING_LEAD =
  /^\W*(test|testing|commission|re-?commission|t&c|tab\b|flush|chlorinat|disinfect|balanc|verif)/i;

/**
 * Classify a BOQ line into a scope type from its description + category. Pure
 * code, no LLM. Order matters — the most specific intent wins.
 */
export function inferScopeType(description: string, category?: string | null): ScopeType {
  const desc = (description ?? "").trim();
  const text = `${category ?? ""} ${description ?? ""}`;
  if (RE_DEMOLITION.test(text) && !RE_SUPPLY.test(text)) return "Demolition / Disposal";
  // Unambiguous deliverables win first — even if the line also carries an
  // incidental physical verb (submittals say "…for construction"; testing lines
  // say "…provide certificates").
  if (RE_DESIGN_STRONG.test(text)) return "Design / Submittal";
  if (RE_TESTING_LEAD.test(desc)) return "Testing & Commissioning";
  if (RE_ALLOWANCE.test(text)) return "Allowance / Provisional";
  if (RE_DESIGN.test(text) && !RE_INSTALL.test(text)) return "Design / Submittal";
  // A testing/commissioning line that isn't itself a supply+install of equipment.
  if (RE_TESTING.test(text) && !RE_SUPPLY.test(text)) return "Testing & Commissioning";
  if (RE_TEMPORARY.test(text)) return "Temporary Works";
  if (RE_CONNECTION.test(text) && !RE_SUPPLY.test(text)) return "Connection to Existing";

  const supply = RE_SUPPLY.test(text);
  const install = RE_INSTALL.test(text);
  if (supply && install) return "Supply & Install";
  if (supply) return "Supply Only";
  if (install) return "Install Only";
  return "General";
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality assessment (pure-code validator — the design's "Pass 7")
// ─────────────────────────────────────────────────────────────────────────────

// Material vocabulary — physical items should name one of these.
const MATERIAL_WORDS = [
  "pex", "cpvc", "upvc", "u-pvc", "pvc", "ppr", "hdpe", "gi ", "g.i", "galvanis",
  "copper", "brass", "stainless", "ductile iron", "cast iron", "cmu", "concrete",
  "rcc", "r.c.c", "reinforced concrete", "blockwork", "block work", "masonry",
  "gypsum", "plasterboard", "mineral wool", "rockwool", "rock wool", "glass wool",
  "polyurethane", "pir", "xps", "eps", "bitumen", "mastic", "sealant", "mortar",
  "cement", "screed", "plaster", "render", "terrazzo", "ceramic", "porcelain",
  "granite", "marble", "vinyl", "epoxy", "timber", "wood", "mdf", "plywood",
  "aluminium", "aluminum", "steel", "ms ", "m.s", "glass", "glazing", "hpl",
  "laminate", "frp", "grp", "emt", "xlpe", "pvc-insulated", "cat-6", "cat6",
  "cat 6", "fiber", "fibre", "rg-6", "rg6", "membrane", "insulation", "paint",
  "primer", "enamel", "emulsion", "asphalt", "interlock", "kerb", "sandwich panel",
];

// A figure with a unit, or an explicit rating word → "has a spec".
const RE_SPEC =
  /\b\d+(\.\d+)?\s?(mm|cm|m|m²|m2|m³|m3|"|in|inch|hp|kw|kva|kvar|w|watt|v|kv|a|amp|ma|btu|tr|ton|kg|lph|l\/s|lps|gpm|gal|gallon|bar|kpa|mpa|pa|°c|deg|sq\.?mm|sqmm|awg|nb|dn|ø|dia)\b/i;
const RE_RATING = /\b(ip\d{2}|r-?\d|class\s?\w|grade\s?\w|sch(edule)?\s?\d|fire[- ]?rated|\d+\s?(min|hour|hr)|\d{3,4}\s?k|\d+\s?lm)\b/i;

// Generic boilerplate that signals a consultant-style line.
const RE_GENERIC = reAny([
  "complete (system|works|installation|set)", "entire system", "all necessary",
  "all associated", "associated works", "various works", "relevant works",
  "general works", "as applicable",
]);

// Lines that genuinely measure a physical quantity — these should never be LS.
const RE_MEASURABLE_NOUN = reAny([
  "pipe", "piping", "cable", "conduit", "duct", "wall", "blockwork", "masonry",
  "paving", "pavement", "kerb", "curb", "screed", "plaster", "tiling", "tile",
  "membrane", "insulation", "rebar", "reinforcement", "structural steel",
  "skirting", "cladding", "flooring", "ceiling", "fencing", "trench", "excavation",
  "backfill", "concrete",
]);

// Countable equipment/fixtures whose price should carry accessories.
const RE_FIXTURE = reAny([
  "pump", "heater", "tank", "chiller", "ahu", "fcu", "fan", "diffuser", "valve",
  "panel", "board", "mdb", "sdb", "luminaire", "fixture", "fitting", "wc",
  "water closet", "lavatory", "wash basin", "washbasin", "sink", "shower",
  "floor drain", "extinguisher", "camera", "cctv", "sprinkler", "hydrant",
  "door", "window", "unit",
]);
const RE_INCLUSIONS = /\b(includ|incl\.?|c\/w|complete with|together with|comprising|with all)\b/i;

const MEP_DISCIPLINES = new Set(["plumbing", "hvac", "electrical", "lighting"]);

export interface QualityFlag {
  code:
    | "generic"
    | "no-spec"
    | "no-material"
    | "no-inclusions"
    | "measurable-as-ls"
    | "no-reference";
  message: string;
}

export interface QualityResult {
  score: number; // 0..1
  flags: QualityFlag[];
  scopeType: ScopeType;
}

export interface AssessableItem {
  description?: string | null;
  category?: string | null;
  unit?: string | null;
  notes?: string | null;
  quantity?: number | string | null;
  /** How many CAD drawing references back this line (>0 = grounded in a drawing). */
  drawingRefCount?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantity Validator — the "BOQ category → measurement method → check" lookup.
// For each trade/category we know HOW it should be measured (doors = counted,
// walls = area, pipe = length, concrete = volume, rebar = weight) and which unit
// follows. We then check each generated line's quantity + unit against that and
// raise a review flag on the ones a human must eyeball — chiefly: a measurable
// item left provisional/unmeasured, a measurable item priced LS, or a unit that
// doesn't match the take-off method. Pure code, zero tokens.
// ─────────────────────────────────────────────────────────────────────────────

export type MeasurementMethod = "counted" | "length" | "area" | "volume" | "weight" | "lump";

const EXPECTED_UNITS_BY_METHOD: Record<MeasurementMethod, string[]> = {
  counted: ["EA", "Set"],
  length: ["m"],
  area: ["m²"],
  volume: ["m³"],
  weight: ["ton", "kg"],
  lump: ["LS", "PM"],
};

const RE_M_VOLUME = reAny(["excavat", "backfill", "concrete", "\\brcc\\b", "\\bpcc\\b", "blinding", "hardcore", "filling", "earthwork"]);
const RE_M_WEIGHT = reAny(["rebar", "reinforcement", "structural steel", "steel frame", "roof sheet", "roof sheeting", "purlin", "sandwich panel", "steelwork"]);
const RE_M_AREA = reAny(["wall", "blockwork", "masonry", "partition", "paving", "pavement", "tiling", "\\btile", "floor finish", "flooring", "ceiling", "plaster", "render", "\\bpaint", "membrane", "waterproof", "insulation", "cladding", "screed", "glazing", "curtain wall", "\\bslab", "vapou?r barrier", "epoxy floor"]);
const RE_M_LENGTH = reAny(["pipe", "piping", "cable", "conduit", "kerb", "curb", "skirting", "fenc", "handrail", "flashing", "trench", "\\bmain\\b", "\\briser", "cabling", "wiring", "drain line", "gutter", "downpipe"]);
const RE_M_COUNTED = reAny(["door", "window", "valve", "pump", "\\bfan", "fixture", "fitting", "\\bpanel", "\\bboard", "\\bmdb", "\\bsdb", "luminaire", "light fitting", "light fixture", "socket", "switch", "diffuser", "grille", "\\bsink", "wash basin", "washbasin", "\\bwc\\b", "water closet", "shower", "heater", "\\btank", "\\bunit\\b", "sensor", "detector", "extinguisher", "hydrant", "hose reel", "mirror", "camera", "outlet", "manhole", "gully"]);

function methodFromUnit(unit: string): MeasurementMethod | null {
  const u = unit.trim().toLowerCase();
  if (u === "m²" || u === "m2") return "area";
  if (u === "m³" || u === "m3") return "volume";
  if (u === "m") return "length";
  if (u === "ton" || u === "kg") return "weight";
  if (u === "ea" || u === "set") return "counted";
  if (u === "ls" || u === "pm") return "lump";
  return null;
}

/** What SHOULD this line be measured by — from its description, not its unit. */
export function detectMeasurementMethod(
  description: string, category: string | null | undefined, unit: string, scopeType: ScopeType,
): MeasurementMethod {
  // Genuine lump deliverables are LS by definition.
  if (scopeType === "Design / Submittal" || scopeType === "Temporary Works" ||
      scopeType === "Allowance / Provisional" || scopeType === "Testing & Commissioning") return "lump";
  const hay = `${category ?? ""} ${description ?? ""}`.toLowerCase();
  if (RE_M_VOLUME.test(hay)) return "volume";
  if (RE_M_WEIGHT.test(hay)) return "weight";
  if (RE_M_AREA.test(hay)) return "area";
  if (RE_M_LENGTH.test(hay)) return "length";
  if (RE_M_COUNTED.test(hay)) return "counted";
  return methodFromUnit(unit) ?? "lump";
}

// Notes phrasing that means "we did NOT actually measure this".
const RE_UNMEASURED = /provisional|not (yet )?measured|to be measured|verify (from|the|run|length|area|count|quantity)|not measurable|not derivable|not shown|not dimensioned|assumed quantity/i;

export type ReviewSeverity = "high" | "medium" | "low";
const SEV_RANK: Record<ReviewSeverity, number> = { low: 1, medium: 2, high: 3 };

export interface QuantityVerdict {
  needsReview: boolean;
  severity: ReviewSeverity | null;
  method: MeasurementMethod;
  reasons: string[];
}

/**
 * Validate ONE line's quantity against its expected measurement method and flag
 * it for human review if the number can't be trusted. The flags are exactly the
 * cases a QS must look at before pricing.
 */
export function validateQuantity(item: AssessableItem): QuantityVerdict {
  const desc = item.description ?? "";
  const unit = (item.unit ?? "").trim();
  const notes = item.notes ?? "";
  const qty = Number(item.quantity);
  const scopeType = inferScopeType(desc, item.category);
  const method = detectMeasurementMethod(desc, item.category, unit, scopeType);
  const reasons: string[] = [];
  let sev: ReviewSeverity | null = null;
  const bump = (s: ReviewSeverity) => { if (sev === null || SEV_RANK[s] > SEV_RANK[sev]) sev = s; };

  if (method !== "lump") {
    const expected = EXPECTED_UNITS_BY_METHOD[method];
    if (/^ls$/i.test(unit)) {
      reasons.push(`${method} item priced LS — should be measured (${expected.join("/")})`);
      bump("high");
    } else if (!expected.some(u => u.toLowerCase() === unit.toLowerCase())) {
      reasons.push(`unit "${unit}" doesn't match a ${method} take-off (expected ${expected.join("/")})`);
      bump("medium");
    }
    if (RE_UNMEASURED.test(notes)) {
      reasons.push("quantity not measured (provisional) — take off from drawings");
      bump("high");
    } else if (Number.isFinite(qty) && Math.abs(qty - 1) < 1e-9 && method !== "counted") {
      reasons.push("quantity is a placeholder of 1 — verify the measured value");
      bump("medium");
    }
    if (method === "counted" && Number.isFinite(qty) && qty > 0 && !Number.isInteger(qty)) {
      reasons.push(`counted item has a fractional quantity (${qty})`);
      bump("medium");
    }
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    reasons.push("quantity missing or not a positive number");
    bump("high");
  }

  return { needsReview: reasons.length > 0, severity: sev, method, reasons };
}

/** Marker used in notes so the review tag is visible and idempotent on re-runs. */
export const REVIEW_MARKER = "NEEDS REVIEW";

/** Short tag appended to a line's notes when it needs human review (empty if not). */
export function reviewSuffix(v: QuantityVerdict): string {
  if (!v.needsReview) return "";
  return ` | ⚠ ${REVIEW_MARKER} (${v.severity}): ${v.reasons.join("; ")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence confidence + TBD — the design doc's Primary Design Position:
// "AI may propose scope, but units & quantities must be evidence-based. No
// evidence means TBD, not guessed." A measurable line with no traceable
// evidence is TBD (shown as TBD in the BOQ, never a credible-looking number).
// ─────────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "High" | "Medium" | "Low" | "TBD";

// Notes phrasing that proves the quantity was actually measured/derived.
const RE_GROUNDED = /count_blocks|get_layer_geometry|polyline|hatch|largestclosed|footprint|=\s*\d|×|\bx\s*\d|per (the )?(door|window|finish|room|lighting|fixture|equipment|schedule)|schedule\b|count\(/i;

/** Strip our appended [QA] / review / conf tags, leaving the original provenance. */
export function stripEstimatorTags(notes: string | null | undefined): string {
  if (!notes) return "";
  const idx = notes.indexOf("[QA");
  return (idx >= 0 ? notes.slice(0, idx) : notes).trim();
}

/**
 * Evidence confidence for ONE line's quantity:
 *   High   — counted from blocks/schedule, or a genuine lump-sum package
 *   Medium — measured/derived from CAD geometry or stated dimensions
 *   Low    — a number with no traceable evidence (verify)
 *   TBD    — measurable item with NO evidence → must show TBD, not a number
 */
export function quantityConfidence(item: AssessableItem): ConfidenceLevel {
  const notes = item.notes ?? "";
  const qty = Number(item.quantity);
  const unit = (item.unit ?? "").trim();
  const scopeType = inferScopeType(item.description ?? "", item.category);
  const method = detectMeasurementMethod(item.description ?? "", item.category, unit, scopeType);
  // A line priced as a lump — either a genuine LS/PM deliverable (method=lump) or
  // any line the estimator carried in LS/PM units — has NO take-off quantity, so
  // it is never "TBD": there is nothing to measure. (A stray "excavation/slab/
  // wall/wiring" keyword in the text can push detectMeasurementMethod to a
  // measured method even on an LS line; the unit is the source of truth here.)
  // validateQuantity still independently flags a measurable item priced LS so the
  // QS sees it — this only stops the misleading TBD in the quantity cell.
  if (method === "lump" || /^(ls|pm)$/i.test(unit)) return "High";
  const grounded = RE_GROUNDED.test(notes) || (item.drawingRefCount ?? 0) > 0;
  // Counted-ness is decided by the UNIT (EA/Set), not the description — a
  // "ceiling-mounted light" is still a counted EA item even though its text
  // says "ceiling". A counted item at qty 1 is plausibly real; an area/length/
  // volume at a bare "1" is a placeholder.
  const isCounted = /^(ea|set)$/i.test(unit);
  // A line has NO real number when qty is missing/≤0, or is a bare placeholder
  // "1" on a measured (area/length/volume) line. A real number is trusted even
  // if a stale "provisional" note lingers in the text.
  const placeholder = !Number.isFinite(qty) || qty <= 0 || (!isCounted && Math.abs(qty - 1) < 1e-9);
  if (placeholder) return grounded ? (isCounted ? "High" : "Medium") : "TBD";
  if (grounded) return isCounted ? "High" : "Medium";
  return "Low";
}

const DEFAULT_BASIS: Record<ConfidenceLevel, string> = {
  High: "Counted from CAD blocks / schedule (or lump-sum package).",
  Medium: "Calculated from CAD geometry / stated dimensions — verify.",
  Low: "Quantity stated without traceable CAD evidence — verify.",
  TBD: "No traceable evidence — requires drawing / schedule takeoff.",
};

/** The "Quantity basis" cell from the design's sample output: the original
 *  provenance the agent recorded, else a sensible default for the confidence. */
export function quantityBasis(item: AssessableItem): string {
  const provenance = stripEstimatorTags(item.notes);
  if (provenance) return provenance.slice(0, 180);
  return DEFAULT_BASIS[quantityConfidence(item)];
}

/** True when the quantity has no evidence and must render as TBD, not a number. */
export function isTbdQuantity(item: AssessableItem): boolean {
  return quantityConfidence(item) === "TBD";
}

/** Compact confidence tag for the notes field (visible + queryable). */
export function confidenceSuffix(level: ConfidenceLevel): string {
  return ` · conf:${level}`;
}

/**
 * Score one BOQ line against the human-estimator quality rules. Pure code, no
 * model call. Returns a 0..1 quality score (1 = reads like a human estimator
 * wrote it), the flags that pulled the score down, and the inferred scope type.
 */
export function assessItemQuality(item: AssessableItem): QualityResult {
  const desc = (item.description ?? "").trim();
  const cat = item.category ?? "";
  const unit = (item.unit ?? "").trim();
  const notes = item.notes ?? "";
  const hay = `${cat} ${desc}`.toLowerCase();
  const scopeType = inferScopeType(desc, cat);

  const flags: QualityFlag[] = [];

  // Lump-sum deliverables (design, mobilization, testing, allowances) and
  // demolition are legitimately material/spec-light and often priced LS — only
  // judge them for genericness, not material/size/LS-misprice.
  const isLumpDeliverable =
    scopeType === "Design / Submittal" ||
    scopeType === "Temporary Works" ||
    scopeType === "Allowance / Provisional" ||
    scopeType === "Testing & Commissioning" ||
    scopeType === "Demolition / Disposal";

  const hasSpec = RE_SPEC.test(desc) || RE_RATING.test(desc);
  const hasMaterial = MATERIAL_WORDS.some(w => hay.includes(w));
  const hasInclusions = RE_INCLUSIONS.test(desc);
  const hasRef =
    /\b(sow|section|clause|drawing|dwg|sheet|spec|schedule|rcp|detail)\b/i.test(desc) ||
    /\b(sow|section|clause|drawing|dwg|sheet|spec|schedule)\b/i.test(notes);

  if (RE_GENERIC.test(desc) || desc.length < 25) {
    flags.push({ code: "generic", message: "reads as generic/consultant scope — name the material, size & inclusions" });
  }
  if (!isLumpDeliverable) {
    if (!hasSpec) {
      flags.push({ code: "no-spec", message: "no size/rating embedded (e.g. mm, kW, R-value, fire rating)" });
    }
    if (!hasMaterial) {
      flags.push({ code: "no-material", message: "no material/system named (e.g. PEX, CMU, XLPE, gypsum)" });
    }
    // Measurable physical work priced as a lump sum is almost always wrong.
    if (/^ls$/i.test(unit) && RE_MEASURABLE_NOUN.test(hay)) {
      flags.push({ code: "measurable-as-ls", message: "measurable work priced LS — should be m / m² / m³ / EA / ton" });
    }
    // Fixtures/equipment must carry their accessories in the rate.
    if (RE_FIXTURE.test(hay) && /^(ea|set)$/i.test(unit) && !hasInclusions) {
      flags.push({ code: "no-inclusions", message: "fixture/equipment with no accessories listed (valves, fittings, supports…)" });
    }
  }
  if (!hasRef) {
    flags.push({ code: "no-reference", message: "no SOW/drawing reference cited" });
  }

  // Weighted penalty → score. Genericness & LS-misprice hurt most; a missing
  // reference is a nudge, not a failure.
  const WEIGHT: Record<QualityFlag["code"], number> = {
    generic: 0.35,
    "measurable-as-ls": 0.3,
    "no-material": 0.2,
    "no-spec": 0.2,
    "no-inclusions": 0.15,
    "no-reference": 0.08,
  };
  let penalty = 0;
  for (const f of flags) penalty += WEIGHT[f.code];
  const score = Math.max(0, Math.min(1, 1 - penalty));
  return { score, flags, scopeType };
}

/** Is this line part of an MEP discipline (so its section needs a testing line)? */
export function isMepItem(item: AssessableItem): boolean {
  const d = classifyDiscipline(`${item.category ?? ""} ${item.description ?? ""} ${item.notes ?? ""}`);
  return d != null && MEP_DISCIPLINES.has(d.key);
}

/**
 * Does a SOW section TITLE name an MEP / commissioned-system discipline? Used to
 * gate the "section has no testing line" warning on the section's own identity
 * rather than on stray per-line keyword matches — a Civil or Architectural
 * section that merely contains one "drainage pipe" line is NOT an MEP section.
 * Fire protection / fire alarm / telecom ARE included (they're commissioned).
 */
export function isMepSectionTitle(title: string): boolean {
  // Leading \b only — no trailing boundary, so "plumb" matches "Plumbing",
  // "electric" matches "Electrical", "telecom"/"communicat" match
  // "Telecommunications". "control"/"bms" are intentionally omitted (they'd
  // false-match "Quality Control" etc.).
  return /\b(mechanical|hvac|plumb|electric|fire\s*(protection|alarm|fighting|suppression)|telecom|communicat|low[\s-]*voltage|\belv\b)/i.test(
    title ?? "",
  );
}

/** Does a description read as a testing / commissioning line? */
export function isTestingLine(item: AssessableItem): boolean {
  return inferScopeType(item.description ?? "", item.category) === "Testing & Commissioning";
}

/**
 * Compose the compact scope-type tag that goes into the AIGCC "Remarks" column.
 * Kept short and QS-readable (it's a human-facing column).
 */
export function scopeTypeRemark(scopeType: ScopeType): string {
  return scopeType === "General" ? "" : scopeType;
}

/**
 * Marker that prefixes the enrichment tag appended to an item's notes. Used to
 * detect (and avoid double-appending) a tag we already added on a previous run.
 */
export const QA_NOTE_MARKER = "[QA]";

/**
 * One-line, human-readable enrichment tag appended to an item's provenance
 * notes. Always carries the scope type (so the QS sees Supply & Install /
 * Testing & Commissioning / Demolition at a glance) and, when the line scored
 * below perfect, its quality % + the flags to fix. This is the surfaced field
 * (the BOQ edit dialog + CSV export show `notes`), so it's where the QS reads
 * the estimator-QA result.
 */
export function qualityNote(result: QualityResult): string {
  const pct = Math.round(result.score * 100);
  const flagPart =
    result.flags.length > 0 ? ` — QA ${pct}%: ${result.flags.map(f => f.code).join(", ")}` : "";
  return `${QA_NOTE_MARKER} ${result.scopeType}${flagPart}`;
}

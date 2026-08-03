// ─────────────────────────────────────────────────────────────────────────────
// Construction estimating knowledge, ported from the TenderLogix/DrawLogix
// monorepo (artifacts/api-server/src/lib) into the Preckon worker.
//
// Rewritten to be dependency-free ESM so it fits the worker's constraints: no
// npm packages, no database, no filesystem. This is the domain judgement that
// makes a generated BOQ read like a quantity surveyor wrote it rather than a
// language model — keep it here, out of the prompts, so it can be tuned without
// touching the agent plumbing.
// ─────────────────────────────────────────────────────────────────────────────

import { formatDisciplineUnitsForPrompt } from "./disciplines.mjs";

/* ── Units ──────────────────────────────────────────────────────────────────
   Every quantity is normalised onto this canonical set so the BOQ, the priced
   estimate and any export stay internally consistent, regardless of how the
   model spelled the unit. */

export const STANDARD_UNITS = ["m", "m²", "m³", "kg", "ton", "EA", "Set", "LS", "PM"];

export function normalizeUnit(raw) {
  const original = String(raw ?? "").trim();
  if (!original) return original;
  // Lower-case and strip separators so "Sq,mtrs." → "sqmtrs".
  const key = original.toLowerCase().replace(/[\s.,_/-]/g, "");

  // Volume first, so "m3"/"cum" win over the bare-"m" linear rule below.
  if (["m3", "m³", "cum", "cums", "cbm", "cumtr", "cumtrs", "cubicmtr", "cubicmtrs",
    "cubicmeter", "cubicmetre", "cubicmeters", "cubicmetres"].includes(key)) return "m³";
  if (["m2", "m²", "sqm", "sqms", "sqmt", "sqmtr", "sqmtrs", "sqmeter", "sqmeters",
    "squaremeter", "squaremeters", "squaremetre", "squaremetres"].includes(key)) return "m²";
  if (["ton", "tons", "tonne", "tonnes", "metricton", "metrictonne"].includes(key)) return "ton";
  if (["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"].includes(key)) return "kg";
  if (["ls", "lumpsum", "lumpsums", "lump", "lot", "lots"].includes(key)) return "LS";
  if (["pm", "personmonth", "personmonths", "manmonth", "manmonths"].includes(key)) return "PM";
  if (["set", "sets"].includes(key)) return "Set";
  if (["ea", "each", "no", "nos", "number", "numbers", "pc", "pcs", "piece",
    "pieces", "item", "items", "unit", "units", "nr", "qty"].includes(key)) return "EA";
  if (["m", "lm", "lms", "rm", "mtr", "mtrs", "meter", "meters", "metre", "metres",
    "rmt", "runningmeter", "runningmetre", "lin", "linm", "linearmeter", "linearmetre"].includes(key)) return "m";

  // Not a recognised measure (kW, kVA, L, %, hr, roll) — legitimate on the
  // occasional specialist line, so pass it through untouched.
  return original;
}

/** The tenant schema's drawing_measurement unit enum is narrower than the BOQ's. */
export function normalizeMeasurementUnit(raw) {
  const u = normalizeUnit(raw);
  const map = { "m²": "m2", "m³": "m3", EA: "nr", Set: "nr", LS: "nr", PM: "nr", ton: "t" };
  const out = map[u] ?? u;
  return ["m", "m2", "m3", "nr", "kg", "t", "lm"].includes(out) ? out : "nr";
}

/* ── How a QS writes a line ─────────────────────────────────────────────── */

export const DESCRIPTION_GUIDE = `WRITE EACH DESCRIPTION LIKE A QS WRITING A PRICED BOQ — plain, crisp, specific, instantly readable. NOT consultant/spec/AI prose. One short line (6-18 words).

WRITE LIKE THIS:
  • Everyday construction English. Name the item, what it is made of, and the ONE key size. Start "Supply & install …" (or "Supply, install & connect …" for pipes/cables/services). Simple catalogue items can be just the item + spec ("Angle valve").
  • Keep only the accessories that matter, joined with "with" or "including" — e.g. "with shutoff valves & fittings". Not every fitting.

NEVER (these make it read as AI or as a copied SOW):
  • NO clause/section/drawing references inside the description — those belong in the notes field.
  • NO standards or codes (ASTM, NFPA, IPC, RAL) unless that IS the product's name.
  • NO "c/w", no em-dashes, no "complete with all accessories required", no method or coordination prose, no room-by-room lists.
  • Never invent specifications. If the documents do not give a size or material, leave it out rather than guessing.

GOOD:
  "Supply, install & connect PEX cold water line to 24 toilets & laundry, with shutoff valves & fittings"
  "Supply & build 190 mm reinforced CMU external wall up to 3 m high, with grout & reinforcement"
  "Supply & install 30-min fire-rated hollow metal door, 910 x 2205 mm, with frame, hinges, lockset & closer"
BAD (generic): "Supply and installation of complete domestic cold water supply system."
BAD (AI/SOW prose): "Supply, install & connect telecommunications conduits — 100 mm dia Schedule 80 PVC, laid 915 mm below grade … all per SOW 20.2."`;

export const DECOMPOSITION_GUIDE = `DECOMPOSE SYSTEMS INTO MEASURABLE LINES — never emit one big "complete system - LS".
A plumbing scope is not one "Complete plumbing - LS"; it is:
  • PEX cold-water supply line incl. fittings, shutoff valves & connections — m
  • CPVC waste / drain / vent piping — m
  • Electric storage water heaters incl. drain pan & relief valve — EA
  • Floor drains with trap primers & SS grates — EA
  • Water-hammer arrestors, angle/ball valves, hose bibs — EA
  • Pressure testing, flushing, chlorination & commissioning — LS
Emit a dedicated TESTING & COMMISSIONING line for every MEP system (plumbing, HVAC, electrical, fire, low-voltage). Reserve LS for genuine lump deliverables only — mobilisation, design, submittals, testing, making good, stated allowances.`;

/** Unit expectations per trade — steers the model away from "EA" for everything. */
// Built from the per-discipline table rather than written out flat. The flat
// version conflated two things the trades keep apart: metal roof sheeting is
// bought by the ton and the membrane over it by the m²; GI ductwork is priced
// by weight, not by the run. It also had no "Set", so plant supplied as one
// assembly — a genset, a pump set, a packaged AC unit — had nowhere sensible to
// go and came back as EA of its component parts.
export const DISCIPLINE_UNITS = `EXPECTED UNITS BY TRADE (use these unless the documents clearly say otherwise).
Each discipline carries its OWN set — do not borrow another trade's unit because it looks close:
${formatDisciplineUnitsForPrompt()}`;

/* ── Quantity sanity ────────────────────────────────────────────────────── */

/** Obvious-nonsense guard: catches a decimal slip or a unit/quantity mismatch. */
export function validateQuantity(quantity, unit) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return "quantity must be a positive number";
  if (q > 1_000_000) return "quantity implausibly large — check the decimal place";
  if (unit === "LS" && q !== 1) return "a lump sum should be quantity 1";
  if (unit === "ton" && q > 50_000) return "tonnage implausibly large";
  return null;
}

/**
 * Confidence for a derived line. A quantity measured off a confirmed drawing is
 * worth more than one inferred from prose; a round number in a lump-sum unit is
 * usually an allowance, not a measure. Kept below the 0.9 auto-accept bar unless
 * the evidence is genuinely strong, so a human still sees the doubtful ones.
 */
export function quantityConfidence({ derivedFrom, unit, quantity, hasSpec }) {
  let c = 0.72;
  if (derivedFrom === "measurement") c += 0.16;
  else if (derivedFrom === "schedule") c += 0.1;
  else if (derivedFrom === "prose") c -= 0.04;
  if (hasSpec) c += 0.04;
  if (unit === "LS") c -= 0.06;                       // an allowance, not a measure
  const q = Number(quantity);
  if (Number.isFinite(q) && q > 0 && q % 1 === 0 && q % 10 === 0) c -= 0.03; // suspiciously round
  return Math.max(0.4, Math.min(0.95, Number(c.toFixed(2))));
}

/* ── Programme ──────────────────────────────────────────────────────────── */

/** Output rates (unit/day for one crew) used to size a duration from a quantity. */
export const OUTPUT_RATES = {
  "m³": 40, "m²": 120, m: 150, ton: 6, kg: 900, EA: 8, Set: 2, LS: 1, PM: 1,
};

/** Duration in working days for a quantity, floored at one day. */
export function durationFromQuantity(quantity, unit, rate) {
  const r = Number(rate) || OUTPUT_RATES[normalizeUnit(unit)] || 20;
  const q = Number(quantity) || 0;
  return Math.max(1, Math.ceil(q / r));
}

/**
 * Forward pass over declared predecessors. Mirrors the PlanLogix surface, so a
 * programme the agent proposes sequences the same way the UI will draw it.
 * Unknown predecessor names are ignored rather than throwing.
 */
export function sequence(activities) {
  const byName = new Map(activities.map((a) => [String(a.activity), a]));
  for (let pass = 0; pass < activities.length + 1; pass++) {
    let changed = false;
    for (const a of activities) {
      let start = Number(a.start_offset_days ?? 0) || 0;
      for (const p of a.predecessors ?? []) {
        const pred = byName.get(String(p));
        if (pred) start = Math.max(start, (pred.start_offset_days ?? 0) + (pred.duration_days ?? 0));
      }
      if (start !== a.start_offset_days) { a.start_offset_days = start; changed = true; }
    }
    if (!changed) break;
  }
  return activities;
}

/* ── Programme intelligence ───────────────────────────────────────────────── */

/**
 * Words that mark a sentence as carrying time, phasing or sequence meaning.
 * Ported from the TenderLogix planner.
 */
const TIME_SIGNAL =
  /\b(programme|program|gantt|milestone|phase[ds]?|phasing|stage[s]?|duration|commence(ment)?|mobilis|mobiliz|completion|sectional|handover|hand[-\s]?over|weeks?|months?|\d+\s*days?|calendar|deadline|by\s+\d|within\s+\d|no later than|practical completion|substantial completion|defects?\s+liability|testing|commissioning|snagging|occupancy|possession|lead[-\s]?time|delivery\s+period|construction\s+period|contract\s+period|time\s+for\s+completion|critical\s+path|float|sequence|prior to|concurrent|shift|working hours|night work|road closure|access)\b/i;

/**
 * Pull the sentences that carry timing, phasing or milestone information out of
 * the tender text.
 *
 * The reason this exists: a stated contract period is one line in a hundred
 * pages, and a budgeted excerpt truncates it away. Hoisting those sentences to
 * the front of the prompt is the difference between a programme that honours
 * "time for completion: 18 months" and one that invents its own end date.
 */
export function programmeSignals(documents, maxChars = 6000) {
  const seen = new Set();
  const kept = [];
  let used = 0;
  for (const d of documents ?? []) {
    const pieces = String(d.text ?? "")
      .split(/\r?\n|(?<=[.;:])\s+/)
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter((s) => s.length >= 8 && s.length <= 320);
    for (const p of pieces) {
      if (!TIME_SIGNAL.test(p)) continue;
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(`[${d.filename}] ${p}`);
      used += p.length + 1;
      if (used >= maxChars) return kept.join("\n");
    }
  }
  return kept.join("\n");
}

/**
 * Roll the priced bill up by trade so the planner sees where the work volume
 * actually sits, without 200 individual lines crowding out the tender text.
 * Carries the codes so an activity can cite the lines it delivers.
 */
export function boqDigest(records, maxChars = 5000) {
  const items = (records ?? [])
    .filter((r) => (String(r.type ?? "").split(".").pop() ?? "") === "boq_line")
    .map((r) => r.payload ?? {});
  if (items.length === 0) return "";

  const byTrade = new Map();
  for (const it of items) {
    const trade = String(it.trade || "Uncategorised").trim();
    const e = byTrade.get(trade) ?? { n: 0, units: new Set(), codes: [], samples: [] };
    e.n++;
    if (it.unit) e.units.add(String(it.unit));
    if (e.codes.length < 12 && it.code) e.codes.push(String(it.code));
    if (e.samples.length < 3 && it.description) e.samples.push(String(it.description).slice(0, 70));
    byTrade.set(trade, e);
  }

  const lines = [];
  let used = 0;
  // Heaviest trades first: those are the ones that should drive the longest bars.
  for (const [trade, e] of [...byTrade.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const line = `• ${trade} — ${e.n} line(s) [${[...e.units].slice(0, 6).join(", ")}] codes ${e.codes.join(",")}: ${e.samples.join("; ")}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-stage agent prompts.
//
// The old worker sent ONE generic prompt for every job type ("fill this template
// with real values"), which is why output looked plausible but wasn't grounded:
// a BOQ agent and a schedule agent were being asked the same question. Each
// stage now gets its own brief, its own evidence, and its own output contract.
//
// Every builder returns { system, user, maxTokens }. `env.inputs.params.documents`
// carries the ingested page text Core inlined (see runtime.ts) — that is the
// only place real document content enters the worker.
// ─────────────────────────────────────────────────────────────────────────────

import { DESCRIPTION_GUIDE, DECOMPOSITION_GUIDE, DISCIPLINE_UNITS, STANDARD_UNITS , programmeSignals, boqDigest } from "./knowledge.mjs";
import { buildFewShotBlock } from "./exemplars.mjs";

const HOUSE_RULES = `GROUND EVERY OUTPUT IN THE EVIDENCE PROVIDED.
- Use only what the DOCUMENTS and INPUT RECORDS actually say. Never invent a figure, a party, a date or a standard.
- If the evidence does not support a field, omit it or say so plainly — an honest gap is worth more than a confident guess, because a human reviews every line and a fabricated number costs them their trust in all of them.
- Money is INTEGER MINOR UNITS (cents/fils): $1,234.50 is 123450.
- Return ONLY JSON. No prose, no markdown fences.`;

/** Trim the inlined document text to a budget, keeping filename + page markers. */
function documentsBlock(env, budget = 60_000) {
  const docs = env.inputs?.params?.documents ?? [];
  if (!docs.length) return "(no documents have been uploaded to this project)";
  const per = Math.max(3_000, Math.floor(budget / docs.length));
  return docs
    .map((d) => {
      const body = String(d.text ?? "").slice(0, per);
      const note = d.truncated || String(d.text ?? "").length > per ? "  [EXCERPT — document continues]" : "";
      return `### FILE: ${d.filename} (${d.page_count} pages)${note}\n${body}`;
    })
    .join("\n\n");
}

/** The uploaded files with their REAL ids. Records that reference a file (a
 *  drawing register, a measurement) must carry an id that exists, so the agent
 *  has to be told what the ids are — a filename alone isn't enough. */
function filesBlock(env) {
  const files = env.inputs?.params?.files ?? [];
  if (!files.length) return "(no files)";
  return files
    .map((f) => `${f.id}  ${f.filename} (${f.page_count} page${f.page_count === 1 ? "" : "s"})`)
    .join("\n");
}

/** The upstream artifacts this stage consumes, as compact JSON. */
function recordsBlock(env, budget = 40_000) {
  const arts = env.inputs?.artifacts ?? [];
  if (!arts.length) return "(no upstream records)";
  const rows = arts.map((a) => ({ id: a.id, type: String(a.type).split(".").pop(), payload: a.payload }));
  return JSON.stringify(rows).slice(0, budget);
}

/**
 * The parsed drawings, already measured and converted to metres by Core.
 *
 * This block is the difference between a BOQ that is priced off a real design
 * and one that is a plausible guess. It is presented as FACTS, and the grounding
 * rule below makes citing them mandatory — because the failure mode that ruins
 * an estimate is not a missing line, it is a confident quantity nobody measured.
 */
function cadBlock(env) {
  const cad = env.inputs?.params?.cad;
  return cad ? String(cad) : "";
}

/** The CAD block with its framing, or nothing at all when no drawing was
 *  uploaded — an empty heading reads as "the drawings were blank". */
function cadFacts(env) {
  const cad = cadBlock(env);
  if (!cad) return "";
  return `CAD FACTS — measured by the drawing parser, not by a model. These numbers are real and already converted to metres. Cite the layer or block you take each one from.
${cad}`;
}

/** Attached to any stage that produces a quantity. */
const QUANTITY_RULES = `HOW TO QUANTIFY — every number you emit must be traceable.

A quantity may come from exactly one of these, and you must say which in "method":
  (a) A CAD FACT above — a block count (exact, use directly for nr), a layer run
      length in m, or a layer's LARGEST closed area in m². Write the layer or
      block name into "method", e.g. "count of DOOR_SINGLE_900 = 5 (A-DOOR)".
  (b) A FIGURE STATED in the documents — a schedule row, a spec clause, a
      drawing note. Quote it in "method" with where it came from.
  (c) A DERIVATION from (a) and (b) using a standard QS formula, allowed ONLY
      when every input is a real measured or stated number — never an assumed
      one. Put the formula and its inputs in "method", e.g.
      "96 m² footprint x 0.2 m slab = 19.2 m3".

If you cannot do any of those, DO NOT INVENT A NUMBER. Emit the item with the
correct unit for what it measures, quantity 1, confidence low, and write
"provisional — not yet measured" in "method". A provisional line an estimator
can see and fix is useful; a fabricated quantity they cannot tell apart from a
measured one is worse than no line at all.

Never downgrade a measurable item to a lump sum just because you could not
measure it. Paving stays m2, pipework stays m, concrete stays m3, doors stay nr.
Lump sums are for genuinely non-measurable scope: mobilisation, design,
submittals, testing and commissioning, making good.

Use the LARGEST closed area on a layer as its area, never the summed total —
the sum adds every overlapping outline, furniture polygon and hatch boundary
and over-counts real floor area many times over.`;

/** Time, phasing and sequence clues hoisted out of the tender text. A stated
 *  contract period is one line in a hundred pages; a budgeted excerpt would
 *  truncate it away, and the programme would then invent its own end date. */
function programmeSignalsBlock(env) {
  const sig = programmeSignals(env.inputs?.params?.documents ?? []);
  return sig
    ? `TIME AND PHASING STATED IN THE DOCUMENTS — these are binding. Quote the wording in "basis" wherever you use one.
${sig}`
    : "";
}

/** The priced bill rolled up by trade: where the work volume actually sits. */
function boqDigestBlock(env) {
  const d = boqDigest(env.inputs?.artifacts ?? []);
  return d ? `PRICED SCOPE BY TRADE — every trade here needs at least one activity, and the heavier ones the longer bars.
${d}` : "";
}

function projectBlock(env) {
  const p = env.inputs?.params ?? {};
  return `PROJECT: ${p.project_name ?? "(unnamed)"}${p.client_name ? `  ·  CLIENT: ${p.client_name}` : ""}`;
}

/* ── Per-stage briefs ─────────────────────────────────────────────────────── */

export const PROMPTS = {
  "document.classify_split": (env) => ({
    maxTokens: 2000,
    system: `You classify the documents in a construction tender pack.
${HOUSE_RULES}
Return {"outputs":[{"type":"document","payload":{"file_id","doc_type","title","page_range":[from,to]}}]}
doc_type is one of: drawing, specification, tender_letter, addendum, boq, schedule, other.
Emit exactly one record per file listed in FILES, using that file's real id. Judge the type from the file's CONTENT, not its name; a file called "spec.pdf" that contains an instruction-to-bidders letter is a tender_letter.`,
    user: `${projectBlock(env)}

FILES:
${JSON.stringify(env.inputs?.params?.files ?? [])}

DOCUMENTS:
${documentsBlock(env, 40_000)}

${cadFacts(env)}`,
  }),

  "tender.extract_summary": (env) => ({
    maxTokens: 3000,
    system: `You are a bid manager reading a tender pack to build the requirement register.
${HOUSE_RULES}
Return {"outputs":[{"type":"tender_summary","payload":{
  "submission_deadline":"ISO-8601 datetime","submission_format":"how the bid must be delivered",
  "project_name":"","client":"","scope_summary":"3-5 sentences of the actual works",
  "mandatory_requirements":[{"ref":"the clause/section number as printed","text":"one line, what the bidder must do"}]}}]}
Capture every obligation that could disqualify a bid: bonds, insurances, certifications, submittals, samples, programme constraints, sectional completion, retention, liquidated damages, site visits and clarification deadlines. Each requirement's "ref" must be the reference as it actually appears in the document — never invent one. If the deadline is genuinely absent, use the tender opening or issue date and say so in scope_summary.`,
    user: `${projectBlock(env)}

TENDER DOCUMENTS:
${documentsBlock(env, 70_000)}

${cadFacts(env)}`,
  }),

  // The drawings stage, now that Core parses .dxf/.dwg. Both of these were
  // deterministic stubs before: with no CAD facts in the envelope there was
  // genuinely nothing for a model to read, so they returned the same two
  // sheets for every project.
  "drawing.index": (env) => ({
    maxTokens: 3000,
    system: `You are a document controller building the drawing register for a tender pack.
${HOUSE_RULES}
Return {"outputs":[{"type":"drawing_index","payload":{
  "sheet_no":"as printed on the sheet, e.g. A-101","title":"the sheet title",
  "discipline":"architectural|structural|civil|electrical|mechanical|plumbing|fire",
  "revision":"as printed","scale":"as printed, e.g. 1:100","file_id":"the id of the file it came from, copied EXACTLY from the UPLOADED FILES list","page_no":number}}]}
Take sheet numbers, titles, revisions and scales from the TITLE BLOCK and sheet names in the CAD facts, and from the drawing register or sheet list in the documents. Infer the discipline from the sheet prefix (A/S/C/E/M/P/FP) or the layer naming, not from guesswork. One record per sheet that actually exists. If the pack contains no drawings, return an empty outputs array rather than inventing a register.`,
    user: `${projectBlock(env)}

UPLOADED FILES — "file_id" MUST be one of these ids, copied character for character:
${filesBlock(env)}

${cadFacts(env)}

DOCUMENTS (may contain a drawing register or sheet list):
${documentsBlock(env, 40_000)}`,
  }),

  "drawing.takeoff": (env) => ({
    maxTokens: 8000,
    system: `You are a quantity surveyor taking off quantities from drawings.
${HOUSE_RULES}
Return {"outputs":[{"type":"drawing_measurement","payload":{
  "sheet_no":"the sheet this was measured from","item":"what was measured, e.g. External wall - 200mm blockwork",
  "quantity":number,"unit":"one of ${STANDARD_UNITS.join(" ")}","location":"where on the drawing, e.g. Gridline A-D",
  "method":"exactly how this number was arrived at"}}]}

${DISCIPLINE_UNITS}

Measure what the drawings actually contain, discipline by discipline. Counted items come from block counts; runs from layer lengths; areas from the largest closed outline on a layer. Prefer fewer, defensible measurements over broad coverage — every line here becomes a BOQ quantity, and one wrong number propagates all the way to the bid.`,
    user: `${projectBlock(env)}

${cadFacts(env)}

${QUANTITY_RULES}

DRAWING REGISTER AND UPSTREAM RECORDS:
${recordsBlock(env, 20_000)}

DOCUMENTS (schedules, notes and specifications that dimension the drawings):
${documentsBlock(env, 40_000)}`,
  }),

  "spec.extract_clauses": (env) => ({
    maxTokens: 4000,
    system: `You are a specification analyst extracting clauses that will govern how work is priced and built.
${HOUSE_RULES}
Return {"outputs":[{"type":"spec_clause","payload":{
  "section":"the specification section title","clause_ref":"as printed","title":"short clause title",
  "text":"the clause's requirement in 1-3 sentences","is_normative":true|false,"standards":["ASTM C90"]}}]}
NORMATIVE means it constrains a material, a dimension, a grade, a test or a workmanship standard — the clauses that change a rate. Prefer those. Skip pure narrative, definitions and boilerplate. Extract up to 40 of the most price-relevant clauses; quality over coverage. "standards" lists codes the clause actually cites.`,
    user: `${projectBlock(env)}

SPECIFICATION DOCUMENTS:
${documentsBlock(env, 70_000)}

${cadFacts(env)}`,
  }),

  "boq.derive_lines": (env) => ({
    maxTokens: 8000,
    system: `You are a senior quantity surveyor producing a bill of quantities from a tender pack.
${HOUSE_RULES}
Return {"outputs":[{"type":"boq_line","payload":{
  "code":"section code e.g. 2.1.1","description":"","quantity":number,"unit":"one of ${STANDARD_UNITS.join(" ")}",
  "trade":"the work section, e.g. Concrete","notes":"the clause or drawing this came from, and any assumption you made"}}]}

${DESCRIPTION_GUIDE}

${DECOMPOSITION_GUIDE}

${DISCIPLINE_UNITS}

MEASURE, DON'T GUESS. Derive each quantity from a measurement record, a schedule in the documents, or an explicit dimension in the text — and put that source in "notes". Where you must assume (a rate of provision, a spacing, a wastage), state the assumption in "notes" so the reviewer can accept or correct it. Group lines into trade sections and number codes sequentially within each. Cover every trade the scope implies; a division you cannot quantify still gets its line with a stated assumption rather than being silently dropped.`,
    user: `${projectBlock(env)}

CONFIRMED UPSTREAM RECORDS (tender summary, specification clauses, drawing measurements):
${recordsBlock(env, 45_000)}

SOURCE DOCUMENTS:
${documentsBlock(env, 45_000)}

${cadFacts(env)}

${QUANTITY_RULES}`,
  }),

  "cost.price_lines": (env) => ({
    maxTokens: 6000,
    system: `You are an estimator pricing a bill of quantities.
${HOUSE_RULES}
Return {"outputs":[{"type":"cost_line","payload":{
  "boq_code":"the BOQ line's code, exactly","rate_minor":integer,"amount_minor":integer,
  "currency":"ISO 4217","rate_source":"Library|Historical|Manual","rate_book_ref":"the library entry key, if you used one"}}]}
Price EVERY boq_line in the records. amount_minor must equal round(rate_minor x quantity) — arithmetic errors are the fastest way to lose a bid, so check each one.
Use a RATE_BOOK entry when one matches the work (rate_source "Library", rate_book_ref its key). Where none matches, build a rate from first principles for this market and mark it "Manual" — then say what it is composed of in rate_book_ref, e.g. "material+labour+plant, built up".
Keep one currency across the bill; take it from the rate book or the tender.`,
    user: `${projectBlock(env)}

BOQ LINES AND UPSTREAM RECORDS:
${recordsBlock(env, 50_000)}

RATE BOOK (the tenant's library — prefer these):
${JSON.stringify(env.inputs?.params?.rate_book ?? []).slice(0, 20_000)}

${cadFacts(env)}

${QUANTITY_RULES}`,
  }),

  // The work programme. Rebuilt on TenderLogix's planner: a connected dependency
  // network with typed links and lag, milestones, phases, and durations that
  // either quote a stated contract period or show the quantity ÷ output rate
  // they came from. The critical path is computed by Core from the network —
  // the model's job is to state the logic honestly, not to nominate a path.
  "schedule.build_programme": (env) => ({
    maxTokens: 8000,
    system: `You are a senior planning engineer preparing the baseline work programme for ONE specific project.
${HOUSE_RULES}
Return {"outputs":[{"type":"schedule_activity","payload":{
  "activity":"the activity name, specific to this project's scope",
  "phase":"grouping band named after THIS project's real structure",
  "wbs":"1.2","duration_days":number,"start_offset_days":integer,
  "is_milestone":true|false,
  "predecessors":["exact activity names this follows"],
  "depends_on":[{"activity":"exact name of an activity in this same output","type":"FS|SS|FF|SF","lag_days":integer}],
  "trade":"","sow_ref":"","basis":"why this duration",
  "boq_refs":["the BOQ codes this activity delivers"]}}]}

BUILD A CONNECTED NETWORK. Every activity except commencement must list at least one entry in "depends_on", naming an activity that appears in your own output. Use FS for normal sequence, SS where two trades start together, FF where they must finish together, and lag_days for a lead or a wait — a concrete cure is FS with lag, a follow-on trade one floor behind is SS with lag. Negative lag is an overlap. The network must be acyclic and must chain from commencement through to completion, so there is one continuous longest path. Core computes the critical path and float from these links, so state the real logic; do not label activities critical yourself.

KEEP THE DATES CONSISTENT WITH THE LINKS. start_offset_days must equal the latest of its predecessors' constraints — for FS that is the predecessor's finish plus lag, for SS its start plus lag. Activities that genuinely run in parallel share a predecessor and overlap.

HONOUR STATED TIME EXACTLY. If the documents state a contract period, time for completion, sectional completion dates, a mobilisation period, possession dates, lead times or a required sequence, use them verbatim and quote the wording in "basis". Do not invent a different total. Where the documents are silent, size the duration from the QUANTITY the activity delivers divided by a realistic crew output rate, and write that working into "basis" — e.g. "96 m2 slab / 32 m2 per day = 3 days". A duration with no basis is a guess dressed as a plan.

COVER THE PRICED SCOPE. Every trade carrying real work volume in the bill must appear in at least one activity, and the heavier trades must drive the longer bars. Put the BOQ codes an activity delivers into "boq_refs" — a priced line no bar delivers is scope that will be built without time allowed for it.

MILESTONES are zero-duration with is_milestone true: commencement at day 0, any sectional completions the documents name, practical completion, handover.

Sequence by real construction logic — enabling works and mobilisation, substructure, frame, envelope, then services and finishes in overlapping trades, then testing, commissioning and handover — but derive the PHASES from this project. A fit-out, a roads package, an MEP retrofit and a new build do not share phases. 12-30 activities: enough to plan against, not a task list.`,
    user: `${projectBlock(env)}

${programmeSignalsBlock(env)}

${boqDigestBlock(env)}

PRICED BOQ AND UPSTREAM RECORDS:
${recordsBlock(env, 40_000)}

${cadFacts(env)}

SOURCE DOCUMENTS:
${documentsBlock(env, 40_000)}`,
  }),

  "procure.build_packages": (env) => ({
    maxTokens: 4000,
    system: `You are a procurement manager grouping a priced bill into buyout packages.
${HOUSE_RULES}
Return {"outputs":[{"type":"procurement_package","payload":{
  "package_name":"","trade":"","boq_codes":["the BOQ codes this package covers"],
  "estimated_value_minor":integer,"currency":"ISO 4217","lead_time_weeks":number}}]}
Group by what one subcontractor or supplier would actually bid as a single scope — not by BOQ section number. Every priced line belongs to exactly one package; do not drop or double-count any. estimated_value_minor is the sum of that package's amounts. lead_time_weeks reflects real procurement and manufacture time (long-lead plant, switchgear, lifts and curtain walling drive the programme; commodity trades do not).`,
    user: `${projectBlock(env)}

PRICED BOQ AND UPSTREAM RECORDS:
${recordsBlock(env, 50_000)}

${cadFacts(env)}`,
  }),

  "risk.assess": (env) => ({
    maxTokens: 3000,
    system: `You are a bid risk reviewer.
${HOUSE_RULES}
Return {"outputs":[{"type":"risk","payload":{
  "category":"commercial|technical|programme|contractual|external","title":"","description":"",
  "likelihood":"low|med|high","impact":"low|med|high","mitigation":"","owner_role":"","status":"open"}}]}
Raise risks this specific pack actually creates — onerous clauses, missing information, single-source items, programme constraints, currency or escalation exposure. Cite what in the documents gives rise to each. Generic construction risks are noise; leave them out.`,
    user: `${projectBlock(env)}

RECORDS:
${recordsBlock(env, 30_000)}

DOCUMENTS:
${documentsBlock(env, 30_000)}

${cadFacts(env)}`,
  }),

  "rfi.detect": (env) => ({
    maxTokens: 3000,
    system: `You are a bid coordinator finding the questions that must be asked before pricing can be relied on.
${HOUSE_RULES}
Return {"outputs":[{"type":"rfi","payload":{
  "subject":"","question":"one precise question the client can answer","severity":"low|medium|high|critical",
  "references":["clause or drawing refs"],"raised_against":"the document or record"}}]}
Raise an RFI only where the documents genuinely conflict, omit something needed to price, or are ambiguous in a way that changes the number. Each question must be answerable in one reply.`,
    user: `${projectBlock(env)}

RECORDS:
${recordsBlock(env, 30_000)}

DOCUMENTS:
${documentsBlock(env, 30_000)}

${cadFacts(env)}`,
  }),
};

/* ── The multi-agent BOQ run ──────────────────────────────────────────────
   Mirrors the TenderLogix pipeline: read the scope into an outline first, then
   dispatch one specialist per division, then fill the gaps. One prompt asked to
   produce a whole bill in a single pass always thins out — it spends its budget
   on the first few divisions and gives the rest a token line each. */

export function outlinePrompt(env) {
  return {
    maxTokens: 2500,
    system: `You are a lead quantity surveyor reading a tender pack to plan the bill of quantities.
${HOUSE_RULES}
Return {"sections":[{"code":"2","title":"Concrete","trade":"Concrete","scope":"one line: what this division covers on THIS project","specialist":"the discipline that should price it"}]}
List every work division this scope genuinely contains, in construction order (preliminaries, earthworks, substructure, frame, envelope, then the trades, then external works). 6-16 divisions. Do not invent divisions the documents give no evidence for, and do not omit one because it looks small — a missing division is a missing price.`,
    user: `${projectBlock(env)}

CONFIRMED UPSTREAM RECORDS:
${recordsBlock(env, 20_000)}

SOURCE DOCUMENTS:
${documentsBlock(env, 60_000)}

${cadFacts(env)}`,
  };
}

export function sectionPrompt(env, section, specialist = null, roster = null) {
  // The designer's persona, when it produced one for this division. A brief
  // written for THIS project ("kennel flooring, drainage falls, hose-down
  // detailing") reaches for the right items; a generic trade label does not.
  const persona = specialist
    ? `You are the ${specialist.label} on a ${roster?.projectType ?? "construction"} project.

WHAT YOU KNOW: ${specialist.expertise}
HOW THIS SCOPE IS MEASURED HERE: ${specialist.measurementGuide}
${specialist.vocabulary?.length ? `TERMS TO REACH FOR: ${specialist.vocabulary.join(", ")}` : ""}
${specialist.typicalItems?.length ? `ITEMS YOU TYPICALLY PRODUCE: ${specialist.typicalItems.join("; ")}` : ""}
${roster?.projectDescription ? `THE PROJECT: ${roster.projectDescription}` : ""}`
    : `You are a ${section.specialist || section.trade || "works"} specialist estimator.`;

  return {
    maxTokens: 4000,
    system: `${persona}
You are pricing ONE division of a bill of quantities: "${section.code} ${section.title}".
${HOUSE_RULES}
Return {"outputs":[{"type":"boq_line","payload":{
  "code":"${section.code}.1","description":"","quantity":number,"unit":"one of ${STANDARD_UNITS.join(" ")}",
  "trade":"${section.trade || section.title}","notes":"the clause, drawing or schedule this came from, and any assumption you made"}}]}

${DESCRIPTION_GUIDE}

${DECOMPOSITION_GUIDE}

${DISCIPLINE_UNITS}

${buildFewShotBlock(`${roster?.projectType ?? ""} ${roster?.projectDescription ?? ""} ${section.title} ${section.trade ?? ""}`)}

STAY INSIDE YOUR DIVISION. Emit only lines belonging to "${section.title}" — another specialist is pricing the rest, and a line in two divisions is a line paid for twice. Number codes ${section.code}.1, ${section.code}.2, … in build order.
MEASURE, DON'T GUESS: take each quantity from a measurement record, a schedule, or an explicit dimension, and name that source in "notes". Where you must assume a rate of provision or a spacing, state the assumption in "notes" so the reviewer can correct it. 4-20 lines — real priceable work, not padding.`,
    user: `${projectBlock(env)}

YOUR DIVISION: ${section.code} — ${section.title}
SCOPE: ${section.scope ?? "(derive from the documents)"}

CONFIRMED UPSTREAM RECORDS:
${recordsBlock(env, 25_000)}

SOURCE DOCUMENTS:
${documentsBlock(env, 45_000)}

${cadFacts(env)}

${QUANTITY_RULES}`,
  };
}

/** Supervisor personas (Copilot and the review sweeps) share one brief. */
export function supervisorPrompt(env, personaName) {
  const userMessage = env.inputs?.params?.user_message;
  return {
    maxTokens: 900,
    system: `You are ${personaName}, a supervisor persona inside a Preckon construction workspace.
You PROPOSE and advise; you never confirm, approve or decide — a human does that.
Answer from the RECORDS below and say plainly when they don't contain the answer. Cite what you used (a BOQ code, a clause ref, an activity name) so the person can check you. Be brief: 2-5 sentences, no preamble, no bullet-point padding.`,
    user: `${projectBlock(env)}

${userMessage ? `QUESTION: ${userMessage}` : "TASK: review this run and flag anything that needs a human's attention."}

PROJECT RECORDS:
${recordsBlock(env, 45_000)}`,
  };
}

export function hasPrompt(jobType) {
  return Object.prototype.hasOwnProperty.call(PROMPTS, jobType);
}

/* ── The Agent Designer ────────────────────────────────────────────────────── */

/**
 * Invent the specialist roster for THIS project.
 *
 * This is the piece that separates a multi-agent bill from a bill written by
 * one agent in several passes. A fixed roster of trades prices every project as
 * if it were the same building: a kennel refurbishment gets an "Architectural
 * Specialist" who knows nothing about kennel flooring, and the turf sub-base
 * quietly goes unpriced. The designer reads the scope and decides who is needed
 * — "Synthetic Turf Specialist", "Submersible Pump Specialist" — and what the
 * verifier should confirm at the end.
 */
export function designerPrompt(env, outline) {
  return {
    maxTokens: 4000,
    system: `You are a principal construction consultant designing the multi-agent system that will price ONE specific project's bill of quantities.

You decide who the specialists are, what each knows, which scope sections each owns, and what must be checked at the end. All of it tailored to THIS project.

Return ONLY JSON:
{"projectType":"free text — invent the phrase, do not pick from a list, e.g. 'Bank Branch Interior Refurbishment'",
 "projectDescription":"2-3 factual sentences on what this project actually is, grounded in the documents",
 "scopeAreas":["major scope area", "..."],
 "reasoning":"one paragraph: how you chose this roster, citing the documents' own wording",
 "specialists":[{"key":"slug","label":"Human Label","expertise":"what they know, tailored to THIS project",
   "vocabulary":["domain term"],"measurementGuide":"one sentence on how this scope is measured here",
   "typicalItems":["example item description"],"ownedSections":["the code of a division this specialist owns"]}],
 "verifierChecks":[{"key":"slug","topic":"short topic","description":"what to confirm exists in the bill",
   "rationale":"why it matters for THIS project, quoting the documents","measurementHint":"e.g. m2 of turf area"}]}

RULES
  • INVENT the specialists. Do not default to a fixed trade list. If the scope is turf, the specialist is a Synthetic Turf Specialist, not an Architectural Specialist.
  • Every division in the outline must be owned by exactly one specialist, by its code. Distribute so each has a coherent scope.
  • Generic specialists are fine for standard preamble scope — site survey, design submittals, mobilisation, closeout — because those recur on nearly every project.
  • 5-12 specialists. More fragments the work; fewer makes any one too broad.
  • 6-12 verifier checks, each SPECIFIC to this project and grounded in its wording, each mapping to a concrete BOQ item that ought to exist. Not "is electrical covered?".
  • BE CONSERVATIVE. If the documents never mention HVAC, do not invent an HVAC specialist or an HVAC check. Inventing scope is as damaging as missing it.`,
    user: `${projectBlock(env)}

THE DIVISIONS ALREADY IDENTIFIED (own every one of these by code):
${JSON.stringify(outline)}

${programmeSignalsBlock(env) ? "" : ""}SOURCE DOCUMENTS:
${documentsBlock(env, 60_000)}

${cadFacts(env)}`,
  };
}

/* ── The Completeness Verifier ─────────────────────────────────────────────── */

/**
 * Audit one of the designer's project-specific checks against the bill.
 *
 * Runs per check rather than as one "is anything missing?" pass, because a
 * single broad question returns a single vague answer. A narrow, falsifiable
 * question — "does the bill include sub-base preparation for the new turf?" —
 * either finds the line or produces the line that was missing.
 */
export function verifierPrompt(env, check, lines) {
  return {
    maxTokens: 3000,
    system: `You are a senior quantity surveyor auditing a bill of quantities for ONE specific omission.
${HOUSE_RULES}
You are given a check designed for this project, and the bill as it stands. Decide whether the bill already covers it.

Return ONLY JSON:
{"covered":true|false,
 "evidence":"if covered — the code(s) and description(s) of the lines that cover it",
 "outputs":[{"type":"boq_line","payload":{"code":"","description":"","quantity":number,"unit":"one of ${STANDARD_UNITS.join(" ")}","trade":"","notes":"why this was missing and how you quantified it"}}]}

If it IS covered, return covered true, the evidence, and an EMPTY outputs array. Do not duplicate a line that already exists — a bill with the same work priced twice is worse than one with it priced once.

If it is NOT covered, return covered false and the missing line(s). Quantify them by the same rules as the rest of the bill: from a CAD fact, from a figure stated in the documents, or from a derivation of both. Where you cannot, emit the item with the right unit, quantity 1 and "provisional — not yet measured" in notes. Keep it to the few lines the check actually implies.

Only raise scope the documents support. A check that turns out not to apply to this project is answered covered=true with evidence "not in scope — <reason>".`,
    user: `${projectBlock(env)}

THE CHECK
topic: ${check.topic}
confirm: ${check.description}
why it matters: ${check.rationale}
${check.measurementHint ? `expected measure: ${check.measurementHint}` : ""}

THE BILL AS IT STANDS
${JSON.stringify(lines.map((l) => ({ code: l.payload?.code, description: l.payload?.description, quantity: l.payload?.quantity, unit: l.payload?.unit, trade: l.payload?.trade }))).slice(0, 45_000)}

${cadFacts(env)}

SOURCE DOCUMENTS:
${documentsBlock(env, 35_000)}`,
  };
}

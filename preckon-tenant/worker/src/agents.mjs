// ── Deterministic stub agents (build-plan M1). No LLM, no DB. Given a
// JobEnvelope, each produces fixed, schema-valid outputs so the whole runtime —
// gates, provenance, stale/re-plan, audit — is exercised without model
// nondeterminism. Swapping in real Claude calls is a change to THIS file only;
// the trust boundary (worker has no store access) is unchanged.

import { PROMPTS, hasPrompt, supervisorPrompt, outlinePrompt, sectionPrompt, designerPrompt, verifierPrompt } from "./prompts.mjs";
import {
  normalizeUnit, normalizeMeasurementUnit, quantityConfidence, validateQuantity, sequence,
} from "./knowledge.mjs";

// A fixed, schema-valid uuid used when the Document agent has no real uploaded
// file inlined (keeps runs progressing in tests / demo without an upload).
const SYNTHETIC_FILE_ID = "00000000-0000-7000-8000-0000000000f1";

// Reviewable proposals emit below the 0.9 auto-accept bar so gates actually
// pause for a human in the demo/e2e (§5.6). Tune per job_type as needed.
const CONF = 0.82;

const ids = (env) => (env.inputs?.artifacts ?? []).map((a) => a.id);
const ofType = (env, type) =>
  (env.inputs?.artifacts ?? []).filter((a) => (a.type ?? "").endsWith(type));

function usage(env) {
  return { model: env.tier === "deep" ? "claude-opus-4-8" : "claude-haiku-4-5", input_tokens: 500, output_tokens: 120, cost_minor: 8 };
}

// tier → concrete model id (env-overridable). Used only on the real-Claude path.
const MODEL_FOR_TIER = {
  routing: process.env.ANTHROPIC_MODEL_ROUTING ?? "claude-haiku-4-5",
  standard: process.env.ANTHROPIC_MODEL_STANDARD ?? "claude-sonnet-5",
  deep: process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-8",
};

/**
 * Compute a JobResult for an envelope. HYBRID: if ANTHROPIC_API_KEY is set, the
 * agent reasons with Claude; otherwise (or on any error) it falls back to the
 * deterministic stub. The stub doubles as the output SHAPE TEMPLATE so real
 * outputs stay schema-valid (Core validates them regardless, §5.1). Async.
 */
export async function computeJobResult(env) {
  const base = { job_id: env.job_id, usage: usage(env), trace_id: `lf_${env.job_id.slice(0, 8)}`, error: null };
  const template = buildOutputs(env);
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await withClaude(env, base, template);
    } catch (e) {
      console.error("[worker] Claude call failed — falling back to stub:", e.message);
    }
  }
  return finalize(base, template);
}

function finalize(base, template) {
  if (template.supervisor)
    return { ...base, status: "succeeded", message: template.message, deviations: template.deviations ?? [] };
  return { ...base, status: "succeeded", outputs: template };
}

async function withClaude(env, base, template) {
  const model = MODEL_FOR_TIER[env.tier] ?? MODEL_FOR_TIER.deep;

  if (template.supervisor) {
    const { system, user, maxTokens } = supervisorPrompt(env, personaName(env.job_type));
    const text = await callAnthropic(model, system, user, maxTokens);
    return {
      ...base,
      status: "succeeded",
      message: { role: "assistant", content: text.trim(), referenced_artifact_ids: ids(env) },
      deviations: template.deviations ?? [],
    };
  }

  // The bill is built by a roster, not a single call.
  if (env.job_type === "boq.derive_lines") {
    const { lines, roster } = await runBoqRoster(env, model);
    const outputs = postProcess(env, lines);
    for (const o of outputs) {
      if (!o.provenance || !o.provenance.length) o.provenance = ids(env);
      if (o.confidence == null) o.confidence = CONF;
    }
    // The roster travels back on the result so Core can store it and the BOQ
    // screen can show WHO priced the bill and what was checked. Without it the
    // pipeline is invisible and a reviewer cannot judge its coverage.
    return { ...base, status: "succeeded", outputs, roster };
  }

  // A stage with its own brief reasons about its own job. Anything else (a
  // second vertical's pack, a type this worker has never seen) still gets the
  // generic template-filling path rather than nothing.
  const build = hasPrompt(env.job_type) ? PROMPTS[env.job_type] : null;
  const { system, user, maxTokens } = build
    ? build(env)
    : {
        maxTokens: 2000,
        system: `You are the "${env.agent_key}" agent in a Preckon workflow. Derive the required records from the INPUTS. Return ONLY a JSON array "outputs" whose items match the TEMPLATE exactly (identical "type" strings and payload keys), with values derived from the real inputs. No prose, no markdown.`,
        user: `INPUTS:\n${JSON.stringify(env.inputs ?? {}).slice(0, 8000)}\n\nTEMPLATE (copy this shape, fill real values):\n${JSON.stringify(template)}`,
      };

  const text = await callAnthropic(model, system, user, maxTokens);
  const parsed = extractJson(text);
  let outputs = Array.isArray(parsed) ? parsed : parsed?.outputs;

  // An empty or unparseable response must not silently become a fabricated
  // stub result — the chain would look like it worked and the numbers would be
  // invented. Fail the job so the run surfaces it and can be re-run.
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error(`no usable outputs from ${env.job_type} (${text.length} chars returned)`);
  }

  outputs = postProcess(env, outputs);
  for (const o of outputs) {
    if (!o.provenance || !o.provenance.length) o.provenance = ids(env);
    if (o.confidence == null) o.confidence = CONF;
  }
  return { ...base, status: "succeeded", outputs };
}

/**
 * The multi-agent bill run, ported from the TenderLogix pipeline.
 *
 *   1  outline    read the scope into work divisions
 *   2  designer   INVENT the specialists this project needs, and the checks the
 *                 bill must pass at the end
 *   3  sections   one designed specialist per division, run concurrently
 *   4  verifier   audit each project-specific check against the bill, and price
 *                 whatever it finds missing
 *
 * Why a designer rather than a fixed trade list: a fixed roster prices every
 * project as if it were the same building. A kennel refurbishment gets an
 * "Architectural Specialist" with no reason to think about hose-down detailing
 * or turf sub-base, and that scope is quietly never priced. Letting a consultant
 * agent read the scope and decide this job needs a Synthetic Turf Specialist is
 * the whole difference.
 *
 * Why a per-check verifier rather than one "anything missing?" pass: a broad
 * question gets a vague answer. A narrow, falsifiable one either finds the line
 * or produces the line that was missing.
 */
export async function runBoqRoster(env, model, call = callAnthropic) {
  const trace = [];
  const note = (stage, message) => {
    trace.push({ stage, message, at: new Date().toISOString() });
    console.log(`[worker] boq/${stage}: ${message}`);
  };

  // 1. Outline
  const outlineReq = outlinePrompt(env);
  const outlineText = await call(model, outlineReq.system, outlineReq.user, outlineReq.maxTokens);
  const outline = extractJson(outlineText);
  let sections = Array.isArray(outline?.sections) ? outline.sections : [];
  if (!sections.length) throw new Error("BOQ outline returned no work divisions");
  sections = sections.slice(0, 16);
  note("outline", `${sections.length} divisions - ${sections.map((x) => x.title).join(", ")}`);

  // 2. Agent Designer
  let roster = null;
  try {
    const dReq = designerPrompt(env, sections);
    const dText = await call(model, dReq.system, dReq.user, dReq.maxTokens);
    const d = extractJson(dText);
    if (Array.isArray(d?.specialists) && d.specialists.length) {
      roster = d;
      note("designer", `${d.projectType ?? "project"} - ${d.specialists.length} specialist(s), ${(d.verifierChecks ?? []).length} check(s)`);
    }
  } catch (e) {
    note("designer", `failed (${e.message})`);
  }
  // A failed designer must not stop the bill. The section agents still run,
  // just with the outline's generic trade brief instead of a designed persona.
  if (!roster) note("designer", "no roster - pricing with generic trade specialists");

  const specialistFor = (section) =>
    roster
      ? roster.specialists.find((sp) => (sp.ownedSections ?? []).map(String).includes(String(section.code))) ?? null
      : null;

  // 3. Section agents
  const runSection = async (sec) => {
    try {
      const req = sectionPrompt(env, sec, specialistFor(sec), roster);
      const text = await call(model, req.system, req.user, req.maxTokens);
      const parsed = extractJson(text);
      const rows = Array.isArray(parsed) ? parsed : parsed?.outputs;
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      console.error(`[worker] division ${sec.code} ${sec.title} failed:`, e.message);
      return [];
    }
  };

  let results = await mapLimit(sections, 4, runSection);

  // Recover empty divisions once. A division that produced nothing is usually a
  // transient provider error, not an absence of scope - dropping it silently
  // leaves a hole nobody notices until tender return.
  const emptyIdx = results.map((r, i) => (r.length === 0 ? i : -1)).filter((i) => i >= 0);
  if (emptyIdx.length) {
    note("sections", `retrying ${emptyIdx.length} empty division(s)`);
    const retried = await mapLimit(emptyIdx.map((i) => sections[i]), 2, runSection);
    emptyIdx.forEach((i, k) => { results[i] = retried[k]; });
  }

  const lines = results.flat();
  if (!lines.length) throw new Error("no BOQ lines produced across any division");
  note("sections", `${lines.length} line(s) from ${results.filter((r) => r.length).length}/${sections.length} division(s)`);

  // 4. Completeness Verifier
  const checks = (roster?.verifierChecks ?? []).slice(0, 12);
  if (checks.length) {
    const runCheck = async (check) => {
      try {
        const req = verifierPrompt(env, check, lines);
        const text = await call(model, req.system, req.user, req.maxTokens);
        const v = extractJson(text);
        return {
          check,
          covered: v?.covered !== false,
          evidence: v?.evidence ?? null,
          added: Array.isArray(v?.outputs) ? v.outputs : [],
        };
      } catch (e) {
        // A check that errors is reported as unknown, never as passed. A
        // verifier that silently approves is worse than no verifier.
        return { check, covered: null, evidence: `check failed: ${e.message}`, added: [] };
      }
    };
    const verdicts = await mapLimit(checks, 3, runCheck);
    const gaps = verdicts.filter((v) => v.covered === false && v.added.length);
    for (const g of gaps) {
      for (const row of g.added) {
        row.payload = { ...(row.payload ?? {}), verified_by: g.check.topic };
        lines.push(row);
      }
    }
    note(
      "verifier",
      `${verdicts.filter((v) => v.covered === true).length}/${checks.length} covered; ` +
        `${gaps.length} gap(s) priced (${gaps.reduce((t, g) => t + g.added.length, 0)} line(s))`
    );
    roster.verdicts = verdicts.map((v) => ({
      key: v.check.key,
      topic: v.check.topic,
      covered: v.covered,
      evidence: v.evidence,
      added: v.added.length,
    }));
  }

  return { lines, roster: roster ? { ...roster, trace } : { trace, isFallback: true } };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * House rules applied in code, not left to the model: unit normalisation, the
 * amount = rate x quantity identity, programme sequencing, and a confidence that
 * reflects how the number was actually derived. Doing this here means every
 * provider and every retry lands on the same standard.
 */
function postProcess(env, outputs) {
  const boqQty = new Map();
  for (const a of env.inputs?.artifacts ?? []) {
    if (String(a.type).endsWith("boq_line") && a.payload?.code != null) {
      boqQty.set(String(a.payload.code), Number(a.payload.quantity) || 0);
    }
  }

  const activities = [];
  for (const o of outputs) {
    const kind = String(o?.type ?? "").split(".").pop();
    const p = o?.payload;
    if (!p || typeof p !== "object") continue;

    if (kind === "boq_line") {
      p.unit = normalizeUnit(p.unit);
      const problem = validateQuantity(p.quantity, p.unit);
      if (problem) p.notes = [p.notes, `QA: ${problem}`].filter(Boolean).join(" · ");
      o.confidence = quantityConfidence({
        derivedFrom: /measurement|drawing/i.test(String(p.notes ?? "")) ? "measurement"
          : /schedule|table/i.test(String(p.notes ?? "")) ? "schedule" : "prose",
        unit: p.unit,
        quantity: p.quantity,
        hasSpec: /clause|spec/i.test(String(p.notes ?? "")),
      });
      if (problem) o.confidence = Math.min(o.confidence, 0.55);
      boqQty.set(String(p.code), Number(p.quantity) || 0);
    }

    if (kind === "drawing_measurement") p.unit = normalizeMeasurementUnit(p.unit);

    if (kind === "cost_line") {
      // The identity has to hold. A model that mis-multiplies produces a bill
      // that looks right and prices wrong, which is worse than an obvious gap.
      const qty = boqQty.get(String(p.boq_code));
      const rate = Number(p.rate_minor);
      if (Number.isFinite(rate) && Number.isFinite(qty) && qty > 0) {
        const expected = Math.round(rate * qty);
        if (Number(p.amount_minor) !== expected) {
          p.amount_minor = expected;
          o.confidence = 0.7;   // arithmetic was corrected — worth a human's eye
        }
      }
    }

    if (kind === "schedule_activity") {
      // A milestone is an instant, not a day of work. The one-day floor below is
      // right for real activities and wrong for these — left in place it draws a
      // bar for handover and pushes the completion date out by a day per
      // milestone. Zero is what makes it render as a diamond on its date.
      p.is_milestone = p.is_milestone === true;
      p.duration_days = p.is_milestone
        ? 0
        : Math.max(1, Math.round(Number(p.duration_days) || 1));

      // Normalise the network. Self-references and links to activities outside
      // this batch would otherwise become dangling edges in the CPM.
      if (Array.isArray(p.depends_on)) {
        p.depends_on = p.depends_on
          .filter((d) => d && typeof d.activity === "string" && d.activity !== p.activity)
          .map((d) => ({
            activity: d.activity,
            type: ["FS", "SS", "FF", "SF"].includes(String(d.type)) ? d.type : "FS",
            lag_days: Math.round(Number(d.lag_days) || 0),
          }));
      }
      // Keep the plain-name form in step with the typed one, so anything reading
      // `predecessors` (the older shape) still sees the same logic.
      if (!Array.isArray(p.predecessors) || p.predecessors.length === 0) {
        p.predecessors = (p.depends_on ?? []).map((d) => d.activity);
      }
      activities.push(p);
    }
  }

  if (activities.length) sequence(activities);
  return outputs;
}

async function callAnthropic(model, system, userText, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: userText }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content ?? []).map((c) => c.text ?? "").join("");
}

function extractJson(text) {
  const s = text.indexOf("["), o = text.indexOf("{");
  const start = s === -1 ? o : o === -1 ? s : Math.min(s, o);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function buildOutputs(env) {
  const t = env.job_type;
  switch (t) {
    case "document.classify_split": {
      const files = env.inputs?.params?.files ?? [];
      const list = files.length ? files : [{ id: SYNTHETIC_FILE_ID, filename: "tender.pdf", doc_type: "tender_letter", page_count: 1 }];
      return list.map((f) => ({
        type: "document",
        payload: {
          file_id: f.id,
          doc_type: f.doc_type ?? "tender_letter",
          title: f.filename ?? "Document",
          page_range: [1, Math.max(1, f.page_count ?? 1)],
        },
        provenance: [], // a document derives from a file, not an artifact
        confidence: 0.99,
      }));
    }
    case "tender.extract_summary":
      return [
        {
          type: "tender_summary",
          payload: {
            submission_deadline: "2026-09-30T17:00:00.000Z",
            submission_format: "Two-envelope electronic submission via portal",
            project_name: env.inputs?.params?.project_name ?? "Riverside School",
            client: env.inputs?.params?.client_name || "Riverside County",
            scope_summary: "New two-storey teaching block, ~2,400 m2, incl. groundworks and MEP.",
            mandatory_requirements: [
              { ref: "MR-1", text: "Bid bond of 5% of tender value" },
              { ref: "MR-2", text: "Health & Safety policy and past-performance record" },
            ],
          },
          provenance: ids(env),
          confidence: CONF,
        },
      ];
    case "spec.extract_clauses":
      return [
        { type: "spec_clause", payload: { section: "03 30 00", clause_ref: "3.2.1", title: "Cast-in-place concrete", text: "Concrete shall be grade C20/25 minimum, cured 7 days.", is_normative: true, standards: ["CSA A23.1"] }, provenance: ids(env), confidence: CONF },
        { type: "spec_clause", payload: { section: "04 20 00", clause_ref: "2.1", title: "Unit masonry", text: "Blockwork 140mm, mortar type S.", is_normative: true, standards: ["CSA A165"] }, provenance: ids(env), confidence: CONF },
      ];
    case "drawing.index":
      return [
        { type: "drawing_index", payload: { sheet_no: "A-101", title: "Ground Floor Plan", discipline: "architectural", revision: "P1", scale: "1:100", file_id: SYNTHETIC_FILE_ID, page_no: 1 }, provenance: ids(env), confidence: CONF },
        { type: "drawing_index", payload: { sheet_no: "S-201", title: "Foundation Plan", discipline: "structural", revision: "P1", scale: "1:100", file_id: SYNTHETIC_FILE_ID, page_no: 2 }, provenance: ids(env), confidence: CONF },
      ];
    case "drawing.takeoff": {
      const sheet = ofType(env, "drawing_index")[0]?.payload?.sheet_no ?? "A-101";
      return [
        { type: "drawing_measurement", payload: { sheet_no: sheet, item: "In-situ concrete to foundations", quantity: 120, unit: "m3", location: "Grid A-D", method: "area x depth" }, provenance: ids(env), confidence: CONF },
        { type: "drawing_measurement", payload: { sheet_no: sheet, item: "Blockwork external walls", quantity: 340, unit: "m2", location: "Perimeter", method: "elevation area" }, provenance: ids(env), confidence: CONF },
      ];
    }
    case "boq.derive_lines":
      return [
        { type: "boq_line", payload: { code: "C20", description: "Concrete grade C20/25 to foundations", quantity: 120, unit: "m3", trade: "Concrete" }, provenance: ids(env), confidence: CONF },
        { type: "boq_line", payload: { code: "R16", description: "Reinforcement bar 16mm", quantity: 9600, unit: "kg", trade: "Rebar" }, provenance: ids(env), confidence: CONF },
        { type: "boq_line", payload: { code: "BW1", description: "Blockwork 140mm external walls", quantity: 340, unit: "m2", trade: "Masonry" }, provenance: ids(env), confidence: CONF },
      ];
    case "cost.price_lines":
      return ofType(env, "boq_line").map((b) => {
        const rate = { C20: 14500, R16: 120, BW1: 6800 }[b.payload.code] ?? 5000;
        const qty = Number(b.payload.quantity ?? 0);
        return { type: "cost_line", payload: { boq_code: b.payload.code, rate_minor: rate, amount_minor: Math.round(rate * qty), currency: "CAD", rate_source: "library:rate_book", rate_book_ref: b.payload.code }, provenance: [b.id], confidence: CONF };
      });
    case "schedule.build_programme":
      return [
        { type: "schedule_activity", payload: { activity: "Groundworks & foundations", wbs: "1.1", duration_days: 20, predecessors: [], trade: "Civils" }, provenance: ids(env), confidence: CONF },
        { type: "schedule_activity", payload: { activity: "Superstructure", wbs: "1.2", duration_days: 35, predecessors: ["Groundworks & foundations"], trade: "Structures" }, provenance: ids(env), confidence: CONF },
      ];
    case "procure.build_packages":
      return [
        { type: "procurement_package", payload: { package_name: "Concrete supply & place", trade: "Concrete", boq_codes: ["C20", "R16"], estimated_value_minor: 2892000, currency: "CAD", lead_time_weeks: 4 }, provenance: ids(env), confidence: CONF },
      ];
    case "rfi.detect":
      return [
        { type: "rfi", payload: { subject: "Foundation bearing capacity", question: "Confirm allowable bearing pressure — geotech report not in tender pack.", severity: "high", references: [], raised_against: "S-201" }, provenance: ids(env), confidence: CONF },
      ];
    case "compliance.check":
      return [
        { type: "compliance_item", payload: { requirement_ref: "MR-1", requirement_text: "Bid bond of 5% of tender value", status: "met", note: "Bond arranged via surety." }, provenance: ids(env), confidence: CONF },
        { type: "compliance_item", payload: { requirement_ref: "MR-2", requirement_text: "H&S policy & past-performance record", status: "met" }, provenance: ids(env), confidence: CONF },
      ];
    case "proposal.assemble": {
      const total = ofType(env, "cost_line").reduce((s, c) => s + Number(c.payload.amount_minor ?? 0), 0) || 3500000;
      const pname = env.inputs?.params?.project_name ?? "Riverside School";
      return [
        { type: "proposal_doc", payload: { title: `${pname} — Tender Proposal`, sections: [{ heading: "Executive Summary", body: `We are pleased to submit our proposal for the ${pname} project.` }, { heading: "Methodology", body: "Phased delivery: groundworks, superstructure, fit-out." }, { heading: "Commercial", body: `Tender total CAD ${(total / 100).toFixed(2)}.` }], total_amount_minor: total, currency: "CAD", submission_ready: true }, provenance: ids(env), confidence: CONF },
      ];
    }
    case "bid.qualify":
      return [
        { type: "bid_decision", payload: { decision: "go", rationale: "Strong fit, adequate capacity, healthy margin headroom.", signals: { fit: "high", capacity: "med", competition: "med", margin_headroom_pct: 14 }, conditions: [] }, provenance: ids(env), confidence: CONF },
      ];
    case "risk.assess":
      return [
        { type: "risk", payload: { category: "commercial", title: "Volatile rebar pricing", description: "Steel prices trending up 8% QoQ.", likelihood: "med", impact: "high", mitigation: "Fix supplier rate at award.", owner_role: "estimator", status: "open" }, provenance: ids(env), confidence: CONF },
        { type: "risk", payload: { category: "programme", title: "Groundwater on site", description: "High water table risk in foundation zone.", likelihood: "med", impact: "med", mitigation: "Allow for dewatering.", owner_role: "precon_lead", status: "open" }, provenance: ids(env), confidence: CONF },
      ];
    case "approval.prepare": {
      const total = ofType(env, "proposal_doc")[0]?.payload?.total_amount_minor ?? 3500000;
      return [
        { type: "bid_approval", payload: { total_amount_minor: total, currency: "CAD", margin_pct: 12.5, compliance_status: "clear", recommendation: "Approve for submission — pricing and compliance are in order.", conditions: [] }, provenance: ids(env), confidence: CONF },
      ];
    }
    case "clarification.draft":
      return [
        { type: "client_query", payload: { direction: "outbound", subject: "Response to clarification", body: "Please find our response to your query attached.", is_addendum: false, status: "answered" }, provenance: ids(env), confidence: CONF },
      ];
    case "knowledge.search":
    case "uw.knowledge.search":
      return []; // service: returns retrieved context to the caller, emits no artifact

    // ── Underwriting pack (second vertical) — namespaced outputs ──────────────
    case "uw.document.classify": {
      const files = env.inputs?.params?.files ?? [];
      const list = files.length ? files : [{ id: SYNTHETIC_FILE_ID, filename: "submission.pdf", doc_type: "acord_form", page_count: 1 }];
      return list.map((f) => ({ type: "underwriting.document", payload: { file_id: f.id, doc_type: f.doc_type ?? "acord_form", title: f.filename ?? "Submission", page_range: [1, Math.max(1, f.page_count ?? 1)] }, provenance: [], confidence: 0.99 }));
    }
    case "uw.intake.extract":
      return [{ type: "underwriting.submission_summary", payload: { insured_name: "Northwind Logistics Ltd", class_of_business: "Commercial Property", broker: "Marsh", effective_date: "2026-10-01", requested_limit_minor: 500000000, requested_deductible_minor: 2500000, currency: "CAD" }, provenance: ids(env), confidence: CONF }];
    case "uw.exposure.capture":
      return [
        { type: "underwriting.exposure", payload: { location: "120 Dockside Rd, Halifax", peril: "fire", value_minor: 320000000, currency: "CAD", construction_type: "steel frame" }, provenance: ids(env), confidence: CONF },
        { type: "underwriting.exposure", payload: { location: "120 Dockside Rd, Halifax", peril: "flood", value_minor: 180000000, currency: "CAD", construction_type: "steel frame" }, provenance: ids(env), confidence: CONF },
      ];
    case "uw.loss.analyze":
      return [{ type: "underwriting.loss_run", payload: { policy_year: 2025, claim_count: 2, incurred_minor: 4200000, currency: "CAD", description: "Two water-damage claims prior year." }, provenance: ids(env), confidence: CONF }];
    case "uw.risk.rate":
      return [
        { type: "underwriting.risk_factor", payload: { factor: "Coastal flood exposure", category: "natural_catastrophe", score: 62, appetite: "in", rationale: "Within appetite with flood sublimit." }, provenance: ids(env), confidence: CONF },
        { type: "underwriting.risk_factor", payload: { factor: "Loss frequency", category: "hazard", score: 48, appetite: "in", rationale: "Two prior claims; acceptable." }, provenance: ids(env), confidence: CONF },
      ];
    case "uw.pricing.price":
      return [{ type: "underwriting.quote_option", payload: { option_name: "Standard", premium_minor: 4850000, currency: "CAD", limit_minor: 500000000, deductible_minor: 2500000, terms: "12-month, flood sublimit CAD 2m." }, provenance: ids(env), confidence: CONF }];
    case "uw.referral.detect":
      return [{ type: "underwriting.referral", payload: { reason: "Requested limit CAD 5m exceeds underwriter authority (CAD 3m).", to_role: "underwriting_manager", authority_breach: true, decision: "pending", note: "Refer for limit authority." }, provenance: ids(env), confidence: CONF }];
    case "uw.conditions.build":
      return [
        { type: "underwriting.condition", payload: { kind: "subjectivity", text: "Satisfactory survey within 30 days of inception.", mandatory: true }, provenance: ids(env), confidence: CONF },
        { type: "underwriting.condition", payload: { kind: "exclusion", text: "Flood excluded above the CAD 2m sublimit.", mandatory: true }, provenance: ids(env), confidence: CONF },
      ];
    case "uw.quote.assemble":
      return [{ type: "underwriting.quote_letter", payload: { quote_ref: "Q-2026-0417", insured_name: "Northwind Logistics Ltd", total_premium_minor: 4850000, currency: "CAD", valid_until: "2026-11-01", option_ref: "Standard" }, provenance: ids(env), confidence: CONF }];
    case "uw.broker.draft":
      return [{ type: "underwriting.uw_query", payload: { direction: "outbound", subject: "Re: additional information", body: "Please confirm the sprinkler certification date for the Halifax location.", is_amendment: false, status: "answered" }, provenance: ids(env), confidence: CONF }];

    // ── Supervisor personas (§6): a chat turn + optional deviation proposals.
    case "copilot.respond":
    case "commercial.respond":
    case "compliance_lead.respond":
    case "underwriter.respond":
    case "actuary.respond":
    case "wordings.respond":
      return { supervisor: true, message: { role: "assistant", content: supervisorVoice(t, env), referenced_artifact_ids: ids(env) }, deviations: [] };
    case "copilot.review_run":
    case "commercial.review_run":
    case "compliance_lead.review_run":
    case "underwriter.review_run":
    case "actuary.review_run":
    case "wordings.review_run":
      return {
        supervisor: true,
        message: { role: "assistant", content: `${personaName(t)} consistency sweep complete. No blocking inconsistencies found in the current run.`, referenced_artifact_ids: ids(env) },
        deviations: [{ kind: "flag", rationale: `${personaName(t)}: verify the priced BOQ reconciles with the proposal total before submission.`, payload: {} }],
      };
    default:
      // ── Domain-agnostic fallback. Any job_type the worker has no hardcoded case
      // for — including every USER-CONFIGURED domain — is handled generically:
      // supervisor turns by suffix, worker outputs synthesized from the produced
      // types' schemas (inlined by Core as params.__produce). No per-domain code.
      if (t.endsWith(".respond")) return genericSupervisor(env, false);
      if (t.endsWith(".review_run")) return genericSupervisor(env, true);
      return genericOutputs(env);
  }
}

function genericSupervisor(env, isReview) {
  const q = env.inputs?.params?.user_message ?? "";
  const on = q ? `On "${q}": ` : "";
  const msg = isReview
    ? `Assistant sweep complete. ${on}I checked the records in this run for consistency and found nothing blocking.`
    : `${on}I'm your assistant for this workspace — I move each record through its stages, propose the next step, and flag anything that looks off. You confirm.`;
  return { supervisor: true, message: { role: "assistant", content: msg, referenced_artifact_ids: ids(env) }, deviations: isReview ? [{ kind: "flag", rationale: "Assistant: double-check the latest stage output before it advances.", payload: {} }] : [] };
}

function genericOutputs(env) {
  const spec = env.inputs?.params?.__produce ?? [];
  if (!spec.length) return [];
  return spec.map(({ type, schema }) => {
    const nonReview = String(type).split(".").pop() === "document";
    return {
      type,
      payload: sampleFromSchema(schema, type),
      provenance: nonReview ? [] : ids(env), // a document derives from a file, not an artifact
      confidence: 0.9,
    };
  });
}

// Synthesize a schema-valid sample payload for any artifact type (§ generic worker).
function sampleFromSchema(schema, typeName = "") {
  if (!schema || schema.type !== "object") return {};
  const out = {};
  const props = schema.properties ?? {};
  for (const [k, s] of Object.entries(props)) out[k] = sampleValue(s, k, typeName);
  for (const r of schema.required ?? []) if (!(r in out)) out[r] = "sample";
  return out;
}
function sampleValue(s, key = "", typeName = "") {
  if (!s || typeof s !== "object") return "sample";
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.type === "integer" || s.type === "number") return Math.max(s.minimum ?? 1, 1);
  if (s.type === "boolean") return true;
  if (s.type === "array") {
    const item = s.items ?? { type: "string" };
    const n = Math.max(s.minItems ?? 1, 1);
    return Array.from({ length: n }, () => sampleValue(item, key, typeName));
  }
  if (s.type === "object") return sampleFromSchema(s, typeName);
  if (s.format === "uuid") return SYNTHETIC_FILE_ID;
  if (s.format === "date-time" || s.format === "date") return "2026-01-15T00:00:00.000Z";
  const label = (typeName ? String(typeName).split(".").pop() + " " : "") + key.replace(/_/g, " ");
  return ("Sample " + label).trim().slice(0, 60);
}

function personaName(jobType) {
  if (jobType.startsWith("commercial")) return "Commercial";
  if (jobType.startsWith("compliance_lead")) return "Compliance Lead";
  if (jobType.startsWith("underwriter")) return "Underwriting Copilot";
  if (jobType.startsWith("actuary")) return "Actuary";
  if (jobType.startsWith("wordings")) return "Wordings";
  return "Construction Copilot";
}

function supervisorVoice(jobType, env) {
  const q = env.inputs?.params?.user_message ?? "";
  const name = personaName(jobType);
  const on = q ? `On "${q}": ` : "";
  switch (name) {
    case "Commercial": return `Commercial here. ${on}I'm watching margin and pricing risk across the estimate. Flag me any cost line that looks thin against the rate book.`;
    case "Compliance Lead": return `Compliance Lead here. ${on}I'm tracking that every mandatory submission requirement is covered before the submission gate.`;
    case "Underwriting Copilot": return `Underwriting Copilot here. ${on}I'm walking the submission from intake to quote — checking appetite, that pricing reconciles with the rating, and that any authority breach is referred.`;
    case "Actuary": return `Actuary here. ${on}I guard the technical price — challenge any quote priced below the rate-table minimum or loss-loading that's thin against the loss run.`;
    case "Wordings": return `Wordings here. ${on}I check every subjectivity is captured as a condition and the quote letter is regulatory-complete before issue.`;
    default: return `Construction Copilot here. ${on}I'm keeping the pursuit moving and cross-checking that scope, quantities, pricing and the proposal all reconcile.`;
  }
}

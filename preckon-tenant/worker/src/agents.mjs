// ── Deterministic stub agents (build-plan M1). No LLM, no DB. Given a
// JobEnvelope, each produces fixed, schema-valid outputs so the whole runtime —
// gates, provenance, stale/re-plan, audit — is exercised without model
// nondeterminism. Swapping in real Claude calls is a change to THIS file only;
// the trust boundary (worker has no store access) is unchanged.

import { PROMPTS, hasPrompt, supervisorPrompt, outlinePrompt, sectionPrompt, designerPrompt, verifierPrompt } from "./prompts.mjs";
import { projectToolbox } from "./project-tools.mjs";
import { createCadToolbox, buildExtractionDigest, knownNames } from "./cad-tools.mjs";
import { runAgenticLoop } from "./agentic-loop.mjs";
import { runVisionPass, visionBlock } from "./vision.mjs";
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

/**
 * Usage for a stub answer.
 *
 * It must NOT claim a model that never ran. The plain usage() above reports
 * "claude-opus-4-8" whatever produced the result, which writes a real model name
 * onto a fabricated job and makes the two indistinguishable in ai_job forever
 * after. Cost is zero because nothing was spent.
 */
function stubUsage() {
  return { model: "stub:deterministic", input_tokens: 0, output_tokens: 0, cost_minor: 0 };
}

// tier → concrete model id (env-overridable). Used only on the real-Claude path.
const MODEL_FOR_TIER = {
  routing: process.env.ANTHROPIC_MODEL_ROUTING ?? "claude-haiku-4-5",
  standard: process.env.ANTHROPIC_MODEL_STANDARD ?? "claude-sonnet-5",
  deep: process.env.ANTHROPIC_MODEL_DEEP ?? "claude-opus-4-8",
};

/**
 * May a deterministic stub stand in for a real answer?
 *
 * The stub exists so the runtime — gates, provenance, stale/re-plan, audit —
 * can be exercised without model nondeterminism. That is worth keeping. What is
 * not acceptable is what it used to do: on a Claude outage, return invented
 * quantities as `status: "succeeded"`, indistinguishable from a real bill.
 *
 * A fabricated BOQ that looks successful is worse than no BOQ. Somebody prices
 * work from it. So:
 *
 *   DEMO_STUB_MODE=true  → permitted anywhere, an explicit and deliberate choice
 *   NODE_ENV=production  → never
 *   otherwise (dev/test) → permitted
 *
 * Production with no key does not quietly degrade either: the job fails and says
 * the key is missing, which is a fixable complaint rather than a plausible
 * invention.
 */
export function stubPolicy(envv = process.env) {
  if (String(envv.DEMO_STUB_MODE).toLowerCase() === "true") {
    return { allowed: true, why: "DEMO_STUB_MODE=true" };
  }
  if (envv.NODE_ENV === "production") {
    return { allowed: false, why: "NODE_ENV=production and DEMO_STUB_MODE is not set" };
  }
  return { allowed: true, why: `NODE_ENV=${envv.NODE_ENV ?? "development"}` };
}

const failure = (base, message, detail) => ({
  ...base,
  usage: stubUsage(),
  status: "failed",
  outputs: undefined,
  error: { message, ...(detail ? { detail } : {}) },
});

/**
 * Compute a JobResult for an envelope.
 *
 * With a key, the agent reasons with Claude. Without one — or when Claude fails
 * — the deterministic stub answers ONLY where stubPolicy permits it; otherwise
 * the job fails so Core can retry it and a person can see that it did not run.
 * The stub doubles as the output SHAPE TEMPLATE, so real outputs stay
 * schema-valid (Core validates them regardless, §5.1).
 */
export async function computeJobResult(env) {
  const base = { job_id: env.job_id, usage: usage(env), trace_id: `lf_${env.job_id.slice(0, 8)}`, error: null };
  const template = buildOutputs(env);
  const policy = stubPolicy();

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await withClaude(env, base, template);
    } catch (e) {
      if (!policy.allowed) {
        // Loud, and it fails. Core marks the job failed, the step does not
        // advance, and the user is told — rather than being handed a bill that
        // no model ever produced.
        console.error(`[worker] job ${env.job_id} (${env.job_type}) FAILED — Claude error, and stub output is not permitted (${policy.why}):`, e.message);
        return failure(base, `The AI service failed and this deployment does not permit substitute output (${policy.why}). The job was not completed.`, e.message);
      }
      console.warn(`[worker] Claude call failed — using STUB output because ${policy.why}:`, e.message);
      return finalize({ ...base, usage: stubUsage() }, template);
    }
  }

  if (!policy.allowed) {
    console.error(`[worker] job ${env.job_id} (${env.job_type}) FAILED — no ANTHROPIC_API_KEY and stub output is not permitted (${policy.why}).`);
    return failure(base, `No AI service is configured and this deployment does not permit substitute output (${policy.why}). Set ANTHROPIC_API_KEY on the worker.`);
  }

  return finalize({ ...base, usage: stubUsage() }, template);
}

function finalize(base, template) {
  if (template.supervisor)
    return { ...base, status: "succeeded", message: template.message, deviations: template.deviations ?? [] };
  return { ...base, status: "succeeded", outputs: template };
}

async function withClaude(env, base, template) {
  const model = MODEL_FOR_TIER[env.tier] ?? MODEL_FOR_TIER.deep;

  if (template.supervisor) {
    const toolbox = projectToolbox(env);
    const { system, user, maxTokens } = supervisorPrompt(env, personaName(env.job_type), !!toolbox);

    /* With tools, the Copilot looks things up instead of being handed a
       truncated pile. Six iterations is enough for "overview → find the
       records → read one" and short of an assistant that browses the project
       for a minute before answering a one-line question.
       Without them — a workspace-level question with no project — it answers
       from the inline records exactly as it always did. */
    const text = toolbox
      ? (await runAgenticLoop({ model, system, user, toolbox, maxTokens, iterCap: 6 })).content
      : await callAnthropic(model, system, user, maxTokens);

    return {
      ...base,
      status: "succeeded",
      message: { role: "assistant", content: String(text ?? "").trim(), referenced_artifact_ids: ids(env) },
      deviations: template.deviations ?? [],
    };
  }

  // The bill is built by a roster, not a single call.
  if (env.job_type === "boq.derive_lines") {
    const { lines, roster } = await runBoqRoster(env, model);
    const outputs = auditCitations(postProcess(env, lines), env.inputs?.params?.cad_extractions ?? []);
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
  /* One currency for the whole bill, stated once at the top of the response
     rather than repeated on every line. Three letters x 200 lines is output
     nobody reads and the estimator cannot mix currencies in one bill anyway. */
  const batchCurrency =
    !Array.isArray(parsed) && typeof parsed?.currency === "string" ? parsed.currency.trim().toUpperCase() : null;

  // An empty or unparseable response must not silently become a fabricated
  // stub result — the chain would look like it worked and the numbers would be
  // invented. Fail the job so the run surfaces it and can be re-run.
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error(`no usable outputs from ${env.job_type} (${text.length} chars returned)`);
  }

  outputs = postProcess(env, outputs, batchCurrency);
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
  //
  // Where drawings were parsed, the specialist gets a toolbox rather than a
  // paragraph. The difference is what it can do when the seeded digest doesn't
  // answer its question: with a digest it must guess (and a guessed quantity is
  // indistinguishable from a measured one once it's in the bill); with the
  // toolbox it calls get_layer_geometry on the layer it actually cares about.
  const toolbox = createCadToolbox(
    env.inputs?.params?.cad_extractions ?? [],
    env.inputs?.params?.documents ?? []
  );
  const grounded = toolbox.drawingCount > 0;
  note(
    "toolbox",
    grounded
      ? `${toolbox.drawingCount} parsed drawing(s) — specialists will measure with tools`
      : "no parsed drawings — specialists price from documents only"
  );

  // Vision pre-pass. Runs once for the whole bill and its observations are
  // shared into every division — a sheet is read at most once however many
  // trades cite it. Skipped entirely when there are no PDFs.
  const pdfs = env.inputs?.params?.drawing_pdfs ?? [];
  let vision = "";
  if (pdfs.length) {
    const v = await runVisionPass({ model, pdfs, note });
    vision = visionBlock(v.notes);
    note("vision", v.sheets ? `read ${v.sheets} sheet(s)` : "no sheets could be read");
  }

  const runSection = async (sec) => {
    const req = sectionPrompt(env, sec, specialistFor(sec), roster);
    try {
      let text;
      if (grounded || vision) {
        const seeded =
          `${req.user}\n\n${vision}\n\n` +
          (grounded
            ? `DRAWINGS ALREADY PARSED (call the tools for anything this does not answer):\n${buildExtractionDigest(env.inputs?.params?.cad_extractions ?? [], 3000)}`
            : "");
        const out = await runAgenticLoop({
          model,
          system: req.system,
          user: seeded,
          toolbox,
          maxTokens: req.maxTokens,
          iterCap: 6,
        });
        text = out.content;
        note(
          `section/${sec.code}`,
          `${out.toolCallsMade} tool call(s) over ${out.iterations} turn(s)${out.hitCap ? " (hit tool cap)" : ""}`
        );
      } else {
        text = await call(model, req.system, req.user, req.maxTokens);
      }
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
/**
 * Audit each measured line's citation against the drawings that actually exist.
 *
 * QUANTITY_RULES require a line to say where its number came from — a layer, a
 * block, a schedule row. Until now nothing checked whether the thing it named
 * was real. A cited layer that does not exist is the pipeline's worst failure
 * mode: it reads as diligence, survives review, and is wrong. Every line that
 * claims a CAD source now either matches a parsed element or is flagged for a
 * human, and the flag is a field rather than prose so the BOQ screen can filter
 * on it.
 *
 * Deliberately conservative. It only judges lines whose method claims a CAD
 * source; a quantity taken from a spec clause or a stated figure is left alone,
 * because inventing a second reason to doubt a good line costs an estimator the
 * same attention as a real one.
 */
function auditCitations(outputs, extractions) {
  if (!extractions?.length) return outputs;
  const { layers, blocks, schedules } = knownNames(extractions);
  if (!layers.size && !blocks.size) return outputs;

  // Identifier-shaped tokens: A-DOOR, DOOR_SINGLE_900, C-SLAB-01. Ordinary
  // prose words are excluded by requiring a separator or an all-caps run.
  const TOKEN = /\b[A-Z0-9]+(?:[-_][A-Z0-9]+)+\b|\b[A-Z]{3,}\b/g;
  const CLAIMS_CAD = /\blayer\b|\bblock\b|\bcount of\b|\bhatch\b|\bpolyline\b/i;

  for (const o of outputs) {
    if (String(o?.type ?? "").split(".").pop() !== "boq_line") continue;
    const p = o.payload;
    if (!p || typeof p !== "object") continue;
    const method = String(p.method ?? p.notes ?? "");
    if (!CLAIMS_CAD.test(method)) continue;

    const cited = [...new Set(method.match(TOKEN) ?? [])];
    if (!cited.length) continue;
    const known = (t) => {
      const k = t.toLowerCase();
      if (layers.has(k) || blocks.has(k) || schedules.has(k)) return true;
      // Agents legitimately cite a layer group ("A-DOOR" for A-DOOR-FRAME).
      for (const l of layers) if (l.includes(k) || k.includes(l)) return true;
      for (const b of blocks) if (b.includes(k) || k.includes(b)) return true;
      return false;
    };

    const unknown = cited.filter((t) => !known(t));
    if (unknown.length === cited.length) {
      p.review_required = true;
      p.review_reason = `cites CAD element(s) not found in the parsed drawings: ${unknown.slice(0, 4).join(", ")}`;
      p.notes = [p.notes, `QA: ${p.review_reason}`].filter(Boolean).join(" · ");
      // Not zero — the line may still be real scope with a mis-typed reference,
      // and deleting an estimator's line is a worse error than doubting it.
      o.confidence = Math.min(Number(o.confidence ?? 0.6), 0.4);
    } else {
      p.measured_from = cited.filter(known).slice(0, 4).join(", ");
    }
  }
  return outputs;
}

function postProcess(env, outputs, batchCurrency = null) {
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
      /* The amount is COMPUTED here, not asked for.
         It always was — this code overwrote whatever the model returned
         whenever the quantity was known, so a bill of 200 lines was paying for
         200 multiplications that were then discarded, and taking a confidence
         penalty on the ones it got wrong. The prompt now asks for the rate and
         nothing else, and the identity holds by construction rather than by
         asking the model to check its own arithmetic.
         Currency likewise: one per bill, stated once, instead of the same three
         letters repeated on every line. */
      const qty = boqQty.get(String(p.boq_code));
      const rate = Number(p.rate_minor);
      if (Number.isFinite(rate) && Number.isFinite(qty) && qty > 0) {
        p.amount_minor = Math.round(rate * qty);
      } else {
        // No quantity to multiply by means this line was priced against a BOQ
        // code that does not exist. Zero and a low confidence, so it shows up
        // as needing a look rather than disappearing into a total.
        p.amount_minor = 0;
        o.confidence = 0.4;
      }
      if (!p.currency && batchCurrency) p.currency = batchCurrency;
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


/**
 * Mark a system prompt as cacheable.
 *
 * The stage briefs here are long and identical across calls — HOUSE_RULES, the
 * estimating knowledge, the exemplar bills, the rate book. The BOQ roster alone
 * re-sends all of it once per specialist per turn, and every one of those was
 * being charged and re-read from scratch.
 *
 * A cache breakpoint on the system block means the first call pays for it and
 * the rest of the run reads it back. Nothing about the answer changes; the same
 * bytes are sent, and the model sees exactly the same prompt.
 *
 * Below the threshold it is not worth a breakpoint — short prompts do not reach
 * the minimum cacheable length, and the marker would just be noise in the
 * request. Returned as a plain string in that case, which is what the API
 * expects anyway.
 */
const CACHEABLE_CHARS = 4000;
function cacheableSystem(system) {
  const text = typeof system === "string" ? system : String(system ?? "");
  if (text.length < CACHEABLE_CHARS) return text;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

async function callAnthropic(model, system, userText, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: cacheableSystem(system),
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content ?? []).map((c) => c.text ?? "").join("");
}

/**
 * Pull the first complete JSON value out of a model response.
 *
 * The old version sliced from the first bracket to the LAST bracket anywhere in
 * the text. One sentence of commentary after the JSON — or a closing brace
 * inside it — corrupted the slice, JSON.parse threw, and the caller discarded
 * everything. That is how a 17,000-character programme became two hardcoded
 * stub bars: the model did the work, the parser threw it away, and the fallback
 * looked like a real answer.
 *
 * This walks the text tracking string state and escapes, so it stops at the
 * point the value actually closes and ignores whatever follows.
 */
function extractJson(text) {
  const src = String(text ?? "");
  const s = src.indexOf("["), o = src.indexOf("{");
  const start = s === -1 ? o : o === -1 ? s : Math.min(s, o);
  if (start === -1) return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(src.slice(start, i + 1)); } catch { break; }
      }
    }
  }

  // Never closed — the response was cut off mid-structure. Rather than lose the
  // whole run, salvage every element that DID complete. A programme missing its
  // last three activities is a programme an estimator can finish; a stub that
  // silently replaced it is not.
  return salvageObjects(src, start);
}

/** Every complete top-level object inside a truncated array, as {outputs}. */
function salvageObjects(src, start) {
  const out = [];
  // Scan from INSIDE the array. A truncated `{"outputs":[{…},{…},{"ty` never
  // closes its wrapper, so a brace counter started at the wrapper stays above
  // zero and no element is ever seen as complete. Stepping past the opening
  // bracket puts each element at depth zero, where it can be recognised.
  const arr = src.indexOf("[", start);
  const from = arr === -1 ? start : arr + 1;
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") { if (depth === 0) objStart = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          const v = JSON.parse(src.slice(objStart, i + 1));
          if (v && typeof v === "object") out.push(v);
        } catch { /* skip the fragment, keep the rest */ }
        objStart = -1;
      }
    }
  }
  if (!out.length) return null;
  // A salvaged run of {type, payload} records is an outputs array; a single
  // salvaged wrapper object is already the shape the caller wants.
  if (out.length === 1 && (out[0].outputs || out[0].sections || out[0].specialists)) return out[0];
  const records = out.filter((v) => v.type && v.payload);
  return records.length ? { outputs: records } : out[0];
}

/**
 * Best-effort doc_type from the filename and mime, for the deterministic path
 * that runs without an API key. The LLM path classifies from actual content and
 * ignores this. Returns one of the construction pack's doc_type values:
 * drawing | specification | tender_letter | addendum | boq | schedule | other.
 */
function guessDocType(f) {
  const name = String(f?.filename ?? "").toLowerCase();
  const mime = String(f?.mime ?? "").toLowerCase();

  // CAD is unambiguous — browsers send application/octet-stream for these, so
  // the extension is the only reliable signal.
  if (/\.(dwg|dxf|dwf|rvt|ifc)$/.test(name) || mime.includes("dwg") || mime.includes("dxf")) return "drawing";
  if (mime.startsWith("image/")) return "drawing";

  if (/\b(boq|bill[-_ ]?of[-_ ]?quantit|schedule[-_ ]of[-_ ]rates|pricing[-_ ]schedule)/.test(name)) return "boq";
  if (/\b(addend|amendment|bulletin|clarification)/.test(name)) return "addendum";
  if (/\b(spec|specification|nbs|masterspec|particular[-_ ]spec)/.test(name)) return "specification";
  if (/\b(programme|program|schedule|gantt|baseline)/.test(name)) return "schedule";
  if (/\b(drawing|plan|elevation|section|detail|layout|ga[-_ ]?drawing|sheet)/.test(name)) return "drawing";
  if (/\b(itt|instruction|invitation|tender[-_ ]letter|cover[-_ ]letter|form[-_ ]of[-_ ]tender)/.test(name)) return "tender_letter";

  // Unknown beats a confident wrong answer — "other" tells a reviewer to look.
  return "other";
}

function buildOutputs(env) {
  const t = env.job_type;
  switch (t) {
    case "document.classify_split": {
      const files = env.inputs?.params?.files ?? [];
      const list = files.length ? files : [{ id: SYNTHETIC_FILE_ID, filename: "tender.pdf", page_count: 1 }];
      return list.map((f) => ({
        type: "document",
        payload: {
          file_id: f.id,
          doc_type: f.doc_type ?? guessDocType(f),
          title: f.filename ?? "Document",
          page_range: [1, Math.max(1, f.page_count ?? 1)],
        },
        provenance: [], // a document derives from a file, not an artifact
        // A filename-based guess is not a content classification. Say so, so a
        // reviewer can tell it apart from the LLM path's real judgement.
        confidence: f.doc_type ? 0.99 : 0.55,
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
    // Shape template for the technical submission. The seven sections are fixed
    // and ordered the way an evaluator reads them, so a partial run still
    // produces a document with the right skeleton rather than an arbitrary
    // subset in whatever order the model happened to emit.
    case "narrative.compose":
      return [
        ["executive_summary", "Executive Summary"],
        ["company_profile", "Company Profile"],
        ["technical_approach", "Technical Approach & Methodology"],
        ["programme", "Project Programme"],
        ["quality", "Quality Assurance Plan"],
        ["hse", "Health, Safety & Environment"],
        ["risk_management", "Risk Management"],
      ].map(([section, title]) => ({
        type: "narrative_section",
        payload: {
          section,
          title,
          body_md: `## ${title}\n\n(not yet written — run NarrativeLogix with the bill and programme confirmed)`,
          grounded_in: "",
          word_count: 0,
        },
        provenance: ids(env),
        confidence: CONF,
      }));
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

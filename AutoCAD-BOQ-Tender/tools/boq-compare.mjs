#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BOQ comparison tool.
//
// Compares a GROUND-TRUTH priced BOQ (e.g. Priced-BOQ-LIVE-correct.xlsx) against
// a machine-GENERATED AIGCC export, on the three dimensions that matter:
//
//   • item description — did we produce the right line items? (coverage + rewording)
//   • unit             — does each line carry the correct standard unit?
//   • quantity         — is the quantity right (within a tolerance)?
//
// Both files use the AIGCC layout written by aigcc-excel.ts (and parsed by
// scripts/build_boq_exemplars.py):
//   col A padding · B SOW Ref · C Our Ref · D Sub Ref · E Sr.No
//   · F DESCRIPTION · G UNIT · H QUANTITY · I RATE · J AMOUNT
// The header row is auto-detected; section/total rows (merged description) are
// skipped so only real priced line items are compared. By default EVERY sheet
// that looks like a BOQ table is read (the generated export puts one section
// per sheet); use --correct-sheet / --gen-sheet to restrict to a single tab.
//
// MATCHING ENGINE
//   • ref-key — exact SOW/Our/Sub/Sr match (free, first pass)
//   • semantic — embedding cosine similarity (OpenAI text-embedding-3-small),
//     used automatically when OPENAI_API_KEY is set. Catches reworded lines
//     that share no words (the big lever on a fair coverage number).
//   • LLM judge — borderline semantic pairs (cosine 0.55–0.80) are confirmed
//     by an Anthropic model when ANTHROPIC_API_KEY is set; rejected pairs drop
//     back to missing/extra so coverage isn't over-credited.
//   • offline — with no keys it falls back to a word-overlap coefficient.
//
// ENV keys (any one enables semantic matching):
//   OPENAI_API_KEY      — embeddings (best matcher) + can also drive the LLM matcher
//   ANTHROPIC_API_KEY   — direct Claude for the LLM matcher/judge
//   OPENROUTER_API_KEY  — OpenRouter (OpenAI-shape) for the LLM matcher/judge
//   GROQ_API_KEY        — Groq (OpenAI-shape) for the LLM matcher/judge
//   BOQ_LLM_API_KEY (+ BOQ_LLM_BASE_URL) — any other OpenAI-compatible gateway
// With no key it falls back to offline word-overlap.
// Tunables: BOQ_EMBED_MODEL, BOQ_JUDGE_MODEL, BOQ_SEM_ACCEPT, BOQ_SEM_FLOOR.
//
// Usage:
//   node tools/boq-compare.mjs <correct.xlsx> <generated.xlsx> [options]
//
// Options:
//   --out <file>         output highlighted workbook (default: comparison.xlsx)
//   --tol <frac>         quantity tolerance as a fraction (default: 0.05 = ±5%)
//   --match <frac>       min word-overlap to pair rows in OFFLINE mode (default: 0.40)
//   --correct-sheet <s>  read only this sheet (name or 1-based index) from the correct file
//   --gen-sheet <s>      read only this sheet from the generated file
//   --no-semantic        force offline word-overlap even if OPENAI_API_KEY is set
//   --no-judge           use embeddings but skip the LLM judge
//   --no-xlsx            only print the console report, don't write a workbook
//
// Exit code is 0 on success; the script never fails the run on a "bad score" —
// it reports. Wire that into CI yourself if you want a gate.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Resolve exceljs from wherever pnpm put it (root, api-server, or .pnpm store).
function loadExcelJS() {
  const candidates = [ROOT, path.join(ROOT, "artifacts", "api-server"), path.join(ROOT, "scripts")];
  for (const base of candidates) {
    try {
      return require(require.resolve("exceljs", { paths: [base] }));
    } catch {
      /* try next */
    }
  }
  // Last resort: glob the pnpm store.
  const store = path.join(ROOT, "node_modules", ".pnpm");
  if (fs.existsSync(store)) {
    const hit = fs.readdirSync(store).find((d) => d.startsWith("exceljs@"));
    if (hit) return require(path.join(store, hit, "node_modules", "exceljs"));
  }
  throw new Error("Could not locate the 'exceljs' module. Run pnpm install first.");
}
const ExcelJS = loadExcelJS();

// ── Unit normalisation — faithful JS port of boq-units.ts normalizeUnit ──────
const STANDARD_UNITS = ["m", "m²", "m³", "kg", "ton", "EA", "Set", "LS", "PM"];
function normalizeUnit(raw) {
  const original = (raw ?? "").toString().trim();
  if (!original) return original;
  const key = original.toLowerCase().replace(/[\s.,_/-]/g, "");
  if (["m3", "m³", "cum", "cums", "cbm", "cumtr", "cumtrs", "cubicmtr", "cubicmtrs",
    "cubicmeter", "cubicmetre", "cubicmeters", "cubicmetres"].includes(key)) return "m³";
  if (["m2", "m²", "sqm", "sqms", "sqmt", "sqmtr", "sqmtrs", "sqmeter", "sqmeters",
    "squaremeter", "squaremeters", "squaremetre", "squaremetres"].includes(key)) return "m²";
  if (["ton", "tons", "tonne", "tonnes", "metricton", "metrictonne"].includes(key)) return "ton";
  if (["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"].includes(key)) return "kg";
  if (["ls", "lumpsum", "lumpsums", "lump", "lot", "lots"].includes(key)) return "LS";
  if (["pm", "personmonth", "personmonths", "manmonth", "manmonths", "mandaymonth"].includes(key)) return "PM";
  if (["set", "sets"].includes(key)) return "Set";
  if (["ea", "each", "no", "nos", "number", "numbers", "pc", "pcs", "piece",
    "pieces", "item", "items", "unit", "units", "nr", "qty"].includes(key)) return "EA";
  if (["m", "lm", "lms", "rm", "mtr", "mtrs", "meter", "meters", "metre", "metres",
    "rmt", "runningmeter", "runningmetre", "lin", "linm", "linearmeter", "linearmetre"].includes(key)) return "m";
  return original;
}

// ── Cell helpers ─────────────────────────────────────────────────────────────
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}
function cellNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && "result" in v) return cellNumber(v.result);
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function isTbd(v) {
  return /tbd|t\.b\.d|to be|provisional/i.test(cellText(v));
}

// Locate the DESCRIPTION/UNIT/QUANTITY header within a sheet. Returns
// { headerRow, off } or null if this sheet isn't a BOQ table.
function findHeader(ws) {
  for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
    const texts = [];
    for (let c = 1; c <= Math.min(13, ws.columnCount); c++) texts.push(cellText(ws.getRow(r).getCell(c).value).toLowerCase());
    const joined = texts.join("|");
    if (joined.includes("description") && joined.includes("unit") && joined.includes("quantity")) {
      // Anchor columns on DESCRIPTION so every layout (header on row 5 or 13,
      // 3 ref cols or 4) lines up: refs are the 4 cells before it, unit/qty after.
      const descIdx = texts.findIndex((t) => t.includes("description"));
      return { headerRow: r, descCol: descIdx + 1 };
    }
  }
  return null;
}

// Parse one worksheet's priced line items. descCol is 1-based.
function parseSheet(ws, headerRow, descCol, sheetName) {
  const items = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const desc = cellText(row.getCell(descCol).value);
    if (!desc) continue;
    if (/^total amount|^grand total|^sub ?total/i.test(desc)) continue;
    const unitRaw = cellText(row.getCell(descCol + 1).value);
    // Section/header rows have the description merged across columns, so the
    // unit (and later) cells repeat the description. A real item has a distinct unit.
    if (unitRaw && unitRaw === desc) continue;
    const sr = cellText(row.getCell(descCol - 1).value);   // Sr.No sits just left of DESCRIPTION
    const qtyCell = row.getCell(descCol + 2).value;
    // A genuine priced line carries a unit or a Sr.No. Skip stray text / section labels.
    if (!unitRaw && !sr) continue;
    // Skip rows where the "unit" is clearly prose (a merged section title spilled over).
    if (unitRaw.length > 12 && !normalizeUnit(unitRaw).match(/^(m|m²|m³|kg|ton|EA|Set|LS|PM)$/)) continue;
    items.push({
      sheet: sheetName,
      row: r,
      sowRef: cellText(row.getCell(descCol - 4).value),
      ourRef: cellText(row.getCell(descCol - 3).value),
      subRef: cellText(row.getCell(descCol - 2).value),
      srNo: sr,
      description: desc,
      unit: unitRaw,
      unitNorm: normalizeUnit(unitRaw),
      qty: cellNumber(qtyCell),
      qtyText: cellText(qtyCell),
      tbd: isTbd(qtyCell),
    });
  }
  return items;
}

// Parse a workbook into a flat list of priced line items. By default reads
// EVERY sheet that looks like a BOQ table (the generated AIGCC export puts one
// section per sheet). `sheetSel` restricts to a sheet by name or 1-based index.
function parseBoq(file, sheetSel) {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.readFile(file).then(() => {
    let sheets = wb.worksheets;
    if (sheetSel) {
      const idx = Number(sheetSel);
      const picked = Number.isInteger(idx) ? wb.worksheets[idx - 1] : wb.getWorksheet(sheetSel);
      if (!picked) throw new Error(`${path.basename(file)}: no sheet "${sheetSel}". Available: ${wb.worksheets.map((w) => w.name).join(", ")}`);
      sheets = [picked];
    }
    const all = [];
    const usedSheets = [];
    for (const ws of sheets) {
      const h = findHeader(ws);
      if (!h) continue; // not a BOQ sheet (e.g. an empty/notes tab)
      const items = parseSheet(ws, h.headerRow, h.descCol, ws.name);
      if (items.length) { all.push(...items); usedSheets.push(`${ws.name}:${items.length}`); }
    }
    if (!all.length) throw new Error(`${path.basename(file)}: no priced line items found (looked in ${sheets.length} sheet(s)).`);
    // De-dup exact-identical rows within the file (collapses backup/copy sheets).
    const seen = new Set();
    const deduped = [];
    for (const it of all) {
      const sig = [it.sowRef, it.ourRef, it.subRef, it.srNo, it.description, it.unit, it.qtyText].join("¦").toLowerCase();
      if (seen.has(sig)) continue;
      seen.add(sig);
      deduped.push(it);
    }
    deduped._sheets = usedSheets;
    return deduped;
  });
}

// ── Description similarity (token Dice coefficient) ──────────────────────────
// Filler words that carry no matching signal in BOQ line items, so dropping
// them lets "Supply & install RC footings" match "RC footing supply/install".
const STOP = new Set([
  "and", "the", "for", "with", "of", "to", "in", "on", "as", "at", "by", "or", "a", "an",
  "all", "any", "etc", "incl", "including", "include", "from", "into", "per", "its",
  "work", "works", "item", "items", "providing", "provide", "provision", "carry", "out",
  "shall", "be", "is", "are", "required", "necessary", "applicable", "various",
]);
// Light stemming so plurals/verb forms collapse: footings→footing, leveling→level.
function stem(w) {
  return w
    .replace(/(ings|ies|ed|es|s)$/u, (m) => (m === "ies" ? "y" : ""))
    .replace(/ing$/u, "");
}
function tokens(s) {
  const out = new Set();
  for (const w of s.toLowerCase().replace(/[^a-z0-9² ³]+/g, " ").split(/\s+/)) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}
function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}
const refKey = (it) => [it.sowRef, it.ourRef, it.subRef, it.srNo].map((x) => (x || "").trim()).join("|");

// ── Semantic layer: embeddings (OpenAI) + LLM judge (Anthropic) ──────────────
// Standalone HTTP calls (Node global fetch) so the script has no build/SDK
// dependency. Keys come from the environment; both layers degrade gracefully.
const EMBED_MODEL = process.env.BOQ_EMBED_MODEL || "text-embedding-3-small";

// LLM backend for the matcher/judge. Works with EITHER a direct Anthropic key OR
// any OpenAI-compatible gateway (OpenRouter, Groq, OpenAI) — the app routes Claude
// through these, so reuse whatever key you already have. Precedence: explicit
// BOQ_LLM_* → OpenRouter → Groq → OpenAI → direct Anthropic. Override the model
// with BOQ_JUDGE_MODEL (use a provider-qualified id for OpenRouter, e.g.
// "anthropic/claude-3.5-haiku").
function llmBackend() {
  const m = process.env.BOQ_JUDGE_MODEL;
  if (process.env.BOQ_LLM_API_KEY)
    return { kind: "openai", key: process.env.BOQ_LLM_API_KEY, baseURL: (process.env.BOQ_LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""), model: m || "anthropic/claude-3.5-haiku" };
  if (process.env.OPENROUTER_API_KEY)
    return { kind: "openai", key: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", model: m || "anthropic/claude-3.5-haiku" };
  if (process.env.GROQ_API_KEY)
    return { kind: "openai", key: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1", model: m || "llama-3.3-70b-versatile" };
  if (process.env.ANTHROPIC_API_KEY)
    return { kind: "anthropic", key: process.env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com", model: m || "claude-haiku-4-5-20251001" };
  if (process.env.OPENAI_API_KEY)
    return { kind: "openai", key: process.env.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1", model: m || "gpt-4o-mini" };
  return null;
}
const LLM = llmBackend();

async function embedAll(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const vecs = new Array(texts.length);
  const B = 256;
  for (let i = 0; i < texts.length; i += B) {
    const batch = texts.slice(i, i + B).map((t) => (t || "").slice(0, 8000) || " ");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    json.data.forEach((d, j) => (vecs[i + j] = d.embedding));
    process.stderr.write(`\r  embedding… ${Math.min(i + B, texts.length)}/${texts.length}`);
  }
  process.stderr.write("\r" + " ".repeat(40) + "\r");
  return vecs;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// One chat completion → assistant text, via whichever backend is configured
// (direct Anthropic Messages API, or an OpenAI-compatible /chat/completions
// endpoint for OpenRouter/Groq/OpenAI). Throws on HTTP error.
async function llmChat(prompt, maxTokens = 1500) {
  if (!LLM) throw new Error("no LLM key (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)");
  if (LLM.kind === "anthropic") {
    const res = await fetch(`${LLM.baseURL}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": LLM.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: LLM.model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return (json.content || []).map((c) => c.text || "").join("");
  }
  // OpenAI-compatible (OpenRouter / Groq / OpenAI).
  const res = await fetch(`${LLM.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM.key}` },
    body: JSON.stringify({ model: LLM.model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || "";
}
function parseJsonArray(text) {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b < 0) return [];
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return []; }
}

// Ask the LLM, in batches, whether each candidate pair is the SAME BOQ scope
// line (allowing for rewording/splitting). Returns a boolean[] aligned to pairs.
async function judgePairs(candidatePairs) {
  if (!LLM || candidatePairs.length === 0) return null;
  const verdicts = new Array(candidatePairs.length).fill(true);
  const B = 25;
  for (let i = 0; i < candidatePairs.length; i += B) {
    const batch = candidatePairs.slice(i, i + B);
    const list = batch.map((p, k) => `${k + 1}. A: "${p.a}"\n   B: "${p.b}"`).join("\n");
    const prompt = `You compare construction Bill-of-Quantities line items. For each numbered pair, decide if A and B describe the SAME scope of work (allow rewording, abbreviation, or splitting/merging of the same task). Different trades, different components, or unrelated work = NOT same.\nReturn ONLY a JSON array like [{"n":1,"same":true},...], one per pair, no prose.\n\n${list}`;
    const arr = parseJsonArray(await llmChat(prompt, 1024));
    for (const o of arr) if (Number.isInteger(o.n) && o.n >= 1 && o.n <= batch.length) verdicts[i + o.n - 1] = !!o.same;
    process.stderr.write(`\r  judging borderline pairs… ${Math.min(i + B, candidatePairs.length)}/${candidatePairs.length}`);
  }
  process.stderr.write("\r" + " ".repeat(50) + "\r");
  return verdicts;
}

// CLAUDE-ONLY semantic matcher (no embeddings). Shows the model the full
// catalog of generated lines once, then asks — for a batch of correct lines —
// which catalog number is the SAME scope (or 0 = none). One-to-one across
// batches. Returns [{ci, gi}]. Costs one prompt per ~40 correct items.
async function llmCatalogMatch(correctLeft, generatedLeft, correct, generated) {
  if (!LLM || !correctLeft.length || !generatedLeft.length) return [];
  const catalog = generatedLeft
    .map((gi, n) => `${n + 1}. ${generated[gi].description}${generated[gi].unit ? ` [${generated[gi].unit}]` : ""}`)
    .join("\n");
  const assignments = [];
  const takenGen = new Set();
  const B = 40;
  for (let i = 0; i < correctLeft.length; i += B) {
    const batch = correctLeft.slice(i, i + B);
    const queries = batch
      .map((ci, n) => `${n + 1}. ${correct[ci].description}${correct[ci].unit ? ` [${correct[ci].unit}]` : ""}`)
      .join("\n");
    const prompt = `You match construction Bill-of-Quantities line items by SCOPE OF WORK (meaning), ignoring wording, abbreviation, and ordering. Units in [brackets] are hints.\n\nCATALOG of generated lines:\n${catalog}\n\nFor each QUERY line below, give the CATALOG number that describes the same scope of work, or 0 if nothing in the catalog matches. A catalog item may be used at most once; pick the single best fit.\nReturn ONLY a JSON array like [{"q":1,"c":12},{"q":2,"c":0},...], one entry per query, no prose.\n\nQUERIES:\n${queries}`;
    const arr = parseJsonArray(await llmChat(prompt, 2048));
    for (const o of arr) {
      if (!Number.isInteger(o.q) || o.q < 1 || o.q > batch.length) continue;
      const c = o.c;
      if (!Number.isInteger(c) || c < 1 || c > generatedLeft.length) continue;
      const gi = generatedLeft[c - 1];
      if (takenGen.has(gi)) continue;
      takenGen.add(gi);
      assignments.push({ ci: batch[o.q - 1], gi });
    }
    process.stderr.write(`\r  LLM matching… ${Math.min(i + B, correctLeft.length)}/${correctLeft.length} correct items`);
  }
  process.stderr.write("\r" + " ".repeat(50) + "\r");
  return assignments;
}

// ── Match generated items to correct items ───────────────────────────────────
// Strategy: (1) exact ref-key match, then (2) a similarity pass over leftovers.
// Similarity is embedding cosine when OPENAI_API_KEY is set (semantic), else the
// offline token coefficient. Borderline semantic pairs are confirmed by the LLM
// judge when ANTHROPIC_API_KEY is set. Assignment is greedy best-first (≈optimal
// for sparse, high-contrast candidate sets) and strictly one-to-one.
const SEM_ACCEPT = Number(process.env.BOQ_SEM_ACCEPT || 0.80); // auto-accept above this cosine
const SEM_FLOOR = Number(process.env.BOQ_SEM_FLOOR || 0.55);   // below this: not a candidate

async function matchItems(correct, generated, opts) {
  const pairs = [];
  const usedGen = new Set();
  const usedCorrect = new Set();

  // Pass 1: exact ref-key match (only when the key isn't entirely empty).
  const genByKey = new Map();
  generated.forEach((g, i) => {
    const k = refKey(g);
    if (k.replace(/\|/g, "")) {
      if (!genByKey.has(k)) genByKey.set(k, []);
      genByKey.get(k).push(i);
    }
  });
  correct.forEach((c, ci) => {
    const k = refKey(c);
    if (!k.replace(/\|/g, "")) return;
    const bucket = genByKey.get(k);
    if (!bucket) return;
    const gi = bucket.find((i) => !usedGen.has(i));
    if (gi === undefined) return;
    usedGen.add(gi); usedCorrect.add(ci);
    pairs.push({ correct: c, gen: generated[gi], how: "ref", sim: similarity(c.description, generated[gi].description) });
  });

  // Decide the matching engine for the leftovers (priority: embeddings → Claude
  // catalog matcher → offline word-overlap). `engine` drives report thresholds.
  let engine = "offline";
  let cvec = null, gvec = null;
  const wantSemantic = opts.semantic !== false;
  if (wantSemantic && process.env.OPENAI_API_KEY) {
    try {
      const cv = await embedAll(correct.map((c) => c.description));
      const gv = await embedAll(generated.map((g) => g.description));
      if (cv && gv) { engine = "embeddings"; cvec = cv; gvec = gv; }
    } catch (e) {
      console.warn(`  [warn] embeddings failed (${e.message.slice(0, 80)}); trying next engine.`);
    }
  }
  if (engine === "offline" && wantSemantic && LLM) {
    engine = "llm"; // LLM catalog matcher (Anthropic/OpenRouter/Groq/OpenAI) — no embeddings needed
  } else if (engine === "offline" && wantSemantic) {
    console.warn("  [info] no OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY — using offline word-overlap.");
  }

  const leftC = correct.map((_, i) => i).filter((i) => !usedCorrect.has(i));
  const leftG = generated.map((_, i) => i).filter((i) => !usedGen.has(i));

  if (engine === "llm") {
    // Pass 2a: Claude assigns each leftover correct line to a generated line.
    try {
      const asg = await llmCatalogMatch(leftC, leftG, correct, generated);
      for (const { ci, gi } of asg) {
        if (usedCorrect.has(ci) || usedGen.has(gi)) continue;
        usedCorrect.add(ci); usedGen.add(gi);
        pairs.push({ correct: correct[ci], gen: generated[gi], how: "llm", sim: similarity(correct[ci].description, generated[gi].description) });
      }
    } catch (e) {
      console.warn(`  [warn] Claude matcher failed (${e.message.slice(0, 80)}); falling back to offline.`);
      engine = "offline";
    }
  }

  if (engine !== "llm") {
    // Pass 2b: similarity candidates over leftovers (embeddings cosine or words).
    const score = engine === "embeddings"
      ? (ci, gi) => cosine(cvec[ci], gvec[gi])
      : (ci, gi) => similarity(correct[ci].description, generated[gi].description);
    const floor = engine === "embeddings" ? SEM_FLOOR : opts.match;
    const cand = [];
    for (const ci of leftC) for (const gi of leftG) {
      if (usedCorrect.has(ci) || usedGen.has(gi)) continue;
      const sim = score(ci, gi);
      if (sim >= floor) cand.push({ ci, gi, sim });
    }
    cand.sort((a, b) => b.sim - a.sim);

    // Greedy one-to-one assignment.
    const assigned = [];
    for (const c of cand) {
      if (usedCorrect.has(c.ci) || usedGen.has(c.gi)) continue;
      usedCorrect.add(c.ci); usedGen.add(c.gi);
      assigned.push(c);
    }

    // LLM judge: only the borderline band (embeddings, below auto-accept).
    if (engine === "embeddings" && opts.judge !== false) {
      const borderline = assigned.filter((a) => a.sim < SEM_ACCEPT);
      try {
        const verdicts = await judgePairs(borderline.map((a) => ({ a: correct[a.ci].description, b: generated[a.gi].description })));
        if (verdicts) {
          borderline.forEach((a, k) => {
            if (verdicts[k] === false) { a.rejected = true; usedCorrect.delete(a.ci); usedGen.delete(a.gi); }
            else a.judged = true;
          });
        }
      } catch (e) {
        console.warn(`  [warn] LLM judge failed (${e.message.slice(0, 80)}); keeping embedding matches unjudged.`);
      }
    }
    for (const a of assigned) {
      if (a.rejected) continue;
      pairs.push({
        correct: correct[a.ci], gen: generated[a.gi],
        how: engine === "embeddings" ? (a.judged ? "judge" : "embed") : "fuzzy",
        sim: a.sim,
      });
    }
  }

  const missing = correct.filter((_, i) => !usedCorrect.has(i));   // in correct, not generated
  const extra = generated.filter((_, i) => !usedGen.has(i));       // generated, not in correct
  return { pairs, missing, extra, engine };
}

// ── Per-pair verdicts ────────────────────────────────────────────────────────
function qtyVerdict(c, g, tol) {
  if (c.qty === null && g.qty === null) return g.tbd ? "tbd" : "ok"; // both non-numeric (e.g. both LS-blank)
  if (g.tbd) return "tbd";
  if (c.qty === null || g.qty === null) return "mismatch";
  const denom = Math.max(Math.abs(c.qty), 1e-9);
  return Math.abs(c.qty - g.qty) / denom <= tol ? "ok" : "mismatch";
}

// ── Report writer ────────────────────────────────────────────────────────────
const FILL = {
  missing: "FFF4CCCC", // red-ish
  extra: "FFFCE5CD",   // orange-ish
  unit: "FFFFF2CC",    // yellow
  qty: "FFFCE4D6",     // peach
  ok: "FFE2EFDA",      // green
  tbd: "FFD9E1F2",     // blue
  header: "FF305496",
};
function fillFor(p) {
  const u = p.unitOk ? null : "unit";
  const q = p.qtyVerdict === "ok" ? null : p.qtyVerdict === "tbd" ? "tbd" : "qty";
  if (!u && !q && p.sim >= 0.85) return "ok";
  if (u && q) return "unit"; // both wrong -> highlight as unit (most structural)
  return u || q || "ok";
}

async function writeWorkbook(outFile, pairs, missing, extra, opts) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Comparison");
  const cols = [
    ["Status", 12], ["Match", 8], ["Ref (SOW/Our/Sub/Sr)", 22],
    ["Correct Description", 50], ["Generated Description", 50], ["Desc Sim", 9],
    ["Correct Unit", 11], ["Gen Unit", 11], ["Unit OK", 8],
    ["Correct Qty", 11], ["Gen Qty", 12], ["Qty", 9],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL.header } }));
  head.alignment = { vertical: "middle", wrapText: true };

  const addRow = (vals, fillKey) => {
    const r = ws.addRow(vals);
    if (fillKey) r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[fillKey] } }));
    r.alignment = { vertical: "top", wrapText: true };
    return r;
  };

  for (const p of pairs) {
    p.unitOk = p.correct.unitNorm === p.gen.unitNorm;
    p.qtyVerdict = qtyVerdict(p.correct, p.gen, opts.tol);
    const key = fillFor(p);
    const status = key === "ok" ? "OK" : key === "tbd" ? "TBD qty" : key === "unit" ? "UNIT diff" : "QTY diff";
    addRow([
      status, p.how, refKey(p.correct).replace(/\|+$/g, "").replace(/\|/g, " / "),
      p.correct.description, p.gen.description, +p.sim.toFixed(2),
      p.correct.unit || "—", p.gen.unit || "—", p.unitOk ? "✓" : "✗",
      p.correct.qty ?? (p.correct.qtyText || "—"), p.gen.tbd ? "TBD" : (p.gen.qty ?? (p.gen.qtyText || "—")),
      p.qtyVerdict === "ok" ? "✓" : p.qtyVerdict === "tbd" ? "TBD" : "✗",
    ], key === "ok" ? "ok" : key);
  }
  for (const m of missing) {
    addRow(["MISSING", "—", refKey(m).replace(/\|+$/g, "").replace(/\|/g, " / "),
      m.description, "— (not generated) —", "", m.unit || "—", "—", "✗",
      m.qty ?? (m.qtyText || "—"), "—", "✗"], "missing");
  }
  for (const e of extra) {
    addRow(["EXTRA", "—", refKey(e).replace(/\|+$/g, "").replace(/\|/g, " / "),
      "— (not in correct) —", e.description, "", "—", e.unit || "—", "✗",
      "—", e.tbd ? "TBD" : (e.qty ?? (e.qtyText || "—")), "✗"], "extra");
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "L1" };
  await wb.xlsx.writeFile(outFile);
}

// ── Console report ───────────────────────────────────────────────────────────
function pct(n, d) {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}
function report(correct, generated, pairs, missing, extra, opts) {
  const engine = opts.engine || "offline";
  const sem = engine === "embeddings"; // only embeddings use cosine bands
  const strongBand = sem ? 0.82 : 0.85;
  const partialBand = sem ? 0.62 : 0.5;
  const engineLabel = engine === "embeddings"
    ? `SEMANTIC embeddings${pairs.some((p) => p.how === "judge") ? " + LLM judge" : ""}`
    : engine === "llm" ? "LLM matcher (meaning-based)" : "offline word-overlap";
  let unitOk = 0, qtyOk = 0, qtyTbd = 0, qtyComparable = 0, descClose = 0, descPartial = 0;
  for (const p of pairs) {
    if (p.correct.unitNorm === p.gen.unitNorm) unitOk++;
    if (p.sim >= strongBand) descClose++;
    else if (p.sim >= partialBand) descPartial++;
    const v = qtyVerdict(p.correct, p.gen, opts.tol);
    if (v === "tbd") qtyTbd++;
    else { qtyComparable++; if (v === "ok") qtyOk++; }
  }
  const M = pairs.length;
  const by = (h) => pairs.filter((p) => p.how === h).length;
  const line = (s) => console.log(s);
  line("");
  line("══════════════════════════ BOQ COMPARISON ══════════════════════════");
  const breakdown = engine === "embeddings" ? `, embed: ${by("embed")}, judge: ${by("judge")}`
    : engine === "llm" ? `, llm: ${by("llm")}` : `, fuzzy: ${by("fuzzy")}`;
  line(`  Matching engine        : ${engineLabel}`);
  line(`  Correct (ground truth) : ${correct.length} line items   [sheets: ${(correct._sheets || []).join(", ") || "1"}]`);
  line(`  Generated              : ${generated.length} line items   [sheets: ${(generated._sheets || []).join(", ") || "1"}]`);
  line(`  Matched pairs          : ${M}   (ref: ${by("ref")}${breakdown})`);
  line("─────────────────────────────────────────────────────────────────────");
  line(`  ITEM COVERAGE          : ${pct(M, correct.length)}  (${M}/${correct.length} correct items matched)`);
  line(`     • missing (in correct, not generated) : ${missing.length}`);
  line(`     • extra   (generated, not in correct) : ${extra.length}`);
  line(`  DESCRIPTION accuracy    : strong ${pct(descClose, M)} (${descClose}/${M} ≥${strongBand}) · partial ${pct(descPartial, M)} (${descPartial}/${M} ${partialBand}–${strongBand})`);
  line(`  UNIT accuracy           : ${pct(unitOk, M)}  (${unitOk}/${M} matched pairs, normalised)`);
  line(`  QUANTITY within ±${(opts.tol * 100).toFixed(0)}%      : ${pct(qtyOk, qtyComparable)}  (${qtyOk}/${qtyComparable} comparable; ${qtyTbd} TBD skipped)`);
  line("═════════════════════════════════════════════════════════════════════");

  const show = (title, rows, fmt) => {
    if (!rows.length) return;
    line(`\n  ${title} (${rows.length}):`);
    rows.slice(0, 15).forEach((r) => line("    " + fmt(r)));
    if (rows.length > 15) line(`    … and ${rows.length - 15} more (see workbook)`);
  };
  show("MISSING items", missing, (m) => `[${refKey(m).replace(/\|+$/g, "").replace(/\|/g, "/")}] ${m.description.slice(0, 70)}`);
  show("EXTRA items", extra, (e) => `[${refKey(e).replace(/\|+$/g, "").replace(/\|/g, "/")}] ${e.description.slice(0, 70)}`);
  const unitDiff = pairs.filter((p) => p.correct.unitNorm !== p.gen.unitNorm);
  show("UNIT mismatches", unitDiff, (p) => `${p.correct.unit || "—"} → ${p.gen.unit || "—"}   | ${p.correct.description.slice(0, 55)}`);
  const qtyDiff = pairs.filter((p) => qtyVerdict(p.correct, p.gen, opts.tol) === "mismatch");
  show("QUANTITY mismatches", qtyDiff, (p) => `${p.correct.qty ?? p.correct.qtyText} → ${p.gen.tbd ? "TBD" : (p.gen.qty ?? p.gen.qtyText)}   | ${p.correct.description.slice(0, 50)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const opts = { out: "comparison.xlsx", tol: 0.05, match: 0.40, xlsx: true, correctSheet: null, genSheet: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--tol") opts.tol = parseFloat(argv[++i]);
    else if (a === "--match") opts.match = parseFloat(argv[++i]);
    else if (a === "--correct-sheet") opts.correctSheet = argv[++i];
    else if (a === "--gen-sheet" || a === "--generated-sheet") opts.genSheet = argv[++i];
    else if (a === "--no-xlsx") opts.xlsx = false;
    else if (a === "--no-semantic") opts.semantic = false;
    else if (a === "--no-judge") opts.judge = false;
    else positional.push(a);
  }
  const [correctFile, generatedFile] = positional;
  if (!correctFile || !generatedFile) {
    console.error("Usage: node tools/boq-compare.mjs <correct.xlsx> <generated.xlsx> [options]");
    console.error("Options: --out file  --tol 0.05  --match 0.40  --correct-sheet <name|N>  --gen-sheet <name|N>  --no-xlsx");
    process.exit(2);
  }
  for (const f of [correctFile, generatedFile]) {
    if (!fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(2); }
  }

  const [correct, generated] = await Promise.all([parseBoq(correctFile, opts.correctSheet), parseBoq(generatedFile, opts.genSheet)]);
  const { pairs, missing, extra, engine } = await matchItems(correct, generated, opts);
  report(correct, generated, pairs, missing, extra, { ...opts, engine });

  if (opts.xlsx) {
    const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(process.cwd(), opts.out);
    await writeWorkbook(outPath, pairs, missing, extra, opts);
    console.log(`\n  ✎ Highlighted comparison written to: ${outPath}`);
    console.log("    Legend: green=match · yellow=unit diff · peach=qty diff · blue=TBD · red=missing · orange=extra\n");
  }
}

main().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });

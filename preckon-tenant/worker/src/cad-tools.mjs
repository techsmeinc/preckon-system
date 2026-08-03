/**
 * cad-tools — a queryable toolbox over the drawings, for tool-using agents.
 *
 * Ported from AutoCAD-BOQ-Tender/artifacts/api-server/src/lib/cad-tools.ts.
 *
 * WHY A TOOLBOX RATHER THAN A DIGEST. The old path flattened every drawing into
 * a few thousand characters of prose and pasted it into the prompt. Anything
 * that didn't fit was gone, and the agent had no way to ask a follow-up: it saw
 * "A-WALL: 412 lines" and had to guess whether that was the layer it wanted.
 * With a toolbox the specialist interrogates the drawing the way an estimator
 * does — list the layers, find the ones that look like external walls, pull
 * their geometry, check the block counts — across as many turns as it needs.
 *
 * TRUST BOUNDARY (§5.1). The reference implementation queried the database from
 * the tool handlers. This worker has no database and no credentials, so Core
 * puts the extractions into the job envelope and the handlers answer from that.
 * The capability is identical; the worker stays a pure function of its input.
 */

/** AutoCAD unit label → metres. Anything else leaves quantities in drawing units. */
const TO_METRES = {
  millimeters: 0.001,
  millimetres: 0.001,
  mm: 0.001,
  centimeters: 0.01,
  centimetres: 0.01,
  cm: 0.01,
  meters: 1,
  metres: 1,
  m: 1,
  kilometers: 1000,
  inches: 0.0254,
  in: 0.0254,
  feet: 0.3048,
  ft: 0.3048,
  yards: 0.9144,
};

function metreFactor(units) {
  if (!units) return null;
  return TO_METRES[String(units).trim().toLowerCase()] ?? null;
}

const lc = (v) => String(v ?? "").toLowerCase();
const round = (n, dp = 3) => (Number.isFinite(n) ? Number(n.toFixed(dp)) : null);

/**
 * Layer geometry with the unit conversion already applied.
 *
 * The `_m` / `_m2` fields only appear when the drawing declared its units. That
 * absence is deliberate and load-bearing: a number the agent cannot trust as
 * metres must not be presented as though it were, or a 1:100 drawing in
 * millimetres silently becomes a bill priced in metres.
 */
function layerGeometry(layer, f) {
  const out = {
    layer: layer.layer,
    lineCount: layer.line_count,
    polylineCount: layer.polyline_count,
    closedPolylineCount: layer.closed_polyline_count,
    hatchCount: layer.hatch_count,
    insertCount: layer.insert_count,
    textCount: layer.text_count,
    dimCount: layer.dim_count,
  };
  const top = Array.isArray(layer.closed_polyline_top_areas) ? layer.closed_polyline_top_areas : [];

  if (f == null) {
    out.unitsKnown = false;
    out.note = "Drawing units are undeclared — lengths are in drawing units, areas in drawing units². Do NOT treat these as metres.";
    out.lineLengthTotal_raw = round(layer.line_length_total);
    out.polylineLengthTotal_raw = round(layer.polyline_length_total);
    out.areaTotal_raw = round(layer.polyline_area_total);
    out.hatchAreaTotal_raw = round(layer.hatch_area_total);
    out.topClosedPolylineAreas_raw = top.map((a) => round(a));
    return out;
  }

  out.unitsKnown = true;
  out.lineLengthTotal_m = round(layer.line_length_total * f);
  out.polylineLengthTotal_m = round(layer.polyline_length_total * f);
  out.areaTotal_m2 = round(layer.polyline_area_total * f * f);
  out.hatchAreaTotal_m2 = round(layer.hatch_area_total * f * f);
  out.topClosedPolylineAreas_m2 = top.map((a) => round(a * f * f));
  out.largestClosedPolylineArea_m2 = top.length ? round(Math.max(...top) * f * f) : null;
  return out;
}

/* ── Tool definitions (Anthropic Messages API shape) ────────────────────────
 *
 * These descriptions are the accuracy surface, not decoration. The guidance
 * about largestClosedPolylineArea_m2 vs areaTotal_m2 is carried verbatim from
 * the reference: summed area adds every overlapping outline, furniture polygon
 * and hatch boundary, so an agent that reaches for it over-measures the floor
 * by multiples. Ported prompts that dropped this line produced bills that
 * looked measured and were wrong.
 */
const TOOL_DEFS = [
  {
    name: "list_drawings",
    description:
      "List every parsed drawing on this project with its declared units, sheet names and warnings. Call this first — the units tell you whether later geometry is trustworthy as metres.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_layers",
    description:
      "List all CAD layers across the project's drawings with entity counts. Use first to discover what is in the drawings before drilling in.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Optional: restrict to one drawing filename." },
      },
      required: [],
    },
  },
  {
    name: "get_layer_geometry",
    description:
      "Return per-layer geometry for layers matching a substring — the primary quantity signal for measured BOQ lines. KEY FIELDS (pre-converted to metric when the drawing's units are known): polylineLengthTotal_m / lineLengthTotal_m for linear items (piping, conduit, kerb, cable, fencing); largestClosedPolylineArea_m2 = the SINGLE biggest closed outline on the layer = the building footprint / floor / slab / roof boundary — USE THIS for a floor/ceiling/roof/finish m² take-off. AVOID areaTotal_m2 as a floor area: it SUMS every overlapping outline, furniture polygon and hatch boundary and badly over-counts. topClosedPolylineAreas_m2 shows the biggest few outlines so you can sanity-check. If the _m/_m2 fields are absent the units are undeclared and the raw values are in drawing units — do not present them as metres.",
    input_schema: {
      type: "object",
      properties: {
        layerLike: { type: "string", description: "Case-insensitive layer substring." },
      },
      required: ["layerLike"],
    },
  },
  {
    name: "count_blocks",
    description:
      "Count block instances by name. Block counts are EXACT — a door, sanitary fitting, luminaire or socket block counted here is a defensible 'nr' quantity, unlike an inferred one. Use a substring to group variants (e.g. 'DOOR' catches DOOR_SINGLE_900 and DOOR_DOUBLE_1800).",
    input_schema: {
      type: "object",
      properties: {
        nameLike: { type: "string", description: "Optional case-insensitive block-name substring." },
      },
      required: [],
    },
  },
  {
    name: "get_schedules",
    description:
      "Return tables detected in the drawings (door/window/finishes/fixture schedules). A schedule row is a STATED figure — the strongest evidence available, stronger than any geometry inference. Quote it when you use it.",
    input_schema: {
      type: "object",
      properties: {
        titleLike: { type: "string", description: "Optional case-insensitive schedule-title substring." },
      },
      required: [],
    },
  },
  {
    name: "get_text_on_layer",
    description:
      "Return text annotations, optionally filtered to a layer. Notes carry specification-grade facts geometry cannot show — 'SLAB 200 THK', 'FALL 1:80', material grades, finishes.",
    input_schema: {
      type: "object",
      properties: {
        layerLike: { type: "string", description: "Optional case-insensitive layer substring." },
        limit: { type: "integer", description: "Max annotations to return (default 80)." },
      },
      required: [],
    },
  },
  {
    name: "search_drawing",
    description:
      "Free-text search across layer names, block names, text annotations and schedule cells. Use when you know the term an estimator would use but not where it lives.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Case-insensitive search term." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_dimensions",
    description:
      "Return dimension entities with their measured values. A dimension is what the designer explicitly declared — prefer it over a length you derived from geometry when the two disagree.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max dimensions to return (default 60)." },
      },
      required: [],
    },
  },
  {
    name: "get_drawing_metadata",
    description:
      "Return title-block fields (project, client, drawing number, revision, scale) for each drawing.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_documents",
    description:
      "Search the project's non-drawing documents (SOW, specification, tender letter) for a term and return the surrounding text. Use to confirm a specification requirement before pricing it.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Case-insensitive search term." },
        limit: { type: "integer", description: "Max excerpts to return (default 6)." },
      },
      required: ["query"],
    },
  },
];

/**
 * Build the toolbox for one job.
 *
 * @param extractions Array of sidecar /extract payloads, one per drawing.
 * @param documents   The project's text documents ({ filename, text }).
 */
export function createCadToolbox(extractions = [], documents = []) {
  const draws = Array.isArray(extractions) ? extractions.filter(Boolean) : [];
  const docs = Array.isArray(documents) ? documents.filter(Boolean) : [];
  const trace = [];

  const eachLayer = function* () {
    for (const d of draws) {
      const f = metreFactor(d.units);
      for (const l of d.layers ?? []) yield { drawing: d, layer: l, f };
    }
  };

  const handlers = {
    list_drawings: async () =>
      draws.map((d) => ({
        file: d.file,
        units: d.units ?? null,
        unitsKnown: metreFactor(d.units) != null,
        dxfVersion: d.dxfVersion ?? null,
        sheets: d.sheets ?? [],
        layerCount: (d.layers ?? []).length,
        warnings: d.warnings ?? [],
      })),

    list_layers: async ({ file }) => {
      const rows = [];
      for (const { drawing, layer } of eachLayer()) {
        if (file && lc(drawing.file) !== lc(file)) continue;
        rows.push({
          file: drawing.file,
          layer: layer.layer,
          entities:
            (layer.line_count ?? 0) +
            (layer.polyline_count ?? 0) +
            (layer.circle_count ?? 0) +
            (layer.arc_count ?? 0) +
            (layer.hatch_count ?? 0) +
            (layer.insert_count ?? 0) +
            (layer.text_count ?? 0),
        });
      }
      return rows.sort((a, b) => b.entities - a.entities);
    },

    get_layer_geometry: async ({ layerLike }) => {
      const q = lc(layerLike);
      const rows = [];
      for (const { drawing, layer, f } of eachLayer()) {
        if (q && !lc(layer.layer).includes(q)) continue;
        rows.push({ file: drawing.file, units: drawing.units ?? null, ...layerGeometry(layer, f) });
      }
      if (!rows.length) return { matched: 0, note: `No layer name contains "${layerLike}". Call list_layers to see what exists.` };
      return { matched: rows.length, layers: rows };
    },

    count_blocks: async ({ nameLike }) => {
      const q = lc(nameLike);
      const totals = new Map();
      for (const d of draws) {
        for (const [name, n] of Object.entries(d.blockInstanceCounts ?? {})) {
          if (q && !lc(name).includes(q)) continue;
          const key = `${d.file}::${name}`;
          totals.set(key, { file: d.file, block: name, count: Number(n) || 0 });
        }
      }
      const rows = [...totals.values()].sort((a, b) => b.count - a.count);
      const grand = rows.reduce((s, r) => s + r.count, 0);
      return { matched: rows.length, totalInstances: grand, blocks: rows, exact: true };
    },

    get_schedules: async ({ titleLike }) => {
      const q = lc(titleLike);
      const rows = [];
      for (const d of draws) {
        for (const s of d.schedules ?? []) {
          if (q && !lc(s.title ?? "").includes(q)) continue;
          rows.push({ file: d.file, ...s });
        }
      }
      return { matched: rows.length, schedules: rows };
    },

    get_text_on_layer: async ({ layerLike, limit }) => {
      const q = lc(layerLike);
      const cap = Number(limit) > 0 ? Number(limit) : 80;
      const rows = [];
      for (const d of draws) {
        for (const t of d.textAnnotations ?? []) {
          if (q && !lc(t.layer).includes(q)) continue;
          rows.push({ file: d.file, layer: t.layer, text: t.text, sheet: t.sheet ?? null });
          if (rows.length >= cap) break;
        }
      }
      return { matched: rows.length, annotations: rows };
    },

    search_drawing: async ({ query }) => {
      const q = lc(query);
      if (!q) return { matched: 0, hits: [] };
      const hits = [];
      for (const d of draws) {
        for (const l of d.layers ?? []) if (lc(l.layer).includes(q)) hits.push({ file: d.file, kind: "layer", value: l.layer });
        for (const name of Object.keys(d.blockInstanceCounts ?? {}))
          if (lc(name).includes(q)) hits.push({ file: d.file, kind: "block", value: name, count: d.blockInstanceCounts[name] });
        for (const t of d.textAnnotations ?? [])
          if (lc(t.text).includes(q)) hits.push({ file: d.file, kind: "text", value: t.text, layer: t.layer });
        for (const s of d.schedules ?? [])
          if (JSON.stringify(s).toLowerCase().includes(q)) hits.push({ file: d.file, kind: "schedule", value: s.title ?? "(untitled)" });
      }
      return { matched: hits.length, hits: hits.slice(0, 60) };
    },

    get_dimensions: async ({ limit }) => {
      const cap = Number(limit) > 0 ? Number(limit) : 60;
      const rows = [];
      for (const d of draws) {
        const f = metreFactor(d.units);
        for (const dim of d.dimensions ?? []) {
          rows.push({
            file: d.file,
            layer: dim.layer ?? null,
            text: dim.text ?? null,
            measurement: dim.measurement ?? null,
            measurement_m: f != null && Number.isFinite(dim.measurement) ? round(dim.measurement * f) : null,
          });
          if (rows.length >= cap) break;
        }
      }
      return { matched: rows.length, dimensions: rows };
    },

    get_drawing_metadata: async () =>
      draws.map((d) => ({ file: d.file, units: d.units ?? null, titleBlock: d.titleBlockFields ?? {} })),

    search_documents: async ({ query, limit }) => {
      const q = lc(query);
      const cap = Number(limit) > 0 ? Number(limit) : 6;
      if (!q) return { matched: 0, excerpts: [] };
      const out = [];
      for (const doc of docs) {
        const text = String(doc.text ?? "");
        let from = 0;
        while (out.length < cap) {
          const at = text.toLowerCase().indexOf(q, from);
          if (at === -1) break;
          out.push({
            filename: doc.filename,
            excerpt: text.slice(Math.max(0, at - 300), at + 500).replace(/\s+/g, " ").trim(),
          });
          from = at + q.length;
        }
      }
      return { matched: out.length, excerpts: out };
    },
  };

  // Wrap each handler so every call is recorded. The trace is what lets a BOQ
  // line carry its working back to the estimator — a quantity whose derivation
  // cannot be replayed is not reviewable, and an unreviewable bill is the thing
  // this pipeline exists to avoid.
  const traced = {};
  for (const [name, fn] of Object.entries(handlers)) {
    traced[name] = async (args) => {
      const result = await fn(args ?? {});
      trace.push({ name, args: args ?? {}, result });
      return result;
    };
  }

  return { toolDefinitions: TOOL_DEFS, handlers: traced, trace, drawingCount: draws.length };
}

/**
 * Every layer, block and schedule title that genuinely exists in the drawings.
 *
 * Used to audit citations. An agent that writes "count of DOOR_SINGLE_900 = 5
 * (A-DOOR)" has produced a checkable claim, and a claim nobody checks is only a
 * more convincing kind of guess — the failure this pipeline exists to prevent is
 * a fabricated quantity an estimator cannot tell apart from a measured one.
 */
export function knownNames(extractions = []) {
  const layers = new Set();
  const blocks = new Set();
  const schedules = new Set();
  for (const d of extractions ?? []) {
    if (!d) continue;
    for (const l of d.layers ?? []) if (l?.layer) layers.add(lc(l.layer));
    for (const b of Object.keys(d.blockInstanceCounts ?? {})) blocks.add(lc(b));
    for (const s of d.schedules ?? []) if (s?.title) schedules.add(lc(s.title));
  }
  return { layers, blocks, schedules };
}

/**
 * A compact text summary, still used to seed the first turn so the agent starts
 * oriented rather than spending a tool call discovering the drawing exists.
 */
export function buildExtractionDigest(extractions = [], maxChars = 3000) {
  const draws = Array.isArray(extractions) ? extractions.filter(Boolean) : [];
  if (!draws.length) return "(no drawings have been parsed for this project)";
  const parts = [];
  for (const d of draws) {
    const f = metreFactor(d.units);
    const top = (d.layers ?? [])
      .slice()
      .sort((a, b) => (b.polyline_length_total ?? 0) - (a.polyline_length_total ?? 0))
      .slice(0, 8)
      .map((l) => {
        const g = layerGeometry(l, f);
        const area = g.largestClosedPolylineArea_m2;
        const len = g.polylineLengthTotal_m;
        const bits = [len != null ? `${len} m` : null, area != null ? `largest closed area ${area} m2` : null].filter(Boolean);
        return `  - ${l.layer}${bits.length ? ` (${bits.join(", ")})` : ""}`;
      })
      .join("\n");
    const blocks = Object.entries(d.blockInstanceCounts ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, c]) => `${n}=${c}`)
      .join(", ");
    parts.push(
      `FILE: ${d.file}  units=${d.units ?? "undeclared"}${f == null ? "  (geometry NOT convertible to metres)" : ""}\n` +
        `TOP LAYERS:\n${top || "  (none)"}\n` +
        `BLOCK COUNTS: ${blocks || "(none)"}\n` +
        `SCHEDULES: ${(d.schedules ?? []).map((s) => s.title ?? "(untitled)").join(", ") || "(none)"}`
    );
  }
  return parts.join("\n\n").slice(0, maxChars);
}

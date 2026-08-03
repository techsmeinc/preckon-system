// CAD understanding — turning a parsed drawing into facts an agent can price.
//
// Ported from AutoCAD-BOQ-Tender's cad-tools/cad-ingest. The single most
// important idea carried over: an agent must never invent a quantity. Every
// number it emits has to trace to something measured here. So this module's job
// is to present the drawing as a small set of TRUSTWORTHY numbers, already in
// metres, with the untrustworthy ones either converted or explicitly flagged.
//
// The subtlety that took that project a long time to learn, and which is the
// difference between a usable BOQ and a fictional one:
//
//   polylineAreaTotal SUMS every closed outline on a layer — the floor slab,
//   plus every furniture polygon, hatch boundary and overlapping detail drawn
//   on top of it. It routinely over-counts true floor area by 5–20×. The
//   LARGEST single closed outline, by contrast, is almost always the actual
//   footprint. So we surface the max, not the sum, and say so.

export interface CadLayer {
  layer: string;
  line_count: number;
  line_length_total: number;
  polyline_count: number;
  polyline_length_total: number;
  closed_polyline_count: number;
  polyline_area_total: number;
  hatch_area_total: number;
  closed_polyline_top_areas: number[];
  circle_count: number;
  arc_count: number;
  hatch_count: number;
  insert_count: number;
  text_count: number;
  dim_count: number;
  other_count: number;
}

export interface CadSummary {
  file: string;
  dxfVersion: string | null;
  units: string | null;
  sheets: string[];
  layers: CadLayer[];
  blockDefinitions: string[];
  blockInstanceCounts: Record<string, {
    total: number;
    byLayer: Record<string, number>;
    sheets: string[];
    sampleAttributes: Record<string, string>;
  }>;
  blockInstances?: Array<{ name: string; layer: string; sheet: string; attributes: Record<string, string> }>;
  textAnnotations: Array<{ layer: string; text: string; sheet: string }>;
  dimensions: Array<{ layer: string; measurement: number | null; text: string | null }>;
  titleBlockFields: Record<string, string>;
  schedules: Array<{ layer: string; header: string[]; rows: string[][] }>;
  warnings: string[];
}

/** Drawing units → metres. Null when the drawing declares no units: converting
 *  anyway would invent a scale, and a wrong scale is worse than none. */
export function metreFactor(units: string | null | undefined): number | null {
  switch ((units ?? "").toLowerCase()) {
    case "mm": return 0.001;
    case "cm": return 0.01;
    case "dm": return 0.1;
    case "m": return 1;
    case "inches": return 0.0254;
    case "feet": return 0.3048;
    default: return null;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Layers that carry annotation rather than construction. Their closed outlines
 *  are note boxes and title borders, not floor plates — excluding them is what
 *  stops "footprint = the drawing border". */
const ANNOTATION_LAYER = /(^|[-_])(anno|text|txt|dim|note|tag|title|tblk|border|frame|grid|hatch|legend|key|north|scale)([-_]|$)/i;

export interface MetricLayer {
  layer: string;
  /** Total run of lines + polylines, in metres. The signal for piping, cable,
   *  conduit, kerb, skirting, fencing. */
  runLength_m: number | null;
  /** The LARGEST single closed outline, in m². The reliable area signal —
   *  footprint, slab, floor plate, roof. */
  largestArea_m2: number | null;
  /** The SUM of every closed outline, in m². Over-counts badly; kept only so
   *  the digest can say so explicitly rather than leaving the agent to guess. */
  summedArea_m2: number | null;
  hatchArea_m2: number | null;
  inserts: number;
  dims: number;
  annotation: boolean;
}

export function metricLayers(summary: CadSummary): MetricLayer[] {
  const f = metreFactor(summary.units);
  const a = f == null ? null : f * f;
  return (summary.layers ?? []).map((l) => ({
    layer: l.layer,
    runLength_m: f == null ? null : round2((l.line_length_total + l.polyline_length_total) * f),
    largestArea_m2: a == null || !l.closed_polyline_top_areas?.length
      ? null
      : round2(Math.max(...l.closed_polyline_top_areas) * a),
    summedArea_m2: a == null ? null : round2(l.polyline_area_total * a),
    hatchArea_m2: a == null ? null : round2(l.hatch_area_total * a),
    inserts: l.insert_count,
    dims: l.dim_count,
    annotation: ANNOTATION_LAYER.test(l.layer),
  }));
}

/** The best available footprint: the largest closed outline on any construction
 *  layer. Returns null rather than guessing when the drawing is unitless. */
export function footprint(summary: CadSummary): { area_m2: number; layer: string } | null {
  let best = 0;
  let layer = "";
  for (const l of metricLayers(summary)) {
    if (l.annotation || l.largestArea_m2 == null) continue;
    if (l.largestArea_m2 > best) { best = l.largestArea_m2; layer = l.layer; }
  }
  return best > 0 ? { area_m2: best, layer } : null;
}

/**
 * The drawing rendered as text an agent can read inside a prompt.
 *
 * Bounded on purpose: a real design package can carry thousands of layers and
 * tens of thousands of annotations, and pasting all of it would crowd out the
 * specification. What survives the cut is what a quantity actually gets built
 * from — block counts, run lengths, areas, schedules, title block.
 */
export function cadDigest(summaries: Array<{ filename: string; summary: CadSummary }>, budget = 12_000): string {
  if (summaries.length === 0) return "";
  const out: string[] = [];
  out.push(`${summaries.length} CAD drawing(s) have been parsed. Every quantity you take from these must cite the layer or block it came from.`);

  for (const { filename, summary } of summaries) {
    const f = metreFactor(summary.units);
    out.push(`\n=== ${filename} ===`);
    out.push(`units: ${summary.units ?? "unstated"}${f == null
      ? "  ⚠ the drawing declares no units, so NO length or area below can be converted to metres — do not treat these numbers as m or m²."
      : ""}`);
    if (summary.sheets?.length) out.push(`sheets: ${summary.sheets.slice(0, 12).join(", ")}`);

    const tb = Object.entries(summary.titleBlockFields ?? {}).slice(0, 8);
    if (tb.length) out.push(`title block: ${tb.map(([k, v]) => `${k}=${v}`).join(", ")}`);

    const fp = footprint(summary);
    if (fp) {
      out.push(`FOOTPRINT ≈ ${fp.area_m2} m² — the largest closed outline, on layer "${fp.layer}". This is the trustworthy area. Use it for slab, floor finish, ceiling and roof lines. Cross-check against any overall dimensions stated in the documents.`);
    }

    // Counted items — the cleanest signal in any drawing, and the only one that
    // needs no unit conversion at all.
    const blocks = Object.entries(summary.blockInstanceCounts ?? {})
      .sort((x, y) => (y[1]?.total ?? 0) - (x[1]?.total ?? 0))
      .slice(0, 40);
    if (blocks.length) {
      out.push(`BLOCK COUNTS (exact — use directly for EA/Set quantities):`);
      for (const [name, agg] of blocks) {
        const byLayer = Object.entries(agg.byLayer ?? {}).slice(0, 4).map(([l, n]) => `${l}:${n}`).join(" ");
        const attrs = Object.entries(agg.sampleAttributes ?? {}).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(" ");
        out.push(`  ${name} × ${agg.total}${byLayer ? `  [${byLayer}]` : ""}${attrs ? `  (${attrs})` : ""}`);
      }
    }

    const layers = metricLayers(summary)
      .filter((l) => !l.annotation && (l.runLength_m || l.largestArea_m2 || l.inserts))
      .sort((x, y) => (y.runLength_m ?? 0) + (y.largestArea_m2 ?? 0) - ((x.runLength_m ?? 0) + (x.largestArea_m2 ?? 0)))
      .slice(0, 40);
    if (layers.length) {
      out.push(`LAYER GEOMETRY (already converted to metres):`);
      for (const l of layers) {
        const bits: string[] = [];
        if (l.runLength_m) bits.push(`run ${l.runLength_m} m`);
        if (l.largestArea_m2) bits.push(`largest closed area ${l.largestArea_m2} m²`);
        if (l.summedArea_m2 && l.largestArea_m2 && l.summedArea_m2 > l.largestArea_m2 * 1.2) {
          bits.push(`(summed ${l.summedArea_m2} m² — over-counts, do not use)`);
        }
        if (l.hatchArea_m2) bits.push(`hatch ${l.hatchArea_m2} m²`);
        if (l.inserts) bits.push(`${l.inserts} inserts`);
        out.push(`  ${l.layer}: ${bits.join(", ")}`);
      }
    }

    for (const s of (summary.schedules ?? []).slice(0, 6)) {
      out.push(`SCHEDULE on ${s.layer}: ${s.header.join(" | ")}`);
      for (const r of s.rows.slice(0, 25)) out.push(`  ${r.join(" | ")}`);
      if (s.rows.length > 25) out.push(`  … ${s.rows.length - 25} more rows`);
    }

    // Dimensions carry the designer's own measurements — often the only stated
    // figure for a span or thickness.
    const dims = (summary.dimensions ?? []).filter((d) => d.measurement != null).slice(0, 25);
    if (dims.length && f != null) {
      out.push(`DIMENSIONS (m): ${dims.map((d) => round2((d.measurement as number) * f)).join(", ")}`);
    }

    const notes = (summary.textAnnotations ?? [])
      .map((t) => t.text.trim())
      .filter((t) => t.length > 3 && t.length < 200);
    if (notes.length) {
      out.push(`DRAWING NOTES: ${[...new Set(notes)].slice(0, 60).join(" · ")}`);
    }

    if (summary.warnings?.length) out.push(`warnings: ${summary.warnings.slice(0, 4).join("; ")}`);
  }

  const text = out.join("\n");
  return text.length > budget ? text.slice(0, budget) + "\n… (CAD digest truncated)" : text;
}

/**
 * The same drawing rendered as plain readable text for the file_page store.
 *
 * This is what makes CAD searchable alongside PDFs with no other changes: a
 * .dxf gets pages in `file_page` like any document, so retrieval, the Documents
 * screen and the existing text-inlining path all work on it untouched.
 */
export function cadAsPageText(summary: CadSummary): string {
  const lines: string[] = [];
  lines.push(`CAD drawing: ${summary.file}`);
  lines.push(`Units: ${summary.units ?? "unstated"}. Sheets: ${(summary.sheets ?? []).join(", ") || "—"}.`);
  const tb = Object.entries(summary.titleBlockFields ?? {});
  if (tb.length) lines.push(`Title block: ${tb.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  const fp = footprint(summary);
  if (fp) lines.push(`Largest closed outline: ${fp.area_m2} m² on layer ${fp.layer}.`);
  const blocks = Object.entries(summary.blockInstanceCounts ?? {}).sort((a, b) => b[1].total - a[1].total);
  if (blocks.length) lines.push(`Blocks: ${blocks.map(([n, a]) => `${n} × ${a.total}`).join(", ")}`);
  for (const l of metricLayers(summary)) {
    if (l.annotation) continue;
    const bits = [
      l.runLength_m ? `${l.runLength_m} m run` : "",
      l.largestArea_m2 ? `${l.largestArea_m2} m² largest area` : "",
      l.inserts ? `${l.inserts} inserts` : "",
    ].filter(Boolean);
    if (bits.length) lines.push(`Layer ${l.layer}: ${bits.join(", ")}`);
  }
  for (const s of summary.schedules ?? []) {
    lines.push(`Schedule (${s.layer}): ${s.header.join(" | ")}`);
    for (const r of s.rows) lines.push(`  ${r.join(" | ")}`);
  }
  const notes = [...new Set((summary.textAnnotations ?? []).map((t) => t.text.trim()).filter(Boolean))];
  if (notes.length) lines.push(`Annotations: ${notes.join(" · ")}`);
  return lines.join("\n");
}

/* ── The sidecar ──────────────────────────────────────────────────────────── */

const CAD_URL = process.env.CAD_URL ?? "http://localhost:7400";

export const isCadFile = (name: string) => /\.(dxf|dwg)$/i.test(name);

export interface CadExtractOutcome {
  ok: boolean;
  summary?: CadSummary;
  error?: string;
}

/** Parse a drawing. Never throws: a drawing we can't read must not fail the
 *  upload — the file is still stored and the estimator is told why. */
export async function extractCad(storagePath: string, filename?: string): Promise<CadExtractOutcome> {
  try {
    const res = await fetch(`${CAD_URL}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: storagePath, filename }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: String(body?.detail ?? `CAD service returned ${res.status}`) };
    return { ok: true, summary: body as CadSummary };
  } catch (e: any) {
    const msg = e?.name === "TimeoutError"
      ? "The drawing took too long to parse (over 2 minutes)."
      : `The CAD service is unreachable (${e?.message ?? e}).`;
    return { ok: false, error: msg };
  }
}

export interface CadRenderOutcome {
  svg: string | null;
  /** Why it didn't render, in words an estimator can act on. Null on success. */
  error: string | null;
  /** Entity types dropped to get the sheet under the size ceiling, if any. */
  degraded: string[];
}

/** Render a drawing to SVG for the Drawings stage. Never throws — a drawing
 *  that measures fine but won't render is still fully useful, and the upload
 *  must not fail over a preview.
 *
 *  The reason is returned rather than swallowed: it is persisted alongside the
 *  row so the viewer can tell the estimator what to do about it. A missing xref
 *  and a sheet too dense to draw are different problems with different answers,
 *  and "could not be rendered" is neither. */
export async function renderCad(storagePath: string): Promise<CadRenderOutcome> {
  try {
    const res = await fetch(`${CAD_URL}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: storagePath }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        svg: null,
        error: String(body?.detail ?? `The renderer returned ${res.status}.`).slice(0, 1000),
        degraded: [],
      };
    }
    if (typeof body?.svg !== "string" || body.svg.length === 0) {
      return { svg: null, error: "The renderer returned an empty sheet.", degraded: [] };
    }
    return { svg: body.svg, error: null, degraded: Array.isArray(body.degraded) ? body.degraded : [] };
  } catch (e: any) {
    const msg = e?.name === "TimeoutError"
      ? "The drawing took too long to render (over 3 minutes)."
      : `The CAD service is unreachable (${e?.message ?? e}).`;
    return { svg: null, error: msg.slice(0, 1000), degraded: [] };
  }
}

/** Convert a drawing to DXF and return the bytes. A .dxf comes back as-is; a
 *  .dwg is converted by the same path extraction used, so what downloads is
 *  exactly what was measured — not a fresh export that may have moved on. */
export async function dxfOf(storagePath: string, filename?: string): Promise<{ bytes: Buffer } | { error: string }> {
  try {
    const res = await fetch(`${CAD_URL}/dxf`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: storagePath, filename }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { error: String(body?.detail ?? `The CAD service returned ${res.status}.`) };
    }
    return { bytes: Buffer.from(await res.arrayBuffer()) };
  } catch (e: any) {
    return {
      error: e?.name === "TimeoutError"
        ? "The conversion took too long (over 3 minutes)."
        : `The CAD service is unreachable (${e?.message ?? e}).`,
    };
  }
}

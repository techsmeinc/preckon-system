/**
 * PDF → DXF conversion (vector PDFs only). Reads a CAD-plotted PDF's graphics
 * operators via pdf.js (through unpdf) and rebuilds them as an editable `DxfModel`
 * — the SAME model the DXF editor and copilot already operate on — so a converted
 * PDF drops straight into "edit → copilot → export" with no separate code path.
 *
 * What it recovers:
 *  - Vector paths (lines, polylines, rectangles, flattened Bézier curves) as
 *    LINE / closed-or-open POLYLINE entities, in the drawing's own coordinates.
 *  - Text (labels, room names, dimensions) with position + height, via
 *    `getTextContent()` (robust text placement).
 *  - Layer structure by stroke/fill colour — CAD assigns a colour per layer when
 *    plotting, so colour is the best available proxy for the original layers.
 *
 * What it CANNOT do: vectorise a scanned / raster PDF (an image, not vector paths).
 * That needs raster tracing + OCR and is out of scope; we detect it and say so.
 *
 * Units: PDF user space is points (1/72"), Y-up — same handedness as DXF. We convert
 * to millimetres so the DXF equals the true paper size at 1:1 ($INSUNITS = 4, mm).
 * If the sheet was plotted at 1:N, pass `scale = N` (or scale later in the copilot)
 * to recover model-space dimensions.
 *
 * Server-only (pdf.js runs in Node). Pure aside from the pdf.js read; no DB/DOM.
 */

import type { DxfModel, Entity, ModelLayer } from "@/domain/dxf-model";
import { cleanText } from "@/domain/dxf-model";

const PT_TO_MM = 25.4 / 72;
const BEZIER_STEPS = 16;
const MAX_ENTITIES = 80_000; // per-page cap — protects the renderer on one huge sheet
const MAX_TOTAL_ENTITIES = 400_000; // safety ceiling across all returned pages
const MAX_PAGES = 60; // never return more than this many separate drawings

/** How a page was classified from its vector-geometry density. */
export type PageKind = "drawing" | "text" | "empty";

export interface PageInfo {
  page: number; // 1-based
  kind: PageKind;
  segments: number; // vector line/polyline segments (the drawing signal)
  textChars: number;
  included: boolean;
}

/** Which pages to convert: auto-detect drawing sheets, all pages, or an explicit list. */
export type PageSelection = "auto" | "all" | number[];

export interface PdfConvertOptions {
  /** Plot-scale denominator (1:N). Default 1 → output is paper size in mm. */
  scale?: number;
  /** Page selection. Default "auto" → only pages classified as drawing sheets. */
  pages?: PageSelection;
}

/** One converted PDF page, as its own standalone editable drawing. */
export interface PdfPage {
  page: number; // 1-based source page number
  kind: PageKind;
  model: DxfModel;
  entities: number;
  truncated: boolean; // this page alone exceeded the per-page cap
}

export interface PdfConvertResult {
  pages: PdfPage[];
  stats: { pages: number; converted: number; paths: number; texts: number; lines: number };
  pageReport: PageInfo[];
  warning?: string;
}

// A page needs at least this many vector segments to count as a drawing sheet
// (a prose/spec page has ~0; a real plan has hundreds–thousands).
const MIN_DRAWING_SEGMENTS = 24;

// 2×3 affine matrix [a,b,c,d,e,f], PDF row-vector convention:
//   x' = a·x + c·y + e ,  y' = b·x + d·y + f
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Apply matrix m to a local point, returning page-space coords. */
function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Compose: the result applies `inner` first, then `outer` (PDF `cm` pre-concat). */
function compose(inner: Mat, outer: Mat): Mat {
  const [a, b, c, d, e, f] = inner;
  const [A, B, C, D, E, F] = outer;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

// Representative RGB for the standard AutoCAD colour indices we render, so a PDF
// stroke colour maps to the nearest ACI (the editor colours layers by ACI).
const ACI_RGB: [number, [number, number, number]][] = [
  [1, [255, 0, 0]],
  [2, [255, 255, 0]],
  [3, [0, 255, 0]],
  [4, [0, 255, 255]],
  [5, [0, 0, 255]],
  [6, [255, 0, 255]],
  [30, [255, 128, 0]],
  [8, [65, 65, 65]],
  [9, [128, 128, 128]],
  [7, [0, 0, 0]],
];
function nearestAci(r: number, g: number, b: number): number {
  let best = 7;
  let bestD = Infinity;
  for (const [aci, [R, G, B]] of ACI_RGB) {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) {
      bestD = d;
      best = aci;
    }
  }
  return best;
}
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
const layerForColor = (r: number, g: number, b: number) => `PDF-${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

type RGB = [number, number, number];
const rgbOf = (arg: unknown): RGB => {
  const a = arg as ArrayLike<number>;
  return [Number(a?.[0]) || 0, Number(a?.[1]) || 0, Number(a?.[2]) || 0];
};

/** Flatten a cubic Bézier (p0→c1→c2→p1) into line points, excluding the start. */
function flattenCubic(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= BEZIER_STEPS; i++) {
    const t = i / BEZIER_STEPS;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push([w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3, w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3]);
  }
  return out;
}

/**
 * Convert a vector PDF buffer to an editable DxfModel.
 *
 * Mixed PDFs (spec/cover text pages + drawing sheets) are handled by classifying
 * each page from its vector-geometry density: a page with real linework is a
 * drawing sheet (converted); a prose page has ~none (skipped). Override with
 * `pages: "all"` or an explicit page-number list.
 */
export async function pdfToModel(buf: Buffer, opts: PdfConvertOptions = {}): Promise<PdfConvertResult> {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const selection: PageSelection = opts.pages ?? "auto";
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const pdfjs = await getResolvedPDFJS();
  const OPS = pdfjs.OPS as Record<string, number>;

  const doc = await getDocumentProxy(new Uint8Array(buf), {
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  } as Parameters<typeof getDocumentProxy>[1]);

  const sc = PT_TO_MM * scale;
  const wantPage = (n: number) => (selection === "all" ? true : selection === "auto" ? null : selection.includes(n));

  const pages: PdfPage[] = []; // one standalone drawing per included page
  const pageReport: PageInfo[] = [];
  let imageOps = 0;
  let totalEnts = 0;
  let overflow = 0; // included pages dropped because a size ceiling was hit

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const view = page.view as number[]; // [x0,y0,x1,y1] MediaBox
    const ox = view[0] || 0;
    const oy = view[1] || 0;

    // Build this page's entities in page-local mm (bottom-left origin). Each page is
    // its own drawing, so no cross-page offset — origins stay at the sheet corner.
    const pageEnts: Entity[] = [];
    let pageSegments = 0;
    let pageTextChars = 0;

    // Map a local path point through the current CTM to page-local (mm) coords.
    const toOut = (ctm: Mat, x: number, y: number): { x: number; y: number } => {
      const [px, py] = apply(ctm, x, y);
      return { x: (px - ox) * sc, y: (py - oy) * sc };
    };

    // ---- Vector paths (getOperatorList) ----
    const ol = await page.getOperatorList();
    const ctmStack: Mat[] = [];
    let ctm: Mat = IDENTITY;
    let strokeRGB: RGB = [0, 0, 0];
    let fillRGB: RGB = [0, 0, 0];
    // A path pending its paint op: subpaths of local points + the CTM in force.
    let pending: { subpaths: [number, number][][]; closed: boolean[]; ctm: Mat } | null = null;

    const emit = (color: RGB) => {
      if (!pending) return;
      const layer = layerForColor(color[0], color[1], color[2]);
      for (let s = 0; s < pending.subpaths.length; s++) {
        if (pageEnts.length >= MAX_ENTITIES) break; // per-page cap
        const raw = pending.subpaths[s];
        if (raw.length < 2) continue;
        const pts = raw.map(([x, y]) => toOut(pending!.ctm, x, y));
        if (pts.length === 2) {
          pageEnts.push({ kind: "line", layer, x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y });
        } else {
          pageEnts.push({ kind: "poly", layer, pts, closed: pending.closed[s] });
        }
        pageSegments++;
      }
      pending = null;
    };

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const args = ol.argsArray[i];
      switch (fn) {
        case OPS.save:
          ctmStack.push(ctm);
          break;
        case OPS.restore:
          ctm = ctmStack.pop() ?? IDENTITY;
          break;
        case OPS.transform:
          ctm = compose(args as unknown as Mat, ctm);
          break;
        case OPS.setStrokeRGBColor:
          // args IS the colour array ([r,g,b], 0–255) — not args[0].
          strokeRGB = rgbOf(args);
          break;
        case OPS.setFillRGBColor:
          fillRGB = rgbOf(args);
          break;
        case OPS.constructPath: {
          const subOps = args[0] as number[];
          const coords = args[1] as number[];
          const subpaths: [number, number][][] = [];
          const closed: boolean[] = [];
          let cur: [number, number][] = [];
          let cx = 0;
          let cy = 0;
          let ci = 0;
          const start = () => {
            if (cur.length) {
              subpaths.push(cur);
              closed.push(false);
            }
            cur = [];
          };
          for (const so of subOps) {
            if (so === OPS.moveTo) {
              start();
              cx = coords[ci++];
              cy = coords[ci++];
              cur.push([cx, cy]);
            } else if (so === OPS.lineTo) {
              cx = coords[ci++];
              cy = coords[ci++];
              cur.push([cx, cy]);
            } else if (so === OPS.curveTo) {
              const x1 = coords[ci++];
              const y1 = coords[ci++];
              const x2 = coords[ci++];
              const y2 = coords[ci++];
              const x3 = coords[ci++];
              const y3 = coords[ci++];
              for (const p of flattenCubic(cx, cy, x1, y1, x2, y2, x3, y3)) cur.push(p);
              cx = x3;
              cy = y3;
            } else if (so === OPS.rectangle) {
              const x = coords[ci++];
              const y = coords[ci++];
              const w = coords[ci++];
              const h = coords[ci++];
              start();
              subpaths.push([
                [x, y],
                [x + w, y],
                [x + w, y + h],
                [x, y + h],
              ]);
              closed.push(true);
              cur = [];
              cx = x;
              cy = y;
            } else if (so === OPS.closePath) {
              if (cur.length) {
                subpaths.push(cur);
                closed.push(true);
                cur = [];
              }
            }
          }
          if (cur.length) {
            subpaths.push(cur);
            closed.push(false);
          }
          pending = { subpaths, closed, ctm };
          break;
        }
        case OPS.paintImageXObject:
        case OPS.paintInlineImageXObject:
        case OPS.paintImageMaskXObject:
          imageOps++;
          break;
        case OPS.endPath: // clip path / no paint — discard
          pending = null;
          break;
        default:
          // Any paint op flushes the pending path with the right colour.
          if (pending) {
            const name = FN_NAME(OPS, fn);
            if (name && /stroke/i.test(name)) emit(strokeRGB);
            else if (name && /fill/i.test(name)) emit(fillRGB);
          }
          break;
      }
    }

    // ---- Text (getTextContent gives baked-in positions) ----
    const pageTexts: Entity[] = [];
    try {
      const tc = await page.getTextContent();
      for (const item of tc.items as { str?: string; transform?: number[]; height?: number }[]) {
        const raw = (item.str ?? "").trim();
        if (!raw) continue;
        pageTextChars += raw.length;
        if (pageEnts.length + pageTexts.length >= MAX_ENTITIES) continue; // per-page cap
        const t = cleanText(raw);
        if (!t) continue;
        const tr = item.transform ?? [1, 0, 0, 1, 0, 0];
        const x = (tr[4] - ox) * sc;
        const y = (tr[5] - oy) * sc;
        const h = (Math.hypot(tr[1], tr[3]) || item.height || 2) * sc;
        pageTexts.push({ kind: "text", layer: "PDF-TEXT", text: t, x, y, h });
      }
    } catch {
      // no text layer — leave geometry as-is
    }

    // ---- Classify the page from its vector density, then include or skip ----
    const kind: PageKind = pageSegments >= MIN_DRAWING_SEGMENTS ? "drawing" : pageSegments > 0 || pageTextChars > 0 ? "text" : "empty";
    const forced = wantPage(pageNo); // true/false for all/list; null for auto
    const included = forced ?? kind === "drawing";
    pageReport.push({ page: pageNo, kind, segments: pageSegments, textChars: pageTextChars, included });

    if (included) {
      const ents = [...pageEnts, ...pageTexts];
      const pageTruncated = pageEnts.length >= MAX_ENTITIES; // hit the per-page ceiling
      // Respect the overall ceilings so a giant document can't blow up the payload.
      if (pages.length >= MAX_PAGES || totalEnts + ents.length > MAX_TOTAL_ENTITIES) {
        overflow++;
      } else {
        // Each page is its own drawing — layers derived from just this page's colours.
        const layerNames = new Set(ents.map((e) => e.layer));
        const layers: ModelLayer[] = [...layerNames].map((name) => ({ name, aci: aciForLayer(name), visible: true }));
        if (!layers.length) layers.push({ name: "0", aci: 7, visible: true });
        pages.push({ page: pageNo, kind, model: { layers, entities: ents, insunits: 4 }, entities: ents.length, truncated: pageTruncated });
        totalEnts += ents.length;
      }
    }
    page.cleanup?.();
  }

  const converted = pages.length;
  const skippedText = pageReport.filter((p) => !p.included && p.kind === "text").length;
  const allEntities = pages.flatMap((p) => p.model.entities);

  let warning: string | undefined;
  if (allEntities.length === 0) {
    if (selection === "auto" && skippedText > 0) {
      warning = `No drawing sheets detected — all ${skippedText} page(s) look like text/spec pages. If this file IS a drawing, set Pages to "all" or the sheet's page number.`;
    } else {
      warning =
        imageOps > 0
          ? "This looks like a scanned / image-only PDF — it has no vector geometry to convert. Vectorising raster drawings (OCR / line tracing) isn't supported; export a vector PDF from your CAD tool."
          : "No vector geometry was found in this PDF.";
    }
  } else {
    const parts: string[] = [];
    if (doc.numPages > 1) parts.push(`Split into ${converted} separate drawing${converted === 1 ? "" : "s"} from ${doc.numPages} page(s)${skippedText ? `; skipped ${skippedText} text/spec page(s)` : ""}.`);
    if (overflow > 0) parts.push(`${overflow} further page(s) were skipped to stay under the size ceiling.`);
    const truncPages = pages.filter((p) => p.truncated).map((p) => p.page);
    if (truncPages.length) parts.push(`Page(s) ${truncPages.join(", ")} were very large and capped at ${MAX_ENTITIES.toLocaleString()} entities each.`);
    if (!parts.length && imageOps > 0) parts.push("Raster images were skipped — only vector linework and text were converted.");
    warning = parts.join(" ") || undefined;
  }

  // Stats derived from what actually made it into the drawings (no double-counting).
  const lineCount = allEntities.reduce((n, e) => n + (e.kind === "line" ? 1 : 0), 0);
  const polyCount = allEntities.reduce((n, e) => n + (e.kind === "poly" ? 1 : 0), 0);
  const textCount = allEntities.reduce((n, e) => n + (e.kind === "text" ? 1 : 0), 0);

  return {
    pages,
    stats: { pages: doc.numPages, converted, paths: lineCount + polyCount, texts: textCount, lines: lineCount },
    pageReport,
    warning,
  };
}

/** ACI for a layer name: PDF-TEXT → yellow; PDF-RRGGBB → nearest ACI; else 7. */
function aciForLayer(name: string): number {
  if (name === "PDF-TEXT") return 2;
  const m = /^PDF-([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(name);
  if (m) return nearestAci(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
  return 7;
}

/** Reverse-lookup an OPS numeric code to its name (cached per OPS object). */
const FN_NAME_CACHE = new WeakMap<object, Record<number, string>>();
function FN_NAME(OPS: Record<string, number>, fn: number): string | undefined {
  let rev = FN_NAME_CACHE.get(OPS);
  if (!rev) {
    rev = {};
    for (const [k, v] of Object.entries(OPS)) rev[v] = k;
    FN_NAME_CACHE.set(OPS, rev);
  }
  return rev[fn];
}

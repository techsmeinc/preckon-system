import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { route } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";

// GET /projects/{pid}/files/{fid}/cad/svg — the rendered sheet, on its own.
//
// It used to travel inside the /cad JSON, which meant the measured facts —
// units, layers, block counts, the things somebody opened the panel to read —
// could not paint until megabytes of drawing had downloaded and been
// JSON-parsed. Split out, the panel appears immediately and the drawing arrives
// behind it.
//
// "Megabytes" is not a figure of speech: these average 9 MB and reach 37 MB.
// ezdxf writes one <path> per entity with full-precision coordinates, so a
// dense plan is a million numbers. Two things make that survivable, and both
// happen here:
//
//   - It is gzipped. Path data is the most compressible text there is — the
//     same few tokens and digits, forever — and it comes down roughly tenfold.
//     Done explicitly rather than left to the server or a proxy in front of it,
//     because "probably compressed" is not a thing to leave a 9 MB response to.
//
//   - The compressed bytes are kept in memory. Compressing 9 MB costs real CPU;
//     paying it once per sheet instead of once per reader is the difference
//     between a viewer and a load generator.
//
// Served as image/svg+xml rather than a JSON string: no escaping, no re-parse,
// and it can be pointed at by an <img>, which is how the viewer avoids building
// a DOM out of a million nodes.

const gzipAsync = promisify(gzip);

/** Enough for the sheet being read and the two the panel warms either side.
 *  These are ~1 MB each compressed, so the ceiling is a few MB of process
 *  memory — cheap next to re-reading and re-compressing 9 MB per request. */
const MAX_CACHED = 4;
const cache = new Map<string, { raw: Buffer; gz: Buffer }>();

export const GET = route<{ pid: string; fid: string }>(async (req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const meta = await queryOne<{ rendered_at: Date | null; has_svg: number }>(
    `SELECT c.rendered_at, c.svg IS NOT NULL AS has_svg FROM cad_extraction c
      WHERE c.tenant_id = ? AND c.project_id = ? AND c.file_id = ?`,
    [ctx.tenantId, pid, fid]
  );
  if (!meta?.has_svg) throw errNotFound("Rendered sheet");

  // A drawing nobody re-rendered is byte-identical to last time, so say so and
  // let the browser skip the transfer entirely. Checked before the sheet is
  // read, so a 304 costs one small query and nothing else.
  const key = `${ctx.tenantId}:${fid}:${meta.rendered_at?.getTime() ?? 0}`;
  const tag = `"${fid}-${meta.rendered_at?.getTime() ?? 0}"`;
  if (req.headers.get("if-none-match") === tag) {
    return new Response(null, { status: 304, headers: { etag: tag, "cache-control": CACHE } });
  }

  let entry = cache.get(key);
  if (!entry) {
    const row = await queryOne<{ svg: string | null }>(
      `SELECT c.svg FROM cad_extraction c
        WHERE c.tenant_id = ? AND c.project_id = ? AND c.file_id = ?`,
      [ctx.tenantId, pid, fid]
    );
    if (!row?.svg) throw errNotFound("Rendered sheet");
    const raw = Buffer.from(withSelfContainedStrokes(row.svg), "utf8");
    entry = { raw, gz: await gzipAsync(raw) };
    cache.delete(key);                 // re-insert so it counts as most recent
    cache.set(key, entry);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  }

  const wantsGzip = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
  const body = wantsGzip ? entry.gz : entry.raw;

  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-length": String(body.length),
      "cache-control": CACHE,
      etag: tag,
      // Vary, because the same URL answers with two different encodings and a
      // cache that ignored this could hand gzip to a client that never asked.
      vary: "accept-encoding",
      ...(wantsGzip ? { "content-encoding": "gzip" } : {}),
    },
  });
});

const CACHE = "private, max-age=86400, stale-while-revalidate=604800";

/**
 * Make the sheet legible on its own, without the page's stylesheet.
 *
 * ezdxf writes stroke widths in DRAWING units against a viewBox a million units
 * across — about 0.014px once fitted to a panel, which renders as a blank white
 * page. The viewer has always corrected that with a CSS rule, but a rule in the
 * page only reaches an SVG that has been inlined into the page's DOM.
 *
 * Putting the same correction inside the SVG lets it be used as an <img>, which
 * is the whole point: an <img> is decoded by the browser's image pipeline, off
 * the main thread, with no DOM nodes, no CSS matching and no layout for what
 * can be a million elements. The page's own rule is more specific, so when the
 * sheet IS inlined — to zoom in past the point where a scaled image blurs —
 * the zoom-aware version still wins.
 */
function withSelfContainedStrokes(svg: string): string {
  if (svg.includes("data-preckon-strokes")) return svg;
  const open = svg.indexOf(">");
  if (open < 0 || !/^\s*<svg[\s>]/i.test(svg)) return svg;
  // Every attribute is quoted, and the CSS carries no <, > or & — because an
  // SVG behind an <img> is parsed as STRICT XML, not as HTML. A bare attribute
  // like `data-preckon-strokes` is legal in HTML and a fatal parse error in
  // XML, and a fatal parse error means the browser renders nothing at all: no
  // drawing, no error, just the alt text.
  const style =
    `<style type="text/css" data-preckon-strokes="1">` +
    `svg [class]{vector-effect:non-scaling-stroke;stroke-width:1.1}` +
    `</style>`;
  return svg.slice(0, open + 1) + style + svg.slice(open + 1);
}

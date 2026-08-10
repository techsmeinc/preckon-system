import path from "node:path";
import { promises as fs } from "node:fs";
import { requirePermission, requireProject } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errBadRequest } from "@/lib/errors";
import { route } from "@/lib/http";
import { dxfOf, isCadFile } from "@/lib/cad";

// GET /projects/{pid}/files/{fid}/dxf — the drawing as DXF.
//
// DWG is a closed binary format nothing outside AutoCAD opens. DXF is the
// interchange format every CAD application reads, and the sidecar already
// converts to it on the way into extraction — so this hands back the same
// converted bytes the measurements were taken from. That identity is the point:
// a fresh export from AutoCAD is a DIFFERENT drawing, possibly a later one, and
// checking a disputed quantity against it proves nothing.
//
// It is also the honest fallback when a sheet is too dense to draw in a browser.
// "Could not be rendered, here is the file, open it in your CAD application" is
// a dead end an estimator can actually walk out of.
//
// This route is what the Drawing editor opens, so its speed is the editor's
// speed. See the two short-circuits below: neither of them existed, and between
// them they were costing an ODA conversion on every single open.

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.uploads";

/** Private, because a drawing is tenant data and must not sit in a shared proxy. */
const CACHE = "private, max-age=86400, stale-while-revalidate=604800";

export const GET = route<{ pid: string; fid: string }>(async (req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{ storage_key: string; filename: string }>(
    "SELECT storage_key, filename FROM file WHERE tenant_id = ? AND project_id = ? AND id = ?",
    [ctx.tenantId, pid, fid]
  );
  if (!row) throw errNotFound("file");
  if (!isCadFile(row.filename)) throw errBadRequest("this file is not a drawing");

  // An uploaded file never changes: a revised drawing is a new upload with a new
  // id. So the id IS the version, and a second open is a 304.
  const etag = `"dxf-${fid}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": CACHE } });
  }

  const src = path.join(STORAGE_DIR, row.storage_key);
  const bytes = await dxfBytes(src, row.filename);
  if ("error" in bytes) throw errBadRequest(bytes.error);

  const name = row.filename.replace(/\.[^.]+$/, "") + ".dxf";
  return new Response(new Uint8Array(bytes.buf), {
    headers: {
      "content-type": "image/vnd.dxf",
      // Quoted and ASCII-escaped: drawing names routinely carry spaces, commas
      // and '&', any of which would truncate a bare filename= value.
      "content-disposition": `attachment; filename="${name.replace(/["\\]/g, "_")}"`,
      "content-length": String(bytes.buf.length),
      "cache-control": CACHE,
      etag,
    },
  });
});

/**
 * The DXF for a drawing, converting only when there is no other way to get it.
 *
 * Three paths, cheapest first:
 *
 *  1. The upload IS a .dxf. Nothing to convert — hand back the stored bytes.
 *     This went through the sidecar for no reason at all.
 *
 *  2. A .dwg converted on some earlier open. The result is kept beside the
 *     original, so this is a file read.
 *
 *  3. A .dwg nobody has converted yet. Run the ODA converter, and keep what it
 *     produces. This is the slow path — up to three minutes on a dense sheet —
 *     and it used to be EVERY path: opening the same drawing ten times ran ten
 *     conversions, which is what "Opening the drawing…" was sitting on.
 *
 * The conversion is deterministic and the source bytes never change, so the
 * cached file needs no invalidation. It is beside the upload it came from, so
 * deleting the file takes its conversion with it.
 */
async function dxfBytes(src: string, filename: string): Promise<{ buf: Buffer } | { error: string }> {
  if (/\.dxf$/i.test(filename)) {
    try {
      return { buf: await fs.readFile(src) };
    } catch {
      return { error: "The uploaded drawing is no longer in storage." };
    }
  }

  const cached = `${src}.converted.dxf`;
  try {
    return { buf: await fs.readFile(cached) };
  } catch { /* not converted yet — fall through */ }

  const out = await dxfOf(src, filename);
  if ("error" in out) return { error: out.error };

  // Written to a temporary name and renamed, so a request that dies mid-write
  // cannot leave a truncated DXF behind for the next reader to open. Failing to
  // cache is not failing the request — it only means the next open converts too.
  const tmp = `${cached}.${process.pid}.part`;
  try {
    await fs.writeFile(tmp, out.bytes);
    await fs.rename(tmp, cached);
  } catch {
    await fs.unlink(tmp).catch(() => { /* nothing to clean up */ });
  }
  return { buf: out.bytes };
}

import path from "node:path";
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

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.uploads";

export const GET = route<{ pid: string; fid: string }>(async (_req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{ storage_key: string; filename: string }>(
    "SELECT storage_key, filename FROM file WHERE tenant_id = ? AND project_id = ? AND id = ?",
    [ctx.tenantId, pid, fid]
  );
  if (!row) throw errNotFound("file");
  if (!isCadFile(row.filename)) throw errBadRequest("this file is not a drawing");

  const out = await dxfOf(path.join(STORAGE_DIR, row.storage_key), row.filename);
  if ("error" in out) throw errBadRequest(out.error);

  const name = row.filename.replace(/\.[^.]+$/, "") + ".dxf";
  return new Response(new Uint8Array(out.bytes), {
    headers: {
      "content-type": "image/vnd.dxf",
      // Quoted and ASCII-escaped: drawing names routinely carry spaces, commas
      // and '&', any of which would truncate a bare filename= value.
      "content-disposition": `attachment; filename="${name.replace(/["\\]/g, "_")}"`,
      "content-length": String(out.bytes.length),
      "cache-control": "private, no-store",
    },
  });
});

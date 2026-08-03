import path from "node:path";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { renderCad } from "@/lib/cad";

// POST /projects/{pid}/files/{fid}/cad/render — draw (or re-draw) the sheet.
//
// WHY THIS EXISTS. The rendered sheet used to be computed exactly once, inside
// the upload request, and any failure was swallowed to a NULL column. From then
// on the Drawings stage said "this drawing measured cleanly but could not be
// rendered" forever — no reason, no retry, and no way back short of deleting
// the file and uploading it again. Yet the failures are overwhelmingly
// transient or since-fixed: the sidecar was still starting, the converter was
// not yet installed, or the renderer has since learnt to draw that file. The
// bytes never changed; only our ability to draw them did.
//
// So rendering is a separate, idempotent, re-runnable operation. The viewer
// calls it when a drawing has no sheet yet, and an estimator can call it again
// from the retry button after the cause is fixed.
//
// Not a use case and not audited: this derives a picture from bytes already
// stored and decides nothing. Re-running it on the same file gives the same
// answer, which is exactly the test §5 uses to keep something out of the
// artifact chain.

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.uploads";

export const POST = route<{ pid: string; fid: string }>(async (_req, ctx, { pid, fid }) => {
  // Rendering is a read of material the estimator already has. It writes only a
  // cached picture of it, so artifact.read is the right gate — a reviewer who
  // can see the drawing can ask for it to be drawn.
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{ storage_key: string; filename: string; svg: string | null }>(
    `SELECT f.storage_key, f.filename, c.svg
       FROM cad_extraction c
       JOIN file f ON f.id = c.file_id
      WHERE c.tenant_id = ? AND c.project_id = ? AND c.file_id = ?`,
    [ctx.tenantId, pid, fid]
  );
  if (!row) throw errNotFound("CAD extraction");

  const render = await renderCad(path.join(STORAGE_DIR, row.storage_key));

  // A failed retry must not wipe a sheet we already had. The previous render is
  // strictly better than nothing, and the estimator is still told what went
  // wrong with this attempt.
  if (!render.svg && row.svg) {
    await query(
      "UPDATE cad_extraction SET render_error = ?, rendered_at = NOW(3) WHERE tenant_id = ? AND file_id = ?",
      [render.error, ctx.tenantId, fid]
    );
    return ok({ svg: row.svg, error: render.error, degraded: [] });
  }

  await query(
    "UPDATE cad_extraction SET svg = ?, render_error = ?, rendered_at = NOW(3) WHERE tenant_id = ? AND file_id = ?",
    [render.svg, render.error, ctx.tenantId, fid]
  );

  return ok({ svg: render.svg, error: render.error, degraded: render.degraded });
});

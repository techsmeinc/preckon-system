import { promises as fs } from "node:fs";
import path from "node:path";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errNotFound } from "@/lib/errors";

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.uploads";

// DELETE /projects/{pid}/files/{fid} — remove a document uploaded by mistake.
//
// The wrong tender in the wrong project is a real thing that happens on a busy
// afternoon, and until now there was no way to take it back out: the file sat
// in the list, its text stayed in the pages the agents read, and the only
// remedy was to distrust everything downstream of it.
//
// The row goes, and so do the extracted pages and CAD reading — leaving those
// behind would mean an agent still quoting a document nobody can see. The bytes
// on disk go too, on a best effort: a file the storage layer will not release
// is not a reason to keep a document visible that the estimator has disowned.
export const DELETE = route<{ pid: string; fid: string }>(async (_req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const file = await queryOne<{ id: string; filename: string; storage_key: string | null }>(
    "SELECT id, filename, storage_key FROM file WHERE id = ? AND tenant_id = ? AND project_id = ?",
    [fid, ctx.tenantId, pid]
  );
  if (!file) throw errNotFound("File");

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    // Children first: page text and the CAD reading both point at this file.
    await query("DELETE FROM file_page WHERE file_id = ? AND tenant_id = ?", [fid, ctx.tenantId]).catch(() => {});
    await query("DELETE FROM cad_extraction WHERE file_id = ? AND tenant_id = ?", [fid, ctx.tenantId]).catch(() => {});
    await query("DELETE FROM file WHERE id = ? AND tenant_id = ?", [fid, ctx.tenantId]);
    audit({
      action: "file.delete",
      targetKind: "file",
      targetId: fid,
      projectId: pid,
      summary: { filename: file.filename },
    });
  });

  if (file.storage_key) {
    // Best effort. The record is already gone; a stubborn file on disk is a
    // housekeeping problem, not a reason to fail the request.
    await fs.unlink(path.join(STORAGE_DIR, file.storage_key)).catch(() => {});
  }

  return ok({ id: fid, deleted: true });
});

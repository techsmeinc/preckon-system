import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.uploads";

// §7.5 GET /projects/{pid}/files — list files + status.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const rows = await query(
    "SELECT id, filename, mime, size_bytes, status, page_count, created_at FROM file WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC",
    [ctx.tenantId, pid]
  );
  return ok(rows);
});

// §7.1/§7.2 POST /projects/{pid}/files — multipart upload. In dev we store to the
// local FS and ingest synchronously (extract text → file_page). The design's
// presigned-URL + async ingestion (MinIO/R2) is the production shape; this is the
// dev/self-hosted collapse noted in the README.
export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw errBadRequest("multipart form field 'file' is required");

  const buf = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buf).digest("hex");
  const id = newId();
  const dir = path.join(STORAGE_DIR, ctx.tenantId, pid);
  await fs.mkdir(dir, { recursive: true });
  const storageKey = path.join(ctx.tenantId, pid, `${id}-${file.name}`);
  await fs.writeFile(path.join(STORAGE_DIR, storageKey), buf);

  // Extract text (non-LLM ingestion, §7.2). PDFs via pdf-parse; else treat as UTF-8.
  let pages: string[] = [];
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    try {
      const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default as any;
      const parsed = await pdf(buf);
      pages = String(parsed.text ?? "").split("\f").filter((s) => s.trim().length > 0);
      if (pages.length === 0) pages = [String(parsed.text ?? "")];
    } catch {
      pages = ["[unparsed pdf]"];
    }
  } else {
    pages = [buf.toString("utf8")];
  }

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    await query(
      `INSERT INTO file (id, tenant_id, project_id, storage_key, filename, mime, size_bytes, checksum, status, page_count, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?, 'ingested', ?, ?)`,
      [id, ctx.tenantId, pid, storageKey, file.name, file.type || "application/octet-stream", buf.length, checksum, pages.length, ctx.user.id]
    );
    let n = 1;
    for (const text of pages) {
      await query(
        "INSERT INTO file_page (id, tenant_id, file_id, page_no, text, method) VALUES (?,?,?,?,?, 'native')",
        [newId(), ctx.tenantId, id, n++, text.slice(0, 200000)]
      );
    }
    audit({ action: "file.upload", targetKind: "file", targetId: id, projectId: pid, summary: { filename: file.name, pages: pages.length } });
  });

  return ok({ id, filename: file.name, pages: pages.length, status: "ingested" }, 201);
});

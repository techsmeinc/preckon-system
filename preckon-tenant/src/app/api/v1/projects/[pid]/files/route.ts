import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { newId } from "@/lib/ids";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { cadAsPageText, extractCad, isCadFile, renderCad, type CadExtractOutcome } from "@/lib/cad";

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.uploads";

// §7.5 GET /projects/{pid}/files — list files + status.
export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const rows = await query(
    `SELECT f.id, f.filename, f.mime, f.size_bytes, f.status, f.page_count, f.created_at,
            c.units AS cad_units, c.layer_count AS cad_layers, c.block_count AS cad_blocks,
            c.sheet_count AS cad_sheets, c.warnings AS cad_warnings,
            c.svg IS NOT NULL AS cad_has_svg
       FROM file f
       LEFT JOIN cad_extraction c ON c.file_id = f.id
      WHERE f.tenant_id = ? AND f.project_id = ?
      ORDER BY f.created_at DESC`,
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

  // Extract text (non-LLM ingestion, §7.2). PDFs via pdf-parse; CAD via the
  // sidecar; else treat as UTF-8.
  let pages: string[] = [];
  let cad: CadExtractOutcome | null = null;

  if (isCadFile(file.name)) {
    // A .dxf is ASCII, so the UTF-8 fallback would "succeed" and fill the store
    // with entity codes; a .dwg is binary and would fill it with mojibake.
    // Neither is readable by an agent. Parse it properly instead.
    cad = await extractCad(path.join(STORAGE_DIR, storageKey), file.name);
    pages = cad.ok && cad.summary
      ? [cadAsPageText(cad.summary)]
      : [`[This drawing could not be read: ${cad.error}]`];
  } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
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

  // Rendered outside the transaction: it is slow, entirely optional, and a
  // drawing that measures fine but won't render is still fully useful.
  const svg = cad?.ok ? await renderCad(path.join(STORAGE_DIR, storageKey)) : null;

  await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    // A drawing we couldn't parse is 'failed', not 'ingested'. The bytes are
    // kept either way, but the chain must not treat an unreadable file as
    // understood — that is how a BOQ ends up quietly missing a discipline.
    const status = cad && !cad.ok ? "failed" : "ingested";
    await query(
      `INSERT INTO file (id, tenant_id, project_id, storage_key, filename, mime, size_bytes, checksum, status, page_count, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?, ?, ?, ?)`,
      [id, ctx.tenantId, pid, storageKey, file.name, file.type || "application/octet-stream", buf.length, checksum, status, pages.length, ctx.user.id]
    );
    let n = 1;
    for (const text of pages) {
      await query(
        "INSERT INTO file_page (id, tenant_id, file_id, page_no, text, method) VALUES (?,?,?,?,?, ?)",
        [newId(), ctx.tenantId, id, n++, text.slice(0, 200000), cad ? "cad" : "native"]
      );
    }
    if (cad?.ok && cad.summary) {
      const s = cad.summary;
      await query(
        `INSERT INTO cad_extraction (file_id, tenant_id, project_id, units, layer_count, block_count, sheet_count, summary, warnings, svg)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          id, ctx.tenantId, pid, s.units ?? null,
          (s.layers ?? []).length,
          Object.values(s.blockInstanceCounts ?? {}).reduce((t, b) => t + (b.total ?? 0), 0),
          (s.sheets ?? []).length,
          JSON.stringify(s), JSON.stringify(s.warnings ?? []), svg,
        ]
      );
    }
    audit({
      action: "file.upload",
      targetKind: "file",
      targetId: id,
      projectId: pid,
      summary: {
        filename: file.name,
        pages: pages.length,
        ...(cad ? { cad: cad.ok, ...(cad.ok ? {} : { error: cad.error }) } : {}),
      },
    });
  });

  return ok(
    {
      id,
      filename: file.name,
      pages: pages.length,
      status: cad && !cad.ok ? "failed" : "ingested",
      ...(cad && !cad.ok ? { error: cad.error } : {}),
    },
    201
  );
});

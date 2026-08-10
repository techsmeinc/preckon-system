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
// Served as image/svg+xml rather than a JSON string: no escaping, no re-parse,
// and the browser caches it like any other image. A drawing's render is a pure
// function of bytes uploaded once, so it is cached hard and keyed on when it was
// rendered — a re-render changes the key and the old one is abandoned.
export const GET = route<{ pid: string; fid: string }>(async (req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{ svg: string | null; rendered_at: Date | null }>(
    `SELECT c.svg, c.rendered_at FROM cad_extraction c
      WHERE c.tenant_id = ? AND c.project_id = ? AND c.file_id = ?`,
    [ctx.tenantId, pid, fid]
  );
  if (!row?.svg) throw errNotFound("Rendered sheet");

  const tag = `"${fid}-${row.rendered_at?.getTime() ?? 0}"`;
  // A drawing nobody re-rendered is byte-identical to last time, so say so and
  // let the browser skip the transfer entirely.
  if (req.headers.get("if-none-match") === tag) {
    return new Response(null, { status: 304, headers: { etag: tag, "cache-control": "private, max-age=86400" } });
  }

  return new Response(row.svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, max-age=86400, stale-while-revalidate=604800",
      etag: tag,
    },
  });
});

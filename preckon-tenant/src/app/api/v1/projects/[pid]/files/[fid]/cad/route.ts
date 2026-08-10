import { route, ok, immutableFor } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { footprint, metricLayers, isCadFile, type CadSummary } from "@/lib/cad";

// GET /projects/{pid}/files/{fid}/cad — what the parser read out of a drawing.
//
// Returns the measured facts already converted to metres. This is the same
// material the agents are given, which is the point: an estimator reviewing a
// quantity should be able to see exactly the evidence the agent had, not a
// prettier summary of it.
//
// The rendered sheet is NOT here — it comes from ./svg. It is megabytes on a
// real drawing, and putting it in this JSON meant the measured facts (units,
// layers, block counts, the things somebody opened the panel to read) could not
// paint until the whole picture had downloaded and been JSON-parsed.
//
// Neither is the full summary read. See rebuild() below.

/** Bump when buildView starts producing a different shape — every stored view
 *  older than this is rebuilt on its next read. Without it a deploy would go on
 *  serving yesterday's shape from the cache forever. */
const VIEW_VERSION = 1;

export const GET = route<{ pid: string; fid: string }>(async (_req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{
    filename: string;
    view_json: any;
    view_version: number;
    has_svg: number;
    units: string | null;
    warnings: any;
    render_error: string | null;
    rendered_at: Date | null;
  }>(
    // Note what is NOT selected: neither c.svg nor c.summary. Reading either one
    // to derive a few kilobytes pulled megabytes across the database connection
    // on every sheet open — the same cost this route exists to avoid, just moved
    // one hop earlier. The trimmed view is read instead, and the summary is
    // touched only by the single request that has to rebuild it.
    `SELECT f.filename, c.view_json, c.view_version,
            c.svg IS NOT NULL AS has_svg,
            c.units, c.warnings, c.render_error, c.rendered_at
       FROM cad_extraction c
       JOIN file f ON f.id = c.file_id
      WHERE c.tenant_id = ? AND c.project_id = ? AND c.file_id = ?`,
    [ctx.tenantId, pid, fid]
  );

  // A drawing the parser could not read has no extraction row at all. 404 was
  // technically right and practically useless: the file IS in the project, the
  // estimator can see it in the dropdown, and "not found" tells them nothing
  // about why. Answer with an empty reading and the reason instead.
  if (!row) {
    const file = await queryOne<{ filename: string; text: string | null }>(
      `SELECT f.filename, p.text
         FROM file f
         LEFT JOIN file_page p ON p.file_id = f.id AND p.page_no = 1
        WHERE f.tenant_id = ? AND f.project_id = ? AND f.id = ?`,
      [ctx.tenantId, pid, fid]
    );
    if (!file || !isCadFile(file.filename)) throw errNotFound("CAD extraction");
    // The upload route parks the parser's reason in page 1 as
    // "[This drawing could not be read: …]". Unwrap it back into a sentence.
    const m = /^\[This drawing could not be read: (.*)\]$/s.exec((file.text ?? "").trim());
    return ok({
      filename: file.filename,
      units: null, sheets: [], titleBlock: {}, footprint: null,
      layers: [], blocks: [], schedules: [], notes: [], warnings: [],
      hasSvg: false,
      parseError: m?.[1] ?? "This drawing could not be read by the parser.",
      renderError: null,
      renderAttempted: true,
    }, 200, immutableFor(120));
  }

  const stored = typeof row.view_json === "string" ? JSON.parse(row.view_json) : row.view_json;
  const view = stored && row.view_version === VIEW_VERSION
    ? stored
    : await rebuild(ctx.tenantId, fid);

  return ok({
    filename: row.filename,
    units: row.units,
    ...view,
    warnings: (typeof row.warnings === "string" ? JSON.parse(row.warnings) : row.warnings) ?? [],
    hasSvg: !!row.has_svg,
    parseError: null,
    renderError: row.render_error,
    // Lets the viewer distinguish "nobody has tried to draw this yet" (render it
    // now, silently) from "we tried and it failed" (say why, offer a retry).
    // Without it every visit would re-run a render that is known to fail.
    renderAttempted: row.rendered_at != null,
  }, 200, immutableFor(300, `${fid}-${row.rendered_at?.getTime() ?? 0}-v${VIEW_VERSION}`));
});

/**
 * Read the full summary once, cut it down to what the panel shows, and keep the
 * result so no later reader pays for it again.
 *
 * Runs on the first open after an upload, and again whenever VIEW_VERSION
 * changes. The stored view is a cache, never a source of truth: it is derived
 * entirely from `summary`, it can be dropped at any time, and a failed write
 * costs nothing more than the next reader rebuilding it too.
 */
async function rebuild(tenantId: string, fid: string) {
  const row = await queryOne<{ summary: any }>(
    "SELECT summary FROM cad_extraction WHERE tenant_id = ? AND file_id = ?",
    [tenantId, fid]
  );
  const summary: CadSummary = typeof row?.summary === "string" ? JSON.parse(row.summary) : row?.summary;
  const view = buildView(summary ?? ({} as CadSummary));
  await query(
    "UPDATE cad_extraction SET view_json = ?, view_version = ? WHERE tenant_id = ? AND file_id = ?",
    [JSON.stringify(view), VIEW_VERSION, tenantId, fid]
  ).catch(() => { /* a cache that would not save is still a correct answer */ });
  return view;
}

/**
 * Everything the Drawings panel reads, and nothing else.
 *
 * Every list is capped, because the panel renders only the first handful of
 * each and an uncapped one is how a plan whose room labels were read as a table
 * came back carrying four hundred rows that nothing displayed and nobody read.
 */
function buildView(summary: CadSummary) {
  return {
    sheets: summary.sheets ?? [],
    titleBlock: summary.titleBlockFields ?? {},
    footprint: footprint(summary),
    // Annotation layers are dropped: a note box or title border is not a
    // quantity, and listing them invites someone to price one.
    layers: metricLayers(summary)
      .filter((l) => !l.annotation && (l.runLength_m || l.largestArea_m2 || l.inserts))
      .slice(0, 40),
    // byLayer and the attribute samples are gone. Nothing displayed them — the
    // agents that do use them read the summary directly, not this route.
    blocks: Object.entries(summary.blockInstanceCounts ?? {})
      .map(([name, agg]) => ({ name, total: agg.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 60),
    schedules: (summary.schedules ?? []).slice(0, 20).map((sc: any) => ({
      ...sc,
      rows: (sc.rows ?? []).slice(0, 80),
      totalRows: (sc.rows ?? []).length,
    })),
    notes: [...new Set((summary.textAnnotations ?? []).map((t) => t.text.trim()).filter(Boolean))].slice(0, 80),
  };
}

import { route, ok, immutableFor } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { footprint, metricLayers, isCadFile, type CadSummary } from "@/lib/cad";

// GET /projects/{pid}/files/{fid}/cad — what the parser read out of a drawing.
//
// Returns the measured facts already converted to metres, plus the rendered
// sheet. This is the same material the agents are given, which is the point:
// an estimator reviewing a quantity should be able to see exactly the evidence
// the agent had, not a prettier summary of it.

export const GET = route<{ pid: string; fid: string }>(async (_req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{
    filename: string;
    summary: any;
    svg: string | null;
    units: string | null;
    warnings: any;
    render_error: string | null;
    rendered_at: Date | null;
  }>(
    `SELECT f.filename, c.summary, c.svg, c.units, c.warnings, c.render_error, c.rendered_at
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
      svg: null,
      parseError: m?.[1] ?? "This drawing could not be read by the parser.",
      renderError: null,
      renderAttempted: true,
    }, 200, immutableFor(120));
  }

  const summary: CadSummary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary;
  const warnings = typeof row.warnings === "string" ? JSON.parse(row.warnings) : row.warnings;

  return ok({
    filename: row.filename,
    units: row.units,
    sheets: summary.sheets ?? [],
    titleBlock: summary.titleBlockFields ?? {},
    footprint: footprint(summary),
    // Annotation layers are dropped: a note box or title border is not a
    // quantity, and listing them invites someone to price one.
    layers: metricLayers(summary).filter((l) => !l.annotation && (l.runLength_m || l.largestArea_m2 || l.inserts)),
    blocks: Object.entries(summary.blockInstanceCounts ?? {})
      .map(([name, agg]) => ({ name, total: agg.total, byLayer: agg.byLayer, attributes: agg.sampleAttributes }))
      .sort((a, b) => b.total - a.total),
    // Capped at the source. A plan whose room labels were read as a table
    // returns hundreds of rows that nothing displays and nobody reads.
    schedules: (summary.schedules ?? []).slice(0, 20).map((sc: any) => ({
      ...sc,
      rows: (sc.rows ?? []).slice(0, 80),
      totalRows: (sc.rows ?? []).length,
    })),
    notes: [...new Set((summary.textAnnotations ?? []).map((t) => t.text.trim()).filter(Boolean))].slice(0, 80),
    warnings: warnings ?? [],
    // The rendered sheet is fetched separately. It is megabytes on a real
    // drawing, and putting it in this JSON meant the measured facts — units,
    // layers, block counts, the things an estimator came to read — could not
    // paint until the whole picture had downloaded and been JSON-parsed. The
    // panel now renders immediately and the drawing arrives after it.
    hasSvg: row.svg != null,
    parseError: null,
    renderError: row.render_error,
    // Lets the viewer distinguish "nobody has tried to draw this yet" (render it
    // now, silently) from "we tried and it failed" (say why, offer a retry).
    // Without it every visit would re-run a render that is known to fail.
    renderAttempted: row.rendered_at != null,
  }, 200, immutableFor(300, `${fid}-${row.rendered_at?.getTime() ?? 0}`));
});

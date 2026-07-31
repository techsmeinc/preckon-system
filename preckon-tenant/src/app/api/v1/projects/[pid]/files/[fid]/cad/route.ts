import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { footprint, metricLayers, type CadSummary } from "@/lib/cad";

// GET /projects/{pid}/files/{fid}/cad — what the parser read out of a drawing.
//
// Returns the measured facts already converted to metres, plus the rendered
// sheet. This is the same material the agents are given, which is the point:
// an estimator reviewing a quantity should be able to see exactly the evidence
// the agent had, not a prettier summary of it.

export const GET = route<{ pid: string; fid: string }>(async (_req, ctx, { pid, fid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const row = await queryOne<{ summary: any; svg: string | null; units: string | null; warnings: any }>(
    `SELECT c.summary, c.svg, c.units, c.warnings
       FROM cad_extraction c
      WHERE c.tenant_id = ? AND c.project_id = ? AND c.file_id = ?`,
    [ctx.tenantId, pid, fid]
  );
  if (!row) throw errNotFound("CAD extraction");

  const summary: CadSummary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary;
  const warnings = typeof row.warnings === "string" ? JSON.parse(row.warnings) : row.warnings;

  return ok({
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
    schedules: summary.schedules ?? [],
    notes: [...new Set((summary.textAnnotations ?? []).map((t) => t.text.trim()).filter(Boolean))].slice(0, 80),
    warnings: warnings ?? [],
    svg: row.svg,
  });
});

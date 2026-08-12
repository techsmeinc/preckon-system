import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query } from "@/lib/db";
import { currentRevision } from "@/lib/pcm/store";
import { pcmType } from "@/lib/pcm/types";

// GET /projects/{pid}/pcm/objects — the model, with what each object measures.
//
// One query for the objects and one for their quantities, joined in memory.
// The alternative — a quantity subquery per row — is the shape that reads
// tidily and takes four seconds on a real project.

export const GET = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));

  const objects = await query<{
    id: string; object_type_code: string; name: string | null; mark: string | null;
    geometry: any; source_method: string; source_confidence: number | null;
    source_file_id: string | null; revision: number; lifecycle_state: string;
  }>(
    `SELECT id, object_type_code, name, mark, geometry, source_method, source_confidence,
            source_file_id, revision, lifecycle_state
       FROM pcm_object
      WHERE tenant_id = ? AND project_id = ? AND deleted_at IS NULL
        ${typeFilter ? "AND object_type_code = ?" : ""}
      ORDER BY object_type_code, mark
      LIMIT ${limit}`,
    typeFilter ? [ctx.tenantId, pid, typeFilter] : [ctx.tenantId, pid]
  );

  const quantities = objects.length
    ? await query<{ entity_id: string; rule_code: string; quantity_value: string; unit: string; status: string }>(
        `SELECT entity_id, rule_code, quantity_value, unit, status
           FROM pcm_quantity
          WHERE tenant_id = ? AND project_id = ? AND entity_id IN (${objects.map(() => "?").join(",")})`,
        [ctx.tenantId, pid, ...objects.map((o) => o.id)]
      )
    : [];

  const byEntity = new Map<string, Array<{ rule: string; value: number; unit: string; stale: boolean }>>();
  for (const q of quantities) {
    const list = byEntity.get(q.entity_id) ?? [];
    list.push({
      rule: q.rule_code,
      value: Number(q.quantity_value),
      unit: q.unit,
      // Surfaced, never hidden. A stale quantity presented as current is the
      // one failure mode the blueprint calls out by name.
      stale: q.status === "DIRTY",
    });
    byEntity.set(q.entity_id, list);
  }

  // What the whole model measures, by type — the number an estimator actually
  // reads off this screen.
  const totals = new Map<string, { unit: string; value: number }>();
  for (const q of quantities) {
    if (q.status === "DIRTY") continue;
    const key = q.rule_code;
    const t = totals.get(key) ?? { unit: q.unit, value: 0 };
    t.value += Number(q.quantity_value);
    totals.set(key, t);
  }

  return ok({
    revision: await currentRevision(ctx.tenantId, pid),
    count: objects.length,
    objects: objects.map((o) => ({
      id: o.id,
      type: o.object_type_code,
      typeName: pcmType(o.object_type_code)?.name ?? o.object_type_code,
      name: o.name,
      mark: o.mark,
      geometry: typeof o.geometry === "string" ? JSON.parse(o.geometry) : o.geometry,
      source: o.source_method,
      confidence: o.source_confidence == null ? null : Number(o.source_confidence),
      fromFileId: o.source_file_id,
      lifecycle: o.lifecycle_state,
      quantities: byEntity.get(o.id) ?? [],
    })),
    totals: [...totals.entries()]
      .map(([rule, t]) => ({ rule, unit: t.unit, value: Math.round(t.value * 1000) / 1000 }))
      .sort((a, b) => a.rule.localeCompare(b.rule)),
  });
});

import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { pcmType } from "@/lib/pcm/types";

// GET /projects/{pid}/pcm/objects/{oid}/trace — why this object measures what
// it measures.
//
// This endpoint is the product. Everything else is machinery to make it
// possible: an estimator points at 13.11 m² and gets the length, the height,
// the gross area, every opening deducted by id, the threshold that decided
// which openings counted, the rule version that did the arithmetic, and the
// file the object was recognised from.
//
// A number a quantity surveyor cannot argue with is a number they cannot
// defend. The blueprint's acceptance criterion is that no quantity may be
// presented as authoritative without traceable contributing objects — this is
// where that promise is kept.

export const GET = route<{ pid: string; oid: string }>(async (_req, ctx, { pid, oid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const obj = await queryOne<{
    id: string; object_type_code: string; name: string | null; mark: string | null;
    geometry: any; source_method: string; source_confidence: number | null;
    source_file_id: string | null; source_region: any; revision: number; created_at: Date;
  }>(
    `SELECT id, object_type_code, name, mark, geometry, source_method, source_confidence,
            source_file_id, source_region, revision, created_at
       FROM pcm_object WHERE tenant_id = ? AND project_id = ? AND id = ? AND deleted_at IS NULL`,
    [ctx.tenantId, pid, oid]
  );
  if (!obj) throw errNotFound("object");

  const [quantities, properties, hosted, hosts, boq, file] = await Promise.all([
    query<{ rule_code: string; quantity_value: string; unit: string; status: string; calculation: any; source_project_revision: number }>(
      `SELECT rule_code, quantity_value, unit, status, calculation, source_project_revision
         FROM pcm_quantity WHERE tenant_id = ? AND entity_id = ?`,
      [ctx.tenantId, oid]
    ),
    query<{ code: string; value_string: string | null; value_decimal: string | null; value_boolean: number | null; unit: string | null }>(
      "SELECT code, value_string, value_decimal, value_boolean, unit FROM pcm_property_value WHERE tenant_id = ? AND entity_id = ?",
      [ctx.tenantId, oid]
    ),
    // What sits IN this object — the openings that were deducted.
    query<{ id: string; object_type_code: string; mark: string | null }>(
      `SELECT o.id, o.object_type_code, o.mark FROM pcm_relationship r
         JOIN pcm_object o ON o.id = r.source_entity_id AND o.deleted_at IS NULL
        WHERE r.tenant_id = ? AND r.target_entity_id = ? AND r.relationship_type = 'HOSTED_BY'`,
      [ctx.tenantId, oid]
    ),
    // What this object sits in.
    query<{ id: string; object_type_code: string; mark: string | null }>(
      `SELECT o.id, o.object_type_code, o.mark FROM pcm_relationship r
         JOIN pcm_object o ON o.id = r.target_entity_id AND o.deleted_at IS NULL
        WHERE r.tenant_id = ? AND r.source_entity_id = ? AND r.relationship_type = 'HOSTED_BY'`,
      [ctx.tenantId, oid]
    ),
    // Which bill lines this object ends up in — the far end of the chain.
    query<{ boq_artifact_id: string; status: string; code: string | null; description: string | null }>(
      `SELECT m.boq_artifact_id, m.status,
              JSON_UNQUOTE(JSON_EXTRACT(a.payload, '$.code')) AS code,
              JSON_UNQUOTE(JSON_EXTRACT(a.payload, '$.description')) AS description
         FROM pcm_boq_map m
         LEFT JOIN artifact a ON a.id = m.boq_artifact_id
        WHERE m.tenant_id = ? AND m.entity_id = ?`,
      [ctx.tenantId, oid]
    ),
    obj.source_file_id
      ? queryOne<{ filename: string }>("SELECT filename FROM file WHERE tenant_id = ? AND id = ?", [ctx.tenantId, obj.source_file_id])
      : Promise.resolve(null),
  ]);

  const type = pcmType(obj.object_type_code);

  return ok({
    object: {
      id: obj.id,
      type: obj.object_type_code,
      typeName: type?.name ?? obj.object_type_code,
      discipline: type?.discipline ?? null,
      name: obj.name,
      mark: obj.mark,
      geometry: typeof obj.geometry === "string" ? JSON.parse(obj.geometry) : obj.geometry,
      revision: obj.revision,
      createdAt: obj.created_at,
    },
    // Where it came from. An object recognised from a drawing at 0.62
    // confidence must never look like one an engineer drew.
    provenance: {
      method: obj.source_method,
      confidence: obj.source_confidence == null ? null : Number(obj.source_confidence),
      fromFile: file?.filename ?? null,
      region: typeof obj.source_region === "string" ? JSON.parse(obj.source_region) : obj.source_region,
    },
    properties: properties.map((p) => ({
      code: p.code,
      value: p.value_decimal != null ? Number(p.value_decimal)
           : p.value_boolean != null ? !!p.value_boolean
           : p.value_string,
      unit: p.unit,
    })),
    // The arithmetic, in full.
    quantities: quantities.map((q) => ({
      rule: q.rule_code,
      value: Number(q.quantity_value),
      unit: q.unit,
      stale: q.status === "DIRTY",
      measuredAtRevision: q.source_project_revision,
      calculation: typeof q.calculation === "string" ? JSON.parse(q.calculation) : q.calculation,
    })),
    relationships: {
      hosts: hosted.map((h) => ({ id: h.id, type: h.object_type_code, mark: h.mark })),
      hostedBy: hosts.map((h) => ({ id: h.id, type: h.object_type_code, mark: h.mark })),
    },
    boqLines: boq.map((b) => ({ artifactId: b.boq_artifact_id, code: b.code, description: b.description, status: b.status })),
  });
});

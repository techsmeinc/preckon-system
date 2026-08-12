import type { PoolConnection } from "mysql2/promise";
import { uuidv7 } from "uuidv7";
import { query, queryOne } from "../db";
import { errBadRequest, errNotFound } from "../errors";
import { geometryBounds, measureObject, type MeasuredObject } from "./measure";
import { pcmType, typeForStudioCategory, type PcmGeometry } from "./types";

// PCM v1 — writing to the model.
//
// One rule runs through this whole file: **nothing mutates the model except a
// committed ChangeSet.** Not the UI, not an agent, not a helper that seemed
// convenient at the time. That is ADR-003 and ADR-004, and it is only worth
// anything if there is no second door — so there is no exported "createObject".
//
// The shape is: open a ChangeSet, stage operations, preview it, commit it. A
// commit takes the project's next revision number, applies the operations,
// marks everything downstream dirty, and emits events — in one transaction, so
// the model and the audit trail cannot disagree.

export type SourceMethod = "MANUAL" | "IMPORT" | "AI" | "RULE" | "INTEGRATION";

export interface ObjectInput {
  typeCode: string;
  name?: string | null;
  mark?: string | null;
  spatialNodeId?: string | null;
  geometry: PcmGeometry;
  properties?: Record<string, string | number | boolean>;
  sourceMethod?: SourceMethod;
  sourceConfidence?: number | null;
  sourceFileId?: string | null;
  sourceRegion?: unknown;
  /** Set for a hosted object — the door's wall. Recorded as a HOSTED_BY edge,
   *  which is what makes the wall's area deduct the opening. */
  hostId?: string | null;
}

export interface Scope { tenantId: string; projectId: string; userId: string }

/* ── revisions ───────────────────────────────────────────────────────────── */

export async function currentRevision(tenantId: string, projectId: string): Promise<number> {
  const row = await queryOne<{ rev: number }>(
    "SELECT COALESCE(MAX(revision), 0) AS rev FROM pcm_project_revision WHERE tenant_id = ? AND project_id = ?",
    [tenantId, projectId]
  );
  return Number(row?.rev ?? 0);
}

/* ── change sets ─────────────────────────────────────────────────────────── */

export interface DraftOp {
  operation: "CREATE" | "UPDATE" | "DELETE" | "RELATE" | "RETYPE";
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export async function openChangeSet(
  s: Scope,
  input: { title: string; changeType: "USER_EDIT" | "AI_EDIT" | "IMPORT" | "RULE"; description?: string }
): Promise<{ id: string; baseRevision: number }> {
  const id = uuidv7();
  const baseRevision = await currentRevision(s.tenantId, s.projectId);
  await query(
    `INSERT INTO pcm_change_set
       (id, tenant_id, project_id, change_type, status, title, description, requested_by, base_project_revision)
     VALUES (?,?,?,?, 'DRAFT', ?,?,?,?)`,
    [id, s.tenantId, s.projectId, input.changeType, input.title, input.description ?? null, s.userId, baseRevision]
  );
  return { id, baseRevision };
}

export async function stageOps(s: Scope, changeSetId: string, ops: DraftOp[]): Promise<void> {
  if (!ops.length) return;
  const start = await queryOne<{ n: number }>(
    "SELECT COALESCE(MAX(sequence), 0) AS n FROM pcm_change_operation WHERE tenant_id = ? AND change_set_id = ?",
    [s.tenantId, changeSetId]
  );
  let seq = Number(start?.n ?? 0);
  for (const op of ops) {
    await query(
      `INSERT INTO pcm_change_operation
         (id, tenant_id, change_set_id, sequence, operation, entity_type, entity_id, before_state, after_state)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv7(), s.tenantId, changeSetId, ++seq, op.operation, op.entityType, op.entityId,
       op.before === undefined ? null : JSON.stringify(op.before),
       op.after === undefined ? null : JSON.stringify(op.after)]
    );
  }
}

export interface Preview {
  changeSetId: string;
  baseRevision: number;
  status: string;
  creates: number;
  updates: number;
  deletes: number;
  /** What this commit would invalidate. The whole reason a preview exists: a
   *  retype that quietly re-measures 47 walls should say so BEFORE it happens,
   *  not after somebody notices the bill moved. */
  quantitiesAffected: number;
  boqLinesAffected: number;
  /** Set when the project has moved on since this ChangeSet was opened. */
  conflict?: string;
}

export async function previewChangeSet(s: Scope, changeSetId: string): Promise<Preview> {
  const cs = await queryOne<{ status: string; base_project_revision: number }>(
    "SELECT status, base_project_revision FROM pcm_change_set WHERE tenant_id = ? AND project_id = ? AND id = ?",
    [s.tenantId, s.projectId, changeSetId]
  );
  if (!cs) throw errNotFound("change set");

  const ops = await query<{ operation: string; entity_id: string }>(
    "SELECT operation, entity_id FROM pcm_change_operation WHERE tenant_id = ? AND change_set_id = ?",
    [s.tenantId, changeSetId]
  );
  const touched = [...new Set(ops.map((o) => o.entity_id))];

  // What downstream would go stale. Counted, not guessed at.
  let quantitiesAffected = 0;
  let boqLinesAffected = 0;
  if (touched.length) {
    const ph = touched.map(() => "?").join(",");
    quantitiesAffected = Number((await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pcm_quantity WHERE tenant_id = ? AND entity_id IN (${ph})`,
      [s.tenantId, ...touched]
    ))?.n ?? 0);
    boqLinesAffected = Number((await queryOne<{ n: number }>(
      `SELECT COUNT(DISTINCT boq_artifact_id) AS n FROM pcm_boq_map WHERE tenant_id = ? AND entity_id IN (${ph})`,
      [s.tenantId, ...touched]
    ))?.n ?? 0);
  }

  const now = await currentRevision(s.tenantId, s.projectId);
  return {
    changeSetId,
    baseRevision: Number(cs.base_project_revision),
    status: cs.status,
    creates: ops.filter((o) => o.operation === "CREATE").length,
    updates: ops.filter((o) => o.operation === "UPDATE" || o.operation === "RETYPE").length,
    deletes: ops.filter((o) => o.operation === "DELETE").length,
    quantitiesAffected,
    boqLinesAffected,
    conflict: now > Number(cs.base_project_revision)
      ? `The model has moved to revision ${now} since this change was drafted (it was based on ${cs.base_project_revision}). Review it again before committing.`
      : undefined,
  };
}

/**
 * Commit — the only path by which the model changes.
 *
 * Runs inside the caller's transaction so the objects, the revision, the dirty
 * marks and the audit entry either all happen or none do. `expectedRevision`
 * is optimistic concurrency: pass what the client read, and a commit against a
 * model that has moved is refused rather than silently overwriting somebody.
 */
export async function commitChangeSet(
  conn: PoolConnection,
  s: Scope,
  changeSetId: string,
  expectedRevision?: number
): Promise<{ revision: number; applied: number; dirtied: number }> {
  const [csRows] = await conn.query(
    "SELECT status, base_project_revision, change_type FROM pcm_change_set WHERE tenant_id = ? AND project_id = ? AND id = ? FOR UPDATE",
    [s.tenantId, s.projectId, changeSetId]
  );
  const cs = (csRows as any[])[0];
  if (!cs) throw errNotFound("change set");
  if (cs.status === "COMMITTED") throw errBadRequest("That change has already been committed.");

  const [revRows] = await conn.query(
    "SELECT COALESCE(MAX(revision), 0) AS rev FROM pcm_project_revision WHERE tenant_id = ? AND project_id = ?",
    [s.tenantId, s.projectId]
  );
  const nowRev = Number((revRows as any[])[0]?.rev ?? 0);
  if (expectedRevision !== undefined && expectedRevision !== nowRev) {
    throw errBadRequest(
      `The model is at revision ${nowRev}, not ${expectedRevision}. Somebody else has committed since you read it.`
    );
  }
  const revision = nowRev + 1;

  const [opRows] = await conn.query(
    "SELECT operation, entity_type, entity_id, after_state FROM pcm_change_operation WHERE tenant_id = ? AND change_set_id = ? ORDER BY sequence",
    [s.tenantId, changeSetId]
  );
  const ops = opRows as Array<{ operation: string; entity_type: string; entity_id: string; after_state: any }>;

  const touched = new Set<string>();
  for (const op of ops) {
    const after = typeof op.after_state === "string" ? JSON.parse(op.after_state) : op.after_state;
    touched.add(op.entity_id);

    if (op.entity_type === "pcm_object") {
      if (op.operation === "CREATE") await insertObject(conn, s, op.entity_id, after, revision);
      else if (op.operation === "DELETE") {
        // Soft. An audited model never loses the fact that something existed.
        await conn.query(
          "UPDATE pcm_object SET deleted_at = NOW(3), revision = ? WHERE tenant_id = ? AND id = ?",
          [revision, s.tenantId, op.entity_id]
        );
      } else {
        await updateObject(conn, s, op.entity_id, after, revision);
      }
    } else if (op.entity_type === "pcm_relationship" && op.operation === "RELATE") {
      await conn.query(
        `INSERT INTO pcm_relationship
           (id, tenant_id, project_id, source_entity_id, relationship_type, target_entity_id, source_method, confidence)
         VALUES (?,?,?,?,?,?,?,?)`,
        [op.entity_id, s.tenantId, s.projectId, after.sourceEntityId, after.relationshipType,
         after.targetEntityId, after.sourceMethod ?? "MANUAL", after.confidence ?? null]
      );
      // The host is affected too: an opening added to a wall changes the wall's
      // net area, and the wall is not in the operation list.
      touched.add(after.targetEntityId);
    }
  }

  await conn.query(
    "INSERT INTO pcm_project_revision (id, tenant_id, project_id, revision, change_set_id) VALUES (?,?,?,?,?)",
    [uuidv7(), s.tenantId, s.projectId, revision, changeSetId]
  );
  await conn.query(
    "UPDATE pcm_change_set SET status = 'COMMITTED', approved_by = ?, committed_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [s.userId, s.tenantId, changeSetId]
  );

  const dirtied = await markQuantitiesDirty(conn, s, [...touched]);

  // Outbox, in the same transaction, so a committed change cannot fail to
  // announce itself and a published event cannot describe a change that rolled
  // back.
  await conn.query(
    "INSERT INTO event_outbox (id, tenant_id, project_id, event_type, payload) VALUES (?,?,?,?,?)",
    [uuidv7(), s.tenantId, s.projectId, "pcm.change_set.committed.v1",
     JSON.stringify({ changeSetId, revision, objects: [...touched], quantitiesDirty: dirtied })]
  );

  return { revision, applied: ops.length, dirtied };
}

async function insertObject(conn: PoolConnection, s: Scope, id: string, o: ObjectInput, revision: number) {
  const b = geometryBounds(o.geometry) ?? { minX: null, minY: null, maxX: null, maxY: null };
  await conn.query(
    `INSERT INTO pcm_object
       (id, tenant_id, project_id, object_type_code, name, mark, spatial_node_id, geometry,
        min_x, min_y, max_x, max_y, source_method, source_confidence, source_file_id, source_region,
        revision, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, s.tenantId, s.projectId, o.typeCode, o.name ?? null, o.mark ?? null, o.spatialNodeId ?? null,
     JSON.stringify(o.geometry), b.minX, b.minY, b.maxX, b.maxY,
     o.sourceMethod ?? "MANUAL", o.sourceConfidence ?? null, o.sourceFileId ?? null,
     o.sourceRegion ? JSON.stringify(o.sourceRegion) : null, revision, s.userId]
  );
  await writeProperties(conn, s, id, o.properties, o.sourceMethod ?? "MANUAL");
}

async function updateObject(conn: PoolConnection, s: Scope, id: string, o: Partial<ObjectInput>, revision: number) {
  const sets: string[] = ["revision = ?"];
  const args: unknown[] = [revision];
  if (o.typeCode !== undefined) { sets.push("object_type_code = ?"); args.push(o.typeCode); }
  if (o.name !== undefined) { sets.push("name = ?"); args.push(o.name); }
  if (o.mark !== undefined) { sets.push("mark = ?"); args.push(o.mark); }
  if (o.spatialNodeId !== undefined) { sets.push("spatial_node_id = ?"); args.push(o.spatialNodeId); }
  if (o.geometry !== undefined) {
    const b = geometryBounds(o.geometry) ?? { minX: null, minY: null, maxX: null, maxY: null };
    sets.push("geometry = ?", "min_x = ?", "min_y = ?", "max_x = ?", "max_y = ?");
    args.push(JSON.stringify(o.geometry), b.minX, b.minY, b.maxX, b.maxY);
  }
  await conn.query(`UPDATE pcm_object SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`,
    [...args, s.tenantId, id]);
  if (o.properties) await writeProperties(conn, s, id, o.properties, o.sourceMethod ?? "MANUAL");
}

async function writeProperties(
  conn: PoolConnection, s: Scope, entityId: string,
  props: Record<string, string | number | boolean> | undefined, source: SourceMethod
) {
  for (const [code, value] of Object.entries(props ?? {})) {
    await conn.query(
      `INSERT INTO pcm_property_value (id, tenant_id, entity_id, code, value_string, value_decimal, value_boolean, source_method)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE value_string=VALUES(value_string), value_decimal=VALUES(value_decimal),
                               value_boolean=VALUES(value_boolean), source_method=VALUES(source_method)`,
      [uuidv7(), s.tenantId, entityId, code,
       typeof value === "string" ? value : null,
       typeof value === "number" ? value : null,
       typeof value === "boolean" ? (value ? 1 : 0) : null,
       source]
    );
  }
}

/**
 * Mark everything measured from these objects as stale.
 *
 * Includes objects that HOST the ones that changed: adding a door does not
 * touch the wall's row, but it certainly changes the wall's net area. Missing
 * that is how a bill keeps showing yesterday's figure and looks right doing it.
 */
async function markQuantitiesDirty(conn: PoolConnection, s: Scope, entityIds: string[]): Promise<number> {
  if (!entityIds.length) return 0;
  const ph = entityIds.map(() => "?").join(",");
  const [hostRows] = await conn.query(
    `SELECT DISTINCT target_entity_id AS id FROM pcm_relationship
      WHERE tenant_id = ? AND relationship_type = 'HOSTED_BY' AND source_entity_id IN (${ph})`,
    [s.tenantId, ...entityIds]
  );
  const all = [...new Set([...entityIds, ...(hostRows as any[]).map((r) => r.id)])];
  const ph2 = all.map(() => "?").join(",");
  const [res] = await conn.query(
    `UPDATE pcm_quantity SET status = 'DIRTY' WHERE tenant_id = ? AND entity_id IN (${ph2}) AND status = 'CURRENT'`,
    [s.tenantId, ...all]
  );
  return Number((res as any)?.affectedRows ?? 0);
}

/* ── measurement ─────────────────────────────────────────────────────────── */

/**
 * Recompute quantities for a project — everything, or only what is dirty.
 *
 * Deliberately not part of commit. A commit must be fast and atomic; measuring
 * a thousand walls is neither. The blueprint's rule is that derived data may be
 * eventual so long as its staleness is explicit — which is what the DIRTY
 * status is for.
 */
export async function recomputeQuantities(
  s: Scope,
  opts: { onlyDirty?: boolean } = {}
): Promise<{ measured: number; objects: number }> {
  const revision = await currentRevision(s.tenantId, s.projectId);

  const objects = await query<{ id: string; object_type_code: string; geometry: any }>(
    `SELECT o.id, o.object_type_code, o.geometry FROM pcm_object o
      WHERE o.tenant_id = ? AND o.project_id = ? AND o.deleted_at IS NULL
      ${opts.onlyDirty ? "AND EXISTS (SELECT 1 FROM pcm_quantity q WHERE q.entity_id = o.id AND q.status = 'DIRTY')" : ""}`,
    [s.tenantId, s.projectId]
  );
  if (!objects.length) return { measured: 0, objects: 0 };

  // Hosted openings, in one query rather than one per wall.
  const hosted = await query<{ host: string; id: string; object_type_code: string; geometry: any }>(
    `SELECT r.target_entity_id AS host, o.id, o.object_type_code, o.geometry
       FROM pcm_relationship r
       JOIN pcm_object o ON o.id = r.source_entity_id AND o.deleted_at IS NULL
      WHERE r.tenant_id = ? AND r.project_id = ? AND r.relationship_type = 'HOSTED_BY'`,
    [s.tenantId, s.projectId]
  );
  const byHost = new Map<string, MeasuredObject[]>();
  for (const h of hosted) {
    const g = typeof h.geometry === "string" ? JSON.parse(h.geometry) : h.geometry;
    const list = byHost.get(h.host) ?? [];
    list.push({ id: h.id, typeCode: h.object_type_code, geometry: g ?? {} });
    byHost.set(h.host, list);
  }

  let measured = 0;
  for (const row of objects) {
    const type = pcmType(row.object_type_code);
    if (!type) continue;
    const geometry = typeof row.geometry === "string" ? JSON.parse(row.geometry) : row.geometry;
    const results = measureObject(
      { id: row.id, typeCode: row.object_type_code, geometry: geometry ?? {}, hosted: byHost.get(row.id) ?? [] },
      type
    );
    for (const q of results) {
      await query(
        `INSERT INTO pcm_quantity
           (id, tenant_id, project_id, entity_id, rule_code, quantity_value, unit, status, source_project_revision, calculation)
         VALUES (?,?,?,?,?,?,?, 'CURRENT', ?,?)
         ON DUPLICATE KEY UPDATE quantity_value=VALUES(quantity_value), unit=VALUES(unit), status='CURRENT',
                                 source_project_revision=VALUES(source_project_revision), calculation=VALUES(calculation)`,
        [uuidv7(), s.tenantId, s.projectId, row.id, q.ruleCode, q.value, q.unit, revision, JSON.stringify(q.calculation)]
      );
      measured++;
    }
  }
  return { measured, objects: objects.length };
}

/* ── publishing a BIM Studio model ───────────────────────────────────────── */

/**
 * Turn a BIM Studio document into PCM objects.
 *
 * The studio's elements already carry a category, a level, hosted geometry and
 * parameters, so this is a mapping rather than a reconstruction. What it adds
 * is the thing the studio never had: identity that outlives the document. Once
 * published, a wall is something a quantity, a bill line and a purchase order
 * can each point at — instead of an entry in a JSON blob.
 *
 * Idempotent by mark: publishing twice updates rather than duplicating, because
 * an estimator WILL press it twice and a doubled bill is unforgivable.
 */
export function bimDocumentToObjects(doc: { elements: Record<string, any>; order: string[] }): {
  objects: Array<ObjectInput & { studioId: string }>;
  skipped: number;
} {
  const objects: Array<ObjectInput & { studioId: string }> = [];
  let skipped = 0;

  for (const id of doc.order ?? []) {
    const el = doc.elements?.[id];
    if (!el) { skipped++; continue; }
    const typeCode = typeForStudioCategory(el.category);
    const g = el.geom ?? {};

    // Studio geometry is already metres; PCM v1 is metres. Stated rather than
    // assumed, because a silent unit mismatch is the most expensive kind.
    const geometry: PcmGeometry = {
      ...(g.start && g.end ? { baseline: [[g.start.x, g.start.y], [g.end.x, g.end.y]] as [number, number][] } : {}),
      ...(g.outline ? { outline: g.outline.map((p: any) => [p.x, p.y] as [number, number]) } : {}),
      ...(g.at ? { at: [g.at.x, g.at.y] as [number, number] } : {}),
      ...(g.rot != null ? { rotation: g.rot } : {}),
      ...(g.width != null ? (g.kind === "linear" ? { thicknessM: g.width } : { widthM: g.width }) : {}),
      ...(g.depth != null ? { depthM: g.depth } : {}),
      ...(g.height != null ? { heightM: g.height } : {}),
      ...(g.thickness != null ? { thicknessM: g.thickness } : {}),
      ...(g.elevation != null ? { elevationM: g.elevation } : {}),
      ...(g.offset != null ? { offsetM: g.offset } : {}),
      ...(g.sill != null ? { sillM: g.sill } : {}),
    };

    objects.push({
      studioId: id,
      typeCode,
      name: el.name ?? null,
      mark: `BIM-${id}`,
      geometry,
      properties: Object.fromEntries(
        Object.entries(el.params ?? {}).filter(([, v]) =>
          typeof v === "string" || typeof v === "number" || typeof v === "boolean") as any
      ),
      sourceMethod: "MANUAL",
      hostId: g.host ?? null,
    });
  }
  return { objects, skipped };
}

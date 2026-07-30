import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errConflict, errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// GET /features/{id} — detail incl. per-edition values (§4.4)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "feature.read");
  const { id } = await params;

  const feature = await queryOne<any>("SELECT * FROM feature WHERE id = ?", [id]);
  if (!feature) throw errNotFound("Feature");

  const editions = await query(
    `SELECT e.id AS edition_id, e.\`key\` AS edition_key, e.name AS edition_name,
            e.status AS edition_status,
            ef.enabled, ef.limit_value, ef.enum_value
       FROM edition_feature ef
       JOIN edition e ON e.id = ef.edition_id
      WHERE ef.feature_id = ?
      ORDER BY e.sort_order ASC, e.\`key\` ASC`,
    [id]
  );

  return ok({ ...feature, editions });
});

const Patch = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.enum(["module", "capability", "limit", "usage"]).optional(),
  unit: z.string().nullable().optional(),
  allowed_values: z.array(z.string()).nullable().optional(),
  status: z.enum(["active", "deprecated"]).optional(),
  sort_order: z.number().int().optional(),
  // Rejected if a change is actually attempted while referenced (see below).
  key: z.string().optional(),
  type: z.enum(["flag", "limit", "metric"]).optional(),
});

// PATCH /features/{id} — edit; key & type immutable once referenced (§4.4)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "feature.write");
  const { id } = await params;
  const body = Patch.parse(await req.json());

  const feature = await queryOne<any>("SELECT * FROM feature WHERE id = ?", [id]);
  if (!feature) throw errNotFound("Feature");

  // Determine whether immutable columns are being changed to a different value.
  const changingKey = body.key !== undefined && body.key !== feature.key;
  const changingType = body.type !== undefined && body.type !== feature.type;
  if (changingKey || changingType) {
    const [{ refs }] = await query<{ refs: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM edition_feature WHERE feature_id = ?) +
         (SELECT COUNT(*) FROM usage_rate WHERE feature_id = ?)
       ) AS refs`,
      [id, id]
    );
    if (Number(refs) > 0)
      throw errConflict(
        "`key` and `type` are immutable once the feature is referenced by an edition or usage rate",
        { changed: [changingKey ? "key" : null, changingType ? "type" : null].filter(Boolean) }
      );
    // If unreferenced, a type change must still respect the type/value_type rule.
    if (changingType) {
      const newType = body.type!;
      const okPair =
        (newType === "flag" && feature.value_type === "boolean") ||
        (newType === "metric" && feature.value_type === "numeric") ||
        (newType === "limit" && (feature.value_type === "numeric" || feature.value_type === "enum"));
      if (!okPair)
        throw errUnprocessable(
          `Invalid type/value_type combination: ${newType} cannot be ${feature.value_type}`,
          { type: newType, value_type: feature.value_type }
        );
    }
  }

  // enum features must keep a non-empty allowed_values.
  if (
    body.allowed_values !== undefined &&
    feature.value_type === "enum" &&
    !(body.allowed_values && body.allowed_values.length > 0)
  )
    throw errUnprocessable("allowed_values cannot be empty for an enum feature");

  const fields = Object.entries(body).filter(([k, v]) => {
    if (v === undefined) return false;
    if (k === "key") return changingKey;
    if (k === "type") return changingType;
    return true;
  });
  if (fields.length === 0) return ok(feature);

  const updated = await useCase(ctx, async (conn, audit) => {
    const set = fields.map(([k]) => `\`${k}\` = ?`).join(", ");
    const values = fields.map(([k, v]) =>
      k === "allowed_values" ? (v === null ? null : JSON.stringify(v)) : v
    );
    await conn.query(`UPDATE feature SET ${set} WHERE id = ?`, [...values, id]);
    audit({
      action: "feature.update",
      targetType: "feature",
      targetId: id,
      summary: `Updated feature ${feature.name} (${feature.key})`,
      metadata: { changed: fields.map(([k]) => k) },
    });
    return queryOne("SELECT * FROM feature WHERE id = ?", [id]);
  });

  return ok(updated);
});

import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errConflict, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody, q } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

// GET /features — catalog with filters ?category ?type ?status ?q (§4.4)
// Each row carries an edition-membership summary: the edition keys that include it.
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "feature.read");

  const where: string[] = [];
  const params: any[] = [];
  const category = q(req, "category");
  const type = q(req, "type");
  const status = q(req, "status");
  const search = q(req, "q");
  if (category) (where.push("f.category = ?"), params.push(category));
  if (type) (where.push("f.type = ?"), params.push(type));
  if (status) (where.push("f.status = ?"), params.push(status));
  if (search) {
    where.push("(f.`key` LIKE ? OR f.name LIKE ? OR f.description LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  // GROUP_CONCAT (not JSON_ARRAYAGG, which is MariaDB 10.5+) → split to array.
  const rows = await query<any>(
    `SELECT f.id, f.\`key\`, f.name, f.description, f.category, f.type,
            f.value_type, f.unit, f.allowed_values, f.status, f.sort_order,
            f.created_at, f.updated_at,
            (SELECT GROUP_CONCAT(e.\`key\`)
               FROM edition_feature ef
               JOIN edition e ON e.id = ef.edition_id
              WHERE ef.feature_id = f.id AND ef.enabled = TRUE) AS editions_csv
       FROM feature f
       ${whereSql}
      ORDER BY f.sort_order ASC, f.\`key\` ASC`,
    params
  );
  const data = rows.map(({ editions_csv, ...r }) => ({
    ...r,
    editions: editions_csv ? String(editions_csv).split(",") : [],
  }));

  return ok({ data });
});

const CreateFeature = z.object({
  key: z
    .string()
    .min(2)
    .regex(/^[a-z0-9_.]+$/, "key must be lowercase letters, digits, dots and underscores"),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["module", "capability", "limit", "usage"]),
  type: z.enum(["flag", "limit", "metric"]),
  value_type: z.enum(["boolean", "numeric", "enum"]),
  unit: z.string().optional(),
  allowed_values: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
});

/** §4.2 type↔value_type rule + enum needs allowed_values. Throws 422 on violation. */
function validateFeatureShape(input: {
  type: "flag" | "limit" | "metric";
  value_type: "boolean" | "numeric" | "enum";
  allowed_values?: string[] | null;
}) {
  const { type, value_type } = input;
  const okPair =
    (type === "flag" && value_type === "boolean") ||
    (type === "metric" && value_type === "numeric") ||
    (type === "limit" && (value_type === "numeric" || value_type === "enum"));
  if (!okPair)
    throw errUnprocessable(
      `Invalid type/value_type combination: ${type} cannot be ${value_type}`,
      { type, value_type }
    );
  if (value_type === "enum" && !(input.allowed_values && input.allowed_values.length > 0))
    throw errUnprocessable("allowed_values is required for enum value_type");
}

// POST /features — create a feature (§4.4)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "feature.write");
  const body = await parseBody(req, CreateFeature);

  validateFeatureShape(body);

  const dup = await query("SELECT id FROM feature WHERE `key` = ?", [body.key]);
  if (dup[0]) throw errConflict("A feature with that key already exists", { key: body.key });

  const feature = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      `INSERT INTO feature (id, \`key\`, name, description, category, type,
                            value_type, unit, allowed_values, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        body.key,
        body.name,
        body.description ?? null,
        body.category,
        body.type,
        body.value_type,
        body.unit ?? null,
        body.allowed_values ? JSON.stringify(body.allowed_values) : null,
        body.sort_order ?? 0,
      ]
    );
    audit({
      action: "feature.create",
      targetType: "feature",
      targetId: id,
      summary: `Created feature ${body.name} (${body.key})`,
      metadata: { key: body.key, type: body.type, value_type: body.value_type, category: body.category },
    });
    return { id, status: "active", sort_order: body.sort_order ?? 0, ...body };
  });

  return ok(feature, 201);
});

import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// GET /editions/{id} — detail incl. full edition_feature set (§4.4)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "edition.read");
  const { id } = await params;

  const edition = await queryOne<any>("SELECT * FROM edition WHERE id = ?", [id]);
  if (!edition) throw errNotFound("Edition");

  const features = await query(
    `SELECT f.id AS feature_id, f.\`key\` AS feature_key, f.name AS feature_name,
            f.category, f.type, f.value_type, f.unit, f.allowed_values,
            ef.enabled, ef.limit_value, ef.enum_value
       FROM edition_feature ef
       JOIN feature f ON f.id = ef.feature_id
      WHERE ef.edition_id = ?
      ORDER BY f.category ASC, f.sort_order ASC, f.\`key\` ASC`,
    [id]
  );

  const [{ tenant_count }] = await query<{ tenant_count: number }>(
    "SELECT COUNT(*) AS tenant_count FROM tenant WHERE current_edition_id = ?",
    [id]
  );

  return ok({ ...edition, tenant_count: Number(tenant_count), features });
});

// draft → published → archived (§4.2). Forward-only; anything else is illegal.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["published"],
  published: ["archived"],
  archived: [],
};

const Patch = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  is_public: z.boolean().optional(),
  trial_days: z.number().int().min(0).optional(),
  sort_order: z.number().int().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

// PATCH /editions/{id} — edit metadata + status with transition validation (§4.4)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "edition.write");
  const { id } = await params;
  const body = Patch.parse(await req.json());

  const edition = await queryOne<any>("SELECT * FROM edition WHERE id = ?", [id]);
  if (!edition) throw errNotFound("Edition");

  if (body.status !== undefined && body.status !== edition.status) {
    const allowed = ALLOWED_TRANSITIONS[edition.status] ?? [];
    if (!allowed.includes(body.status))
      throw errUnprocessable(
        `Illegal status transition ${edition.status} → ${body.status}`,
        { from: edition.status, to: body.status }
      );
  }

  const fields = Object.entries(body).filter(
    ([k, v]) => v !== undefined && !(k === "status" && v === edition.status)
  );
  if (fields.length === 0) return ok(edition);

  const updated = await useCase(ctx, async (conn, audit) => {
    const set = fields.map(([k]) => `\`${k}\` = ?`).join(", ");
    await conn.query(`UPDATE edition SET ${set} WHERE id = ?`, [...fields.map(([, v]) => v), id]);
    audit({
      action: "edition.update",
      targetType: "edition",
      targetId: id,
      summary: `Updated edition ${edition.name} (${edition.key})`,
      metadata: { changed: fields.map(([k]) => k) },
    });
    return queryOne("SELECT * FROM edition WHERE id = ?", [id]);
  });

  return ok(updated);
});

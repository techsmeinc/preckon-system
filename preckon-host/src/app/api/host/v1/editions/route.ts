import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errConflict } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

// GET /editions — plan-card list (§4.4)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "edition.read");

  const rows = await query(
    `SELECT e.id, e.\`key\`, e.name, e.description, e.status, e.is_public,
            e.trial_days, e.sort_order, e.created_at, e.updated_at,
            (SELECT COUNT(*) FROM edition_feature ef
               JOIN feature f ON f.id = ef.feature_id
              WHERE ef.edition_id = e.id AND ef.enabled = TRUE
                AND f.category = 'module') AS module_count,
            (SELECT COUNT(*) FROM edition_feature ef
              WHERE ef.edition_id = e.id AND ef.enabled = TRUE) AS feature_count,
            (SELECT COUNT(*) FROM tenant t WHERE t.current_edition_id = e.id) AS tenant_count
       FROM edition e
      ORDER BY e.sort_order ASC, e.\`key\` ASC`
  );

  return ok({ data: rows });
});

const CreateEdition = z.object({
  key: z
    .string()
    .min(2)
    .regex(/^[a-z0-9_-]+$/, "key must be lowercase letters, digits, hyphens and underscores"),
  name: z.string().min(1),
  description: z.string().optional(),
  is_public: z.boolean().optional(),
  trial_days: z.number().int().min(0).optional(),
  sort_order: z.number().int().optional(),
});

// POST /editions — create edition (status='draft') (§4.4)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "edition.write");
  const body = await parseBody(req, CreateEdition);

  const dup = await query("SELECT id FROM edition WHERE `key` = ?", [body.key]);
  if (dup[0]) throw errConflict("An edition with that key already exists", { key: body.key });

  const edition = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      `INSERT INTO edition (id, \`key\`, name, description, status, is_public, trial_days, sort_order)
       VALUES (?,?,?,?, 'draft', ?, ?, ?)`,
      [
        id,
        body.key,
        body.name,
        body.description ?? null,
        body.is_public ?? true,
        body.trial_days ?? 0,
        body.sort_order ?? 0,
      ]
    );
    audit({
      action: "edition.create",
      targetType: "edition",
      targetId: id,
      summary: `Created edition ${body.name} (${body.key})`,
      metadata: { key: body.key },
    });
    return {
      id,
      status: "draft",
      is_public: body.is_public ?? true,
      trial_days: body.trial_days ?? 0,
      sort_order: body.sort_order ?? 0,
      ...body,
    };
  });

  return ok(edition, 201);
});

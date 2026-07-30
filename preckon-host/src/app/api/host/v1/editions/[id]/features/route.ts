import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { bumpEdition } from "@/lib/entitlements";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

const PutFeatures = z.object({
  features: z
    .array(
      z.object({
        feature_key: z.string().min(1),
        enabled: z.boolean(),
        limit_value: z.number().min(0).nullable().optional(),
        enum_value: z.string().nullable().optional(),
      })
    )
    .min(1),
});

// PUT /editions/{id}/features — bulk upsert the edition's feature config (§4.4 / §4.3)
export const PUT = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "edition.write");
  const { id } = await params;
  const body = await parseBody(req, PutFeatures);

  const edition = await queryOne<{ id: string; key: string; name: string; status: string }>(
    "SELECT id, `key`, name, status FROM edition WHERE id = ?",
    [id]
  );
  if (!edition) throw errNotFound("Edition");

  // Resolve every referenced feature by key up front.
  const keys = body.features.map((f) => f.feature_key);
  const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupKeys.length)
    throw errUnprocessable("Duplicate feature_key in request", { keys: [...new Set(dupKeys)] });

  const placeholders = keys.map(() => "?").join(",");
  const features = await query<{
    id: string;
    key: string;
    type: "flag" | "limit" | "metric";
    value_type: "boolean" | "numeric" | "enum";
    allowed_values: unknown;
  }>(
    `SELECT id, \`key\`, type, value_type, allowed_values FROM feature WHERE \`key\` IN (${placeholders})`,
    keys
  );
  const byKey = new Map(features.map((f) => [f.key, f]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length) throw errUnprocessable("Unknown feature_key(s)", { keys: missing });

  // §4.3 per-row validation → normalized rows for upsert.
  const rows = body.features.map((input) => {
    const f = byKey.get(input.feature_key)!;
    const hasLimit = input.limit_value !== undefined && input.limit_value !== null;
    const hasEnum = input.enum_value !== undefined && input.enum_value !== null;
    let limit_value: number | null = null;
    let enum_value: string | null = null;

    if (f.type === "flag") {
      if (hasLimit || hasEnum)
        throw errUnprocessable(
          `Feature ${f.key} is a flag and takes no limit_value/enum_value`,
          { feature_key: f.key }
        );
    } else if (f.value_type === "enum") {
      // enum-valued limit → enum_value column only.
      if (hasLimit)
        throw errUnprocessable(`Feature ${f.key} is enum-valued; limit_value is not allowed`, {
          feature_key: f.key,
        });
      if (input.enabled) {
        if (!hasEnum)
          throw errUnprocessable(`Feature ${f.key} is enabled but has no enum_value`, {
            feature_key: f.key,
          });
        const allowed = Array.isArray(f.allowed_values)
          ? (f.allowed_values as string[])
          : f.allowed_values
            ? (JSON.parse(f.allowed_values as string) as string[])
            : [];
        if (!allowed.includes(input.enum_value!))
          throw errUnprocessable(
            `enum_value "${input.enum_value}" is not in allowed_values for ${f.key}`,
            { feature_key: f.key, allowed_values: allowed }
          );
        enum_value = input.enum_value!;
      }
    } else {
      // numeric limit or metric → limit_value column only (null = unlimited / all-metered).
      if (hasEnum)
        throw errUnprocessable(`Feature ${f.key} is numeric; enum_value is not allowed`, {
          feature_key: f.key,
        });
      if (input.enabled && hasLimit) limit_value = input.limit_value!;
    }

    return { feature_id: f.id, enabled: input.enabled, limit_value, enum_value };
  });

  const published = edition.status === "published";

  await useCase(ctx, async (conn, audit) => {
    for (const r of rows) {
      await conn.query(
        `INSERT INTO edition_feature (edition_id, feature_id, enabled, limit_value, enum_value)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled),
                                 limit_value = VALUES(limit_value),
                                 enum_value = VALUES(enum_value)`,
        [id, r.feature_id, r.enabled, r.limit_value, r.enum_value]
      );
    }
    // §4.2/§5.4 — editing a PUBLISHED edition's features is a live effect: bump
    // entitlement versions for every tenant on this edition in the same tx.
    if (published) await bumpEdition(conn, id);

    audit({
      action: "edition.features.update",
      targetType: "edition",
      targetId: id,
      summary: `Updated ${rows.length} feature(s) on edition ${edition.name}${
        published ? " (LIVE — published edition)" : ""
      }`,
      metadata: {
        count: rows.length,
        feature_keys: keys,
        published,
        live_effect_warning: published,
      },
    });
  });

  return ok({
    edition_id: id,
    updated: rows.length,
    published,
    live_effect_warning: published,
  });
});

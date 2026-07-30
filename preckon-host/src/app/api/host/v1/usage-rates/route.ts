import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { useCase } from "@/lib/usecase";

// GET /usage-rates — all metric rates by currency, joined to feature (§6.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.read");

  const rows = await query(
    `SELECT ur.feature_id, f.\`key\` AS feature_key, f.name AS feature_name, f.unit,
            ur.currency_code, ur.amount_minor, ur.is_active,
            ur.created_at, ur.updated_at
       FROM usage_rate ur
       JOIN feature f ON f.id = ur.feature_id
      ORDER BY f.sort_order ASC, f.\`key\` ASC, ur.currency_code ASC`
  );

  return ok({ data: rows });
});

const PutRates = z.object({
  rates: z
    .array(
      z.object({
        feature_key: z.string().min(1),
        currency_code: z.string().length(3),
        amount_minor: z.number().int().min(0),
      })
    )
    .min(1),
});

// PUT /usage-rates — bulk upsert usage_rate; reject non-metric features (§6.5)
export const PUT = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.write");
  const body = await parseBody(req, PutRates);

  // Reject duplicate (feature_key, currency_code) pairs.
  const seen = new Set<string>();
  for (const r of body.rates) {
    const k = `${r.feature_key}:${r.currency_code}`;
    if (seen.has(k))
      throw errUnprocessable("Duplicate (feature_key, currency_code) in request", { key: k });
    seen.add(k);
  }

  const keys = [...new Set(body.rates.map((r) => r.feature_key))];
  const features = await query<{ id: string; key: string; type: string }>(
    `SELECT id, \`key\`, type FROM feature WHERE \`key\` IN (${keys.map(() => "?").join(",")})`,
    keys
  );
  const byKey = new Map(features.map((f) => [f.key, f]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length) throw errUnprocessable("Unknown feature_key(s)", { keys: missing });
  const nonMetric = keys.filter((k) => byKey.get(k)!.type !== "metric");
  if (nonMetric.length)
    throw errUnprocessable("Usage rates require metric features", { keys: nonMetric });

  const codes = [...new Set(body.rates.map((r) => r.currency_code))];
  const known = await query<{ code: string }>(
    `SELECT code FROM currency WHERE code IN (${codes.map(() => "?").join(",")})`,
    codes
  );
  const knownSet = new Set(known.map((c) => c.code));
  const badCodes = codes.filter((c) => !knownSet.has(c));
  if (badCodes.length) throw errUnprocessable("Unknown currency_code(s)", { codes: badCodes });

  await useCase(ctx, async (conn, audit) => {
    for (const r of body.rates) {
      const feature = byKey.get(r.feature_key)!;
      await conn.query(
        `INSERT INTO usage_rate (feature_id, currency_code, amount_minor)
         VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE amount_minor = VALUES(amount_minor), is_active = TRUE`,
        [feature.id, r.currency_code, r.amount_minor]
      );
    }
    audit({
      action: "usage_rates.update",
      targetType: "usage_rate",
      targetId: null,
      summary: `Updated ${body.rates.length} usage rate(s)`,
      metadata: { count: body.rates.length, feature_keys: keys, currencies: codes },
    });
  });

  const rows = await query(
    `SELECT ur.feature_id, f.\`key\` AS feature_key, f.name AS feature_name,
            ur.currency_code, ur.amount_minor, ur.is_active
       FROM usage_rate ur
       JOIN feature f ON f.id = ur.feature_id
      ORDER BY f.sort_order ASC, f.\`key\` ASC, ur.currency_code ASC`
  );
  return ok({ data: rows });
});

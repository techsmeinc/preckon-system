import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// GET /editions/{id}/prices — rows across currency × interval (§6.5)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.read");
  const { id } = await params;

  const edition = await queryOne("SELECT id FROM edition WHERE id = ?", [id]);
  if (!edition) throw errNotFound("Edition");

  const prices = await query(
    `SELECT edition_id, currency_code, \`interval\`, amount_minor, is_active,
            created_at, updated_at
       FROM edition_price
      WHERE edition_id = ?
      ORDER BY currency_code ASC, \`interval\` ASC`,
    [id]
  );

  return ok({ edition_id: id, prices });
});

const PutPrices = z.object({
  prices: z
    .array(
      z.object({
        currency_code: z.string().length(3),
        interval: z.enum(["monthly", "annual"]),
        amount_minor: z.number().int().min(0),
      })
    )
    .min(1),
});

// PUT /editions/{id}/prices — bulk upsert edition_price (§6.5)
export const PUT = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.write");
  const { id } = await params;
  const body = await parseBody(req, PutPrices);

  const edition = await queryOne<{ id: string; key: string; name: string }>(
    "SELECT id, `key`, name FROM edition WHERE id = ?",
    [id]
  );
  if (!edition) throw errNotFound("Edition");

  // Validate currency codes exist and reject duplicate (currency, interval) keys.
  const seen = new Set<string>();
  for (const p of body.prices) {
    const k = `${p.currency_code}:${p.interval}`;
    if (seen.has(k))
      throw errUnprocessable("Duplicate (currency_code, interval) in request", { key: k });
    seen.add(k);
  }
  const codes = [...new Set(body.prices.map((p) => p.currency_code))];
  const known = await query<{ code: string }>(
    `SELECT code FROM currency WHERE code IN (${codes.map(() => "?").join(",")})`,
    codes
  );
  const knownSet = new Set(known.map((c) => c.code));
  const badCodes = codes.filter((c) => !knownSet.has(c));
  if (badCodes.length) throw errUnprocessable("Unknown currency_code(s)", { codes: badCodes });

  await useCase(ctx, async (conn, audit) => {
    for (const p of body.prices) {
      await conn.query(
        `INSERT INTO edition_price (edition_id, currency_code, \`interval\`, amount_minor)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE amount_minor = VALUES(amount_minor), is_active = TRUE`,
        [id, p.currency_code, p.interval, p.amount_minor]
      );
    }
    audit({
      action: "edition.prices.update",
      targetType: "edition",
      targetId: id,
      summary: `Updated ${body.prices.length} price row(s) on edition ${edition.name}`,
      metadata: { count: body.prices.length, currencies: codes },
    });
  });

  const prices = await query(
    `SELECT edition_id, currency_code, \`interval\`, amount_minor, is_active
       FROM edition_price WHERE edition_id = ?
      ORDER BY currency_code ASC, \`interval\` ASC`,
    [id]
  );
  return ok({ edition_id: id, prices });
});

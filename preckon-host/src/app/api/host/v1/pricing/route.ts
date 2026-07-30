import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /pricing — consolidated pricing view for the Pricing screen (§6.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.read");

  const currencies = await query(
    `SELECT code, name, symbol, minor_unit, is_active, sort_order
       FROM currency
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, code ASC`
  );

  const editions = await query<{ id: string; key: string; name: string; status: string; is_public: number }>(
    `SELECT id, \`key\`, name, status, is_public
       FROM edition
      WHERE status <> 'archived'
      ORDER BY sort_order ASC, \`key\` ASC`
  );

  const editionPrices = await query<{
    edition_id: string;
    currency_code: string;
    interval: string;
    amount_minor: number;
  }>(
    `SELECT edition_id, currency_code, \`interval\`, amount_minor
       FROM edition_price
      WHERE is_active = TRUE
      ORDER BY currency_code ASC, \`interval\` ASC`
  );
  const pricesByEdition = new Map<string, any[]>();
  for (const p of editionPrices) {
    let arr = pricesByEdition.get(p.edition_id);
    if (!arr) pricesByEdition.set(p.edition_id, (arr = []));
    arr.push({ currency_code: p.currency_code, interval: p.interval, amount_minor: Number(p.amount_minor) });
  }

  const rateRows = await query<{
    feature_id: string;
    feature_key: string;
    feature_name: string;
    unit: string | null;
    currency_code: string;
    amount_minor: number;
  }>(
    `SELECT ur.feature_id, f.\`key\` AS feature_key, f.name AS feature_name, f.unit,
            ur.currency_code, ur.amount_minor
       FROM usage_rate ur
       JOIN feature f ON f.id = ur.feature_id
      WHERE ur.is_active = TRUE
      ORDER BY f.sort_order ASC, f.\`key\` ASC, ur.currency_code ASC`
  );
  const ratesByFeature = new Map<string, any>();
  const featureOrder: string[] = [];
  for (const r of rateRows) {
    let entry = ratesByFeature.get(r.feature_key);
    if (!entry) {
      entry = { feature_key: r.feature_key, name: r.feature_name, unit: r.unit, rates: [] };
      ratesByFeature.set(r.feature_key, entry);
      featureOrder.push(r.feature_key);
    }
    entry.rates.push({ currency_code: r.currency_code, amount_minor: Number(r.amount_minor) });
  }

  return ok({
    editions: editions.map((e) => ({
      id: e.id,
      key: e.key,
      name: e.name,
      status: e.status,
      is_public: !!e.is_public,
      prices: pricesByEdition.get(e.id) ?? [],
    })),
    usage_rates: featureOrder.map((k) => ratesByFeature.get(k)),
    currencies,
  });
});

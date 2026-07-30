import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /currencies — active currencies for the switcher (§6.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.read");

  const rows = await query(
    `SELECT code, name, symbol, minor_unit, is_active, sort_order
       FROM currency
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, code ASC`
  );

  return ok({ data: rows });
});

import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /tenants/stats — tenant counts by status, aggregated in the DB.
// Replaces the console pulling every tenant row just to count them client-side
// (which silently capped at the page limit). Cheap GROUP BY over the PK-indexed
// status column.
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");

  const rows = await query<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM tenant GROUP BY status",
    []
  );

  const by_status = rows.map((r) => ({ status: r.status, n: Number(r.n) }));
  const total = by_status.reduce((s, r) => s + r.n, 0);

  return ok({ total, by_status });
});

import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /permissions — the full permission catalog grouped by category (drives the RBAC matrix). (§1.4)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "role.manage");

  const rows = await query<{ id: string; key: string; category: string; description: string }>(
    "SELECT id, `key`, category, description FROM host_permission ORDER BY category, `key`"
  );

  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byCategory.get(row.category);
    if (bucket) bucket.push(row);
    else byCategory.set(row.category, [row]);
  }
  const groups = [...byCategory.entries()].map(([category, permissions]) => ({
    category,
    permissions,
  }));

  return ok({ groups });
});

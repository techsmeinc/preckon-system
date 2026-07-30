import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /editions/matrix — full feature × published-edition matrix (§4.4)
// Defined before editions/[id] so the literal `matrix` segment resolves first.
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "edition.read");

  const editions = await query<{ id: string; key: string; name: string }>(
    `SELECT id, \`key\`, name
       FROM edition
      WHERE status = 'published'
      ORDER BY sort_order ASC, \`key\` ASC`
  );

  const features = await query<{
    id: string;
    key: string;
    name: string;
    category: string;
    type: string;
    sort_order: number;
  }>(
    `SELECT id, \`key\`, name, category, type, sort_order
       FROM feature
      WHERE status = 'active'
      ORDER BY category ASC, sort_order ASC, \`key\` ASC`
  );

  const cells = await query<{
    feature_id: string;
    edition_id: string;
    enabled: number;
    limit_value: string | null;
    enum_value: string | null;
  }>(
    `SELECT ef.feature_id, ef.edition_id, ef.enabled, ef.limit_value, ef.enum_value
       FROM edition_feature ef
       JOIN edition e ON e.id = ef.edition_id
      WHERE e.status = 'published'`
  );

  // Index cells by feature → edition.
  const byFeature = new Map<string, Record<string, any>>();
  for (const c of cells) {
    let m = byFeature.get(c.feature_id);
    if (!m) byFeature.set(c.feature_id, (m = {}));
    const cell: Record<string, unknown> = { enabled: !!c.enabled };
    if (c.limit_value !== null) cell.limit_value = Number(c.limit_value);
    if (c.enum_value !== null) cell.enum_value = c.enum_value;
    m[c.edition_id] = cell;
  }

  // Group features by category, preserving encounter order.
  const groupOrder: string[] = [];
  const groups = new Map<string, any[]>();
  for (const f of features) {
    if (!groups.has(f.category)) (groups.set(f.category, []), groupOrder.push(f.category));
    groups.get(f.category)!.push({
      key: f.key,
      name: f.name,
      type: f.type,
      cells: byFeature.get(f.id) ?? {},
    });
  }

  return ok({
    editions: editions.map((e) => ({ id: e.id, key: e.key, name: e.name })),
    groups: groupOrder.map((category) => ({ category, features: groups.get(category)! })),
  });
});

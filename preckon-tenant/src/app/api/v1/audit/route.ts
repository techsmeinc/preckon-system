import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query } from "@/lib/db";

// §9.5 GET /audit — tenant audit log (filter by action/target/date).
export const GET = route(async (req, ctx) => {
  requirePermission(ctx, "admin.settings");
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const where = ["tenant_id = ?"];
  const params: any[] = [ctx.tenantId];
  if (action) {
    where.push("action = ?");
    params.push(action);
  }
  const rows = await query(
    `SELECT seq, actor_kind, actor_id, action, target_kind, target_id, project_id, summary, hash, created_at
       FROM audit_event WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT 200`,
    params
  );
  return ok(rows);
});

import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, list, parsePage, paginate, q } from "@/lib/http";

// GET /observability/failed-jobs — filters ?job_type ?tenant_id ?resolved (§10.3)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "observability.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const jobType = q(req, "job_type");
  const tenantId = q(req, "tenant_id");
  const resolved = q(req, "resolved");
  if (jobType) (where.push("f.job_type = ?"), params.push(jobType));
  if (tenantId) (where.push("f.tenant_id = ?"), params.push(tenantId));
  if (resolved === "true" || resolved === "false")
    (where.push("f.resolved = ?"), params.push(resolved === "true" ? 1 : 0));
  if (cursor) (where.push("f.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `SELECT f.id, f.job_id, f.job_type, f.queue, f.tenant_id, f.error_class, f.error_message,
            f.attempt, f.max_attempts, f.correlation_id, f.failed_at,
            f.resolved, f.resolved_by, f.resolved_at, f.resolution_note
       FROM job_failure f
       ${whereSql}
      ORDER BY f.id DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET /observability/failed-jobs/{id} — detail incl. traceback + envelope (§10.3)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "observability.read");
  const { id } = await params;

  const job = await queryOne<any>("SELECT * FROM job_failure WHERE id = ?", [id]);
  if (!job) throw errNotFound("Failed job");

  return ok(job);
});

import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };
const Body = z.object({ note: z.string().min(1, "note is required") });

// POST /observability/failed-jobs/{id}/resolve — mark triaged (§10.3)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "job.manage");
  const { id } = await params;
  const { note } = Body.parse(await req.json());

  const job = await queryOne<{ id: string; job_type: string; tenant_id: string | null }>(
    "SELECT id, job_type, tenant_id FROM job_failure WHERE id = ?",
    [id]
  );
  if (!job) throw errNotFound("Failed job");

  const updated = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "UPDATE job_failure SET resolved=TRUE, resolved_by=?, resolved_at=NOW(), resolution_note=? WHERE id=?",
      [ctx.user.id, note, id]
    );
    audit({
      action: "job.resolve",
      targetType: "job_failure",
      targetId: id,
      targetTenantId: job.tenant_id ?? undefined,
      summary: `Resolved failed job ${job.job_type}`,
      metadata: { note },
    });
    return queryOne("SELECT * FROM job_failure WHERE id = ?", [id]);
  });

  return ok(updated);
});

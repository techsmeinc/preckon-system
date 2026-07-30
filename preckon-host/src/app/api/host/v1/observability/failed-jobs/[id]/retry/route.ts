import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// POST /observability/failed-jobs/{id}/retry — re-enqueue from stored envelope (§10.3)
// arq isn't wired, so we log the re-enqueue and audit it; `resolved` is left as-is.
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "job.manage");
  const { id } = await params;

  const job = await queryOne<{
    id: string;
    job_id: string;
    job_type: string;
    queue: string;
    tenant_id: string | null;
    envelope: any;
  }>("SELECT id, job_id, job_type, queue, tenant_id, envelope FROM job_failure WHERE id = ?", [id]);
  if (!job) throw errNotFound("Failed job");

  const result = await useCase(ctx, async (_conn, audit) => {
    // Mirror-only re-enqueue: in prod this pushes job.envelope back onto arq/Redis.
    console.info(`[jobs:mock] re-enqueue ${job.job_type} (${job.job_id}) → queue '${job.queue}'`);
    audit({
      action: "job.retry",
      targetType: "job_failure",
      targetId: id,
      targetTenantId: job.tenant_id ?? undefined,
      summary: `Re-enqueued failed job ${job.job_type} (${job.job_id})`,
      metadata: { job_id: job.job_id, job_type: job.job_type, queue: job.queue },
    });
    return { id, job_id: job.job_id, requeued: true, queue: job.queue };
  });

  return ok(result);
});

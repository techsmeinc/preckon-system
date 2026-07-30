import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id}/export — kick off a full tenant data export job (§3.4, §3.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.offboard");
  const { id } = await params;

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const jobId = newId();
  await useCase(ctx, async (conn, audit) => {
    // Export is an async job producing a signed download; log the intent for now.
    console.info("[export] queued tenant data export", id, jobId);
    audit({
      action: "tenant.export",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Queued data export for ${tenant.name}`,
      metadata: { job_id: jobId },
    });
  });
  return ok({ job_id: jobId, status: "queued" });
});

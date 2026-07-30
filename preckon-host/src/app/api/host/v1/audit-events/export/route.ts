import { getAuthContext, requirePermission } from "@/lib/context";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

// POST /audit-events/export — kick off an async export for a filter range. Returns a job id.
// Exporting the audit log is itself an audited action. (§2.4)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "audit.export");

  // The filter/format payload is optional; capture whatever was sent for the audit trail.
  let filters: unknown = {};
  try {
    filters = await req.json();
  } catch {
    /* no body — export everything with defaults */
  }

  const jobId = newId();
  await useCase(ctx, async (_conn, audit) => {
    audit({
      action: "audit.export",
      targetType: "audit_export",
      targetId: jobId,
      summary: "Started an audit log export",
      metadata: { job_id: jobId, filters: filters ?? {} },
    });
  });

  return ok({ job_id: jobId });
});

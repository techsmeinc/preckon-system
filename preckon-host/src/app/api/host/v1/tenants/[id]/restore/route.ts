import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// POST /tenants/{id}/restore — suspended → active (or trial if trial未过期) (§3.2)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.restore");
  const { id } = await params;

  const tenant = await queryOne<{ status: string; name: string; trial_ends_at: Date | null }>(
    "SELECT status, name, trial_ends_at FROM tenant WHERE id = ?",
    [id]
  );
  if (!tenant) throw errNotFound("Tenant");
  if (tenant.status !== "suspended")
    throw errUnprocessable(`Only suspended tenants can be restored (was '${tenant.status}')`);

  const target =
    tenant.trial_ends_at && new Date(tenant.trial_ends_at) > new Date() ? "trial" : "active";

  await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "UPDATE tenant SET status=?, suspended_at=NULL, suspended_reason=NULL WHERE id=?",
      [target, id]
    );
    audit({
      action: "tenant.restore",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Restored ${tenant.name} to ${target}`,
    });
  });
  return ok(await queryOne("SELECT * FROM tenant WHERE id = ?", [id]));
});

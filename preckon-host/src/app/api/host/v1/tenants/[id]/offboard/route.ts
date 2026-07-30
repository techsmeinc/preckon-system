import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { storage } from "@/lib/integrations";

type Params = { params: Promise<{ id: string }> };
const Body = z.object({ confirm_slug: z.string().min(1, "confirm_slug is required") });

// POST /tenants/{id}/offboard — start offboarding (§3.4, §3.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.offboard");
  const { id } = await params;
  const { confirm_slug } = Body.parse(await req.json());

  const tenant = await queryOne<{ status: string; name: string; slug: string }>(
    "SELECT status, name, slug FROM tenant WHERE id = ?",
    [id]
  );
  if (!tenant) throw errNotFound("Tenant");
  if (confirm_slug !== tenant.slug)
    throw errUnprocessable("confirm_slug does not match the tenant slug");
  if (!["trial", "active", "suspended"].includes(tenant.status))
    throw errUnprocessable(`Cannot offboard a tenant in '${tenant.status}' state`);

  const updated = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "UPDATE tenant SET status='offboarding', offboarded_at=NULL WHERE id=?",
      [id]
    );
    // Export + purge are async jobs (§3.4). Mirror the intent for now.
    console.info("[offboard] queued export + retention-gated purge", id);
    storage.keyFor(id, "export");
    audit({
      action: "tenant.offboard",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Started offboarding ${tenant.name}`,
      metadata: { confirm_slug },
    });
    return queryOne("SELECT * FROM tenant WHERE id = ?", [id]);
  });
  return ok(updated);
});

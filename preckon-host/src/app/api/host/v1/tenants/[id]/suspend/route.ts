import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };
const Body = z.object({ reason: z.string().min(1, "reason is required") });

// POST /tenants/{id}/suspend — trial/active → suspended (§3.2, §3.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.suspend");
  const { id } = await params;
  const { reason } = Body.parse(await req.json());

  const tenant = await queryOne<{ status: string; name: string }>(
    "SELECT status, name FROM tenant WHERE id = ?",
    [id]
  );
  if (!tenant) throw errNotFound("Tenant");
  if (!["trial", "active"].includes(tenant.status))
    throw errUnprocessable(`Cannot suspend a tenant in '${tenant.status}' state`);

  await useCase(ctx, async (conn, audit) => {
    await conn.query(
      "UPDATE tenant SET status='suspended', suspended_at=NOW(), suspended_reason=? WHERE id=?",
      [reason, id]
    );
    audit({
      action: "tenant.suspend",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Suspended ${tenant.name}`,
      metadata: { reason },
    });
  });
  // Read back AFTER the transaction commits (pool reads can't see an open tx).
  return ok(await queryOne("SELECT * FROM tenant WHERE id = ?", [id]));
});

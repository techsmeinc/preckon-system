import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { tx } from "@/lib/db";
import { verifyChain } from "@/lib/audit";

// §9.5 GET /audit/verify — walk the tenant's chain, recompute hashes, confirm linkage.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "admin.settings");
  const result = await tx((conn) => verifyChain(conn, ctx.tenantId));
  return ok(result);
});

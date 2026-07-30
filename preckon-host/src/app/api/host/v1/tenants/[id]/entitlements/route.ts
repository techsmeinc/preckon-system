import { getAuthContext, requirePermission } from "@/lib/context";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { resolveEntitlements } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id}/entitlements — resolved effective set, console-facing (§5.5)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");
  const { id } = await params;

  const resolved = await resolveEntitlements(id);
  if (!resolved) throw errNotFound("Tenant");
  return ok(resolved);
});

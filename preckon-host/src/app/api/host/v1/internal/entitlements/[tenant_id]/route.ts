import { requireServiceAuth } from "@/lib/context";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { resolveEntitlements } from "@/lib/entitlements";

type Params = { params: Promise<{ tenant_id: string }> };

// GET /internal/entitlements/{tenant_id} — the §5.3 machine contract consumed by
// the tenant plane. Service-to-service auth, NOT a host session (§5.5).
export const GET = handle(async (req, { params }: Params) => {
  requireServiceAuth(req);
  const { tenant_id } = await params;

  const resolved = await resolveEntitlements(tenant_id);
  if (!resolved) throw errNotFound("Tenant");
  return ok(resolved);
});

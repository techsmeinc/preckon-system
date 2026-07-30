import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { licensedWorkflows } from "@/lib/entitlements";

// §4.6 GET /workflows — enabled workflows licensed under the tenant's edition.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "workflow.read");
  const wfs = await licensedWorkflows(ctx.tenantId);
  return ok(
    wfs.map((w) => ({
      key: w.key,
      name: w.name,
      moduleKey: w.module_key,
      entitlementKey: w.entitlement_key,
    }))
  );
});

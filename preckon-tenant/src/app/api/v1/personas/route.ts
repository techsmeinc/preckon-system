import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { licensedPersonas } from "@/lib/entitlements";

// §6.4.5 GET /personas — the roster visible under the tenant's entitlements.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "workflow.read");
  const personas = await licensedPersonas(ctx.tenantId);
  return ok(
    personas.map((p) => ({
      key: p.agent_key,
      label: p.name,
      isDefault: !!p.is_default,
      scope: { moduleKeys: p.scope?.module_keys ?? [] },
      deviations: p.deviation_kinds ?? [],
    }))
  );
});

import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { getRules, resolveStandards } from "@/lib/standards";

// GET /standards/rules[?subject=] — the tenant's standard rules; with ?subject,
// also returns the deterministic tier-precedence resolution (§2).
export const GET = route(async (req, ctx) => {
  requirePermission(ctx, "library.read");
  const rules = await getRules(ctx.tenantId);
  const subject = new URL(req.url).searchParams.get("subject");
  return ok({
    rules,
    resolution: subject ? resolveStandards(rules, subject) : null,
  });
});

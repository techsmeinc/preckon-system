import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { listTemplates } from "@/lib/domains";

// GET /domain/templates — the industry template library a tenant can pick from.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "workflow.read");
  return ok(listTemplates());
});

import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { provisionTenantDomain } from "@/lib/domains";

const Body = z.object({ templateKey: z.string().min(1), name: z.string().min(1).optional() });

// POST /domain/provision — pick (or switch to) an industry template: clone it into
// the tenant's own editable domain, seed the catalog, bind the tenant.
export const POST = route(async (req, ctx) => {
  requirePermission(ctx, "admin.settings");
  const body = Body.parse(await req.json());
  const res = await provisionTenantDomain(actorFromCtx(ctx), ctx.tenantId, body.templateKey, body.name);
  return ok(res, 201);
});

import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { getTenantDomain, updateTenantDomain } from "@/lib/domains";

// GET /domain — the tenant's current domain (assistant): editable pack + meta.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "workflow.read");
  return ok(await getTenantDomain(ctx.tenantId));
});

const Edit = z.object({
  name: z.string().min(1).optional(),
  assistantName: z.string().min(1).optional(),
  modules: z.array(z.object({ key: z.string(), label: z.string().optional(), description: z.string().optional(), icon: z.string().optional() })).optional(),
  types: z.array(z.object({ key: z.string(), name: z.string() })).optional(),
});

// PUT /domain — edit the tenant's own domain (labels/names/assistant); re-projects.
export const PUT = route(async (req, ctx) => {
  requirePermission(ctx, "admin.settings");
  const edits = Edit.parse(await req.json());
  await updateTenantDomain(actorFromCtx(ctx), ctx.tenantId, edits);
  return ok(await getTenantDomain(ctx.tenantId));
});

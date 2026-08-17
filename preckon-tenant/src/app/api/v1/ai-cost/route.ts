import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { costByTenant, tierMix, type Grouping } from "@/lib/ai-cost";

// GET /v1/ai-cost — what the AI cost this tenant, and where it went.
//
// Scoped to the caller's tenant by construction: the id comes from the auth
// context and is never read from the query string, so there is no parameter to
// tamper with. Cross-tenant spend is a platform question and does not belong on
// a tenant-facing route at all.
//
// Behind the admin permission rather than a plain read: spend is commercially
// sensitive inside a customer as well as outside one.

const Query = z.object({
  groupBy: z.enum(["project", "agent", "job_type", "model", "day"]).default("project"),
  /* Days back. Capped at a year — the table grows without bound and an
     unbounded scan from a URL parameter is a denial of service somebody finds
     by accident. */
  days: z.coerce.number().int().min(1).max(365).default(30),
  projectId: z.string().max(64).optional(),
});

export const GET = route(async (req, ctx) => {
  requirePermission(ctx, "tenant.admin");

  const url = new URL(req.url);
  const q = Query.parse({
    groupBy: url.searchParams.get("groupBy") ?? undefined,
    days: url.searchParams.get("days") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
  });

  const since = new Date(Date.now() - q.days * 86400_000);
  const [summary, tiers] = await Promise.all([
    costByTenant(ctx.tenantId, { since, groupBy: q.groupBy as Grouping, projectId: q.projectId }),
    tierMix(ctx.tenantId, since),
  ]);

  return ok({
    since: since.toISOString(),
    days: q.days,
    groupBy: q.groupBy,
    ...summary,
    /* The routing ladder's baseline. Improvement work on model selection is
       judged against this split, so it travels with the spend rather than
       living on a separate screen nobody opens. */
    tiers,
  });
});

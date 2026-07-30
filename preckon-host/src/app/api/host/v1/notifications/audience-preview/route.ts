import { getAuthContext, requirePermission } from "@/lib/context";
import { errBadRequest } from "@/lib/errors";
import { handle, ok, q } from "@/lib/http";
import { resolveAudience, audienceSample, type AudienceType, type AudienceFilter } from "../_audience";

const AUDIENCE_TYPES = ["all_tenants", "by_edition", "by_status", "specific"] as const;

// GET /notifications/audience-preview — ?audience_type=&filter= → count + sample (§8.3)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "notification.read");

  const audienceType = q(req, "audience_type");
  if (!audienceType || !AUDIENCE_TYPES.includes(audienceType as AudienceType))
    throw errBadRequest("audience_type must be one of " + AUDIENCE_TYPES.join(", "));

  let filter: AudienceFilter = {};
  const rawFilter = q(req, "filter");
  if (rawFilter) {
    try {
      filter = JSON.parse(rawFilter);
    } catch {
      throw errBadRequest("filter must be a JSON-encoded object");
    }
  }

  const tenantIds = await resolveAudience(audienceType as AudienceType, filter);
  const sample = await audienceSample(tenantIds);

  return ok({
    audience_type: audienceType,
    filter,
    matched_count: tenantIds.length,
    sample,
  });
});

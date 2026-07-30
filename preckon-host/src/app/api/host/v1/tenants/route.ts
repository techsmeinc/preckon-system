import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errConflict, errBadRequest } from "@/lib/errors";
import { handle, list, ok, parsePage, paginate, q } from "@/lib/http";
import { newId } from "@/lib/ids";
import { withIdempotency } from "@/lib/idempotency";
import { useCase } from "@/lib/usecase";
import { stripe, tenantPlane } from "@/lib/integrations";

// GET /tenants — list with filters ?status ?region ?edition_id ?q (§3.6)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const status = q(req, "status");
  const region = q(req, "region");
  const editionId = q(req, "edition_id");
  const search = q(req, "q");
  if (status) (where.push("t.status = ?"), params.push(status));
  if (region) (where.push("t.region = ?"), params.push(region));
  if (editionId) (where.push("t.current_edition_id = ?"), params.push(editionId));
  if (search) {
    where.push("(t.name LIKE ? OR t.slug LIKE ? OR t.primary_contact_email LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (cursor) (where.push("t.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `SELECT t.id, t.slug, t.name, t.status, t.region, t.current_edition_id,
            e.\`key\` AS edition_key, e.name AS edition_name,
            t.trial_ends_at, t.primary_contact_email, t.created_at,
            (SELECT s.status FROM subscription s
               WHERE s.tenant_id = t.id AND s.status <> 'canceled' LIMIT 1) AS subscription_status,
            (SELECT COALESCE(ter.limit_value_override, ef.limit_value)
               FROM feature f
               LEFT JOIN edition_feature ef ON ef.edition_id = t.current_edition_id AND ef.feature_id = f.id
               LEFT JOIN tenant_entitlement_override ter ON ter.tenant_id = t.id AND ter.feature_id = f.id
              WHERE f.\`key\` = 'limit.seats') AS seat_cap
       FROM tenant t JOIN edition e ON e.id = t.current_edition_id
       ${whereSql}
      ORDER BY t.id DESC
      LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

const CreateTenant = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase, digits and hyphens"),
  region: z.string().min(1),
  edition_id: z.string().min(1),
  primary_contact_email: z.string().email(),
  legal_name: z.string().optional(),
  start_as: z.enum(["trial", "active"]).default("trial"),
});

// POST /tenants — provision (Idempotency-Key required) (§3.6)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.create");
  if (!req.headers.get("idempotency-key"))
    throw errBadRequest("Idempotency-Key header is required for provisioning");

  return withIdempotency(req, "POST /tenants", ctx.user.id, async () => {
    const body = await req.clone().json().then((b) => CreateTenant.parse(b));

    const edition = await query<{ id: string; status: string; trial_days: number; key: string; name: string }>(
      "SELECT id, status, trial_days, `key`, name FROM edition WHERE id = ?",
      [body.edition_id]
    );
    if (!edition[0]) throw errBadRequest("Unknown edition_id");
    if (edition[0].status !== "published")
      throw errConflict("Only published editions can be assigned to tenants");

    const dup = await query("SELECT id FROM tenant WHERE slug = ?", [body.slug]);
    if (dup[0]) throw errConflict("A tenant with that slug already exists", { slug: body.slug });

    const tenant = await useCase(ctx, async (conn, audit) => {
      const id = newId();
      const status = body.start_as;
      const trialEnds =
        status === "trial" && edition[0].trial_days > 0
          ? `DATE_ADD(NOW(), INTERVAL ${edition[0].trial_days} DAY)`
          : "NULL";
      await conn.query(
        `INSERT INTO tenant (id, slug, name, legal_name, status, region, current_edition_id,
                             trial_ends_at, primary_contact_email, provisioned_by)
         VALUES (?,?,?,?,?,?,?, ${trialEnds}, ?, ?)`,
        [id, body.slug, body.name, body.legal_name ?? null, status, body.region, body.edition_id,
         body.primary_contact_email, ctx.user.id]
      );
      // Empty theme row + tenant-plane bootstrap (Stripe customer for paid start).
      await conn.query("INSERT INTO tenant_theme (tenant_id, theme_tokens) VALUES (?, JSON_OBJECT())", [id]);
      if (status === "active") {
        await stripe.createCustomer({ name: body.name, email: body.primary_contact_email, tenantId: id });
      }
      audit({
        action: "tenant.create",
        targetType: "tenant",
        targetId: id,
        targetTenantId: id,
        summary: `Provisioned ${body.name} (${edition[0].name}, ${status})`,
        metadata: { slug: body.slug, edition: edition[0].key, region: body.region },
      });
      return { id, ...body, status };
    });

    // §1.5 — provision the tenant's workspace on the tenant plane: create the owner
    // in the SEPARATE tenant identity pool + seed roles/settings/entitlements.
    // Best-effort: a tenant-plane outage must not fail the Host record (retryable).
    let provisioning: any = null;
    try {
      const mods = await query<{ module_key: string }>(
        `SELECT REPLACE(f.\`key\`,'module.','') AS module_key
           FROM edition_feature ef JOIN feature f ON f.id = ef.feature_id
          WHERE ef.edition_id = ? AND ef.enabled = 1 AND f.\`key\` LIKE 'module.%'`,
        [body.edition_id]
      );
      provisioning = await tenantPlane.bootstrap({
        tenantId: tenant.id,
        tenantName: body.name,
        ownerEmail: body.primary_contact_email,
        ownerName: body.legal_name ?? body.name,
        editionRef: edition[0].key,
        licensedModules: mods.map((m) => m.module_key),
      });
    } catch (e) {
      console.error("[provision] tenant-plane bootstrap failed:", (e as Error).message);
      provisioning = { error: (e as Error).message, bootstrapped: false };
    }

    return ok({ ...tenant, provisioning }, 201);
  });
});

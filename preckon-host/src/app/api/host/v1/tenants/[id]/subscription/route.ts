import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { bumpTenant } from "@/lib/entitlements";
import { errBadRequest, errConflict, errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { withIdempotency } from "@/lib/idempotency";
import { stripe } from "@/lib/integrations";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// GET /tenants/{id}/subscription — the tenant's current non-canceled subscription (§7.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.read");
  const { id } = await params;

  const tenant = await queryOne<{ id: string }>("SELECT id FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const subscription = await queryOne<any>(
    `SELECT s.*, e.\`key\` AS edition_key, e.name AS edition_name
       FROM subscription s JOIN edition e ON e.id = s.edition_id
      WHERE s.tenant_id = ? AND s.status <> 'canceled'
      LIMIT 1`,
    [id]
  );
  if (!subscription) throw errNotFound("Subscription");
  return ok(subscription);
});

const CreateSub = z.object({
  edition_id: z.string().min(1),
  currency_code: z.string().length(3),
  interval: z.enum(["monthly", "annual"]),
  seats: z.number().int().positive().nullable().optional(),
  coupon_code: z.string().min(1).optional(),
});

// POST /tenants/{id}/subscription — start a subscription (Idempotency-Key required) (§7.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "subscription.manage");
  const { id } = await params;
  if (!req.headers.get("idempotency-key"))
    throw errBadRequest("Idempotency-Key header is required to start a subscription");

  return withIdempotency(req, "POST /tenants/:id/subscription", ctx.user.id, async () => {
    const body = await req.clone().json().then((b) => CreateSub.parse(b));

    const tenant = await queryOne<{ id: string; name: string; primary_contact_email: string }>(
      "SELECT id, name, primary_contact_email FROM tenant WHERE id = ?",
      [id]
    );
    if (!tenant) throw errNotFound("Tenant");

    const edition = await queryOne<{ id: string; key: string; name: string; status: string; trial_days: number }>(
      "SELECT id, `key`, name, status, trial_days FROM edition WHERE id = ?",
      [body.edition_id]
    );
    if (!edition) throw errBadRequest("Unknown edition_id");
    if (edition.status !== "published")
      throw errConflict("Only published editions can be subscribed to");

    const currency = await queryOne<{ code: string }>(
      "SELECT code FROM currency WHERE code = ? AND is_active = TRUE",
      [body.currency_code]
    );
    if (!currency) throw errBadRequest("Unknown or inactive currency_code");

    let couponId: string | null = null;
    if (body.coupon_code) {
      const coupon = await queryOne<{ id: string }>(
        "SELECT id FROM coupon WHERE code = ? AND status = 'active'",
        [body.coupon_code]
      );
      if (!coupon) throw errUnprocessable("Unknown or inactive coupon_code", { coupon_code: body.coupon_code });
      couponId = coupon.id;
    }

    // One live subscription per tenant (mirrors the partial-unique index §7.1).
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM subscription WHERE tenant_id = ? AND status <> 'canceled' LIMIT 1",
      [id]
    );
    if (existing) throw errConflict("Tenant already has an active subscription");

    // Stripe boundary (mock in dev). Entitlements do NOT depend on this succeeding (§7.0).
    const customer = await stripe.createCustomer({
      name: tenant.name,
      email: tenant.primary_contact_email,
      tenantId: id,
    });
    const stripeSub = await stripe.createSubscription({
      customerId: customer.id,
      editionKey: edition.key,
      interval: body.interval,
      seats: body.seats ?? null,
    });

    const status = edition.trial_days > 0 ? "trialing" : "active";
    const periodUnit = body.interval === "annual" ? "YEAR" : "MONTH";

    const created = await useCase(ctx, async (conn, audit) => {
      const subId = newId();
      const trialExpr = status === "trialing" ? `DATE_ADD(NOW(), INTERVAL ${edition.trial_days} DAY)` : "NULL";
      await conn.query(
        `INSERT INTO subscription
           (id, tenant_id, edition_id, currency_code, \`interval\`, status, seats, coupon_id,
            custom_amount_minor, trial_end, current_period_start, current_period_end,
            stripe_customer_id, stripe_subscription_id)
         VALUES (?,?,?,?,?,?,?,?,?, ${trialExpr}, NOW(), DATE_ADD(NOW(), INTERVAL 1 ${periodUnit}), ?, ?)`,
        [subId, id, body.edition_id, body.currency_code, body.interval, status, body.seats ?? null,
          couponId, null, customer.id, stripeSub.id]
      );

      // §7.0: entitlement anchor moves in the SAME tx as the billing change.
      await conn.query("UPDATE tenant SET current_edition_id = ? WHERE id = ?", [body.edition_id, id]);
      await bumpTenant(conn, id);

      // §7.1 seat-change flow: mirror the billed seat count into a limit.seats override.
      if (body.seats != null) await upsertSeatOverride(conn, id, body.seats, ctx.user.id);

      audit({
        action: "subscription.create",
        targetType: "subscription",
        targetId: subId,
        targetTenantId: id,
        summary: `Started ${edition.name} (${body.interval}, ${status}) for ${tenant.name}`,
        metadata: { edition: edition.key, interval: body.interval, currency: body.currency_code, seats: body.seats ?? null, coupon: body.coupon_code ?? null },
      });
      return queryOne("SELECT * FROM subscription WHERE id = ?", [subId]);
    });

    return ok(created, 201);
  });
});

const PatchSub = z.object({
  edition_id: z.string().min(1).optional(),
  currency_code: z.string().length(3).optional(),
  interval: z.enum(["monthly", "annual"]).optional(),
  seats: z.number().int().positive().nullable().optional(),
  coupon_code: z.string().min(1).nullable().optional(),
});

// PATCH /tenants/{id}/subscription — change plan/interval/seats/coupon (§7.6)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "subscription.manage");
  const { id } = await params;
  const body = PatchSub.parse(await req.json());

  const sub = await queryOne<any>(
    "SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'canceled' LIMIT 1",
    [id]
  );
  if (!sub) throw errNotFound("Subscription");

  let newEdition: { id: string; key: string; name: string } | null = null;
  if (body.edition_id && body.edition_id !== sub.edition_id) {
    const e = await queryOne<{ id: string; key: string; name: string; status: string }>(
      "SELECT id, `key`, name, status FROM edition WHERE id = ?",
      [body.edition_id]
    );
    if (!e) throw errBadRequest("Unknown edition_id");
    if (e.status !== "published") throw errConflict("Only published editions can be subscribed to");
    newEdition = e;
  }

  let couponId: string | null | undefined = undefined; // undefined = unchanged
  if (body.coupon_code !== undefined) {
    if (body.coupon_code === null) couponId = null;
    else {
      const coupon = await queryOne<{ id: string }>(
        "SELECT id FROM coupon WHERE code = ? AND status = 'active'",
        [body.coupon_code]
      );
      if (!coupon) throw errUnprocessable("Unknown or inactive coupon_code", { coupon_code: body.coupon_code });
      couponId = coupon.id;
    }
  }

  if (body.currency_code) {
    const currency = await queryOne<{ code: string }>(
      "SELECT code FROM currency WHERE code = ? AND is_active = TRUE",
      [body.currency_code]
    );
    if (!currency) throw errBadRequest("Unknown or inactive currency_code");
  }

  const seatsChanged = body.seats !== undefined && body.seats !== sub.seats;

  // Stripe boundary (mock in dev) — proration handled by Stripe.
  if (sub.stripe_subscription_id) {
    await stripe.createSubscription({
      customerId: sub.stripe_customer_id ?? "",
      editionKey: newEdition?.key ?? "",
      interval: body.interval ?? sub.interval,
      seats: body.seats ?? sub.seats,
    });
  }

  const updated = await useCase(ctx, async (conn, audit) => {
    const set: string[] = [];
    const vals: any[] = [];
    if (newEdition) (set.push("edition_id = ?"), vals.push(newEdition.id));
    if (body.currency_code) (set.push("currency_code = ?"), vals.push(body.currency_code));
    if (body.interval) (set.push("`interval` = ?"), vals.push(body.interval));
    if (body.seats !== undefined) (set.push("seats = ?"), vals.push(body.seats));
    if (couponId !== undefined) (set.push("coupon_id = ?"), vals.push(couponId));
    if (set.length) {
      await conn.query(`UPDATE subscription SET ${set.join(", ")} WHERE id = ?`, [...vals, sub.id]);
    }

    // §7.0: edition change moves the entitlement anchor in the same tx.
    if (newEdition) {
      await conn.query("UPDATE tenant SET current_edition_id = ? WHERE id = ?", [newEdition.id, id]);
      await bumpTenant(conn, id);
    }

    // §7.1 seat-change flow: keep the limit.seats override in lockstep with billed seats.
    if (seatsChanged && body.seats != null) {
      await upsertSeatOverride(conn, id, body.seats, ctx.user.id);
      await bumpTenant(conn, id);
    }

    audit({
      action: "subscription.update",
      targetType: "subscription",
      targetId: sub.id,
      targetTenantId: id,
      summary: `Updated subscription for tenant ${id}`,
      metadata: {
        edition_changed: newEdition ? newEdition.key : null,
        interval: body.interval ?? null,
        seats: body.seats ?? null,
        coupon_changed: couponId !== undefined,
      },
    });
    return queryOne("SELECT * FROM subscription WHERE id = ?", [sub.id]);
  });
  return ok(updated);
});

// Upsert the limit.seats entitlement override to match the billed seat count (§7.1).
async function upsertSeatOverride(conn: any, tenantId: string, seats: number, hostUserId: string) {
  const feature = await queryOne<{ id: string }>("SELECT id FROM feature WHERE `key` = 'limit.seats'", []);
  if (!feature) return; // seat feature not registered — nothing to mirror
  await conn.query(
    `INSERT INTO tenant_entitlement_override
       (tenant_id, feature_id, enabled_override, limit_value_override, limit_unlimited_override, reason, created_by)
     VALUES (?,?, TRUE, ?, FALSE, 'seat count from subscription', ?)
     ON DUPLICATE KEY UPDATE
       enabled_override = TRUE,
       limit_value_override = VALUES(limit_value_override),
       limit_unlimited_override = FALSE,
       reason = 'seat count from subscription',
       updated_at = NOW()`,
    [tenantId, feature.id, seats, hostUserId]
  );
}

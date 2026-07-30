import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { stripe } from "@/lib/integrations";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };
const Body = z.object({ at_period_end: z.boolean().optional() });

// POST /tenants/{id}/subscription/cancel — cancel now or at period end (§7.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "subscription.manage");
  const { id } = await params;
  const { at_period_end = false } = Body.parse(await req.json().catch(() => ({})));

  const sub = await queryOne<any>(
    "SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'canceled' LIMIT 1",
    [id]
  );
  if (!sub) throw errNotFound("Subscription");

  // Stripe boundary (mock in dev).
  if (sub.stripe_subscription_id) await stripe.cancelSubscription(sub.stripe_subscription_id, at_period_end);

  const updated = await useCase(ctx, async (conn, audit) => {
    if (at_period_end) {
      await conn.query("UPDATE subscription SET cancel_at_period_end = TRUE WHERE id = ?", [sub.id]);
    } else {
      await conn.query(
        "UPDATE subscription SET status = 'canceled', canceled_at = NOW() WHERE id = ?",
        [sub.id]
      );
    }
    audit({
      action: "subscription.cancel",
      targetType: "subscription",
      targetId: sub.id,
      targetTenantId: id,
      summary: at_period_end
        ? `Scheduled subscription cancellation at period end for tenant ${id}`
        : `Canceled subscription for tenant ${id}`,
      metadata: { at_period_end },
    });
    return queryOne("SELECT * FROM subscription WHERE id = ?", [sub.id]);
  });
  return ok(updated);
});

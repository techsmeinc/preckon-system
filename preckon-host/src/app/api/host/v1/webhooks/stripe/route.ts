import { pool, queryOne, tx } from "@/lib/db";
import { bumpTenant } from "@/lib/entitlements";
import { errBadRequest } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { stripe } from "@/lib/integrations";

// POST /webhooks/stripe — signed Stripe webhook sink (§7.4). NO host auth.
// Verify → dedupe on event id → mirror updates (+ entitlement anchor on plan
// change) → mark processed. Never trusts an unverified body.
export const POST = handle(async (req) => {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!stripe.verifyWebhook(payload, sig)) throw errBadRequest("Invalid Stripe signature");

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    throw errBadRequest("Webhook body must be valid JSON");
  }
  const eventId: string | undefined = event?.id;
  const eventType: string | undefined = event?.type;
  if (!eventId || !eventType) throw errBadRequest("Event id and type are required");

  // Dedupe: the event id is the PK. A redelivery collides and we ack 200 (§7.4).
  try {
    await pool.query(
      "INSERT INTO stripe_webhook_event (id, type, status, payload) VALUES (?,?, 'received', ?)",
      [eventId, eventType, payload]
    );
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY" || err?.errno === 1062) {
      return ok({ received: true, duplicate: true });
    }
    throw err;
  }

  try {
    await processEvent(eventType, event?.data?.object ?? {});
    await pool.query(
      "UPDATE stripe_webhook_event SET status = 'processed', processed_at = NOW() WHERE id = ?",
      [eventId]
    );
  } catch (err: any) {
    // Record the failure but still ack so Stripe's retry backoff is our recovery path.
    await pool.query(
      "UPDATE stripe_webhook_event SET status = 'failed', error = ? WHERE id = ?",
      [String(err?.message ?? err), eventId]
    );
  }

  return ok({ received: true });
});

async function processEvent(type: string, obj: any): Promise<void> {
  switch (type) {
    case "customer.subscription.updated":
    case "customer.subscription.created":
    case "customer.subscription.deleted":
      await handleSubscription(type, obj);
      break;
    case "invoice.paid":
      await handleInvoice(obj, "paid");
      break;
    case "invoice.payment_failed":
      await handleInvoice(obj, "payment_failed");
      break;
    default:
      // Recorded (received) but no mirror action — robust to hand-posted test events.
      break;
  }
}

async function handleSubscription(type: string, obj: any): Promise<void> {
  const stripeSubId: string | undefined = obj?.id;
  if (!stripeSubId) return;

  const sub = await queryOne<{ id: string; tenant_id: string; edition_id: string }>(
    "SELECT id, tenant_id, edition_id FROM subscription WHERE stripe_subscription_id = ?",
    [stripeSubId]
  );
  if (!sub) return; // unknown subscription (e.g. hand-posted event) — recorded only.

  // Optional plan-change signal: our edition id carried in Stripe metadata.
  const newEditionId: string | null =
    obj?.metadata?.preckon_edition_id ?? obj?.metadata?.edition_id ?? null;
  const status: string | null = type === "customer.subscription.deleted" ? "canceled" : (obj?.status ?? null);

  await tx(async (conn) => {
    const set: string[] = [];
    const vals: any[] = [];
    if (status) (set.push("status = ?"), vals.push(status));
    if (typeof obj?.cancel_at_period_end === "boolean")
      (set.push("cancel_at_period_end = ?"), vals.push(obj.cancel_at_period_end));
    if (obj?.current_period_end)
      (set.push("current_period_end = FROM_UNIXTIME(?)"), vals.push(obj.current_period_end));
    if (newEditionId && newEditionId !== sub.edition_id)
      (set.push("edition_id = ?"), vals.push(newEditionId));
    if (set.length) await conn.query(`UPDATE subscription SET ${set.join(", ")} WHERE id = ?`, [...vals, sub.id]);

    // §7.0: a plan change moves the entitlement anchor + version in the SAME tx.
    if (newEditionId && newEditionId !== sub.edition_id) {
      await conn.query("UPDATE tenant SET current_edition_id = ? WHERE id = ?", [newEditionId, sub.tenant_id]);
      await bumpTenant(conn, sub.tenant_id);
    }
  });
}

async function handleInvoice(obj: any, kind: "paid" | "payment_failed"): Promise<void> {
  const stripeInvoiceId: string | undefined = obj?.id;
  if (!stripeInvoiceId) return;

  const inv = await queryOne<{ id: string }>(
    "SELECT id FROM invoice WHERE stripe_invoice_id = ?",
    [stripeInvoiceId]
  );
  if (!inv) return; // unknown invoice — recorded only.

  if (kind === "paid") {
    await pool.query(
      `UPDATE invoice
          SET status = 'paid',
              amount_paid_minor = COALESCE(?, amount_paid_minor),
              amount_due_minor = 0,
              paid_at = NOW()
        WHERE id = ?`,
      [obj?.amount_paid ?? null, inv.id]
    );
  } else {
    await pool.query(
      "UPDATE invoice SET status = 'open', attempt_count = attempt_count + 1 WHERE id = ?",
      [inv.id]
    );
  }
}

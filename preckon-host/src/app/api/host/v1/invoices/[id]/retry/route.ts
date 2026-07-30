import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { stripe } from "@/lib/integrations";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// POST /invoices/{id}/retry — retry payment via Stripe (§7.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "invoice.retry");
  const { id } = await params;

  const invoice = await queryOne<{ id: string; tenant_id: string; status: string; attempt_count: number; stripe_invoice_id: string | null; number: string | null }>(
    "SELECT id, tenant_id, status, attempt_count, stripe_invoice_id, number FROM invoice WHERE id = ?",
    [id]
  );
  if (!invoice) throw errNotFound("Invoice");
  if (!["open", "uncollectible"].includes(invoice.status))
    throw errUnprocessable(`Cannot retry payment on a '${invoice.status}' invoice`);

  // Stripe boundary (mock in dev): re-attempt payment. Stripe is the source of truth
  // for the outcome; our attempt_count mirror is bumped optimistically and reconciled
  // by the invoice.paid / payment_failed webhooks (§7.4).
  if (stripe.live && invoice.stripe_invoice_id) {
    // TODO(prod): stripe.invoices.pay(invoice.stripe_invoice_id)
  } else {
    console.info("[stripe:mock] retryInvoice", invoice.stripe_invoice_id ?? invoice.id);
  }

  const updated = await useCase(ctx, async (conn, audit) => {
    await conn.query("UPDATE invoice SET attempt_count = attempt_count + 1 WHERE id = ?", [id]);
    audit({
      action: "invoice.retry",
      targetType: "invoice",
      targetId: id,
      targetTenantId: invoice.tenant_id,
      summary: `Retried payment for invoice ${invoice.number ?? id}`,
      metadata: { attempt_count: invoice.attempt_count + 1 },
    });
    return queryOne("SELECT * FROM invoice WHERE id = ?", [id]);
  });
  return ok(updated);
});

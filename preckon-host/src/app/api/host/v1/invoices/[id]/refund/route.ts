import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { stripe } from "@/lib/integrations";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };
const Body = z.object({ amount_minor: z.number().int().positive().optional() });

// POST /invoices/{id}/refund — full/partial refund via Stripe (§7.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.refund");
  const { id } = await params;
  const { amount_minor } = Body.parse(await req.json().catch(() => ({})));

  const invoice = await queryOne<{ id: string; tenant_id: string; status: string; number: string | null; currency_code: string; amount_paid_minor: number; stripe_invoice_id: string | null }>(
    "SELECT id, tenant_id, status, number, currency_code, amount_paid_minor, stripe_invoice_id FROM invoice WHERE id = ?",
    [id]
  );
  if (!invoice) throw errNotFound("Invoice");
  if (invoice.status !== "paid")
    throw errUnprocessable(`Only paid invoices can be refunded (invoice is '${invoice.status}')`);
  if (amount_minor != null && amount_minor > Number(invoice.amount_paid_minor))
    throw errUnprocessable("Refund amount exceeds the amount paid");

  // Stripe boundary (mock in dev). Stripe is the source of truth; the refunded
  // amount is reconciled into our mirror by the charge.refunded webhook (§7.4).
  const refund = await stripe.refund({
    chargeOrInvoiceId: invoice.stripe_invoice_id ?? invoice.id,
    amountMinor: amount_minor,
  });

  const result = await useCase(ctx, async (conn, audit) => {
    audit({
      action: "invoice.refund",
      targetType: "invoice",
      targetId: id,
      targetTenantId: invoice.tenant_id,
      summary: `Refunded invoice ${invoice.number ?? id}` +
        (amount_minor != null ? ` (${amount_minor} ${invoice.currency_code} minor units)` : " (full)"),
      metadata: {
        amount_minor: amount_minor ?? Number(invoice.amount_paid_minor),
        currency: invoice.currency_code,
        full: amount_minor == null,
        stripe_refund_id: refund.id,
      },
    });
    return { refunded: true, refund_id: refund.id, amount_minor: amount_minor ?? Number(invoice.amount_paid_minor) };
  });
  return ok(result);
});

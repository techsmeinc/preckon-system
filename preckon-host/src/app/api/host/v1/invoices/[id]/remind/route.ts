import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { email } from "@/lib/integrations";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// POST /invoices/{id}/remind — send a payment reminder to the tenant contact (§7.6)
export const POST = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "invoice.remind");
  const { id } = await params;

  const invoice = await queryOne<any>(
    `SELECT i.id, i.tenant_id, i.number, i.status, i.currency_code, i.amount_due_minor,
            i.hosted_invoice_url, i.due_date,
            t.name AS tenant_name, t.primary_contact_email
       FROM invoice i JOIN tenant t ON t.id = i.tenant_id
      WHERE i.id = ?`,
    [id]
  );
  if (!invoice) throw errNotFound("Invoice");
  if (invoice.status !== "open")
    throw errUnprocessable(`Cannot send a reminder for a '${invoice.status}' invoice`);

  const subject = `Payment reminder: invoice ${invoice.number ?? invoice.id}`;
  const body =
    `Hello ${invoice.tenant_name},\n\n` +
    `This is a reminder that invoice ${invoice.number ?? invoice.id} for ` +
    `${invoice.amount_due_minor} ${invoice.currency_code} (minor units) is outstanding` +
    (invoice.due_date ? ` and due ${invoice.due_date}.` : `.`) +
    (invoice.hosted_invoice_url ? `\n\nPay it here: ${invoice.hosted_invoice_url}` : ``) +
    `\n\nThank you.`;

  // Email boundary (mock in dev).
  const sent = await email.send({ to: invoice.primary_contact_email, subject, body });

  const result = await useCase(ctx, async (conn, audit) => {
    audit({
      action: "invoice.remind",
      targetType: "invoice",
      targetId: id,
      targetTenantId: invoice.tenant_id,
      summary: `Sent payment reminder for invoice ${invoice.number ?? id} to ${invoice.primary_contact_email}`,
      metadata: { to: invoice.primary_contact_email, message_id: sent.id, delivered: sent.delivered },
    });
    return { reminded: true, to: invoice.primary_contact_email, message_id: sent.id };
  });
  return ok(result);
});

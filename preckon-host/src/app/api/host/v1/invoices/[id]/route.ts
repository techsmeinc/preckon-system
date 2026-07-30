import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errNotFound } from "@/lib/errors";
import { handle, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET /invoices/{id} — detail incl. invoice_line rows (§7.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "billing.read");
  const { id } = await params;

  const invoice = await queryOne<any>(
    `SELECT i.*, t.name AS tenant_name, t.slug AS tenant_slug
       FROM invoice i JOIN tenant t ON t.id = i.tenant_id
      WHERE i.id = ?`,
    [id]
  );
  if (!invoice) throw errNotFound("Invoice");

  const lines = await query(
    `SELECT il.id, il.kind, il.feature_id, il.description, il.quantity,
            il.unit_amount_minor, il.amount_minor, il.period_start, il.period_end,
            f.\`key\` AS feature_key
       FROM invoice_line il
       LEFT JOIN feature f ON f.id = il.feature_id
      WHERE il.invoice_id = ?
      ORDER BY il.created_at ASC`,
    [id]
  );

  return ok({ ...invoice, lines });
});

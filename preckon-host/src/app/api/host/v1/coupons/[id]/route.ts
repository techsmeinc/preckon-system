import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errConflict, errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

// GET /coupons/{id} — detail (§6.5)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.read");
  const { id } = await params;

  const coupon = await queryOne<any>("SELECT * FROM coupon WHERE id = ?", [id]);
  if (!coupon) throw errNotFound("Coupon");

  return ok(coupon);
});

// Terms that lock once the coupon has been redeemed (§6.5).
const LOCKED_TERMS = [
  "code",
  "discount_type",
  "percent_off",
  "amount_off_minor",
  "currency_code",
  "duration",
  "duration_months",
] as const;

const Patch = z
  .object({
    // Always editable while unredeemed / or of the "gate" kind.
    name: z.string().max(128).nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(),
    max_redemptions: z.number().int().gt(0).nullable().optional(),
    valid_from: z.string().datetime().nullable().optional(),
    valid_until: z.string().datetime().nullable().optional(),
    // Locked once redeemed_count > 0.
    code: z.string().min(1).max(64).optional(),
    discount_type: z.enum(["percent", "fixed"]).optional(),
    percent_off: z.number().gt(0).max(100).nullable().optional(),
    amount_off_minor: z.number().int().gt(0).nullable().optional(),
    currency_code: z.string().length(3).nullable().optional(),
    duration: z.enum(["once", "repeating", "forever"]).optional(),
    duration_months: z.number().int().gt(0).nullable().optional(),
  })
  .strict();

const DATE_FIELDS = new Set(["valid_from", "valid_until"]);

// PATCH /coupons/{id} — edit / disable; code + discount terms immutable once redeemed (§6.5)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "coupon.write");
  const { id } = await params;
  const body = Patch.parse(await req.json());

  const coupon = await queryOne<any>("SELECT * FROM coupon WHERE id = ?", [id]);
  if (!coupon) throw errNotFound("Coupon");

  // Reject changes to locked terms once the coupon has been redeemed.
  if (Number(coupon.redeemed_count) > 0) {
    const attempted = LOCKED_TERMS.filter(
      (k) => (body as any)[k] !== undefined && (body as any)[k] !== coupon[k]
    );
    if (attempted.length)
      throw errConflict("`code` and discount terms are immutable once the coupon is redeemed", {
        locked: attempted,
      });
  }

  // If unredeemed and discount terms change, re-validate the §6.4 shape on the merged result.
  const merged = { ...coupon, ...body };
  if (merged.discount_type === "percent") {
    if (merged.percent_off == null || merged.amount_off_minor != null)
      throw errUnprocessable("Percent coupons need percent_off and no amount_off_minor");
  } else if (merged.discount_type === "fixed") {
    if (merged.amount_off_minor == null || !merged.currency_code || merged.percent_off != null)
      throw errUnprocessable("Fixed coupons need amount_off_minor + currency_code and no percent_off");
  }
  if (merged.duration === "repeating" && merged.duration_months == null)
    throw errUnprocessable("Repeating coupons need duration_months");

  if (body.currency_code) {
    const cur = await query("SELECT code FROM currency WHERE code = ?", [body.currency_code]);
    if (!cur[0]) throw errUnprocessable("Unknown currency_code", { code: body.currency_code });
  }

  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length === 0) return ok(coupon);

  const updated = await useCase(ctx, async (conn, audit) => {
    const set = fields.map(([k]) => `\`${k}\` = ?`).join(", ");
    const values = fields.map(([k, v]) =>
      DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v
    );
    await conn.query(`UPDATE coupon SET ${set} WHERE id = ?`, [...values, id]);
    audit({
      action: "coupon.update",
      targetType: "coupon",
      targetId: id,
      summary: `Updated coupon ${coupon.code}`,
      metadata: { changed: fields.map(([k]) => k) },
    });
    return queryOne("SELECT * FROM coupon WHERE id = ?", [id]);
  });

  return ok(updated);
});

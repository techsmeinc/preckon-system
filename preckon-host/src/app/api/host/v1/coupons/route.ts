import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errConflict, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

// GET /coupons — list incl. redeemed_count / status (§6.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "pricing.read");

  const rows = await query(
    `SELECT id, code, name, discount_type, percent_off, amount_off_minor, currency_code,
            duration, duration_months, max_redemptions, redeemed_count,
            valid_from, valid_until, status, created_at, updated_at
       FROM coupon
      ORDER BY created_at DESC, id DESC`
  );

  return ok({ data: rows });
});

const CreateCoupon = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().max(128).optional(),
    discount_type: z.enum(["percent", "fixed"]),
    percent_off: z.number().gt(0).max(100).optional(),
    amount_off_minor: z.number().int().gt(0).optional(),
    currency_code: z.string().length(3).optional(),
    duration: z.enum(["once", "repeating", "forever"]).default("once"),
    duration_months: z.number().int().gt(0).optional(),
    max_redemptions: z.number().int().gt(0).optional(),
    valid_from: z.string().datetime().optional(),
    valid_until: z.string().datetime().optional(),
  })
  .strict();

/** §6.4 shape rules: percent XOR fixed (fixed needs currency); repeating needs duration_months. */
function validateCouponShape(b: z.infer<typeof CreateCoupon>) {
  if (b.discount_type === "percent") {
    if (b.percent_off == null)
      throw errUnprocessable("percent_off is required for a percent coupon");
    if (b.amount_off_minor != null)
      throw errUnprocessable("amount_off_minor is not allowed for a percent coupon");
  } else {
    if (b.amount_off_minor == null)
      throw errUnprocessable("amount_off_minor is required for a fixed coupon");
    if (!b.currency_code)
      throw errUnprocessable("currency_code is required for a fixed coupon");
    if (b.percent_off != null)
      throw errUnprocessable("percent_off is not allowed for a fixed coupon");
  }
  if (b.duration === "repeating" && b.duration_months == null)
    throw errUnprocessable("duration_months is required for a repeating coupon");
  if (b.duration !== "repeating" && b.duration_months != null)
    throw errUnprocessable("duration_months is only valid for a repeating coupon");
}

// POST /coupons — create a coupon (§6.5)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "coupon.write");
  const body = await parseBody(req, CreateCoupon);

  validateCouponShape(body);

  const dup = await query("SELECT id FROM coupon WHERE code = ?", [body.code]);
  if (dup[0]) throw errConflict("A coupon with that code already exists", { code: body.code });

  if (body.currency_code) {
    const cur = await query("SELECT code FROM currency WHERE code = ?", [body.currency_code]);
    if (!cur[0]) throw errUnprocessable("Unknown currency_code", { code: body.currency_code });
  }

  const coupon = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      `INSERT INTO coupon (id, code, name, discount_type, percent_off, amount_off_minor,
                           currency_code, duration, duration_months, max_redemptions,
                           valid_from, valid_until, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        body.code,
        body.name ?? null,
        body.discount_type,
        body.percent_off ?? null,
        body.amount_off_minor ?? null,
        body.currency_code ?? null,
        body.duration,
        body.duration_months ?? null,
        body.max_redemptions ?? null,
        body.valid_from ? new Date(body.valid_from) : null,
        body.valid_until ? new Date(body.valid_until) : null,
        ctx.user.id,
      ]
    );
    audit({
      action: "coupon.create",
      targetType: "coupon",
      targetId: id,
      summary: `Created coupon ${body.code}`,
      metadata: {
        code: body.code,
        discount_type: body.discount_type,
        duration: body.duration,
      },
    });
    return { id, status: "active", redeemed_count: 0, ...body };
  });

  return ok(coupon, 201);
});

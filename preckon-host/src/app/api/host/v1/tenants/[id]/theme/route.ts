import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { storage } from "@/lib/integrations";

type Params = { params: Promise<{ id: string }> };

const HEX = /^#[0-9a-fA-F]{6}$/;

// theme_tokens allow-list (§3.5 / §11.1): only these keys, each strictly typed.
const ThemeTokens = z
  .object({
    font_family: z.enum(["Inter", "JetBrains Mono", "General Sans"]).optional(),
    radius_scale: z.number().min(0).max(2).optional(),
  })
  .strict();

const PutBody = z
  .object({
    brand_color: z.string().regex(HEX, "brand_color must be #RRGGBB").nullable().optional(),
    brand_color_dark: z.string().regex(HEX, "brand_color_dark must be #RRGGBB").nullable().optional(),
    accent_color: z.string().regex(HEX, "accent_color must be #RRGGBB").nullable().optional(),
    theme_tokens: ThemeTokens.optional(),
  })
  .strict();

// GET /tenants/{id}/theme — current theme + resolved logo URL (§3.5, §3.6)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.read");
  const { id } = await params;

  const tenant = await queryOne<{ id: string }>("SELECT id FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const theme = await queryOne<any>("SELECT * FROM tenant_theme WHERE tenant_id = ?", [id]);
  if (!theme) return ok(null);
  return ok({ ...theme, logo_url: storage.urlFor(theme.logo_object_key) });
});

// PUT /tenants/{id}/theme — set colors + allow-listed tokens (§3.5, §3.6)
export const PUT = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "tenant.theme.write");
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = PutBody.safeParse(raw);
  if (!parsed.success)
    throw errUnprocessable("Invalid theme payload", { issues: parsed.error.issues });
  const body = parsed.data;

  const tenant = await queryOne<{ name: string }>("SELECT name FROM tenant WHERE id = ?", [id]);
  if (!tenant) throw errNotFound("Tenant");

  const updated = await useCase(ctx, async (conn, audit) => {
    await conn.query(
      `INSERT INTO tenant_theme (tenant_id, brand_color, brand_color_dark, accent_color, theme_tokens, updated_by)
       VALUES (?,?,?,?, ?, ?)
       ON DUPLICATE KEY UPDATE
         brand_color = VALUES(brand_color),
         brand_color_dark = VALUES(brand_color_dark),
         accent_color = VALUES(accent_color),
         theme_tokens = VALUES(theme_tokens),
         updated_by = VALUES(updated_by)`,
      [
        id,
        body.brand_color ?? null,
        body.brand_color_dark ?? null,
        body.accent_color ?? null,
        JSON.stringify(body.theme_tokens ?? {}),
        ctx.user.id,
      ]
    );
    audit({
      action: "tenant.theme.update",
      targetType: "tenant",
      targetId: id,
      targetTenantId: id,
      summary: `Updated theme for ${tenant.name}`,
      metadata: {
        colors: {
          brand_color: body.brand_color ?? null,
          brand_color_dark: body.brand_color_dark ?? null,
          accent_color: body.accent_color ?? null,
        },
        tokens: Object.keys(body.theme_tokens ?? {}),
      },
    });
    return queryOne("SELECT * FROM tenant_theme WHERE tenant_id = ?", [id]);
  });
  return ok(updated);
});

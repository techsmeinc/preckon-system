import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

// GET /settings/email — provider config (email.*) + domains (§9.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.read");

  const settingRows = await query<{ key: string; value: any }>(
    "SELECT `key`, value FROM platform_setting WHERE `key` LIKE 'email.%' ORDER BY `key`"
  );
  const config: Record<string, any> = {};
  for (const row of settingRows) config[row.key] = row.value;

  const domains = await query(
    "SELECT id, domain, status, dns_records, verified_at, created_at, updated_at FROM email_domain ORDER BY created_at DESC"
  );

  return ok({ config, domains });
});

const Patch = z
  .object({
    "email.provider": z.string().min(1).optional(),
    "email.from_address": z.string().email().optional(),
    "email.api_key_secret_ref": z.string().min(1).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field is required" });

// PATCH /settings/email — update provider / from-address / secret ref (§9.5)
export const PATCH = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.write");
  const body = Patch.parse(await req.json());

  const entries = Object.entries(body).filter(([, v]) => v !== undefined);

  const updated = await useCase(ctx, async (conn, audit) => {
    for (const [key, value] of entries) {
      await conn.query(
        `INSERT INTO platform_setting (\`key\`, value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
        [key, JSON.stringify(value), ctx.user.id]
      );
    }
    audit({
      action: "email.settings.update",
      targetType: "platform_setting",
      summary: `Updated email settings (${entries.length} field(s))`,
      metadata: { keys: entries.map(([k]) => k) },
    });
    return entries.map(([k]) => k);
  });

  return ok({ updated });
});

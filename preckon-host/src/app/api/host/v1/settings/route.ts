import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

// GET /settings — all platform_setting grouped by namespace (§9.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.read");

  const rows = await query<{ key: string; value: any; description: string | null; updated_at: string }>(
    "SELECT `key`, value, description, updated_at FROM platform_setting ORDER BY `key`"
  );

  const grouped: Record<string, Record<string, { value: any; description: string | null; updated_at: string }>> = {};
  for (const row of rows) {
    const dot = row.key.indexOf(".");
    const namespace = dot === -1 ? "general" : row.key.slice(0, dot);
    (grouped[namespace] ??= {})[row.key] = {
      value: row.value,
      description: row.description,
      updated_at: row.updated_at,
    };
  }

  return ok({ namespaces: grouped });
});

const Patch = z.record(z.any()).refine((o) => Object.keys(o).length > 0, {
  message: "At least one setting is required",
});

// PATCH /settings — upsert general settings; maintenance.* is rejected here (§9.5)
export const PATCH = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.write");
  const body = Patch.parse(await req.json());

  const maintenanceKeys = Object.keys(body).filter((k) => k.startsWith("maintenance."));
  if (maintenanceKeys.length > 0)
    throw errUnprocessable("maintenance.* settings must be changed via /settings/maintenance", {
      keys: maintenanceKeys,
    });

  const entries = Object.entries(body);

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
      action: "settings.update",
      targetType: "platform_setting",
      summary: `Updated ${entries.length} platform setting(s)`,
      metadata: { keys: entries.map(([k]) => k) },
    });
    return entries.map(([k]) => k);
  });

  return ok({ updated });
});

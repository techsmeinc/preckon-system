import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

const Body = z.object({
  enabled: z.boolean(),
  message: z.string().optional(),
});

// POST /settings/maintenance — toggle maintenance mode (§9.5)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "maintenance.toggle");
  const body = Body.parse(await req.json());

  const result = await useCase(ctx, async (conn, audit) => {
    const upsert = async (key: string, value: unknown) =>
      conn.query(
        `INSERT INTO platform_setting (\`key\`, value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
        [key, JSON.stringify(value), ctx.user.id]
      );

    await upsert("maintenance.enabled", body.enabled);
    await upsert("maintenance.message", body.message ?? "");

    audit({
      action: "maintenance.toggle",
      targetType: "platform_setting",
      targetId: "maintenance.enabled",
      summary: `Maintenance mode ${body.enabled ? "enabled" : "disabled"}`,
      metadata: { enabled: body.enabled, message: body.message ?? "" },
    });

    return { enabled: body.enabled, message: body.message ?? "" };
  });

  return ok(result);
});

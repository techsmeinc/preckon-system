import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errBadRequest } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

const Patch = z.object({
  name: z.string().min(1).optional(),
  base_url: z.string().url().nullable().optional(),
  api_key_secret_ref: z.string().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

// PATCH /settings/ai/providers/{id} — edit / disable (§9.5)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.ai.write");
  const { id } = await params;
  const body = Patch.parse(await req.json());

  const provider = await queryOne<{ id: string; name: string }>(
    "SELECT id, name FROM ai_provider WHERE id = ?",
    [id]
  );
  if (!provider) throw errNotFound("AI provider");

  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length === 0) throw errBadRequest("No fields to update");

  const updated = await useCase(ctx, async (conn, audit) => {
    const set = fields.map(([k]) => `\`${k}\` = ?`).join(", ");
    await conn.query(`UPDATE ai_provider SET ${set} WHERE id = ?`, [
      ...fields.map(([, v]) => v),
      id,
    ]);
    audit({
      action: "ai_provider.update",
      targetType: "ai_provider",
      targetId: id,
      summary: `Updated AI provider ${provider.name}`,
      metadata: { changed: fields.map(([k]) => k) },
    });
    return queryOne("SELECT * FROM ai_provider WHERE id = ?", [id]);
  });

  return ok(updated);
});

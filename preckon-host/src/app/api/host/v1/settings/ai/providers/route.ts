import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errConflict } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

// GET /settings/ai/providers — providers; secret refs returned opaque (§9.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.read");

  const providers = await query(
    `SELECT id, \`key\`, name, kind, base_url, api_key_secret_ref, status, created_at, updated_at
       FROM ai_provider ORDER BY name`
  );
  return ok({ providers });
});

const Create = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_-]+$/, "key must be lowercase alnum, _ or -"),
  name: z.string().min(1),
  kind: z.enum(["llm", "embedding", "reranker"]),
  base_url: z.string().url().optional(),
  api_key_secret_ref: z.string().min(1),
});

// POST /settings/ai/providers — register a provider (§9.5)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.ai.write");
  const body = Create.parse(await req.json());

  const dup = await queryOne("SELECT id FROM ai_provider WHERE `key` = ?", [body.key]);
  if (dup) throw errConflict("A provider with that key already exists", { key: body.key });

  const provider = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      `INSERT INTO ai_provider (id, \`key\`, name, kind, base_url, api_key_secret_ref)
       VALUES (?,?,?,?,?,?)`,
      [id, body.key, body.name, body.kind, body.base_url ?? null, body.api_key_secret_ref]
    );
    audit({
      action: "ai_provider.create",
      targetType: "ai_provider",
      targetId: id,
      summary: `Registered AI provider ${body.name} (${body.kind})`,
      metadata: { key: body.key, kind: body.kind },
    });
    return queryOne("SELECT * FROM ai_provider WHERE id = ?", [id]);
  });

  return ok(provider, 201);
});

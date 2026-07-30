import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errUnprocessable } from "@/lib/errors";
import { handle, ok } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";

// GET /settings/ai/routing — rules grouped by tier, in fallback order (§9.5)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.read");

  const rows = await query<any>(
    `SELECT r.id, r.tier, r.provider_id, p.\`key\` AS provider_key, p.name AS provider_name,
            r.model, r.priority, r.params, r.is_active, r.created_at, r.updated_at
       FROM ai_routing_rule r
       JOIN ai_provider p ON p.id = r.provider_id
      ORDER BY r.tier, r.priority`
  );

  const tiers: Record<string, any[]> = {};
  for (const row of rows) (tiers[row.tier] ??= []).push(row);

  return ok({ tiers });
});

const Put = z.object({
  tier: z.string().min(1),
  rules: z
    .array(
      z.object({
        provider_id: z.string().min(1),
        model: z.string().min(1),
        priority: z.number().int(),
        params: z.record(z.any()).default({}),
        is_active: z.boolean().default(true),
      })
    )
    .min(1),
});

// PUT /settings/ai/routing — replace a tier's ordered rules (§9.5)
export const PUT = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "settings.ai.write");
  const body = Put.parse(await req.json());

  // Enforce unique (tier, priority) within the payload up front.
  const priorities = body.rules.map((r) => r.priority);
  if (new Set(priorities).size !== priorities.length)
    throw errUnprocessable("Each rule in a tier must have a unique priority");

  // Validate all referenced providers exist.
  for (const rule of body.rules) {
    const p = await queryOne("SELECT id FROM ai_provider WHERE id = ?", [rule.provider_id]);
    if (!p) throw errUnprocessable(`Unknown provider_id: ${rule.provider_id}`);
  }

  const result = await useCase(ctx, async (conn, audit) => {
    await conn.query("DELETE FROM ai_routing_rule WHERE tier = ?", [body.tier]);
    for (const rule of body.rules) {
      await conn.query(
        `INSERT INTO ai_routing_rule (id, tier, provider_id, model, priority, params, is_active)
         VALUES (?,?,?,?,?, ?, ?)`,
        [
          newId(),
          body.tier,
          rule.provider_id,
          rule.model,
          rule.priority,
          JSON.stringify(rule.params),
          rule.is_active,
        ]
      );
    }
    audit({
      action: "ai_routing.update",
      targetType: "ai_routing_rule",
      targetId: body.tier,
      summary: `Replaced routing rules for tier '${body.tier}' (${body.rules.length} rule(s))`,
      metadata: { tier: body.tier, rule_count: body.rules.length },
    });
    return query(
      `SELECT id, tier, provider_id, model, priority, params, is_active
         FROM ai_routing_rule WHERE tier = ? ORDER BY priority`,
      [body.tier]
    );
  });

  return ok({ tier: body.tier, rules: result });
});

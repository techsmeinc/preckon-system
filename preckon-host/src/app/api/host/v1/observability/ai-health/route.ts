import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok } from "@/lib/http";

// GET /observability/ai-health — per provider/model volume, error rate, latency, cost (§10.3)
// Mock (from Langfuse in prod) but shaped from the real ai_provider + ai_routing_rule
// rows so it reflects the actually-configured providers/models.
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "observability.read");

  const rows = await query<{
    provider_id: string;
    provider_key: string;
    provider_name: string;
    status: string;
    model: string | null;
    tier: string | null;
  }>(
    `SELECT p.id AS provider_id, p.\`key\` AS provider_key, p.name AS provider_name, p.status,
            r.model, r.tier
       FROM ai_provider p
       LEFT JOIN ai_routing_rule r ON r.provider_id = p.id
      WHERE p.kind = 'llm'
      ORDER BY p.name, r.tier, r.priority`
  );

  // Deterministic per-model pseudo-metrics so the shape is stable per config.
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  };

  const providersMap: Record<string, any> = {};
  for (const row of rows) {
    const p = (providersMap[row.provider_id] ??= {
      provider_id: row.provider_id,
      provider_key: row.provider_key,
      provider_name: row.provider_name,
      status: row.status,
      models: [] as any[],
    });
    if (!row.model) continue;
    if (p.models.some((m: any) => m.model === row.model && m.tier === row.tier)) continue;
    const seed = hash(`${row.provider_key}:${row.model}`);
    const requests = 500 + (seed % 4500);
    const errors = seed % 40;
    p.models.push({
      model: row.model,
      tier: row.tier,
      requests,
      error_rate: +(errors / requests).toFixed(4),
      latency_ms: { p50: 200 + (seed % 300), p95: 900 + (seed % 1200) },
      tokens: { input: requests * (300 + (seed % 200)), output: requests * (120 + (seed % 100)) },
      cost_usd: +((requests * (0.0004 + (seed % 6) / 10000))).toFixed(2),
    });
  }

  return ok({
    generated_at: new Date().toISOString(),
    source: "mock",
    providers: Object.values(providersMap),
  });
});

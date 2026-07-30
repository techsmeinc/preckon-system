import { z } from "zod";
import { serviceRoute, ok } from "@/lib/http";
import { query, queryOne } from "@/lib/db";

// §8.5 POST /internal/entitlements — the Host pushes a resolved snapshot; upsert
// by tenant, ignore a stale (older) version (out-of-order protection).
const Snapshot = z.object({
  tenant_id: z.string(),
  edition_ref: z.string(),
  version: z.number(),
  licensed_modules: z.array(z.string()),
  max_tier: z.enum(["routing", "standard", "deep"]).default("deep"),
  seats: z.number().nullable().optional(),
  limits: z.record(z.unknown()).default({}),
  features: z.record(z.boolean()).default({}),
  forbidden_deviations: z.array(z.string()).default([]),
  resolved_at: z.string().optional(),
});

export const POST = serviceRoute(async (req) => {
  const s = Snapshot.parse(await req.json());
  const existing = await queryOne<{ version: number }>(
    "SELECT version FROM entitlement_snapshot WHERE tenant_id = ?",
    [s.tenant_id]
  );
  if (existing && Number(existing.version) >= s.version) return ok({ ignored: "stale version" });

  await query(
    `INSERT INTO entitlement_snapshot
       (tenant_id, edition_ref, version, licensed_modules, max_tier, seats, limits, features, forbidden_deviations, resolved_at)
     VALUES (?,?,?,?,?,?,?,?,?, ?)
     ON DUPLICATE KEY UPDATE edition_ref=VALUES(edition_ref), version=VALUES(version),
       licensed_modules=VALUES(licensed_modules), max_tier=VALUES(max_tier), seats=VALUES(seats),
       limits=VALUES(limits), features=VALUES(features), forbidden_deviations=VALUES(forbidden_deviations),
       resolved_at=VALUES(resolved_at), fetched_at=NOW(3)`,
    [
      s.tenant_id,
      s.edition_ref,
      s.version,
      JSON.stringify(s.licensed_modules),
      s.max_tier,
      s.seats ?? null,
      JSON.stringify(s.limits),
      JSON.stringify(s.features),
      JSON.stringify(s.forbidden_deviations),
      s.resolved_at ?? new Date().toISOString().slice(0, 23).replace("T", " "),
    ]
  );
  return ok({ ok: true });
});

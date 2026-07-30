import { route, ok } from "@/lib/http";
import { getSnapshot } from "@/lib/entitlements";
import { moduleDisplay } from "@/lib/modules";
import { queryOne } from "@/lib/db";

// §8.5 GET /entitlements — current plan projection + the caller's permission set.
// Module display resolves from the tenant's bound domain manifest (works for
// user-configured domains, whose modules aren't in the compiled catalog), with a
// fall back to the first-party display for the seeded packs.
export const GET = route(async (_req, ctx) => {
  const snap = await getSnapshot(ctx.tenantId);
  const boot = await queryOne<{ domain_key: string }>("SELECT domain_key FROM tenant_bootstrap WHERE tenant_id = ?", [ctx.tenantId]);
  const dom = boot ? await queryOne<{ manifest: any }>("SELECT manifest FROM domain WHERE `key` = ?", [boot.domain_key]) : null;
  const manifestModules: any[] = Array.isArray(dom?.manifest?.modules) ? dom!.manifest.modules : [];
  const byKey = new Map(manifestModules.filter((m) => typeof m === "object").map((m) => [m.key, m]));

  const modules = (snap?.licensed_modules ?? [])
    .map((k) => {
      const m = byKey.get(k);
      if (m) return { key: m.key, label: m.label, icon: m.icon, order: m.order ?? 999, description: m.description ?? "" };
      return { ...moduleDisplay(k), description: "" }; // first-party fallback
    })
    .sort((a, b) => a.order - b.order);
  return ok({
    licensedModules: modules,
    permissions: [...ctx.permissions],
    editionRef: snap?.edition_ref ?? null,
    seats: snap?.seats ?? null,
    maxTier: snap?.max_tier ?? "deep",
    features: snap?.features ?? {},
  });
});

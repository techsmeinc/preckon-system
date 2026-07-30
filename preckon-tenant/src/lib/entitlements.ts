import { query, queryOne } from "./db";
import { errEntitlement } from "./errors";
import { DEFAULT_DOMAIN_KEY, type Tier } from "./constants";
import { clampTier } from "./jobs";

// §8 — the tenant plane reads a resolved entitlement snapshot (pushed by the
// Host) and enforces it. Permission (may) is checked first; entitlement
// (licensed) second. Here we resolve licensed modules → workflows → personas.

export interface Snapshot {
  tenant_id: string;
  edition_ref: string | null;
  licensed_modules: string[];
  max_tier: Tier;
  seats: number | null;
  limits: Record<string, unknown>;
  features: Record<string, boolean>;
  forbidden_deviations: string[];
}

export async function getSnapshot(tenantId: string): Promise<Snapshot | null> {
  return queryOne<Snapshot>(
    "SELECT tenant_id, edition_ref, licensed_modules, max_tier, seats, limits, features, forbidden_deviations FROM entitlement_snapshot WHERE tenant_id = ?",
    [tenantId]
  );
}

/** Licensed workflows: workflow.module_key ∈ licensed_modules (§8.1). */
export async function licensedWorkflows(tenantId: string): Promise<any[]> {
  const snap = await getSnapshot(tenantId);
  const licensed = snap?.licensed_modules ?? [];
  const wfs = await query<any>(
    "SELECT `key`, name, module_key, entitlement_key FROM workflow WHERE enabled = 1 ORDER BY module_key"
  );
  return wfs.filter((w) => licensed.includes(w.module_key));
}

/** Personas visible under the tenant's entitlements: scoped FIRST to the tenant's
 *  domain pack (a whole-run persona must not leak across domains), then by module. */
export async function licensedPersonas(tenantId: string): Promise<any[]> {
  const snap = await getSnapshot(tenantId);
  const licensed = new Set(snap?.licensed_modules ?? []);
  const boot = await queryOne<{ domain_key: string }>(
    "SELECT domain_key FROM tenant_bootstrap WHERE tenant_id = ?",
    [tenantId]
  );
  const dom = await queryOne<{ manifest: any }>("SELECT manifest FROM domain WHERE `key` = ?", [
    boot?.domain_key ?? DEFAULT_DOMAIN_KEY,
  ]);
  const domainPersonas = new Set<string>(dom?.manifest?.personas ?? []);
  const rows = await query<any>(
    `SELECT sp.agent_key, a.name, sp.scope, sp.deviation_kinds, sp.is_default, sp.sort_order
       FROM supervisor_profile sp JOIN agent a ON a.\`key\` = sp.agent_key
      WHERE a.enabled = 1 ORDER BY sp.sort_order`
  );
  return rows.filter((p) => {
    if (domainPersonas.size && !domainPersonas.has(p.agent_key)) return false; // other domain
    const mods: string[] = p.scope?.module_keys ?? [];
    if (mods.length === 0) return true; // whole-run persona within this domain
    return mods.some((m) => licensed.has(m));
  });
}

/** §8.3 — assert a workflow is licensed, else 403 entitlement_required. */
export async function assertWorkflowLicensed(tenantId: string, workflowKey: string): Promise<void> {
  const wf = await queryOne<{ module_key: string }>(
    "SELECT module_key FROM workflow WHERE `key` = ? AND enabled = 1",
    [workflowKey]
  );
  const snap = await getSnapshot(tenantId);
  if (!wf || !snap || !snap.licensed_modules.includes(wf.module_key))
    throw errEntitlement(`Workflow '${workflowKey}' is not licensed`);
}

/** §8.3 — clamp a requested AI tier to the edition cap. */
export async function clampToEdition(tenantId: string, requested: Tier): Promise<Tier> {
  const snap = await getSnapshot(tenantId);
  return snap ? clampTier(requested, snap.max_tier) : requested;
}

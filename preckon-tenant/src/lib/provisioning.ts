import { uuidv7 } from "uuidv7";
import { pool, query, queryOne, tx } from "./db";
import { auth } from "./auth";
import { appendAudit } from "./audit";
import { CORE_PERMISSIONS } from "./pack/core";
import { ALL_PACKS, getPack, defaultModulesFor } from "./pack/registry";
import { validatePack } from "./pack/contract";
import { DEFAULT_DOMAIN_KEY } from "./constants";
import { seedStandardRules } from "./standards";

// ── §1.5 / §D.4 provisioning. Two idempotent operations shared by the seed
// script and the Host-facing bootstrap endpoint:
//   • seedCatalog()      — global, first-party pack registration (run once/deploy)
//   • bootstrapTenant()  — per-tenant IAM: roles, settings, owner, entitlements
// Keeping them here means "the Host provisions a tenant" is one function call.

/** Register the Core catalog + EVERY domain pack (types, agents, workflows, personas). Idempotent. */
export async function seedCatalog(): Promise<void> {
  for (const p of CORE_PERMISSIONS) {
    await query(
      "INSERT INTO tenant_permission (`key`, domain, description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE domain=VALUES(domain), description=VALUES(description)",
      [p.key, p.domain, p.description]
    );
  }
  // Seed each compiled-in pack. Every pack must pass the domain resolver first —
  // this is what guarantees Core can host it with zero kernel change (§D).
  for (const pack of ALL_PACKS) {
    const errs = validatePack(pack as any);
    if (errs.length) throw new Error(`domain '${pack.key}' failed validation:\n  - ${errs.join("\n  - ")}`);
    for (const p of pack.packPermissions) {
      await query(
        "INSERT INTO tenant_permission (`key`, domain, description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE domain=VALUES(domain), description=VALUES(description)",
        [p.key, p.domain, p.description]
      );
    }
    await query(
      "INSERT INTO domain (`key`, name, version, manifest, enabled) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name), version=VALUES(version), manifest=VALUES(manifest)",
      [pack.key, pack.name, pack.version, JSON.stringify(pack.manifest)]
    );
    for (const t of pack.artifactTypes) {
      await query(
        "INSERT INTO artifact_type (`key`, name, payload_schema, is_reviewable) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), payload_schema=VALUES(payload_schema), is_reviewable=VALUES(is_reviewable)",
        [t.key, t.name, JSON.stringify(t.payload_schema), t.is_reviewable ? 1 : 0]
      );
    }
    for (const a of pack.agents) {
      await query(
        "INSERT INTO agent (`key`, name, kind, consumes, produces, job_types, permission_keys, entitlement_key) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), kind=VALUES(kind), consumes=VALUES(consumes), produces=VALUES(produces), job_types=VALUES(job_types), permission_keys=VALUES(permission_keys)",
        [a.key, a.name, a.kind, JSON.stringify(a.consumes), JSON.stringify(a.produces), JSON.stringify(a.job_types), JSON.stringify(a.permission_keys), a.entitlement_key]
      );
    }
    for (const w of pack.workflows) {
      await query(
        "INSERT INTO workflow (`key`, name, module_key, version, definition, entitlement_key, enabled) VALUES (?,?,?,1,?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name), module_key=VALUES(module_key), definition=VALUES(definition), entitlement_key=VALUES(entitlement_key)",
        [w.key, w.name, w.module_key, JSON.stringify(w.definition), w.entitlement_key]
      );
    }
    for (const p of pack.personas) {
      await query(
        "INSERT INTO supervisor_profile (agent_key, scope, deviation_kinds, is_default, sort_order) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE scope=VALUES(scope), deviation_kinds=VALUES(deviation_kinds), is_default=VALUES(is_default), sort_order=VALUES(sort_order)",
        [p.agent_key, JSON.stringify(p.scope), JSON.stringify(p.deviation_kinds), p.is_default ? 1 : 0, p.sort_order]
      );
    }
  }
}

export interface BootstrapInput {
  tenantId: string;
  tenantName: string;
  ownerEmail: string;
  ownerName?: string;
  ownerPassword?: string; // for the demo, sets a login password; real flow uses invites
  editionRef?: string;
  licensedModules?: string[];
  maxTier?: "routing" | "standard" | "deep";
  features?: Record<string, boolean>;
  domainKey?: string;
  source?: "host_provision" | "manual";
  idempotencyKey?: string;
}
export interface BootstrapResult {
  tenantId: string;
  ownerEmail: string;
  ownerPassword: string | null;
  alreadyBootstrapped: boolean;
}

/** §1.5 — provision a tenant's IAM. Idempotent by tenant_id. */
export async function bootstrapTenant(input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.ownerEmail.toLowerCase();
  const existing = await queryOne<{ tenant_id: string }>(
    "SELECT tenant_id FROM tenant_bootstrap WHERE tenant_id = ?",
    [input.tenantId]
  );
  if (existing) {
    return { tenantId: input.tenantId, ownerEmail: email, ownerPassword: null, alreadyBootstrapped: true };
  }

  // Owner credential in the tenant identity pool (separate from Host staff, §0.2).
  const password = input.ownerPassword ?? "preckon-tenant-2026";
  let authUserId: string;
  const existingAuth = await queryOne<{ id: string }>("SELECT id FROM `user` WHERE email = ?", [email]);
  if (existingAuth) {
    authUserId = existingAuth.id;
  } else {
    const res = await auth.api.signUpEmail({
      body: { email, password, name: input.ownerName ?? "Owner" },
    });
    authUserId = res.user.id;
  }

  const domainKey = input.domainKey ?? DEFAULT_DOMAIN_KEY;
  const pack = getPack(domainKey);
  const modules = input.licensedModules ?? defaultModulesFor(domainKey);

  await tx(async (conn) => {
    // 1) Roles + permission presets from the pack role template (§D.4).
    const roleIds: Record<string, string> = {};
    for (const r of pack.roles) {
      const id = uuidv7();
      await conn.query(
        "INSERT INTO tenant_role (id, tenant_id, `key`, name, tier, is_system) VALUES (?,?,?,?,?,1)",
        [id, input.tenantId, r.key, r.name, r.tier]
      );
      roleIds[r.key] = id;
      for (const pk of r.permissions) {
        await conn.query(
          "INSERT IGNORE INTO tenant_role_permission (tenant_id, role_id, permission_key) VALUES (?,?,?)",
          [input.tenantId, id, pk]
        );
      }
    }

    // 2) Tenant settings from pack defaults.
    await conn.query(
      "INSERT INTO tenant_setting (tenant_id, auto_accept_threshold, type_thresholds, default_tier, extra) VALUES (?,?, '{}', ?, '{}') ON DUPLICATE KEY UPDATE tenant_id=tenant_id",
      [input.tenantId, pack.settings.auto_accept_threshold, pack.settings.default_tier]
    );

    // 3) Owner app_user (active) + owner role.
    const appUserId = uuidv7();
    await conn.query(
      "INSERT INTO app_user (id, tenant_id, email, name, status, auth_user_id) VALUES (?,?,?,?, 'active', ?)",
      [appUserId, input.tenantId, email, input.ownerName ?? "Owner", authUserId]
    );
    await conn.query(
      "INSERT IGNORE INTO user_role (tenant_id, user_id, role_id) VALUES (?,?,?)",
      [input.tenantId, appUserId, roleIds.owner]
    );

    // 4) Entitlement snapshot (the Host resolves licensing; we cache it, §8.2).
    await conn.query(
      `INSERT INTO entitlement_snapshot
         (tenant_id, edition_ref, version, licensed_modules, max_tier, seats, limits, features, forbidden_deviations, resolved_at)
       VALUES (?,?,1,?,?,?,?,?, '[]', NOW(3))
       ON DUPLICATE KEY UPDATE licensed_modules=VALUES(licensed_modules), features=VALUES(features), edition_ref=VALUES(edition_ref)`,
      [
        input.tenantId,
        input.editionRef ?? "standard",
        JSON.stringify(modules),
        input.maxTier ?? "deep",
        25,
        JSON.stringify({ runs_per_month: 100000, tokens_per_month: 1000000000, mode: "soft" }),
        JSON.stringify(input.features ?? { white_label: true, sso: false, custom_roles: false }),
      ]
    );

    // 5) Bootstrap marker + audit.
    await conn.query(
      "INSERT INTO tenant_bootstrap (tenant_id, domain_key, source, idempotency_key) VALUES (?,?,?,?)",
      [input.tenantId, domainKey, input.source ?? "host_provision", input.idempotencyKey ?? null]
    );
    await appendAudit(conn, { tenantId: input.tenantId, actorId: "host", actorKind: "service" }, {
      action: "tenant.bootstrapped",
      targetKind: "tenant",
      targetId: input.tenantId,
      summary: { owner: email, edition: input.editionRef ?? "standard", modules: modules.length },
    });
  });

  // Standards & Rules content (Library data) — the pack's seeded rule bundle.
  await seedStandardRules(input.tenantId, (pack.standardRules ?? []) as any);

  return { tenantId: input.tenantId, ownerEmail: email, ownerPassword: password, alreadyBootstrapped: false };
}

/** Create a demo project on a freshly bootstrapped tenant (used by the seed only). */
export async function seedDemoProject(tenantId: string, ownerEmail: string): Promise<string | null> {
  const owner = await queryOne<{ id: string }>(
    "SELECT id FROM app_user WHERE tenant_id = ? AND email = ?",
    [tenantId, ownerEmail.toLowerCase()]
  );
  if (!owner) return null;
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM project WHERE tenant_id = ? LIMIT 1",
    [tenantId]
  );
  if (existing) return existing.id;
  const pid = uuidv7();
  await query(
    "INSERT INTO project (id, tenant_id, name, code, client_name, status, lifecycle_key, lifecycle_state, created_by) VALUES (?,?,?,?,?, 'active', 'bid_pursuit', 'received', ?)",
    [pid, tenantId, "Demo — Riverside School Tender", "RVS-001", "Riverside County", owner.id]
  );
  await query("INSERT IGNORE INTO project_member (tenant_id, project_id, user_id) VALUES (?,?,?)", [tenantId, pid, owner.id]);
  // a small rate book so CostLogix has reference data
  for (const r of [
    { code: "C20", desc: "Concrete grade C20/25", rate_minor: 14500, unit: "m3" },
    { code: "R16", desc: "Reinforcement bar 16mm", rate_minor: 120, unit: "kg" },
    { code: "BW1", desc: "Blockwork 140mm", rate_minor: 6800, unit: "m2" },
  ]) {
    await query(
      "INSERT INTO library_entry (id, tenant_id, collection, entry_key, payload, status) VALUES (?,?, 'rate_book', ?, ?, 'active')",
      [uuidv7(), tenantId, r.code, JSON.stringify({ ...r, currency: "CAD" })]
    );
  }
  return pid;
}

export const _internal = { pool };

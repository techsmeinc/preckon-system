import { query, queryOne, tx } from "./db";
import { appendAudit, type AuditActor } from "./audit";
import { errNotFound, errSchema } from "./errors";
import { validatePack, type DomainPack } from "./pack/contract";
import { TEMPLATES, TEMPLATE_META } from "./pack/templates";

// ── Tenant-owned domains. A tenant PICKS an industry template; we clone it into a
// domain that belongs to that tenant, keyed uniquely, seeded into the shared
// catalog, and stored as one editable pack document (tenant_domain.pack_json).
// Editing re-projects the same rows. Core, the runtime, and autopilot are unchanged
// — a user-configured domain is just another pack, exactly like a first-party one.

const short = (k: string) => k.split(".").pop() ?? k;
// Full 32-hex tenant id — sequential/demo tenant ids share a long common prefix,
// so any prefix slice collides. The full id guarantees a unique per-tenant key.
const tShort = (tenantId: string) => tenantId.replace(/-/g, "");

/** A tenant+template's unique domain key (namespaces its catalog rows). */
export function tenantDomainKey(tenantId: string, templateKey: string): string {
  return `d${tShort(tenantId)}_${templateKey}`;
}

/** Prefix a bare-key template pack with the tenant's domain key so its catalog
 *  rows are unique per tenant (no collisions in the shared catalog). */
export function rekeyPack(pack: DomainPack, dk: string): DomainPack {
  const T = (k: string) => (k === "*" ? "*" : `${dk}.${k}`);
  const modules = pack.modules.map((m) => ({ ...m, key: `${dk}.${m.key}` }));
  const artifactTypes = pack.artifactTypes.map((t) => ({ ...t, key: T(t.key) }));
  const agents = pack.agents.map((a) => ({
    ...a, key: T(a.key), consumes: a.consumes.map(T), produces: a.produces.map(T),
    job_types: a.job_types.map((j) => ({ ...j })),
  }));
  const reNode = (n: any) => ({
    ...n,
    ...(n.agent_key ? { agent_key: T(n.agent_key) } : {}),
    ...(n.gate_types ? { gate_types: n.gate_types.map(T) } : {}),
    ...(n.over ? { over: T(n.over) } : {}),
  });
  const workflows = pack.workflows.map((w) => ({
    ...w, key: T(w.key), module_key: `${dk}.${w.module_key}`, entitlement_key: T(w.entitlement_key),
    definition: { nodes: w.definition.nodes.map(reNode), edges: w.definition.edges },
  }));
  const personas = pack.personas.map((p) => ({
    ...p, agent_key: T(p.agent_key),
    scope: { ...p.scope, ...(p.scope.artifact_types ? { artifact_types: p.scope.artifact_types.map(T) } : {}) },
  }));
  const lifecycle = { ...pack.lifecycle, transitions: pack.lifecycle.transitions.map((tr) => ({ ...tr, trigger_type: T(tr.trigger_type) })) };
  const manifest = {
    ...pack.manifest, domain: dk, modules,
    artifact_types: artifactTypes.map((t) => t.key), agents: agents.map((a) => a.key),
    workflows: workflows.map((w) => w.key), personas: personas.map((p) => p.agent_key),
    lifecycles: [lifecycle],
  };
  return { ...pack, key: dk, manifest, modules, artifactTypes, agents, workflows, personas, lifecycle };
}

/** Seed one pack's rows into the shared catalog (idempotent upsert). ownerTenantId
 *  marks it tenant-owned (vs a first-party template). */
export async function projectPack(pack: DomainPack, ownerTenantId: string | null): Promise<void> {
  await query(
    "INSERT INTO domain (`key`, name, version, manifest, enabled, owner_tenant_id, is_template) VALUES (?,?,?,?,1,?,0) ON DUPLICATE KEY UPDATE name=VALUES(name), version=VALUES(version), manifest=VALUES(manifest), owner_tenant_id=VALUES(owner_tenant_id)",
    [pack.key, pack.name, pack.version, JSON.stringify(pack.manifest), ownerTenantId]
  );
  for (const t of pack.artifactTypes)
    await query(
      "INSERT INTO artifact_type (`key`, name, payload_schema, is_reviewable) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), payload_schema=VALUES(payload_schema), is_reviewable=VALUES(is_reviewable)",
      [t.key, t.name, JSON.stringify(t.payload_schema), t.is_reviewable ? 1 : 0]
    );
  for (const a of pack.agents)
    await query(
      "INSERT INTO agent (`key`, name, kind, consumes, produces, job_types, permission_keys, entitlement_key, enabled) VALUES (?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name), kind=VALUES(kind), consumes=VALUES(consumes), produces=VALUES(produces), job_types=VALUES(job_types), permission_keys=VALUES(permission_keys)",
      [a.key, a.name, a.kind, JSON.stringify(a.consumes), JSON.stringify(a.produces), JSON.stringify(a.job_types), JSON.stringify(a.permission_keys), a.entitlement_key]
    );
  for (const w of pack.workflows)
    await query(
      "INSERT INTO workflow (`key`, name, module_key, version, definition, entitlement_key, enabled) VALUES (?,?,?,1,?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name), module_key=VALUES(module_key), definition=VALUES(definition), entitlement_key=VALUES(entitlement_key)",
      [w.key, w.name, w.module_key, JSON.stringify(w.definition), w.entitlement_key]
    );
  for (const p of pack.personas)
    await query(
      "INSERT INTO supervisor_profile (agent_key, scope, deviation_kinds, is_default, sort_order) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE scope=VALUES(scope), deviation_kinds=VALUES(deviation_kinds), is_default=VALUES(is_default), sort_order=VALUES(sort_order)",
      [p.agent_key, JSON.stringify(p.scope), JSON.stringify(p.deviation_kinds), p.is_default ? 1 : 0, p.sort_order]
    );
}

export function listTemplates() {
  return TEMPLATE_META;
}

/** Provision (or switch) a tenant onto an industry template — clone → validate →
 *  project → bind. Returns the new domain key + module count. */
export async function provisionTenantDomain(
  actor: AuditActor,
  tenantId: string,
  templateKey: string,
  displayName?: string
): Promise<{ domainKey: string; modules: number; name: string }> {
  const template = TEMPLATES[templateKey];
  if (!template) throw errNotFound(`Template '${templateKey}'`);
  const dk = tenantDomainKey(tenantId, templateKey);
  const pack = rekeyPack(template, dk);
  if (displayName) { pack.name = displayName; (pack.manifest as any).name = displayName; }

  const errs = validatePack(pack);
  if (errs.length) throw errSchema(`Template failed validation:\n${errs.join("\n")}`);

  const moduleKeys = pack.modules.map((m) => m.key);
  await tx(async (conn) => {
    await projectPack(pack, tenantId);
    await conn.query(
      "INSERT INTO tenant_domain (tenant_id, domain_key, name, industry, template_key, pack_json) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE domain_key=VALUES(domain_key), name=VALUES(name), industry=VALUES(industry), template_key=VALUES(template_key), pack_json=VALUES(pack_json), updated_at=NOW(3)",
      [tenantId, dk, pack.name, (pack.manifest as any).industry ?? "", templateKey, JSON.stringify(pack)]
    );
    await conn.query("UPDATE tenant_bootstrap SET domain_key = ? WHERE tenant_id = ?", [dk, tenantId]);
    await conn.query(
      "UPDATE entitlement_snapshot SET licensed_modules = ?, resolved_at = NOW(3) WHERE tenant_id = ?",
      [JSON.stringify(moduleKeys), tenantId]
    );
    await appendAudit(conn, actor, {
      action: "domain.provisioned", targetKind: "domain", targetId: dk, summary: { template: templateKey, name: pack.name, modules: moduleKeys.length },
    });
  });
  return { domainKey: dk, modules: moduleKeys.length, name: pack.name };
}

/** The tenant's current domain: its editable pack + meta, or null if on a
 *  first-party (non-editable) domain. */
export async function getTenantDomain(tenantId: string): Promise<any> {
  const row = await queryOne<{ domain_key: string; name: string; industry: string; template_key: string; pack_json: any; updated_at: string }>(
    "SELECT domain_key, name, industry, template_key, pack_json, updated_at FROM tenant_domain WHERE tenant_id = ?",
    [tenantId]
  );
  const boot = await queryOne<{ domain_key: string }>("SELECT domain_key FROM tenant_bootstrap WHERE tenant_id = ?", [tenantId]);
  if (!row || boot?.domain_key !== row.domain_key) {
    // On a first-party domain (e.g. seeded construction/underwriting) — not tenant-owned.
    const dom = await queryOne<{ name: string; manifest: any }>("SELECT name, manifest FROM domain WHERE `key` = ?", [boot?.domain_key ?? ""]);
    return { editable: false, domainKey: boot?.domain_key ?? null, name: dom?.name ?? null, industry: dom?.manifest?.industry ?? null, lifecycleKey: dom?.manifest?.lifecycles?.[0]?.key ?? null, manifest: dom?.manifest ?? null };
  }
  const pack: DomainPack = row.pack_json;
  return {
    editable: true, domainKey: row.domain_key, name: row.name, industry: row.industry, templateKey: row.template_key, updatedAt: row.updated_at,
    lifecycleKey: pack.lifecycle?.key ?? null,
    assistant: (pack.manifest as any).assistant ?? null,
    modules: pack.modules,
    types: pack.artifactTypes.map((t) => ({ key: t.key, name: t.name, short: short(t.key) })),
    stages: (pack.manifest as any).states ?? [],
  };
}

export interface DomainEdits {
  name?: string;
  assistantName?: string;
  modules?: Array<{ key: string; label?: string; description?: string; icon?: string }>;
  types?: Array<{ key: string; name: string }>;
}

/** Edit the tenant's own domain (labels/names/assistant), re-validate, and
 *  re-project the catalog rows. Structure (workflows/lifecycle) is preserved. */
export async function updateTenantDomain(actor: AuditActor, tenantId: string, edits: DomainEdits): Promise<void> {
  const row = await queryOne<{ domain_key: string; pack_json: any }>(
    "SELECT domain_key, pack_json FROM tenant_domain WHERE tenant_id = ?",
    [tenantId]
  );
  if (!row) throw errNotFound("Tenant domain");
  const pack: DomainPack = row.pack_json;

  if (edits.name) { pack.name = edits.name; (pack.manifest as any).name = edits.name; }
  if (edits.assistantName) {
    const persona = pack.agents.find((a) => a.kind === "supervisor");
    if (persona) persona.name = edits.assistantName;
    (pack.manifest as any).assistant = { ...(pack.manifest as any).assistant, name: edits.assistantName };
  }
  for (const me of edits.modules ?? []) {
    const m = pack.modules.find((x) => x.key === me.key);
    if (m) { if (me.label != null) m.label = me.label; if (me.description != null) m.description = me.description; if (me.icon != null) m.icon = me.icon; }
  }
  (pack.manifest as any).modules = pack.modules;
  for (const te of edits.types ?? []) {
    const t = pack.artifactTypes.find((x) => x.key === te.key);
    if (t && te.name) t.name = te.name;
  }

  const errs = validatePack(pack);
  if (errs.length) throw errSchema(`Edited domain invalid:\n${errs.join("\n")}`);

  await tx(async (conn) => {
    await projectPack(pack, tenantId);
    await conn.query(
      "UPDATE tenant_domain SET name = ?, pack_json = ?, updated_at = NOW(3) WHERE tenant_id = ?",
      [pack.name, JSON.stringify(pack), tenantId]
    );
    await appendAudit(conn, actor, { action: "domain.edited", targetKind: "domain", targetId: row.domain_key, summary: {} });
  });
}

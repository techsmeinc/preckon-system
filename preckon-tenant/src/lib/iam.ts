import { uuidv7 } from "uuidv7";
import { query, queryOne, tx } from "./db";
import { auth } from "./auth";
import { appendAudit, type AuditActor } from "./audit";
import { errBadRequest, errNotFound } from "./errors";

// ── Tenant IAM actions (admin surface). Add/deactivate users, assign roles, and
// create/edit custom roles. Domain-neutral: roles + permissions are data (seeded
// from the tenant's pack, extended here). Every mutation is audited on the chain.

const TIERS = ["owner_admin", "delivery", "review", "view"] as const;
type Tier = (typeof TIERS)[number];

async function roleIdsForKeys(tenantId: string, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const ph = keys.map(() => "?").join(",");
  const rows = await query<{ id: string }>(
    `SELECT id FROM tenant_role WHERE tenant_id = ? AND \`key\` IN (${ph})`,
    [tenantId, ...keys]
  );
  return rows.map((r) => r.id);
}

export interface AddUserInput { email: string; name?: string; roleKeys: string[]; password?: string; }

/** Add a member to the tenant: create the tenant-pool auth login (idempotent by
 *  email), the app_user (active), and the role assignments. Returns a temp password
 *  the admin can share. */
export async function addUser(
  actor: AuditActor,
  tenantId: string,
  grantedBy: string,
  input: AddUserInput
): Promise<{ userId: string; email: string; password: string | null; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw errBadRequest("Email is required");
  const existingAppUser = await queryOne<{ id: string }>(
    "SELECT id FROM app_user WHERE tenant_id = ? AND email = ?",
    [tenantId, email]
  );
  if (existingAppUser) throw errBadRequest("A user with that email already exists in this tenant");

  const roleIds = await roleIdsForKeys(tenantId, input.roleKeys);
  if (roleIds.length !== input.roleKeys.length) throw errBadRequest("One or more roles are unknown");

  // Auth login is shared across the tenant identity pool by email.
  const password = input.password ?? `preckon-${uuidv7().slice(0, 8)}`;
  let authUserId: string;
  const existingAuth = await queryOne<{ id: string }>("SELECT id FROM `user` WHERE email = ?", [email]);
  if (existingAuth) authUserId = existingAuth.id;
  else authUserId = (await auth.api.signUpEmail({ body: { email, password, name: input.name ?? email } })).user.id;

  const appUserId = uuidv7();
  await tx(async (conn) => {
    await conn.query(
      "INSERT INTO app_user (id, tenant_id, email, name, status, auth_user_id) VALUES (?,?,?,?, 'active', ?)",
      [appUserId, tenantId, email, input.name ?? email, authUserId]
    );
    for (const rid of roleIds)
      await conn.query("INSERT IGNORE INTO user_role (tenant_id, user_id, role_id, granted_by) VALUES (?,?,?,?)", [tenantId, appUserId, rid, grantedBy]);
    await appendAudit(conn, actor, { action: "user.add", targetKind: "user", targetId: appUserId, summary: { email, roles: input.roleKeys } });
  });
  return { userId: appUserId, email, password: existingAuth ? null : password, created: !existingAuth };
}

export interface UpdateUserInput { status?: "active" | "suspended"; roleKeys?: string[]; }

/** Update a member: set status and/or replace their role assignments. */
export async function updateUser(
  actor: AuditActor,
  tenantId: string,
  userId: string,
  grantedBy: string,
  input: UpdateUserInput
): Promise<void> {
  const user = await queryOne<{ id: string }>("SELECT id FROM app_user WHERE id = ? AND tenant_id = ?", [userId, tenantId]);
  if (!user) throw errNotFound("User");

  let roleIds: string[] | null = null;
  if (input.roleKeys) {
    roleIds = await roleIdsForKeys(tenantId, input.roleKeys);
    if (roleIds.length !== input.roleKeys.length) throw errBadRequest("One or more roles are unknown");
  }
  await tx(async (conn) => {
    if (input.status)
      await conn.query("UPDATE app_user SET status = ?, updated_at = NOW(3) WHERE id = ? AND tenant_id = ?", [input.status, userId, tenantId]);
    if (roleIds) {
      await conn.query("DELETE FROM user_role WHERE tenant_id = ? AND user_id = ?", [tenantId, userId]);
      for (const rid of roleIds)
        await conn.query("INSERT IGNORE INTO user_role (tenant_id, user_id, role_id, granted_by) VALUES (?,?,?,?)", [tenantId, userId, rid, grantedBy]);
    }
    await appendAudit(conn, actor, { action: "user.update", targetKind: "user", targetId: userId, summary: { status: input.status ?? null, roles: input.roleKeys ?? null } });
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "role";

export interface CreateRoleInput { name: string; tier: Tier; permissions: string[]; key?: string; }

/** Create a custom (non-system) role from selected permissions. */
export async function createRole(actor: AuditActor, tenantId: string, input: CreateRoleInput): Promise<{ id: string; key: string }> {
  if (!input.name?.trim()) throw errBadRequest("Role name is required");
  if (!TIERS.includes(input.tier)) throw errBadRequest("Invalid tier");
  const key = slug(input.key ?? input.name);
  const dupe = await queryOne<{ id: string }>("SELECT id FROM tenant_role WHERE tenant_id = ? AND `key` = ?", [tenantId, key]);
  if (dupe) throw errBadRequest(`A role with key '${key}' already exists`);
  const valid = await validPermissions(input.permissions);

  const id = uuidv7();
  await tx(async (conn) => {
    await conn.query("INSERT INTO tenant_role (id, tenant_id, `key`, name, tier, is_system) VALUES (?,?,?,?,?,0)", [id, tenantId, key, input.name.trim(), input.tier]);
    for (const p of valid)
      await conn.query("INSERT IGNORE INTO tenant_role_permission (tenant_id, role_id, permission_key) VALUES (?,?,?)", [tenantId, id, p]);
    await appendAudit(conn, actor, { action: "role.create", targetKind: "role", targetId: id, summary: { key, permissions: valid.length } });
  });
  return { id, key };
}

export interface UpdateRoleInput { name?: string; permissions?: string[]; }

/** Edit a custom role (system roles are read-only — seeded by the pack). */
export async function updateRole(actor: AuditActor, tenantId: string, roleId: string, input: UpdateRoleInput): Promise<void> {
  const role = await queryOne<{ id: string; is_system: number }>("SELECT id, is_system FROM tenant_role WHERE id = ? AND tenant_id = ?", [roleId, tenantId]);
  if (!role) throw errNotFound("Role");
  if (Number(role.is_system) === 1) throw errBadRequest("System roles (from your domain pack) can’t be edited");

  await tx(async (conn) => {
    if (input.name) await conn.query("UPDATE tenant_role SET name = ? WHERE id = ? AND tenant_id = ?", [input.name.trim(), roleId, tenantId]);
    if (input.permissions) {
      const valid = await validPermissions(input.permissions);
      await conn.query("DELETE FROM tenant_role_permission WHERE tenant_id = ? AND role_id = ?", [tenantId, roleId]);
      for (const p of valid)
        await conn.query("INSERT IGNORE INTO tenant_role_permission (tenant_id, role_id, permission_key) VALUES (?,?,?)", [tenantId, roleId, p]);
    }
    await appendAudit(conn, actor, { action: "role.update", targetKind: "role", targetId: roleId, summary: {} });
  });
}

/** Delete a custom role (system roles protected; assignments cascade off). */
export async function deleteRole(actor: AuditActor, tenantId: string, roleId: string): Promise<void> {
  const role = await queryOne<{ id: string; is_system: number }>("SELECT id, is_system FROM tenant_role WHERE id = ? AND tenant_id = ?", [roleId, tenantId]);
  if (!role) throw errNotFound("Role");
  if (Number(role.is_system) === 1) throw errBadRequest("System roles can’t be deleted");
  await tx(async (conn) => {
    await conn.query("DELETE FROM tenant_role WHERE id = ? AND tenant_id = ?", [roleId, tenantId]);
    await appendAudit(conn, actor, { action: "role.delete", targetKind: "role", targetId: roleId, summary: {} });
  });
}

async function validPermissions(keys: string[]): Promise<string[]> {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return [];
  const ph = uniq.map(() => "?").join(",");
  const rows = await query<{ key: string }>(`SELECT \`key\` FROM tenant_permission WHERE \`key\` IN (${ph})`, uniq);
  return rows.map((r) => r.key);
}

/** The permission catalog (Core keys + any pack additions), grouped for the UI. */
export async function permissionCatalog(): Promise<Array<{ key: string; domain: string; description: string }>> {
  return query("SELECT `key`, domain, description FROM tenant_permission ORDER BY domain, `key`");
}

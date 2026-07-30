import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errConflict, errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { useCase } from "@/lib/usecase";
import { resolvePermissionIds } from "../_helpers";

type Params = { params: Promise<{ id: string }> };

async function loadRole(id: string) {
  const role = await queryOne<any>(
    `SELECT r.id, r.\`key\`, r.name, r.description, r.is_system, r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM host_user hu WHERE hu.role_id = r.id) AS user_count
       FROM host_role r WHERE r.id = ?`,
    [id]
  );
  if (!role) return null;
  const perms = await query<{ key: string }>(
    `SELECT p.\`key\` FROM host_role_permission rp
       JOIN host_permission p ON p.id = rp.permission_id
      WHERE rp.role_id = ? ORDER BY p.\`key\``,
    [id]
  );
  return { ...role, permission_keys: perms.map((p) => p.key) };
}

// GET /roles/{id} — detail incl. permission keys. (§1.4)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.read");
  const { id } = await params;

  const role = await loadRole(id);
  if (!role) throw errNotFound("Role");
  return ok(role);
});

const PatchRole = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  permission_keys: z.array(z.string()).optional(),
  // Present only so we can reject attempts to mutate immutable system fields.
  key: z.string().optional(),
  is_system: z.boolean().optional(),
});

// PATCH /roles/{id} — rename/describe + replace permission set. System role key/is_system
// are immutable (422 if changed). Audited. (§1.4)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "role.manage");
  const { id } = await params;
  const body = await parseBody(req, PatchRole);

  const role = await queryOne<{ id: string; key: string; name: string; is_system: number }>(
    "SELECT id, `key`, name, is_system FROM host_role WHERE id = ?",
    [id]
  );
  if (!role) throw errNotFound("Role");

  if (role.is_system) {
    if (body.key !== undefined && body.key !== role.key)
      throw errUnprocessable("A system role's key is immutable");
    if (body.is_system !== undefined && body.is_system !== true)
      throw errUnprocessable("A system role's is_system flag is immutable");
    // A system role's permission set is fixed. Allowing it to be replaced lets an
    // operator strip role.manage / host_user.manage from Owner and permanently
    // lock every staff member out of role administration.
    if (body.permission_keys !== undefined)
      throw errUnprocessable("A system role's permissions are immutable");
  }

  // Resolve the replacement permission set up front (422 on unknown keys).
  const perms =
    body.permission_keys !== undefined
      ? await resolvePermissionIds(body.permission_keys)
      : null;

  const metaFields = Object.entries({
    name: body.name,
    description: body.description,
  }).filter(([, v]) => v !== undefined);

  const updated = await useCase(ctx, async (conn, audit) => {
    if (metaFields.length > 0) {
      const set = metaFields.map(([k]) => `\`${k}\` = ?`).join(", ");
      await conn.query(`UPDATE host_role SET ${set} WHERE id = ?`, [
        ...metaFields.map(([, v]) => v),
        id,
      ]);
    }
    if (perms !== null) {
      await conn.query("DELETE FROM host_role_permission WHERE role_id = ?", [id]);
      for (const p of perms) {
        await conn.query(
          "INSERT INTO host_role_permission (role_id, permission_id) VALUES (?, ?)",
          [id, p.id]
        );
      }
    }
    audit({
      action: "role.update",
      targetType: "role",
      targetId: id,
      summary: `Updated role ${role.name}`,
      metadata: {
        changed: metaFields.map(([k]) => k),
        permission_keys: perms ? perms.map((p) => p.key) : undefined,
      },
    });
    return loadRole(id);
  });
  return ok(updated);
});

// DELETE /roles/{id} — delete a custom role. 409 if is_system or any user assigned. Audited. (§1.4)
export const DELETE = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "role.manage");
  const { id } = await params;

  const role = await queryOne<{ id: string; key: string; name: string; is_system: number }>(
    "SELECT id, `key`, name, is_system FROM host_role WHERE id = ?",
    [id]
  );
  if (!role) throw errNotFound("Role");
  if (role.is_system) throw errConflict("System roles cannot be deleted");

  const assigned = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM host_user WHERE role_id = ?",
    [id]
  );
  if (assigned && Number(assigned.n) > 0)
    throw errConflict("Role is assigned to one or more users", { user_count: Number(assigned.n) });

  await useCase(ctx, async (conn, audit) => {
    await conn.query("DELETE FROM host_role_permission WHERE role_id = ?", [id]);
    await conn.query("DELETE FROM host_role WHERE id = ?", [id]);
    audit({
      action: "role.delete",
      targetType: "role",
      targetId: id,
      summary: `Deleted role ${role.name}`,
      metadata: { key: role.key },
    });
  });

  return ok({ deleted: true, id });
});

import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errConflict, errUnprocessable } from "@/lib/errors";
import { handle, list, ok, parseBody } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";
import { resolvePermissionIds, slugify } from "./_helpers";

function csvToKeys(csv: string | null): string[] {
  return csv ? csv.split(",") : [];
}

// GET /roles — list roles with their permission keys and assigned-user counts. (§1.4)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.read");

  const rows = await query<any>(
    `SELECT r.id, r.\`key\`, r.name, r.description, r.is_system, r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM host_user hu WHERE hu.role_id = r.id) AS user_count,
            (SELECT GROUP_CONCAT(p.\`key\`)
               FROM host_role_permission rp
               JOIN host_permission p ON p.id = rp.permission_id
              WHERE rp.role_id = r.id) AS permission_keys_csv
       FROM host_role r
      ORDER BY r.is_system DESC, r.name ASC`
  );
  const data = rows.map((r) => {
    const { permission_keys_csv, ...rest } = r;
    return { ...rest, permission_keys: csvToKeys(permission_keys_csv) };
  });
  return list(data, null);
});

const CreateRole = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permission_keys: z.array(z.string()).default([]),
});

// POST /roles — create a custom role (is_system=false) with a permission set. Audited. (§1.4)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "role.manage");
  const body = await parseBody(req, CreateRole);

  const key = "custom_" + slugify(body.name);
  if (key === "custom_") throw errUnprocessable("Role name must contain letters or digits");

  const dup = await queryOne<{ id: string }>("SELECT id FROM host_role WHERE `key` = ?", [key]);
  if (dup) throw errConflict("A role with that key already exists", { key });

  // Resolve permission keys → ids (reject unknown keys).
  const perms = await resolvePermissionIds(body.permission_keys);

  const created = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      "INSERT INTO host_role (id, `key`, name, description, is_system) VALUES (?,?,?,?, 0)",
      [id, key, body.name, body.description ?? null]
    );
    for (const p of perms) {
      await conn.query(
        "INSERT INTO host_role_permission (role_id, permission_id) VALUES (?, ?)",
        [id, p.id]
      );
    }
    audit({
      action: "role.create",
      targetType: "role",
      targetId: id,
      summary: `Created role ${body.name}`,
      metadata: { key, permission_keys: perms.map((p) => p.key) },
    });
    return {
      id,
      key,
      name: body.name,
      description: body.description ?? null,
      is_system: false,
      permission_keys: perms.map((p) => p.key),
    };
  });

  return ok(created, 201);
});

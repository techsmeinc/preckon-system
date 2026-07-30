import { z } from "zod";
import { getAuthContext, requirePermission } from "@/lib/context";
import { queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { useCase } from "@/lib/usecase";

type Params = { params: Promise<{ id: string }> };

const HOST_USER_SELECT = `
  SELECT hu.id, hu.auth_user_id, hu.email, hu.display_name, hu.role_id,
         hu.status, hu.two_factor_enabled, hu.last_login_at, hu.created_by,
         hu.created_at, hu.updated_at,
         r.\`key\` AS role_key, r.name AS role_name
    FROM host_user hu
    JOIN host_role r ON r.id = hu.role_id`;

// GET /host-users/{id} — detail. (§1.4)
export const GET = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.read");
  const { id } = await params;

  const user = await queryOne(`${HOST_USER_SELECT} WHERE hu.id = ?`, [id]);
  if (!user) throw errNotFound("Host user");
  return ok(user);
});

const PatchHostUser = z.object({
  display_name: z.string().min(1).optional(),
  role_id: z.string().min(1).optional(),
  status: z.enum(["invited", "active", "suspended"]).optional(),
});

// PATCH /host-users/{id} — update display_name/role_id/status. Cannot suspend/demote self (422). (§1.4)
export const PATCH = handle(async (req, { params }: Params) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.manage");
  const { id } = await params;
  const body = await parseBody(req, PatchHostUser);

  const existing = await queryOne<{ id: string; display_name: string; role_id: string }>(
    "SELECT id, display_name, role_id FROM host_user WHERE id = ?",
    [id]
  );
  if (!existing) throw errNotFound("Host user");

  // A user cannot suspend or demote (change the role of) themselves (§1.4).
  if (id === ctx.user.id) {
    if (body.status === "suspended")
      throw errUnprocessable("You cannot suspend your own account");
    if (body.role_id && body.role_id !== existing.role_id)
      throw errUnprocessable("You cannot change your own role");
  }

  if (body.role_id) {
    const role = await queryOne<{ id: string }>("SELECT id FROM host_role WHERE id = ?", [
      body.role_id,
    ]);
    if (!role) throw errUnprocessable("Unknown role_id", { role_id: body.role_id });
  }

  const fields = Object.entries(body).filter(([, v]) => v !== undefined);
  if (fields.length === 0) {
    const current = await queryOne(`${HOST_USER_SELECT} WHERE hu.id = ?`, [id]);
    return ok(current);
  }

  const updated = await useCase(ctx, async (conn, audit) => {
    const set = fields.map(([k]) => `\`${k}\` = ?`).join(", ");
    await conn.query(`UPDATE host_user SET ${set} WHERE id = ?`, [
      ...fields.map(([, v]) => v),
      id,
    ]);
    audit({
      action: "host_user.update",
      targetType: "host_user",
      targetId: id,
      summary: `Updated host user ${existing.display_name}`,
      metadata: { changed: fields.map(([k]) => k) },
    });
    const [rows] = await conn.query(`${HOST_USER_SELECT} WHERE hu.id = ?`, [id]);
    return (rows as any[])[0];
  });
  return ok(updated);
});

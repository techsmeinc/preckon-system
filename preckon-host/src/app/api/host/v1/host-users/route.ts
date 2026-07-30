import { randomBytes } from "crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errConflict, errUnprocessable } from "@/lib/errors";
import { handle, list, ok, parseBody, parsePage, paginate, q } from "@/lib/http";
import { newId } from "@/lib/ids";
import { useCase } from "@/lib/usecase";
import { email } from "@/lib/integrations";

const HOST_USER_SELECT = `
  SELECT hu.id, hu.auth_user_id, hu.email, hu.display_name, hu.role_id,
         hu.status, hu.two_factor_enabled, hu.last_login_at, hu.created_by,
         hu.created_at, hu.updated_at,
         r.\`key\` AS role_key, r.name AS role_name
    FROM host_user hu
    JOIN host_role r ON r.id = hu.role_id`;

// GET /host-users — list. Filters ?status ?role_id ?q (email/display_name). Cursor-paginated. (§1.4)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.read");
  const { limit, cursor } = parsePage(req);

  const where: string[] = [];
  const params: any[] = [];
  const status = q(req, "status");
  const roleId = q(req, "role_id");
  const search = q(req, "q");
  if (status) (where.push("hu.status = ?"), params.push(status));
  if (roleId) (where.push("hu.role_id = ?"), params.push(roleId));
  if (search) {
    where.push("(hu.email LIKE ? OR hu.display_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (cursor) (where.push("hu.id < ?"), params.push(cursor));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await query(
    `${HOST_USER_SELECT} ${whereSql} ORDER BY hu.id DESC LIMIT ${limit + 1}`,
    params
  );
  const { data, nextCursor } = paginate(rows, limit, (r: any) => r.id);
  return list(data, nextCursor);
});

const InviteHostUser = z.object({
  email: z.string().email(),
  display_name: z.string().min(1),
  role_id: z.string().min(1),
});

function randomPassword(len = 20): string {
  return randomBytes(len).toString("base64url").slice(0, len);
}

// POST /host-users — invite staff. Creates the Better Auth user + host_user (status 'invited'),
// sends invite email, audits 'host_user.invite'. (§1.4)
export const POST = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "host_user.manage");
  const body = await parseBody(req, InviteHostUser);

  const role = await queryOne<{ id: string; key: string; name: string }>(
    "SELECT id, `key`, name FROM host_role WHERE id = ?",
    [body.role_id]
  );
  if (!role) throw errUnprocessable("Unknown role_id", { role_id: body.role_id });

  const dup = await queryOne<{ id: string }>("SELECT id FROM host_user WHERE email = ?", [
    body.email,
  ]);
  if (dup) throw errConflict("A host user with that email already exists", { email: body.email });

  // Create the Better Auth identity (invite flow). If the account already exists
  // in the shared identity pool, reuse its id instead of failing.
  let authUserId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: { email: body.email, name: body.display_name, password: randomPassword() },
    });
    authUserId = res.user.id;
  } catch {
    const existing = await queryOne<{ id: string }>("SELECT id FROM `user` WHERE email = ?", [
      body.email,
    ]);
    if (!existing) throw errConflict("Could not create the Better Auth account", { email: body.email });
    authUserId = existing.id;
  }

  const created = await useCase(ctx, async (conn, audit) => {
    const id = newId();
    await conn.query(
      `INSERT INTO host_user (id, auth_user_id, email, display_name, role_id, status,
                              two_factor_enabled, created_by)
       VALUES (?,?,?,?,?, 'invited', 0, ?)`,
      [id, authUserId, body.email, body.display_name, body.role_id, ctx.user.id]
    );
    audit({
      action: "host_user.invite",
      targetType: "host_user",
      targetId: id,
      summary: `Invited ${body.display_name} (${body.email}) as ${role.name}`,
      metadata: { email: body.email, role_id: role.id, role_key: role.key },
    });
    const [rows] = await conn.query(`${HOST_USER_SELECT} WHERE hu.id = ?`, [id]);
    return (rows as any[])[0];
  });

  await email.send({
    to: body.email,
    subject: "You're invited to the Preckon Host console",
    body: `Hi ${body.display_name}, you've been invited to Preckon Host as ${role.name}. Set your password to activate your account.`,
  });

  return ok(created, 201);
});

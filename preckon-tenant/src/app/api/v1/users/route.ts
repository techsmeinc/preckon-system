import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { actorFromCtx } from "@/lib/usecase";
import { addUser } from "@/lib/iam";

// §1.7 GET /users — tenant users + their roles (admin surface).
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "admin.users");
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.status, u.created_at,
            GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') AS roles,
            GROUP_CONCAT(r.\`key\` ORDER BY r.name SEPARATOR ',') AS role_keys
       FROM app_user u
       LEFT JOIN user_role ur ON ur.user_id = u.id
       LEFT JOIN tenant_role r ON r.id = ur.role_id
      WHERE u.tenant_id = ?
      GROUP BY u.id, u.email, u.name, u.status, u.created_at
      ORDER BY u.created_at ASC`,
    [ctx.tenantId]
  );
  return ok(rows);
});

const AddUser = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  roleKeys: z.array(z.string()).default([]),
  password: z.string().min(8).optional(),
});

// POST /users — add a member (creates the tenant login + assigns roles).
export const POST = route(async (req, ctx) => {
  requirePermission(ctx, "admin.users");
  const b = AddUser.parse(await req.json());
  const res = await addUser(actorFromCtx(ctx), ctx.tenantId, ctx.user.id, b);
  return ok(res, 201);
});

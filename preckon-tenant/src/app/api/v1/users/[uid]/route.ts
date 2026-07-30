import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { updateUser } from "@/lib/iam";

const Body = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  roleKeys: z.array(z.string()).optional(),
});

// PATCH /users/{uid} — set a member's status and/or replace their roles.
export const PATCH = route<{ uid: string }>(async (req, ctx, { uid }) => {
  requirePermission(ctx, "admin.users");
  const b = Body.parse(await req.json());
  await updateUser(actorFromCtx(ctx), ctx.tenantId, uid, ctx.user.id, b);
  return ok({ id: uid });
});

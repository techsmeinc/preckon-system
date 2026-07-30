import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { updateRole, deleteRole } from "@/lib/iam";

const Body = z.object({ name: z.string().min(1).optional(), permissions: z.array(z.string()).optional() });

// PATCH /roles/{rid} — edit a custom role (name / permissions).
export const PATCH = route<{ rid: string }>(async (req, ctx, { rid }) => {
  requirePermission(ctx, "admin.users");
  const b = Body.parse(await req.json());
  await updateRole(actorFromCtx(ctx), ctx.tenantId, rid, b);
  return ok({ id: rid });
});

// DELETE /roles/{rid} — remove a custom role.
export const DELETE = route<{ rid: string }>(async (_req, ctx, { rid }) => {
  requirePermission(ctx, "admin.users");
  await deleteRole(actorFromCtx(ctx), ctx.tenantId, rid);
  return ok({ id: rid, deleted: true });
});

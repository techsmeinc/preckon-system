import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { actorFromCtx } from "@/lib/usecase";
import { updateEntry, removeEntry } from "@/lib/library";

const Body = z.object({ entryKey: z.string().nullable().optional(), payload: z.record(z.any()).optional() });

// PATCH /library/{id} — edit an entry (versions it).
export const PATCH = route<{ id: string }>(async (req, ctx, { id }) => {
  requirePermission(ctx, "library.manage");
  const b = Body.parse(await req.json());
  const res = await updateEntry(actorFromCtx(ctx), ctx.tenantId, id, ctx.user.id, b);
  return ok(res);
});

// DELETE /library/{id} — remove from the active set (soft).
export const DELETE = route<{ id: string }>(async (_req, ctx, { id }) => {
  requirePermission(ctx, "library.manage");
  await removeEntry(actorFromCtx(ctx), ctx.tenantId, id);
  return ok({ id, removed: true });
});

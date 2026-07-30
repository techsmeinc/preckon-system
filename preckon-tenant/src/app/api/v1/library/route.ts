import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { actorFromCtx } from "@/lib/usecase";
import { addEntry } from "@/lib/library";

// §M.4 GET /library?collection= — reference & precedent entries (cross-project memory).
export const GET = route(async (req, ctx) => {
  requirePermission(ctx, "library.read");
  const col = new URL(req.url).searchParams.get("collection");
  const where = ["tenant_id = ?", "status = 'active'"];
  const params: any[] = [ctx.tenantId];
  if (col) { where.push("collection = ?"); params.push(col); }
  const rows = await query(
    `SELECT id, collection, entry_key, payload, version, created_at
       FROM library_entry WHERE ${where.join(" AND ")} ORDER BY collection, created_at DESC`,
    params
  );
  return ok(rows);
});

const NewEntry = z.object({
  collection: z.string().min(1),
  entryKey: z.string().optional(),
  payload: z.record(z.any()).default({}),
});

// POST /library — add a reference entry (needs library.manage).
export const POST = route(async (req, ctx) => {
  requirePermission(ctx, "library.manage");
  const b = NewEntry.parse(await req.json());
  const res = await addEntry(actorFromCtx(ctx), ctx.tenantId, ctx.user.id, b);
  return ok(res, 201);
});

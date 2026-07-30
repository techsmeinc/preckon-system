import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { permissionCatalog } from "@/lib/iam";

// GET /permissions — the permission catalog (Core keys + pack additions) for the
// role editor.
export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "admin.users");
  return ok(await permissionCatalog());
});

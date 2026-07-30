import { getAuthContext } from "@/lib/context";
import { handle, ok } from "@/lib/http";

// GET /me — current staff profile, role, resolved permission keys (§1.4).
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  return ok({
    id: ctx.user.id,
    email: ctx.user.email,
    display_name: ctx.user.display_name,
    role: { key: ctx.user.role_key, name: ctx.user.role_name },
    permissions: [...ctx.permissions].sort(),
    two_factor_enabled: ctx.user.two_factor_enabled,
  });
});

import { auth } from "./auth";
import { query, queryOne } from "./db";
import { ApiError, errForbidden, errUnauthenticated } from "./errors";

export interface HostUser {
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string;
  role_id: string;
  role_key: string;
  role_name: string;
  status: string;
  two_factor_enabled: boolean;
}

export interface AuthContext {
  user: HostUser;
  permissions: Set<string>;
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
}

function reqMeta(req: Request) {
  const h = req.headers;
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  return {
    ip,
    userAgent: h.get("user-agent"),
    correlationId: h.get("x-correlation-id") ?? crypto.randomUUID(),
  };
}

/**
 * Resolve the current staff member + role + permission set from the Better Auth
 * session. Throws 401 if unauthenticated or the staff profile is missing/blocked.
 * The console's UI gating is convenience only — this is the boundary (§0.5).
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) throw errUnauthenticated();

  const user = await queryOne<HostUser>(
    `SELECT hu.id, hu.auth_user_id, hu.email, hu.display_name, hu.role_id,
            hu.status, hu.two_factor_enabled,
            r.\`key\` AS role_key, r.name AS role_name
       FROM host_user hu
       JOIN host_role r ON r.id = hu.role_id
      WHERE hu.auth_user_id = ?`,
    [session.user.id]
  );
  if (!user) throw errUnauthenticated("No host staff profile for this account");
  if (user.status === "suspended")
    throw new ApiError("forbidden", "Your staff account is suspended");

  const perms = await query<{ key: string }>(
    `SELECT p.\`key\` FROM host_role_permission rp
       JOIN host_permission p ON p.id = rp.permission_id
      WHERE rp.role_id = ?`,
    [user.role_id]
  );

  return {
    user,
    permissions: new Set(perms.map((p) => p.key)),
    ...reqMeta(req),
  };
}

/** Assert a permission key or throw 403 (§0.5). */
export function requirePermission(ctx: AuthContext, key: string): void {
  if (!ctx.permissions.has(key)) throw errForbidden(key);
}

export function has(ctx: AuthContext, key: string): boolean {
  return ctx.permissions.has(key);
}

/**
 * Service-to-service auth for /internal endpoints (§5.5, §7.6) — the tenant
 * plane presents a bearer token, NOT a host session.
 */
export function requireServiceAuth(req: Request): void {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected || !token || token !== expected)
    throw errUnauthenticated("Invalid service token");
}

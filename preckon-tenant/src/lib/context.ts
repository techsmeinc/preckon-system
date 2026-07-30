import { auth } from "./auth";
import { query, queryOne } from "./db";
import { ApiError, errForbidden, errNotFound, errUnauthenticated } from "./errors";

export interface AppUser {
  id: string;
  tenant_id: string;
  email: string;
  name: string | null;
  status: string;
  auth_user_id: string | null;
}

export interface AuthContext {
  user: AppUser;
  tenantId: string;
  permissions: Set<string>;
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
}

function reqMeta(req: Request) {
  const h = req.headers;
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return {
    ip,
    userAgent: h.get("user-agent"),
    correlationId: h.get("x-correlation-id") ?? crypto.randomUUID(),
  };
}

/**
 * Resolve the current tenant user + permission set from the Better Auth session.
 * This is where app-layer tenancy begins: every downstream query is scoped to
 * `ctx.tenantId` (MySQL has no RLS — see lib/tenancy.ts). Throws 401 if
 * unauthenticated or the profile is missing/suspended.
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) throw errUnauthenticated();

  const user = await queryOne<AppUser>(
    `SELECT id, tenant_id, email, name, status, auth_user_id
       FROM app_user WHERE auth_user_id = ?`,
    [session.user.id]
  );
  if (!user) throw errUnauthenticated("No tenant profile for this account");
  if (user.status === "suspended")
    throw new ApiError("forbidden", "Your account is suspended");

  const perms = await query<{ permission_key: string }>(
    `SELECT permission_key FROM user_effective_permission
      WHERE user_id = ? AND tenant_id = ?`,
    [user.id, user.tenant_id]
  );

  return {
    user,
    tenantId: user.tenant_id,
    permissions: new Set(perms.map((p) => p.permission_key)),
    ...reqMeta(req),
  };
}

/** Assert a permission key or throw 403 (§1.2). */
export function requirePermission(ctx: AuthContext, key: string): void {
  if (!ctx.permissions.has(key)) throw errForbidden(key);
}

export function has(ctx: AuthContext, key: string): boolean {
  return ctx.permissions.has(key);
}

/**
 * Resolve a project the caller may act on, enforcing the §1.4 access model:
 * a member, OR a holder of `project.read_all`. Also confirms tenant ownership
 * of the project (app-layer tenancy). Throws 404 if not visible (no existence
 * leak, §X.2).
 */
export async function requireProject(
  ctx: AuthContext,
  projectId: string
): Promise<{ id: string; lifecycle_key: string | null; lifecycle_state: string }> {
  const project = await queryOne<{
    id: string;
    lifecycle_key: string | null;
    lifecycle_state: string;
  }>(`SELECT id, lifecycle_key, lifecycle_state FROM project WHERE id = ? AND tenant_id = ?`, [
    projectId,
    ctx.tenantId,
  ]);
  if (!project) throw errNotFound("Project");

  if (ctx.permissions.has("project.read_all")) return project;

  const member = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM project_member WHERE project_id = ? AND user_id = ? AND tenant_id = ?`,
    [projectId, ctx.user.id, ctx.tenantId]
  );
  if (!member) throw errNotFound("Project");
  return project;
}

/**
 * Service-to-service auth for /internal endpoints (job callback, bootstrap,
 * entitlement push) — a bearer token from the Host/worker trust domain, not a
 * user session (§X.4).
 */
export function requireServiceAuth(req: Request): void {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected || !token || token !== expected)
    throw errUnauthenticated("Invalid service token");
}

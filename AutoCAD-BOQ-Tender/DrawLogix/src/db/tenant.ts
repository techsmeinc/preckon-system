import { cookies } from "next/headers";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "./client";

/** Cookie holding the active org (tenant) chosen by the dev org selector. */
export const ACTIVE_ORG_COOKIE = "dl_org";

/** All orgs (for the selector). Read-only view of the platform's tenant table. */
export async function listOrgs(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: schema.orgs.id, name: schema.orgs.name }).from(schema.orgs).orderBy(asc(schema.orgs.name));
}

/**
 * The active tenant (no login — a dev selector). Reads the cookie; falls back to the
 * first org. Returns null only if the database has no orgs at all.
 */
export async function getActiveOrgId(): Promise<string | null> {
  const fromCookie = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  if (fromCookie) {
    const found = (await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, fromCookie)).limit(1))[0];
    if (found) return found.id;
  }
  const first = (await db.select({ id: schema.orgs.id }).from(schema.orgs).orderBy(asc(schema.orgs.name)).limit(1))[0];
  return first?.id ?? null;
}

/** Like getActiveOrgId but throws when there's no tenant — for write paths. */
export async function requireOrgId(): Promise<string> {
  const orgId = await getActiveOrgId();
  if (!orgId) throw new Error("No organization found in the database. Seed an org first.");
  return orgId;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Tenant-scoped transaction. There's no RLS in MariaDB, so isolation is enforced in
 * code: every query inside MUST filter by orgId. The session var is set for parity
 * with the platform (informational).
 */
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET @app_current_org = ${orgId}`);
    return fn(tx);
  });
}

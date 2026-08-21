import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { newId } from "@/lib/ids";
import {
  toScim, fromScim, listResponse, parseFilter, scimError,
  SCIM_USER_SCHEMA, type AppUser,
} from "@/lib/scim";

// SCIM 2.0 — /scim/v2/Users
//
// Outside /api/v1 on purpose: SCIM's path is fixed by RFC 7644 and identity
// providers construct it themselves. Bending it to our own prefix means every
// integration needs a bespoke base URL, which is exactly the friction SCIM
// exists to remove.
//
// Authenticated by a bearer token per tenant, not by a session: the caller is
// Azure AD or Okta, and there is no browser and nobody to sign in. The token
// identifies WHICH tenant is being provisioned, so a leaked token cannot reach
// another one.

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

/**
 * Resolve the caller's tenant from its bearer token.
 *
 * Returns null rather than throwing so every handler answers 401 in the SCIM
 * error shape — a provider that gets an HTML error page reports "endpoint
 * unreachable", which sends whoever is debugging it to the wrong place.
 */
async function tenantFor(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;

  // A single shared token is the common deployment; a per-tenant table is the
  // multi-tenant one. Env first so a single-tenant install needs no rows.
  const configured = process.env.SCIM_TOKEN;
  if (configured && token === configured) {
    const row = await queryOne<any>("SELECT id FROM tenant ORDER BY created_at LIMIT 1");
    return row?.id ?? null;
  }
  const row = await queryOne<any>(
    "SELECT tenant_id FROM tenant_scim_token WHERE token = ? AND revoked_at IS NULL",
    [token],
  ).catch(() => null);
  return row?.tenant_id ?? null;
}

const rowToApp = (r: any): AppUser => ({
  id: r.id, email: r.email, name: r.name ?? "", status: r.status,
  externalId: r.scim_external_id ?? null,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

export async function GET(req: Request) {
  const tenantId = await tenantFor(req);
  if (!tenantId) return json(scimError(401, "A valid bearer token is required."), 401);

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const filter = parseFilter(url.searchParams.get("filter"));
  const count = Math.min(200, Number(url.searchParams.get("count") ?? 100));
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? 1));

  if (filter && filter.attribute !== "username" && filter.attribute !== "externalid") {
    // Saying so beats returning everything: a provider that asked for one user
    // and received the directory will happily act on the difference.
    return json(scimError(400, `Only userName and externalId filters are supported, not ${filter.attribute}.`, "invalidFilter"), 400);
  }

  const where = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (filter?.attribute === "username") { where.push("email = ?"); params.push(filter.value.toLowerCase()); }
  if (filter?.attribute === "externalid") { where.push("scim_external_id = ?"); params.push(filter.value); }

  const rows = await query<any>(
    `SELECT id, email, name, status, scim_external_id, created_at, updated_at
       FROM app_user WHERE ${where.join(" AND ")}
      ORDER BY created_at LIMIT ? OFFSET ?`,
    [...params, count, startIndex - 1],
  );
  const totalRow = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM app_user WHERE ${where.join(" AND ")}`, params);

  return json(listResponse(rows.map((r) => toScim(rowToApp(r), base)), startIndex, Number(totalRow?.n ?? rows.length)));
}

export async function POST(req: Request) {
  const tenantId = await tenantFor(req);
  if (!tenantId) return json(scimError(401, "A valid bearer token is required."), 401);

  const body = await req.json().catch(() => null);
  const parsed = fromScim(body);
  if (!parsed.ok) return json(scimError(400, parsed.reason, "invalidValue"), 400);
  const { email, name, active, externalId } = parsed.value;

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;

  // Re-provisioning an existing user is normal: a provider that lost its id
  // mapping replays every create. Answering 409 with the existing resource lets
  // it recover instead of retrying forever.
  const existing = await queryOne<any>(
    `SELECT id, email, name, status, scim_external_id, created_at, updated_at
       FROM app_user WHERE tenant_id = ? AND email = ?`, [tenantId, email]);
  if (existing) {
    return json({ ...toScim(rowToApp(existing), base), detail: "User already exists." }, 409);
  }

  const id = newId();
  await query(
    `INSERT INTO app_user (id, tenant_id, email, name, status, scim_external_id)
     VALUES (?,?,?,?,?,?)`,
    [id, tenantId, email, name, active ? "active" : "suspended", externalId],
  );

  const created = await queryOne<any>(
    `SELECT id, email, name, status, scim_external_id, created_at, updated_at
       FROM app_user WHERE tenant_id = ? AND id = ?`, [tenantId, id]);
  return json({ ...toScim(rowToApp(created!), base), schemas: [SCIM_USER_SCHEMA] }, 201);
}

import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { toScim, fromScim, applyPatch, scimError, type AppUser } from "@/lib/scim";

// SCIM 2.0 — /scim/v2/Users/{id}
//
// The operation that matters here is deactivation. DELETE does not delete: it
// suspends. A user's approvals, authored artifacts and audit entries have to
// stay attributable years after they leave, and removing the row would orphan a
// chain of decisions somebody may have to defend. SCIM's contract is satisfied —
// the user stops being able to sign in, which is what "deprovisioned" means to
// the identity provider — without destroying the record.

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

async function tenantFor(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
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

const SELECT = `SELECT id, email, name, status, scim_external_id, created_at, updated_at
                  FROM app_user WHERE tenant_id = ? AND id = ?`;

async function load(tenantId: string, id: string) {
  return queryOne<any>(SELECT, [tenantId, id]);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFor(req);
  if (!tenantId) return json(scimError(401, "A valid bearer token is required."), 401);
  const { id } = await params;
  const row = await load(tenantId, id);
  if (!row) return json(scimError(404, `No user with id ${id}.`), 404);
  const url = new URL(req.url);
  return json(toScim(rowToApp(row), `${url.protocol}//${url.host}`));
}

/** Full replace. Absent `active` means active, per RFC 7643. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFor(req);
  if (!tenantId) return json(scimError(401, "A valid bearer token is required."), 401);
  const { id } = await params;
  const row = await load(tenantId, id);
  if (!row) return json(scimError(404, `No user with id ${id}.`), 404);

  const parsed = fromScim(await req.json().catch(() => null));
  if (!parsed.ok) return json(scimError(400, parsed.reason, "invalidValue"), 400);

  await query(
    `UPDATE app_user SET email = ?, name = ?, status = ?, scim_external_id = COALESCE(?, scim_external_id)
      WHERE tenant_id = ? AND id = ?`,
    [parsed.value.email, parsed.value.name, parsed.value.active ? "active" : "suspended",
     parsed.value.externalId, tenantId, id],
  );

  const url = new URL(req.url);
  return json(toScim(rowToApp((await load(tenantId, id))!), `${url.protocol}//${url.host}`));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFor(req);
  if (!tenantId) return json(scimError(401, "A valid bearer token is required."), 401);
  const { id } = await params;
  const row = await load(tenantId, id);
  if (!row) return json(scimError(404, `No user with id ${id}.`), 404);

  const body = await req.json().catch(() => null);
  const outcome = applyPatch(body?.Operations ?? body?.operations ?? []);

  const sets: string[] = [];
  const args: unknown[] = [];
  if (outcome.active !== undefined) { sets.push("status = ?"); args.push(outcome.active ? "active" : "suspended"); }
  if (outcome.name) { sets.push("name = ?"); args.push(outcome.name); }
  if (outcome.email) { sets.push("email = ?"); args.push(outcome.email); }

  if (!sets.length) {
    // Nothing understood. Reporting it beats a silent 200, which an IdP records
    // as a successful deprovision that never happened.
    return json(
      scimError(400, `No supported operation in this patch. Received: ${outcome.unsupported.join("; ") || "(none)"}.`, "invalidValue"),
      400,
    );
  }

  await query(`UPDATE app_user SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`, [...args, tenantId, id]);

  const url = new URL(req.url);
  return json(toScim(rowToApp((await load(tenantId, id))!), `${url.protocol}//${url.host}`));
}

/**
 * Deprovision.
 *
 * Suspends rather than deletes, and returns 204 as SCIM requires. The provider
 * sees the user gone; the audit chain keeps everything they ever approved
 * attributable to a real person.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFor(req);
  if (!tenantId) return json(scimError(401, "A valid bearer token is required."), 401);
  const { id } = await params;
  const row = await load(tenantId, id);
  if (!row) return json(scimError(404, `No user with id ${id}.`), 404);

  await query("UPDATE app_user SET status = 'suspended' WHERE tenant_id = ? AND id = ?", [tenantId, id]);
  return new NextResponse(null, { status: 204 });
}

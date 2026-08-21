// SCIM 2.0 user provisioning.
//
// The point of SCIM is not creating users — an admin screen does that. It is
// DEPROVISIONING: when somebody leaves, their access should disappear because
// HR closed their record, not because a project manager remembered to tell
// someone. Every month a leaver keeps working access is a month of risk nobody
// chose to take, and manual removal is the step that gets skipped.
//
// So the mapping here treats `active: false` as the important operation, not
// the afterthought. A deactivated user keeps their app_user row — their audit
// trail, their authorship of artifacts, their approvals must all stay
// attributable — and loses their ability to sign in. Deleting the row would
// orphan a chain of decisions somebody may need to defend years later.
//
// RFC 7644 shapes, with the subset that matters honestly implemented rather
// than the whole spec badly: Users, list with filter, create, replace, patch
// active, and delete-as-deactivate.

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export interface ScimName { givenName?: string; familyName?: string; formatted?: string }
export interface ScimEmail { value: string; primary?: boolean; type?: string }

export interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active: boolean;
  meta: { resourceType: "User"; created?: string; lastModified?: string; location?: string };
}

/** The internal shape SCIM maps onto. */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  status: string;
  externalId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export const scimError = (status: number, detail: string, scimType?: string) => ({
  schemas: [SCIM_ERROR_SCHEMA],
  status: String(status),
  ...(scimType ? { scimType } : {}),
  detail,
});

/**
 * An app user as SCIM sees it.
 *
 * `active` is derived from status rather than stored twice. Two fields meaning
 * the same thing drift, and when they drift the one the identity provider reads
 * is not the one the application enforces — which is a leaver who still has a
 * session.
 */
export function toScim(user: AppUser, baseUrl: string): ScimUser {
  const [given, ...rest] = (user.name ?? "").split(" ");
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    ...(user.externalId ? { externalId: user.externalId } : {}),
    userName: user.email,
    name: { givenName: given || undefined, familyName: rest.join(" ") || undefined, formatted: user.name || undefined },
    displayName: user.name || user.email,
    emails: [{ value: user.email, primary: true, type: "work" }],
    active: user.status === "active",
    meta: {
      resourceType: "User",
      created: user.createdAt ?? undefined,
      lastModified: user.updatedAt ?? undefined,
      location: `${baseUrl}/scim/v2/Users/${user.id}`,
    },
  };
}

export interface ParsedUser {
  email: string;
  name: string;
  active: boolean;
  externalId?: string | null;
}


/** Read a SCIM user payload into the fields this application stores. */
export function fromScim(body: any): { ok: true; value: ParsedUser } | { ok: false; reason: string } {
  const userName = String(body?.userName ?? "").trim();
  const emails: ScimEmail[] = Array.isArray(body?.emails) ? body.emails : [];
  const primary = emails.find((e) => e.primary) ?? emails[0];
  const email = (primary?.value ?? userName).trim().toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: "userName or a primary email address is required and must be an email." };
  }

  const name =
    String(body?.displayName ?? "").trim() ||
    [body?.name?.givenName, body?.name?.familyName].filter(Boolean).join(" ").trim() ||
    String(body?.name?.formatted ?? "").trim() ||
    email.split("@")[0];

  return {
    ok: true,
    value: {
      email,
      name,
      // Absent means active: RFC 7643 defaults it, and treating a missing flag
      // as inactive would deactivate everybody an IdP creates without one.
      active: body?.active === undefined ? true : body.active !== false,
      externalId: body?.externalId ? String(body.externalId) : null,
    },
  };
}

export interface PatchOutcome {
  active?: boolean;
  name?: string;
  email?: string;
  /** Operations understood but not supported, reported rather than ignored. */
  unsupported: string[];
}

/**
 * Apply a PATCH.
 *
 * Providers differ wildly here: Azure sends `{op:"Replace", path:"active"}`,
 * Okta sends `{op:"replace", value:{active:false}}`, others send the path in
 * mixed case or wrapped in a filter. All of those mean the same thing and all
 * of them must work, because the one that does not is the one that leaves a
 * leaver enabled.
 */
export function applyPatch(ops: any[]): PatchOutcome {
  const out: PatchOutcome = { unsupported: [] };

  for (const op of ops ?? []) {
    const kind = String(op?.op ?? "").toLowerCase();
    const path = String(op?.path ?? "").toLowerCase().replace(/\[.*?\]/g, "");
    const value = op?.value;

    if (kind !== "replace" && kind !== "add") {
      // A remove on `active` is not the same as deactivation and is rare
      // enough that guessing would be worse than saying so.
      out.unsupported.push(`${op?.op} ${op?.path ?? ""}`.trim());
      continue;
    }

    if (path === "active") {
      out.active = value === true || value === "True" || value === "true";
      continue;
    }
    if (path === "displayname") { out.name = String(value ?? "").trim() || undefined; continue; }
    if (path === "username") { out.email = String(value ?? "").trim().toLowerCase() || undefined; continue; }

    // Pathless replace: the whole patch body is an object of attributes.
    if (!path && value && typeof value === "object") {
      if ("active" in value) out.active = value.active !== false;
      if (value.displayName) out.name = String(value.displayName);
      if (value.userName) out.email = String(value.userName).toLowerCase();
      continue;
    }

    out.unsupported.push(`${op?.op} ${op?.path ?? "(no path)"}`);
  }

  return out;
}

export interface Filter { attribute: string; value: string }

/**
 * The one filter SCIM clients actually send: `userName eq "x"`.
 *
 * Implemented narrowly and on purpose. A half-built general filter parser
 * silently returns the wrong set for the expressions it does not understand,
 * and a provisioning system returning the wrong set of users is worse than one
 * that says it cannot answer.
 */
export function parseFilter(raw: string | null): Filter | null {
  if (!raw) return null;
  const m = raw.match(/^\s*(\w+)\s+eq\s+"([^"]*)"\s*$/i);
  return m ? { attribute: m[1].toLowerCase(), value: m[2] } : null;
}

export function listResponse(users: ScimUser[], startIndex = 1, total?: number) {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total ?? users.length,
    startIndex,
    itemsPerPage: users.length,
    Resources: users,
  };
}

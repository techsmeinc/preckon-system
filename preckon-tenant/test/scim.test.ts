// SCIM mapping.
//
// The tests that matter are about deprovisioning, because that is what SCIM is
// for and it is the operation that fails silently: an IdP sends a deactivation
// in a shape we do not understand, we answer 200, and the leaver keeps working
// access while the audit log records a successful deprovision.

import { describe, it, expect } from "vitest";
import {
  toScim, fromScim, applyPatch, parseFilter, listResponse, scimError,
  SCIM_USER_SCHEMA, type AppUser,
} from "@/lib/scim";

const user: AppUser = {
  id: "u1", email: "sam@cedarstone.build", name: "Sam Whitfield", status: "active",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("mapping out", () => {
  it("derives active from status rather than storing it twice", () => {
    expect(toScim(user, "https://x").active).toBe(true);
    expect(toScim({ ...user, status: "suspended" }, "https://x").active).toBe(false);
    expect(toScim({ ...user, status: "invited" }, "https://x").active).toBe(false);
  });

  it("splits a display name into given and family", () => {
    const s = toScim(user, "https://x");
    expect(s.name).toMatchObject({ givenName: "Sam", familyName: "Whitfield" });
    expect(s.userName).toBe("sam@cedarstone.build");
    expect(s.meta.location).toBe("https://x/scim/v2/Users/u1");
  });

  it("copes with a one-word name without inventing a surname", () => {
    expect(toScim({ ...user, name: "Cher" }, "https://x").name?.familyName).toBeUndefined();
  });
});

describe("mapping in", () => {
  it("treats an absent active flag as active", () => {
    // RFC 7643 defaults it. Reading absence as inactive would deactivate
    // everybody an IdP creates without the field.
    const r = fromScim({ userName: "a@b.com" });
    expect(r.ok && r.value.active).toBe(true);
  });

  it("prefers the primary email over userName", () => {
    const r = fromScim({
      userName: "login-name",
      emails: [{ value: "secondary@b.com" }, { value: "primary@b.com", primary: true }],
    });
    expect(r.ok && r.value.email).toBe("primary@b.com");
  });

  it("refuses a payload with no usable email", () => {
    const r = fromScim({ userName: "not-an-email" });
    expect(r.ok).toBe(false);
  });

  it("falls back through displayName, then name parts, then the local part", () => {
    expect((fromScim({ userName: "a@b.com", displayName: "Given Name" }) as any).value.name).toBe("Given Name");
    expect((fromScim({ userName: "a@b.com", name: { givenName: "A", familyName: "B" } }) as any).value.name).toBe("A B");
    expect((fromScim({ userName: "sam@b.com" }) as any).value.name).toBe("sam");
  });
});

describe("patch: every provider spells deactivation differently", () => {
  it("understands Azure's Replace with a path", () => {
    expect(applyPatch([{ op: "Replace", path: "active", value: false }]).active).toBe(false);
  });

  it("understands Okta's pathless replace with a value object", () => {
    expect(applyPatch([{ op: "replace", value: { active: false } }]).active).toBe(false);
  });

  it("understands a filtered path", () => {
    expect(applyPatch([{ op: "replace", path: 'active[value eq "x"]', value: false }]).active).toBe(false);
  });

  it("treats the string True as true, which some providers send", () => {
    expect(applyPatch([{ op: "replace", path: "active", value: "True" }]).active).toBe(true);
  });

  it("reports an operation it does not understand instead of silently succeeding", () => {
    // A silent 200 is recorded by the IdP as a deprovision that happened.
    const r = applyPatch([{ op: "remove", path: "active" }]);
    expect(r.active).toBeUndefined();
    expect(r.unsupported).toHaveLength(1);
  });

  it("carries a rename through", () => {
    const r = applyPatch([{ op: "replace", path: "displayName", value: "New Name" }]);
    expect(r.name).toBe("New Name");
  });
});

describe("filters", () => {
  it("parses the one filter providers actually send", () => {
    expect(parseFilter('userName eq "a@b.com"')).toEqual({ attribute: "username", value: "a@b.com" });
  });

  it("returns null for anything else rather than guessing", () => {
    // A half-parsed filter returns the wrong set, and a provisioning system
    // acting on the wrong set of users is worse than one that refuses.
    expect(parseFilter('userName sw "a"')).toBeNull();
    expect(parseFilter("active eq true")).toBeNull();
    expect(parseFilter(null)).toBeNull();
  });
});

describe("envelopes", () => {
  it("builds a list response in the shape a provider expects", () => {
    const r = listResponse([toScim(user, "https://x")], 1, 42);
    expect(r.schemas[0]).toMatch(/ListResponse/);
    expect(r.totalResults).toBe(42);
    expect(r.itemsPerPage).toBe(1);
    expect(r.Resources[0].schemas).toContain(SCIM_USER_SCHEMA);
  });

  it("builds an error in SCIM's shape, with status as a string", () => {
    const e = scimError(404, "No such user.");
    expect(e.status).toBe("404");
    expect(e.schemas[0]).toMatch(/Error/);
  });
});

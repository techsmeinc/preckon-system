// Cedar & Stone Builders — the demo tenant identity.
//
// Idempotent: run it as often as you like. It ensures the workspace name, brand
// accent and language, then creates the Cedar & Stone logins. It does NOT touch
// projects, the library or any artifacts — those come from seed-aigcc.mjs (the
// portfolio seed) or from real use.
//
//   node scripts/seed-cedarstone.mjs
//
// Env:
//   TENANT_URL               default http://localhost:3100
//   INTERNAL_SERVICE_TOKEN   must match the app's; default matches compose
//   BOOTSTRAP_OWNER / BOOTSTRAP_PASSWORD
//       An existing owner used only to authenticate the API calls. Defaults to
//       the Cedar & Stone owner this script creates, so a second run needs no
//       extra input. On a workspace that was first seeded as AIGCC, pass the
//       old owner once:  BOOTSTRAP_OWNER=owner@aigcc.group node scripts/…

const BASE = process.env.TENANT_URL ?? "http://localhost:3100";
const TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "change-me-service-token";

// Which workspace to seed. Two ids are in play across the demo stack:
//   …0000a1  the standalone workspace `seed-aigcc.mjs` creates (local default)
//   …000001  the one `preckon-host/scripts/seed-demo-tenant.mjs` registers, i.e.
//            the workspace the HOST plane actually manages and licenses
// Point this at …000001 when you want Host → Tenant to line up:
//   TENANT_ID=00000000-0000-7000-8000-000000000001 node scripts/seed-cedarstone.mjs
const TENANT = process.env.TENANT_ID ?? "00000000-0000-7000-8000-0000000000a1";

const WORKSPACE = "Cedar & Stone Builders";
const BRAND = "#15C2A8";
const LOCALE = process.env.WORKSPACE_LOCALE ?? "en"; // en | ar | fr

const OWNER = {
  email: "owner@cedarstone.build",
  name: "Sam Whitfield",
  password: process.env.OWNER_PASSWORD ?? "preckon-tenant-2026",
};

// Cedar & Stone's own people. Deliberately different names from the Host's
// staff logins (shruthi/pranavi @techsme.com): the Host operates the platform,
// the tenant is a customer, and a demo that shares names across the two planes
// makes it look like one directory when the whole point is that they're separate.
const USERS = [
  { email: "dana@cedarstone.build", name: "Dana Ashcroft", roleKeys: ["admin"], password: "preckon-2026" },
  { email: "riya@cedarstone.build", name: "Riya Kapoor", roleKeys: ["admin"], password: "preckon-2026" },
];

/** Emails to deactivate if present — earlier demo identities, kept out of the
 *  roster without destroying the audit history that references them. */
const RETIRE = ["shruthi@cedarstone.build", "pranavi@cedarstone.build"];

let cookie = "";
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", origin: BASE, cookie, ...(opts.headers || {}) },
  });
  const setc = res.headers.getSetCookie?.() ?? [];
  if (setc.length) cookie = setc.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const ok = (r) => r.status >= 200 && r.status < 300;

(async () => {
  console.log(`\nSeeding ${WORKSPACE} into ${BASE}\n${"=".repeat(58)}`);

  // 1) Ensure the tenant exists with the Cedar & Stone owner. Bootstrap is
  //    idempotent by tenant id, so on an existing workspace this is a no-op and
  //    the owner it names may already be someone else — hence step 2's fallback.
  const boot = await call(`/api/internal/tenants/${TENANT}/bootstrap`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      tenant_name: WORKSPACE,
      owner: { email: OWNER.email, name: OWNER.name, password: OWNER.password },
      edition_ref: "enterprise",
      domain_key: "construction",
      max_tier: "deep",
    }),
  });
  console.log(`tenant bootstrap → HTTP ${boot.status}`);

  // 2) Authenticate. Prefer the Cedar & Stone owner; fall back to whoever the
  //    workspace was originally bootstrapped with.
  const candidates = [
    { email: process.env.BOOTSTRAP_OWNER, password: process.env.BOOTSTRAP_PASSWORD ?? OWNER.password },
    { email: OWNER.email, password: OWNER.password },
    { email: "owner@aigcc.group", password: "preckon-tenant-2026" },
  ].filter((c) => c.email);

  let signedInAs = null;
  for (const c of candidates) {
    const r = await call("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify(c) });
    if (r.status === 200) { signedInAs = c.email; break; }
  }
  if (!signedInAs) {
    throw new Error(
      "Could not authenticate. Pass an existing owner:\n" +
      "  BOOTSTRAP_OWNER=owner@aigcc.group BOOTSTRAP_PASSWORD=preckon-tenant-2026 node scripts/seed-cedarstone.mjs"
    );
  }
  console.log(`signed in as ${signedInAs}`);

  // 3) Workspace identity: name, accent and default language (§7 tenant_theme).
  const theme = await call("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify({ workspaceName: WORKSPACE, brandColor: BRAND, locale: LOCALE }),
  });
  console.log(`workspace identity → HTTP ${theme.status}  (${WORKSPACE}, ${BRAND}, ${LOCALE})`);

  // 4) The Cedar & Stone logins. Creating a user is idempotent-ish: a duplicate
  //    email is rejected, which is exactly the "already present" case.
  const wanted = [{ ...OWNER, roleKeys: ["owner"] }, ...USERS];
  const existing = new Set(((await call("/api/v1/users")).body ?? []).map((u) => u.email));
  let added = 0;
  for (const u of wanted) {
    if (existing.has(u.email)) { console.log(`  · ${u.email.padEnd(30)} already present`); continue; }
    const r = await call("/api/v1/users", { method: "POST", body: JSON.stringify(u) });
    if (ok(r)) { added++; console.log(`  ✚ ${u.email.padEnd(30)} ${u.roleKeys.join(", ")}`); }
    else console.log(`  ✕ ${u.email.padEnd(30)} HTTP ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 90)}`);
  }
  console.log(`logins ensured (${added} added, ${wanted.length - added} already present)`);

  // 5) Retire superseded demo identities (suspend, never delete — the audit
  //    chain and existing artifacts still reference them).
  const roster = (await call("/api/v1/users")).body ?? [];
  for (const email of RETIRE) {
    const u = roster.find((x) => x.email === email);
    if (!u || u.status === "suspended") continue;
    const r = await call(`/api/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status: "suspended" }) });
    console.log(`  ⊘ ${email.padEnd(30)} ${ok(r) ? "deactivated" : `HTTP ${r.status}`}`);
  }

  console.log(`${"=".repeat(58)}`);
  console.log(`\n✅ ${WORKSPACE} ready at ${BASE}\n`);
  console.log(`   Owner   ${OWNER.email.padEnd(30)} ${OWNER.password}`);
  for (const u of USERS) console.log(`   Admin   ${u.email.padEnd(30)} ${u.password}`);
  console.log("");
})().catch((e) => { console.error("FATAL", e.message ?? e); process.exit(2); });

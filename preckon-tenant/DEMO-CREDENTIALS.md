# Preckon — Demo Logins (Tenant workspace)

The demo tenant is **Cedar & Stone Builders** (construction). Sign in at the
workspace (local: http://localhost:3100).
**Change these before any public/production use.**

| Name | Email | Password | Role |
|---|---|---|---|
| Sam Whitfield | `owner@cedarstone.build` | `preckon-tenant-2026` | Owner |
| Dana Ashcroft | `dana@cedarstone.build` | `preckon-2026` | Admin |
| Riya Kapoor | `riya@cedarstone.build` | `preckon-2026` | Admin |

> These are **tenant** logins — a customer's own team. The Host's staff logins
> (`shruthi@techsme.com`, `pranavi@techsme.com`) are a different plane and a
> different directory; the names are kept distinct on purpose.

Create or refresh them at any time — the script is idempotent and only touches
the workspace identity and these logins, never projects or artifacts:

```bash
cd preckon-tenant
node scripts/seed-cedarstone.mjs
```

It also sets the workspace name, brand accent and default language. Seed the
workspace in Arabic or French instead of English with:

```bash
WORKSPACE_LOCALE=ar node scripts/seed-cedarstone.mjs
```

## The portfolio seed (projects, library, pursuits)

The five demo projects, the rate book/standards library and the autopilot-run
pursuits come from a separate seed. It was written against an earlier demo
identity and still creates `@aigcc.group` team members:

```bash
node scripts/seed-aigcc.mjs          # portfolio + library
node scripts/seed-cedarstone.mjs     # then re-assert the Cedar & Stone identity
```

Run them in that order on a fresh database. The `@aigcc.group` accounts are
harmless but will show under **Admin → Team** — deactivate them there if you
want a clean roster for a demo.

> The Host control plane has its own operator logins — see
> `preckon-host/DEMO-CREDENTIALS.md`.

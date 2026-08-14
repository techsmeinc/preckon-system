# Preckon — Demo Logins (Tenant workspace)

The demo tenant is **Cedar & Stone Builders** (construction). Sign in at the
workspace (local: http://localhost:3100).

## Where the passwords are

**They are not in this file, and must not be added to it.** This repository is
the artefact that gets cloned onto servers and shared with reviewers; a password
committed here is a password in everyone's git history, on every clone, for as
long as the repo exists — and rotating it later does not remove it from history.

The seed reads the owner's password from `TENANT_OWNER_PASSWORD`, which the
compose file requires and refuses to default. Set it in `.env`:

```
TENANT_OWNER_PASSWORD=<something you generated, not something you typed>
```

Then seed:

```
docker compose --profile tools run --rm seed
```

The other demo accounts are created with the same value unless the seed is given
per-user overrides.

## The accounts

| Name | Email | Role |
|---|---|---|
| Sam Whitfield | `owner@cedarstone.build` | Owner |
| Dana Ashcroft | `dana@cedarstone.build` | Admin |
| Riya Kapoor | `riya@cedarstone.build` | Admin |
| Marcus Bell | `marcus@cedarstone.build` | Estimator |
| Priya Raman | `priya@cedarstone.build` | Reviewer |

## Before anything is publicly reachable

- Set `TENANT_OWNER_PASSWORD` to a generated value, per environment.
- Rotate `BETTER_AUTH_SECRET` and `INTERNAL_SERVICE_TOKEN`; both had known
  placeholder values in this repo's history.
- Change the database password from the compose default.
- Confirm `AUTH_SIGNIN_MAX` is at its default. It is raised only to run the e2e
  suite, and must never be raised on a public host.
- Confirm 3306/3308 (MySQL), 8081 (phpMyAdmin) and 4000 (worker) are not
  reachable from outside the host. The compose file binds them to 127.0.0.1, and
  phpMyAdmin now only starts under `--profile tools`, but a firewall rule is the
  thing that actually guarantees it.

# Preckon — Demo Logins (Host control plane)

Host staff sign in at the console (local: http://localhost:3000). Staff use the
operator domain `@techsme.com`. **Change these before any public/production use.**

| Name | Email | Password | Role |
|---|---|---|---|
| Platform Owner | `admin@techsme.com` | `preckon-admin-2026` | Owner |
| Shruthi | `shruthi@techsme.com` | `preckon-2026` | Admin |
| Pranavi | `pranavi@techsme.com` | `preckon-2026` | Admin |

Reproduce after a fresh DB:

```bash
docker compose up -d --build
docker compose run --rm seed        # owner + demo tenant registration
npm run seed:staff                  # Shruthi + Pranavi (Admin) — app must be up
```

`seed:staff` is idempotent (safe to re-run) and driven by `scripts/seed-staff.mjs`.

> The tenant workspace has its own logins — see `preckon-tenant/DEMO-CREDENTIALS.md`.

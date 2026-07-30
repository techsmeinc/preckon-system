# Preckon — Host Console (prototype)

The platform-operator console for Preckon: where TechSME defines the product (editions, features, pricing), manages every tenant, runs billing, and monitors the platform. This is the **Host** plane of the Host/Tenant model — separate from the tenant app your customers use.

Single self-contained file: **`preckon-host-console.html`** — built on the DS-01 design system, dark by default with a light toggle, mock data throughout, no build step.

## How to use it
Open the file, sign in (the form is prefilled — just click **Sign in**, or **Continue with SSO**). Navigate with the left sidebar or **⌘K**.

## Screens (11, all live)

| Group | Screen | What it does |
|---|---|---|
| Platform | **Overview** | KPIs, revenue + tenant-status charts, needs-attention, activity, system status |
| Platform | **Tenants** | Every org; filter/search; detail drawer with **audited impersonation**, suspend/restore; **create tenant** |
| Platform | **Subscriptions & billing** | Revenue KPIs (computed), invoices with retry/remind, billing health, subscription roster |
| Product | **Editions** | Plan cards + feature matrix; create/edit an edition (features, limits, trial) |
| Product | **Features** | Flag/limit catalog by category; edition membership pills; create/edit feature |
| Product | **Pricing** | Per-edition plan + usage rates; **live currency switcher** (USD/CAD/EUR/GBP/AED); coupons |
| Administration | **Host users & roles** | Staff table (role, status, 2FA); RBAC **permissions matrix**; **create custom roles** with presets |
| Operations | **Audit log** | Append-only, tamper-evident record of every host action; category filter |
| Operations | **Notifications** | Inbox + Sent tabs; bell dropdown with unread badge; **compose mass notifications** to tenants |
| Administration | **Host settings** | General, AI providers & routing, Email (provider + verified domain), security defaults, maintenance mode |
| Operations | **Observability** | Queue/worker health, throughput chart, AI provider health, failed-job diagnostics |

## Interactive (stateful in-session)
- Suspend/restore a tenant → the list and status counts update.
- Create a tenant → it appears at the top of the list.
- Send a broadcast → it lands in the Sent tab; recipient count in the toast.
- Read a notification / mark all read → bell badge and sidebar badge update.
- Switch currency on Pricing → every figure re-prices.
- Create a role from a preset → permission switches set themselves.

## Gap audit — what a complete host console needs, and status

Covered: auth/login, overview, tenant list + detail + **create** + suspend + impersonation (audited), editions, features, pricing (multi-currency), subscriptions + invoices + dunning, host users + RBAC + **custom roles**, audit log, notifications (inbox + broadcast), host settings (general, AI providers, email provider, security, maintenance), observability. ⌘K, theme toggle, responsive shell.

Deliberately **mock** (wire up on port):
- A newly created **edition** or **role** confirms via toast but doesn't yet render as a new column in its matrix — that needs the matrix to build from live state.
- Impersonation shows a toast; a real app also shows a persistent "impersonating" banner and switches session context.
- All "Save"/"Export"/"Retry"/"Send test" actions are front-end only.

## Email / SMTP decision (baked into Host settings → Email)
Preckon sends via a **transactional email provider** (Resend / Postmark / Amazon SES) — you store an **API key** (a secret: encrypt at rest, mask in UI, audit changes) plus a **verified sending domain** (SPF/DKIM/DMARC), **not** raw SMTP host/port/user/password. Raw **custom SMTP** is offered only as a **per-tenant Enterprise feature** (bring-your-own mail server), configured in the tenant app and gated by an edition feature flag — never stored in plaintext.

## Porting notes (Next.js / Turborepo `apps/host`)
- Serve on a **separate, hardened subdomain** (`host.preckon.com`), separate auth context from the tenant app.
- Each screen is registered in **three** places — the sidebar nav, a title map, and a render map. Encode these as one screen-registration object so a screen can't be half-wired (that was the one bug we hit).
- Replace mock arrays with API calls; wire Better Auth (host RBAC), the billing provider, the email provider, and Langfuse for observability.
- The commercial model is the contract: **Feature → Edition → Pricing → Subscription → feature-gated tenant app.** Persist these first; the tenant app reads from them.

*Built on DS-01. Dark-default control room. One file, eleven screens, one coherent commercial + operational model.*

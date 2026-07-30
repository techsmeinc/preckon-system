# Preckon Host — build conventions (read before adding routes/screens)

Stack: **Next.js 15 App Router (TS)** · **mysql2** (raw SQL, no ORM) · **Better Auth** (host IAM) · React screens reusing DS-01 (`src/app/globals.css`).

## API routes — pattern

All under `src/app/api/host/v1/...`. Every handler:

```ts
import { getAuthContext, requirePermission } from "@/lib/context";
import { handle, ok, list, parsePage, paginate, q, parseBody } from "@/lib/http";
import { useCase } from "@/lib/usecase";     // mutation + audit in ONE tx
import { queryOne, query } from "@/lib/db";
import { newId } from "@/lib/ids";
import { errNotFound, errConflict, errUnprocessable, errBadRequest } from "@/lib/errors";

export const GET = handle(async (req, { params }) => {
  const ctx = await getAuthContext(req);        // 401 if no session
  requirePermission(ctx, "some.permission");     // 403 if missing (§0.5)
  ...
  return ok(resource);                           // or list(rows, nextCursor)
});
```

Rules:
- **Never** write a mutation without an audit event. Do writes inside `useCase(ctx, async (conn, audit) => { ...; audit({action,targetType,targetId,targetTenantId?,summary,metadata}); })`. Steps 4+5 commit together (§0.4).
- Reads use `query`/`queryOne` (pool). Mutations use the `conn` inside `useCase`.
- **Permission key per endpoint** is mandatory — see the §1.3 catalog / each domain section of `Preckon/host/back end technical design files/preckon-host-backend-design.md`.
- List endpoints: cursor pagination. `const {limit,cursor}=parsePage(req)`, add `id < cursor` when cursor present, `ORDER BY id DESC LIMIT limit+1`, then `paginate(rows,limit,r=>r.id)` → `list(data,nextCursor)`.
- Errors: throw the `err*` helpers; `handle()` renders the §0.5 envelope. Status map: 400/401/403/404/409/422/429/500.
- Money is integer minor units (BIGINT). Timestamps are UTC DATETIME(3).
- Cross-plane (tenant-directed) audit events set `targetTenantId`.
- Dynamic route params are a Promise in Next 15: `{ params }: { params: Promise<{id:string}> }`, `const {id}=await params`.
- `/internal/*` endpoints use `requireServiceAuth(req)` instead of a host session.
- Idempotent creators wrap in `withIdempotency(req, "POST /route", ctx.user.id, async()=>{...})` and 400 if the header is missing when the spec says "required".

## Reference implementations already written
- `me/route.ts`, `tenants/route.ts`, `tenants/[id]/route.ts`, `tenants/[id]/suspend|restore/route.ts`.

## Frontend — pattern
- Screens are client components under `src/app/(console)/<screen>/page.tsx` inside a shared shell (`src/app/(console)/layout.tsx`) that renders the DS-01 sidebar/topbar. Use `@/lib/api` (`api.get/post/...`) for data and the exact class names from `globals.css` (`.kpis`, `.card`, `.tbl`, `.badge`, `.btn`, etc — copy structure from `preckon-host-console.html`).
- Login page at `src/app/page.tsx` uses `@/lib/auth-client` (`signIn.email`). On success route to `/overview`.
- Theme toggle writes `localStorage["preckon-host-theme"]` and sets `document.documentElement[data-theme]`.

## The commercial model (the contract the tenant plane reads)
Feature (catalog) → Edition (+limits) → Pricing → Subscription → resolved **Entitlements** (§5, `tenant_entitlement_resolved` view + `/internal/entitlements/{tenant_id}`).

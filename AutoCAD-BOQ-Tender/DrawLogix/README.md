# DrawLogix — standalone Concept Studio

A **fully independent** Next.js app (no `@ci/*` dependency) that rebuilds the DrawLogix
drawing-lifecycle module: paste an SOW / client brief → extract structured requirements
→ generate a concept floor-plan (viewable **SVG** + downloadable **DXF**) + an area
schedule, all riding the artifact lifecycle, with an AI-style copilot to tweak the plan.

It runs on **port 3001** and connects to the **same `construction_intelligence` MariaDB**
as the platform, using the surviving `drawing_*` tables. No login — a dev **org selector**
sets the tenant; every query is still org-scoped (`withTenant`).

## Run

```bash
cd DrawLogix
npm install          # self-contained node_modules (independent of the pnpm workspace)
npm run dev          # http://localhost:3001
```

Make sure MariaDB (XAMPP) is running and the `construction_intelligence` DB exists with at
least one row in `orgs`. Connection string is in `.env.local` (`DATABASE_URL`).

## Concept generation
Rule-based — **no API key required**. `src/domain/concept.ts` extracts requirements from the
pasted text, derives an area schedule (keyword→room, or a default office programme), and
renders the same layout as SVG and DXF. Swap in a real LLM later behind `generateConcept()`.

## Layout
```
app/                 routes (projects list, project detail, /api export routes)
src/db/              schema (drawing_*), pooled client, withTenant tenant scoping
src/domain/          projects, documents, concept, generate, lifecycle, copilot
src/ui/              self-contained components + tokens
src/server/actions   server actions (BFF edge)
```

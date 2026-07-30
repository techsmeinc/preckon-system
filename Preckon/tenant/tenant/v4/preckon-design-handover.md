# Preckon — Design Handover (Backend Engineering)

**For:** the senior backend developer picking up implementation.
**From:** the platform design work. Everything referenced below is in the deliverables folder.
**One-line status:** the design is complete, internally consistent, and validated. It is ready to build. Start at the walking-skeleton build plan (§6).

---

## 1. Status — and two honest caveats

The platform is fully specified: a domain-neutral **Core** (framework v1.2), a complete first product (**construction pack** v1.1) including tender management, a **second pack** (underwriting) that proves a new vertical needs no Core change, the frontend data path, the Host seam, per-agent implementation specs for the first build slice, and a ticketed build plan.

Two things are **deferred by design, not missing** — neither blocks the first build:

1. **Per-agent full specs (Doc 2) are complete only for the three walking-skeleton agents** (Document, Tender, BOQ). The other agents are tabulated (job_type, tier, I/O, tools, confidence signals) and are meant to be authored in full *as each workflow is built* — you don't need them for Milestone 1, and writing them ahead of the workflow they serve would be speculative.
2. **The Host doc touch-up is a patch, not applied.** `preckon-host-spec-touchup.md` specifies a small, validated change to `preckon-host-backend-design.md` (which lives in the Host workstream, not this folder). Apply it there, or it can be integrated when that doc is on hand. Nothing in Core or the packs depends on it except the app's module-nav display.

Everything else is done.

---

## 2. Reading order (new-developer path)

1. **Framework** — `preckon-tenant-platform-design.md` (v1.2). The engine. Read §0 (conventions), §S (the walking skeleton — this is what you build first), then the keystones §2 (artifact store), §3 (Agent ABI), §4 (workflow runtime). Then §5 (orchestration), §1.6 (project lifecycle), §6/§6.4 (orchestrator + personas), §8 (entitlements).
2. **Build plan** — `preckon-walking-skeleton-build-plan.md` + `preckon-walking-skeleton-tickets.csv`. **The execution path — start here for coding.** 27 tickets, 8 epics, 3 milestones.
3. **Doc 2** — `preckon-doc2-agent-specs.md`. How agents are implemented; §2 fully specs the three skeleton agents you'll build.
4. **Construction pack** — `preckon-construction-pack-design.md` (v1.1). The first product: its agents, workflows, artifact types (with JSON Schemas), personas, and the bid-pursuit lifecycle.
5. **Frontend** — `preckon-frontend-integration.md` + `preckon-workspace-layer.tsx`. The shell's canonical data path (real endpoints, no synthetic manifest).
6. **Host** — `preckon-host-spec-touchup.md`. Apply to the Host doc.
7. **Diagrams** — `preckon-diagrams.drawio` (construction) + `preckon-underwriting-diagrams.drawio`. Visual reference; open in draw.io.
8. **Underwriting pack** — `preckon-underwriting-pack-design.md` (v1.0). Context, not a build target: the proof the abstraction generalizes.

---

## 3. Artifact index (with status)

**Canonical (build against these):**

| File | What |
|---|---|
| `preckon-tenant-platform-design.md` / `.docx` | **Core / framework, v1.2** — the engine. Domain-neutral. |
| `preckon-construction-pack-design.md` / `.docx` | **Construction pack, v1.1** — the first product (incl. tender management). |
| `preckon-underwriting-pack-design.md` / `.docx` | **Underwriting pack, v1.0** — proof a 2nd vertical needs no Core change. |

**Supporting (build inputs & references):**

| File | What |
|---|---|
| `preckon-walking-skeleton-build-plan.md` | The M1→M3 plan. **Coding starts here.** |
| `preckon-walking-skeleton-tickets.csv` | The 27 tickets (import to a tracker). |
| `preckon-doc2-agent-specs.md` | Agent implementation contract + the 3 skeleton agents in full. |
| `preckon-frontend-integration.md` | Canonical shell rendering (endpoints → surfaces). |
| `preckon-workspace-layer.tsx` | Realigned frontend data layer (typechecked). |
| `preckon-host-spec-touchup.md` | Patch to apply to the Host doc. |
| `preckon-tender-management-design.md` | The design spec the bid-pursuit lifecycle was built from. |
| `preckon-diagrams.drawio` | Construction diagrams (lifecycle, workflows, provenance). |
| `preckon-underwriting-diagrams.drawio` | Underwriting diagrams (same set). |

**Superseded — delete / ignore (kept only as pointer stubs):**

| File | Why |
|---|---|
| `preckon-backend-design-section-D.md` | alternate §D (pack_* tables) — not canonical; see the framework's §D. |
| `preckon-workspace-manifest-endpoint.ts` | built on the non-canonical §D. |
| `preckon-manifest-layer.tsx` | replaced by `preckon-workspace-layer.tsx`. |
| `preckon-tenant-platform-appendices.md` | mis-scoped early appendices; superseded by the doc's own §X/glossary/appendices. |
| `preckon-construction-pack-agents.md` | the agent roster is now Appendix A of the construction deck; redundant. |

**Not in this folder (other workstream):** `preckon-host-backend-design.md` (the Host control plane) — needed to apply the touch-up.

---

## 4. What's been validated (why you can trust it)

Not asserted — executed:

- **Framework SQL:** 116/116 statements parse (sqlglot, Postgres dialect); the **full schema executes clean on PostgreSQL 16 + pgvector** — 32 tables, RLS on 18, 3 views, indexes, the `vector(1024)` column + hnsw index, and the re-plan recursive CTE.
- **Every workflow DAG** (construction: 12, underwriting: 8): parses, acyclic, agents/types resolve, gates fire on upstream-produced types.
- **Every artifact-type schema** (construction: 16, underwriting: 10): valid JSON Schema, with positive/negative examples passing/rejecting.
- **Manifests reconcile:** the agents/types/workflows/personas arrays match the appendices exactly, all namespaced.
- **Doc 2 example outputs validate against the pack schemas** — the agent specs and the types agree.
- **Both packs add zero Core DDL** (no `create/alter table`) — the "same Core, second vertical" proof.
- **Word builds pass XSD validation**; **frontend TS typechecks under `strict`**; **diagrams are well-formed** with no dangling edges.

---

## 5. Stack & repo foundation

**Canonical stack (fixed by the design):** Turborepo · Next.js 15 / Tailwind / shadcn · FastAPI + arq/Redis (worker) · Drizzle ORM (UUIDv7 PKs) · PostgreSQL 16 + pgvector (RLS) · Better Auth · MinIO/R2 (presigned) · Voyage (embeddings) · Claude **Opus** (deep) / **Haiku** (routing) · Langfuse.

**Foundation to build on:** `github.com/techsmeinc/tenderlogix` @ `v0.1.0-foundation` — monorepo, Docker Compose (Postgres+pgvector, Redis, MinIO), Better Auth + RBAC scaffold, FastAPI/arq shell, CI. The build plan (§3 of it) lists what exists vs. what the skeleton adds.

---

## 6. Where to start: Milestone 1 (kernel proof, no LLM)

The build plan's discipline, and the single most important instruction for the build: **prove the deterministic kernel with a *stub* agent before adding any LLM.**

M1 = the store (Epic A), the four syscalls + runtime + gate/resume/stale (Epic B), the job seam + a stub agent (Epic C), the minimal API (Epic F), and the RLS + e2e tests (Epic H1/H3) — **17 of the 27 tickets.** Its exit condition: the full run → gate → confirm → BOQ → gate → edit → stale → re-run → supersede loop passes an automated test with a fixed stub output, and RLS isolation holds — all without one model call. Only then (M2) do the real agents go in.

Why: gate-resume atomicity, stale propagation, and job idempotency are the genuinely hard logic. Debugging them alongside a nondeterministic LLM is the trap the sequencing avoids.

---

## 7. Open items & deferrals (nothing hidden)

1. **Remaining agent specs (Doc 2 §3/§4)** — author in full per workflow, as each Logix / underwriting workflow is built. The three skeleton agents are done.
2. **Apply the Host touch-up** to `preckon-host-backend-design.md` (Host workstream).
3. **Delete the five superseded files** (§3).
4. **The frontend layer runs after M1** — `preckon-workspace-layer.tsx` typechecks but has no backend to hit until the API exists.

Decisions already settled (so they're not re-litigated): the canonical §D is the single `domain` table + JSONB manifest (not the retired `pack_*` cluster); the project lifecycle is generic on Core with the machine as pack data; `bid.approve` / `uw.authorize` are tenant-plane pack permissions, not Host entitlements; modules are Host-catalog capabilities gated by entitlements.

---

## 8. The one rule that protects the architecture

Core is **domain-neutral and frozen**; every domain is **data** (a pack). Two packs — construction and underwriting — prove it, and both add zero Core surface. When building, hold that line: if a pack ever seems to need a new Core table, endpoint, or syscall, that is a **design smell to raise**, not a quick fix to merge. The value of the whole platform is that the tenth vertical costs the same as the second — a pack, not a rewrite.

---

*The design is finished and self-proving. Hand this document to your developer as the entry point; the build plan is the map from here.*

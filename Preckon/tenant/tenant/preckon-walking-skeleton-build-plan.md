# Preckon — Walking Skeleton (§S) — Build Plan

**Status:** build plan (design artifact, no code). Scopes the framework's **§S walking skeleton** into buildable tickets against the existing `tenderlogix` repo foundation (`v0.1.0-foundation`).
**Traces to:** `preckon-tenant-platform-design.md` v1.2 (§S, §2, §3, §4, §5, §7) · `preckon-construction-pack-design.md` v1.1 (Appendix A/B, B.1).

---

## 1. Why this slice

The §S slice is the thinnest thing that runs Core **end to end**, and the whole framework was shaped around it. Building it exercises — and thereby proves against reality — the four ABI syscalls, the artifact store (versioning · provenance · stale propagation), the run table (agent step → gate → resume-on-confirm), RLS, the TS↔Python job seam, and the human-in-the-loop gate. Ship this before the surface grows, so the design meets code while it's still cheap to change.

**The slice (§S):** upload one tender PDF → **Document** classifies → **Tender** proposes a `tender_summary` → *gate* (human confirms) → **BOQ** proposes 2–3 `boq_line`s → *gate* → **re-plan** (edit the summary → BOQ lines go stale → re-run supersedes them). This is `workflow.tenderlogix.skeleton` (pack Appendix B.1).

---

## 2. Scope

**In:** 3 artifact types (`document`, `tender_summary`, `boq_line`) · 3 agents (Document, Tender, BOQ) · 1 workflow (the skeleton) · the 4 syscalls · the deterministic runtime with one gate + resume · stale/re-run · RLS · file upload + text extraction · the job seam · a minimal review UI.

**Out (deliberately deferred):** the other six Logix and BidAssembly/lifecycle (tender management, §2 of the pack) · personas beyond the default · entitlement *enforcement* (stubbed to "all licensed") · pgvector retrieval / OCR / embeddings (text extraction only) · the Host plane, billing, provisioning · white-label. Auth is one seeded tenant + one seeded user.

---

## 3. What exists vs. what this adds

**Exists (`v0.1.0-foundation`):** Turborepo monorepo · Next.js 15 / Tailwind / shadcn · FastAPI + arq worker shell · Docker Compose (Postgres 16 + pgvector, Redis, MinIO) · Better Auth + hybrid RBAC scaffold · Biome/Husky · GitHub Actions · `CLAUDE.md`.

**This adds:** the Core **kernel** (store + ABI + deterministic runtime + audit spine) · the **job seam** (JobEnvelope/JobResult, Redis tier lanes, `/internal` callback) · the **3 agents** in the worker · file ingestion (text only) · the slice's API + review UI · the e2e/RLS/eval proofs.

**Canonical stack (fixed):** Drizzle (UUIDv7 PKs) · Postgres 16 RLS · arq/Redis · MinIO/R2 (presigned) · Voyage (deferred here) · Claude **Opus** (deep) / **Haiku** (routing) · Langfuse.

---

## 4. Epics → tickets

Sizes: **S** ≈ ≤0.5d, **M** ≈ 1–2d, **L** ≈ 3–4d. Each ticket's acceptance ties back to a framework guarantee.

### Epic A — Store & schema (the filesystem) · §2, §4
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-A1 | Drizzle migrations for the 10 skeleton tables + enums (already SQL-validated) | M | tables create clean; UUIDv7 PKs; money integer minor units |
| WS-A2 | RLS policies + `withTenant()` scoped repo + 3-part isolation test | M | cross-tenant read returns 0 rows; test in CI |
| WS-A3 | Seed 3 artifact types (`document` non-reviewable) + `workflow.tenderlogix.skeleton` definition | S | resolver accepts the DAG; seed idempotent |
| WS-A4 | `review_queue` view + `markDownstreamStale()` (the validated recursive CTE) | S | editing an upstream artifact marks the transitive downstream `stale` |

### Epic B — ABI & runtime (the kernel) · §3, §4
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-B1 | `AgentContext` + the four syscalls (trusted TS): `emitArtifact` (provenance+scope+confidence+audit), `readArtifacts` (confirmed-only, project-scoped), `requestReview` (auto-accept ≥ threshold), `enqueueJob` (dispatch half) | L | an agent can touch only these; scope is unforgeable |
| WS-B2 | Deterministic runtime: materialize a step per node, dispatch ready agent steps, **gate → `awaiting_review`**, resume-on-confirm, terminal states | L | run pauses at the gate; confirming the last gated artifact resumes |
| WS-B3 | Canonical use-case skeleton (validate→authorize→tenant-scope→work→audit) + append-only hash-chained audit for the slice | M | every mutation audited; chain verifies |
| WS-B4 | `rerunStale(runId)` — re-execute only stale-producing steps, superseding outputs | M | edit summary → re-run → new `boq_line` versions, old superseded |

### Epic C — The job seam (TS↔Python) · §5
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-C1 | `enqueueJob` writes `ai_job` (`queued`) + pushes JobEnvelope to a Redis tier lane | M | envelope carries inlined input artifacts; worker never reads the store |
| WS-C2 | arq worker: consume envelope → resolve tier→model (Opus/Haiku, config) → Langfuse trace → return JobResult | M | tier lanes isolate slow `deep` from fast `routing` |
| WS-C3 | `POST /internal/jobs/{id}/result` (service auth, idempotent by `job_id`) → `onJobResult` → materialize outputs via `emitArtifact` → advance step | M | re-delivering a result is a no-op; outputs land as proposals |
| WS-C4 | **Stub agent** (no LLM) behind the seam emitting a fixed `tender_summary` — the M1 kernel proof | S | full run/gate/confirm/stale works with zero AI |

### Epic D — The three agents (userland, worker) · §S, §5.6, §7.4
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-D1 | Document Agent — classify/split page text → `document` proposals (non-reviewable); Haiku | M | a multi-doc PDF splits into typed `document`s, auto-confirmed |
| WS-D2 | Tender Agent — `document` → one `tender_summary` (deadline, format, one mandatory requirement) + confidence; Opus | M | emits a schema-valid `tender_summary` proposal with provenance |
| WS-D3 | BOQ Agent — confirmed `tender_summary` → 2–3 `boq_line` + confidence + provenance; Opus | M | lines provenance-linked to the summary |
| WS-D4 | Prompt refs (Langfuse) + per-job confidence functions + auto-accept wiring | S | confidence computed by the worker, not lifted from prose |

### Epic E — Ingestion & storage · §7.1–7.2
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-E1 | `POST /projects/{pid}/files` (presigned MinIO PUT) + `/files/{id}/complete` (checksum → `uploaded` → enqueue ingestion) | M | Core never proxies bytes; checksum verified |
| WS-E2 | Ingestion job (non-LLM): per-page native text → `file_page` → `ingested` (idempotent) | M | `file.status` tracks; no separate job table (OCR/embeddings deferred) |

### Epic F — API surface · §2.6, §4.6, §1
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-F1 | Run endpoints: `POST /projects/{pid}/runs` (start skeleton), `GET …/runs/{rid}`, cancel — permission-gated + audit | M | `workflow.run` required; run + steps readable |
| WS-F2 | Artifact ops: `GET artifacts` / `review-queue`, `confirm`, `reject`, `PATCH` (edit→supersede→stale), `rerun-stale` | M | confirm resumes a paused run; edit re-plans |
| WS-F3 | Seed one tenant + one user (Better Auth) + the estimator role preset + permission-catalog subset | S | the seeded user can drive the whole slice |

### Epic G — Frontend slice · workspace-layer, §2.5
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-G1 | Upload + start-run screen (Next.js/shadcn) | M | drop a PDF, start the run |
| WS-G2 | Review queue: pending `tender_summary`/`boq_line`, confirm/edit — via the canonical workspace layer subset | M | confirm advances the run; edit supersedes |
| WS-G3 | Run view: step status, `awaiting_review`, stale badges + re-run | M | the gate and stale state are visible |

### Epic H — Proof: tests & the eval gate · §S, CI
| ID | Ticket | Size | Acceptance |
|---|---|---|---|
| WS-H1 | E2E test driving all 7 §S steps; asserts gate pause/resume, provenance, stale propagation, supersede | L | green on CI |
| WS-H2 | Agent eval harness: golden tender PDFs → expected fields; thresholds; **CI eval gate** | M | a regression below threshold fails the build |
| WS-H3 | RLS isolation test + trust-boundary test (worker cannot write the store) | S | both green in CI |

---

## 5. Sequencing — prove the kernel before the AI

The walking-skeleton discipline: get the thinnest thing running end to end, then thicken. Critically, **prove the deterministic runtime with a stub agent before adding LLM nondeterminism** — otherwise you debug the kernel and the model at once.

- **Milestone 1 — Kernel proof (no AI).** A → B → C1–C3 → **C4 (stub agent)** → F → H1 (partial) + H3. *Exit:* the full run/gate/confirm/stale/supersede machinery works against a fixed stub output, RLS isolation passes. This is the riskiest logic, de-risked without a single LLM call.
- **Milestone 2 — Real agents.** E (ingestion) → D (Document/Tender/BOQ) → swap the stub for the real seam. *Exit:* a real PDF flows upload → LLM → proposals → gate → BOQ → gate → re-plan.
- **Milestone 3 — UX + eval.** G (review UI) → H2 (eval gate). *Exit:* a human drives the slice in the browser; the eval gate guards the three agents.

Dependency spine: `A → B → C → (D ‖ E) → F → G → H`, with C4/H at the M1 checkpoint.

---

## 6. Definition of done

The slice is done when, in CI:
1. An automated e2e drives the **7 §S steps** and passes.
2. All **four syscalls** are exercised; **provenance**, **stale propagation**, and **supersede** are asserted.
3. The **gate** pauses the run (`awaiting_review`) and a confirm **resumes** it.
4. The **RLS isolation** test and the **worker-cannot-write** trust-boundary test pass.
5. The **eval gate** is green for Document/Tender/BOQ.

At that point the ABI is proven against reality, and thickening to the full pack (the other Logix, personas, the bid-pursuit lifecycle) is additive — registry rows and pack data, no kernel change.

---

## 7. Risks & how the design already de-risks them

- **Gate-resume atomicity** — confirming the last gated artifact must resume exactly once. *Mitigation:* WS-B2 resume is idempotent; H1 asserts single-resume.
- **Stale propagation correctness** — the transitive walk. *Mitigation:* the recursive CTE is already SQL-validated (framework §2.4); WS-A4 + H1 assert it.
- **Job idempotency** — duplicate `/internal` callbacks. *Mitigation:* idempotent by `job_id` (WS-C3).
- **Trust boundary** — the worker must not touch the store. *Mitigation:* worker gets no DB handle; H3 asserts it.
- **LLM nondeterminism** — flaky agents. *Mitigation:* confidence functions + auto-accept threshold (WS-D4); eval gate on goldens (WS-H2); the kernel is proven on a stub first (M1).

---

## 8. Rough sizing

~24 tickets across 8 epics: ~4×L, ~14×M, ~6×S. For one focused engineer, roughly **5–7 weeks** to DoD (M1 ~2 wks, M2 ~2–3 wks, M3 ~1–2 wks); parallelizable across two (kernel/store vs. worker/agents) to ~3–4 weeks. Rough — treat the milestones, not the calendar, as the plan.

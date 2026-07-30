# Preckon — Doc 2: Agent Implementation Specs

**Status:** the layer between "I/O-typed" (pack Appendix A) and "buildable." Concentrated detail on the three **skeleton** agents (`document`, `tender`, `boq`) that the walking-skeleton build needs (WS-D); a shared contract so all 19 stay consistent; compact specs for the rest.
**Traces to:** framework §3 (ABI), §5 (orchestration, JobEnvelope/JobResult, tiers, confidence), §7.4 (document/knowledge seam), §6 (supervisors) · pack Appendix A (roster), C.2 (payload schemas).

---

## §0 — The agent implementation contract

Every worker agent is the **same shape** (§5.1): stateless Python/arq, no store access. Core assembles a **JobEnvelope**, the worker reasons and calls tools, and returns a **JobResult** of *proposed* outputs; Core validates each output against the `artifact_type.payload_schema` and materializes it via `emitArtifact`. So a spec is complete when it fixes six things:

1. **`job_type` + tier + `prompt_ref`.** The declared job (in `agent.job_types`), its default AI tier (`routing`→Haiku · `standard`→Sonnet · `deep`→Opus, §5.5), and the versioned Langfuse prompt id (`<job_type>@vN`).
2. **Envelope inputs.** Which confirmed artifacts Core inlines (the agent's `consumes`), plus any `params`. **Content-reading agents** (`tender`, `specification`, `drawing`) also get the referenced `file_page` **text inlined** — a `document` artifact carries `file_id` + `page_range`, not the text, and the worker has no store access, so Core resolves and inlines the text as `params.source_text`.
3. **Tool bindings.** Always an `emit_<type>` structured-output tool per `produces` type, **schema-constrained** to the C.2 payload schema (the model cannot emit an invalid payload). Plus shared tools where declared: `knowledge_search` (calls the Knowledge service, §7.4), domain calculators.
4. **Output contract.** The `produces` type(s), whether reviewable, and provenance (which input artifact ids each output derives from — Core writes the edges).
5. **Confidence function.** A worker-computed score in [0,1] per output (§5.6, §1 below) — never lifted from model prose.
6. **Failure semantics.** Malformed output (fails schema) or `status:failed` → step retry (`max_attempts`, §5.7); exhausted → step/run `failed`, surfaced.

**The JobEnvelope / JobResult shapes are fixed by §5.2** — a spec only fills `job_type`, the inlined `inputs`, and `prompt_ref`; the JobResult only varies in its `outputs[]` types.

---

## §1 — The confidence function (shared recipe, §5.6)

Confidence gates auto-accept (§2.5): `≥ tenant threshold` → confirmed without a human; else → the review queue. It is **computed by the worker**, per output, as a normalized blend of:

- **Completeness** `c` — required schema fields present and grounded (not guessed). Missing/inferred required field → sharp penalty.
- **Grounding** `g` — each claim traceable to inlined source (a page cite / input artifact). Ungrounded assertion → penalty.
- **Agreement** `a` — validator/tool agreement (e.g. a quantity re-derived by a tool matches; a rate found in the rate book). Absent for some agents.
- **Model certainty** `m` — the model's self-reported certainty for the extraction, capped so it can't dominate.

`confidence = normalize(w_c·c + w_g·g + w_a·a + w_m·m)`, weights per `job_type`. Calibration (were high-confidence proposals actually right?) is a **Memory/flywheel** concern (§M): confirm/reject history re-tunes weights and the recommended threshold. Non-reviewable types (`document`) skip this.

---

## §2 — Skeleton agents (full specs)

### §2.1 Document Agent — `agent.document`

The chain's entry; the **only** agent whose input is not confirmed artifacts.

| | |
|---|---|
| `job_type` / tier / prompt | `document.classify_split` · **standard** · `document.classify_split@v1` |
| Envelope inputs | `params`: `{ file_id, pages: [{ page_no, text }] }` (Core inlines the ingested `file_page` text; no artifacts) |
| Tools | `emit_document` (→ `document` schema) |
| Output | `document[]` — one per classified section; **non-reviewable** (`is_reviewable=false`) → auto-confirmed on emit; provenance `[]` (derives from a file, not an artifact) |
| Confidence | classification certainty (informational; non-reviewable) |

**Prompt spec:** *You classify and split an uploaded construction file into documents.* For each contiguous run of pages, assign a `doc_type` from `{drawing, specification, tender_letter, addendum, boq, schedule, other}` and a `page_range`; emit one `document` per run via `emit_document`. Ground the split in the page text (headers, sheet borders, section titles). The classification vocabulary is domain data — Core knows none of it.

**JobResult (example):**
```jsonc
{ "job_id":"…","status":"succeeded",
  "outputs":[ { "type":"document",
    "payload":{ "file_id":"…","doc_type":"tender_letter","title":"Invitation to Tender","page_range":[1,3] },
    "provenance":[] } ],
  "usage":{…}, "trace_id":"lf_…" }
```

### §2.2 Tender Agent — `agent.tender`

Extracts the bid scope. The skeleton's proposal step.

| | |
|---|---|
| `job_type` / tier / prompt | `tender.extract_summary` · **deep** · `tender.extract_summary@v3` |
| Envelope inputs | `artifacts`: confirmed `document`s (`consumes: [document]`); `params.source_text`: the referenced `file_page` text |
| Tools | `emit_tender_summary` (→ `tender_summary` schema); `knowledge_search` (optional precedent) |
| Output | **one** `tender_summary` — reviewable proposal; provenance → the `document` ids |
| Confidence | `w_c` heavy: all three required fields (`submission_deadline`, `submission_format`, ≥1 `mandatory_requirements`) found **and page-cited**; `g` per field; `m` capped |

**Prompt spec:** *From the tender documents, extract the submission scope.* Produce exactly one `tender_summary`: `submission_deadline` (ISO), `submission_format`, and the `mandatory_requirements[]` (each `{ref, text}`), plus `project_name`/`client`/`scope_summary` when present. Ground every field in the inlined text; do not infer a deadline that isn't stated (leave the field and lower confidence instead). Emit via `emit_tender_summary`.

**JobResult (example):**
```jsonc
{ "job_id":"…","status":"succeeded",
  "outputs":[ { "type":"tender_summary",
    "payload":{ "submission_deadline":"2026-08-01T17:00:00Z","submission_format":"PDF via portal",
                "project_name":"Riverside Depot","mandatory_requirements":[{"ref":"3.1","text":"ISO 9001 certification"}] },
    "provenance":["<document id>"], "confidence":0.91 } ],
  "usage":{…}, "trace_id":"lf_…" }
```

### §2.3 BOQ Agent — `agent.boq`

Derives priced-scope lines. Shared by TenderLogix-skeleton (from the summary) and QuantLogix (from measurements + clauses).

| | |
|---|---|
| `job_type` / tier / prompt | `boq.derive_lines` · **deep** · `boq.derive_lines@v2` |
| Envelope inputs | `artifacts`: confirmed `tender_summary` (skeleton); in QuantLogix also `drawing_measurement` + `spec_clause` |
| Tools | `emit_boq_line` (→ `boq_line` schema); `standards_lookup` (units / classification / company descriptions); `knowledge_search` (precedent lines) |
| Output | 2–3 `boq_line` (skeleton) — reviewable; provenance → the `tender_summary` (and measurements/clauses in QuantLogix) |
| Confidence | per line: scope coverage `c`, unit sanity + precedent match `a`, grounding `g` |

**Prompt spec:** *From the confirmed scope, derive the bill-of-quantities lines.* For the skeleton, produce 2–3 `boq_line`s (`code`, `description`, `quantity`, `unit`, `trade`) that a quantity surveyor would recognise, grounded in the `tender_summary` scope; call `knowledge_search` for standard descriptions/precedent before proposing. Emit each via `emit_boq_line`.

**JobResult (example):**
```jsonc
{ "job_id":"…","status":"succeeded",
  "outputs":[
    { "type":"boq_line","payload":{ "code":"C20.10","description":"Reinforced concrete slab, 200mm","quantity":320.5,"unit":"m3","trade":"Concrete" },
      "provenance":["<tender_summary id>"],"confidence":0.84 },
    { "type":"boq_line","payload":{ "code":"E10.05","description":"Main LV distribution board","quantity":1,"unit":"nr","trade":"Electrical" },
      "provenance":["<tender_summary id>"],"confidence":0.79 } ],
  "usage":{…}, "trace_id":"lf_…" }
```

---

## §3 — Remaining workers (compact)

Same contract (§0). Full specs are authored as each workflow is built; this fixes the buildable parameters now.

| Agent | `job_type` (tier) | Envelope inputs | Tools (+ `emit_<type>`) | Output · confidence signals |
|---|---|---|---|---|
| `specification` | `spec.extract_clauses` (deep) | `document` + `source_text` | knowledge_search | `spec_clause[]` · completeness, page-grounding |
| `drawing` | `drawing.index` (standard), `drawing.takeoff` (deep) | `document` + page **rasters** | measure (geometry) | `drawing_index`, `drawing_measurement` · tool-vs-model agreement on quantities |
| `cost` | `cost.price_lines` (deep) | `boq_line` + Library `rate_book` | rate_lookup | `cost_line` · rate found in book (`a`), math check (amount = qty×rate) |
| `schedule` | `schedule.build_programme` (deep) | `boq_line`, `cost_line` | — | `schedule_activity` · dependency validity, duration sanity |
| `procurement` | `procure.build_packages` (standard) | `boq_line`, `cost_line` | — | `procurement_package` · trade grouping coverage |
| `rfi` | `rfi.detect` (standard) | `tender_summary`, `spec_clause`, `drawing_measurement` | — | `rfi` · conflict/gap detected with two grounded sources |
| `compliance` | `compliance.check` (deep) | `tender_summary`, `spec_clause`, `proposal_doc` | — | `compliance_item` · each mandatory req mapped to evidence |
| `proposal` | `proposal.assemble` (deep) | `tender_summary`, `boq_line`, `cost_line`, `schedule_activity`, `procurement_package` | — | `proposal_doc` · section coverage, total = Σ cost_lines |
| `bid_qualification` | `bid.qualify` (deep) | `tender_summary`, `risk` | knowledge_search (win history) | `bid_decision` · signal completeness (fit/capacity/competition/margin) |
| `risk` | `risk.assess` (deep) | scope + estimate artifacts | knowledge_search (precedent risks) | `risk[]` · grounded category, likelihood/impact rationale |
| `approval_prep` | `approval.prepare` (deep) | `proposal_doc`, `cost_line`, `risk`, `compliance_item` | — | `bid_approval` · totals reconcile, all open risks surfaced |
| `clarification` | `clarification.draft` (deep) | inbound `client_query` + `tender_summary`/`spec_clause`/`boq_line`/`proposal_doc` | knowledge_search | `client_query` (outbound) · answer grounded, addendum flagged |

---

## §4 — Service & supervisors (different shape)

- **Knowledge** (`agent.knowledge`, service) — `job_type: knowledge.search` (**routing**). Envelope: a query + optional `source_kind` filter. Tool: `semantic_search` (Core's `POST /search`, §7.5). Returns retrieved context to the **calling agent's** job (not the store); emits no artifact, has no confidence. It is one of two service agents invoked mid-job.
- **Standards** (`agent.standards`, service) — `job_type: standards.lookup` (**routing**). Resolves the Library `standard_rule` collection (company-over-pack precedence, effective version). Tool: `standards_lookup`. Returns rules to the caller; emits no artifact. BOQ/Cost/Specification/Drawing/Compliance/Risk consult it before proposing (Standards & Rules capability).
- **Supervisors** (`construction_copilot`, `commercial`, `compliance_lead`) — the §6.1 shape, not this one. Envelope = the **whole-run context** (scoped to the persona, §6.4), not single-step inputs. Tools: `propose_deviation` (constrained to the persona's allowed `deviation_kinds`, §6.4) and `chat_reply`. JobResult = a chat `message` + `deviations[]` — **no artifact outputs, no confidence**. `job_types`: `<persona>.respond`, `<persona>.review_run`. Their "prompt" is the persona's voice (pack §1.2).

---

## §5 — Cross-cutting

- **Tool registry.** Per-`produces` `emit_<type>` tools are generated from the C.2 schemas (single source of truth — a schema change regenerates the tool). Shared tools: `knowledge_search`, `standards_lookup` (structured Standards & Rules lookup over the Library), `rate_lookup`, `measure`, `semantic_search`.
- **The output-validation seam.** Core validates every JobResult output against `artifact_type.payload_schema` **before** `emitArtifact` (§5.1). A worker physically cannot land an invalid artifact — a schema-invalid output is a job failure, retried. (The C.2 schemas are already validated; the `emit_<type>` tools enforce them at generation time too.)
- **Prompt versioning.** `prompt_ref = <job_type>@vN` in Langfuse; the run **pins** the version (§5.2) so a mid-run prompt change can't split a run's behaviour.
- **Eval hooks (WS-H2).** Each `job_type` ships golden inputs → expected outputs + a threshold; the CI eval gate fails a build on regression. The skeleton three (`document`, `tender`, `boq`) are the first eval sets.
- **Idempotency & retries.** `idempotency_key` per job (§5.4); malformed/failed output retried to `max_attempts`; exhaustion fails the step then the run, surfaced — never a half-write (§5.7).

---

*Build order: §2 (the three skeleton agents) is what WS-D implements; §3–§4 are authored per workflow as the pack's other Logix and the tender-management workflows come online.*

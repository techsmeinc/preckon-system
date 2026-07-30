## Appendix A — The Construction pack: agents

The thirteen agents that make Core a construction product, authored against the finished ABI (§3) — pack data, not Core. Each is one row in the `agent` registry (§3.1): a `kind`, typed I/O over the artifact-type vocabulary (§2.1, full set in Appendix C), the AI `job_types` it enqueues (§5), and its gating. Keys shown are short forms of their `construction.`-namespaced values (§D.3): `agent.tender` ≡ `construction.agent.tender`.

Two invariants from Core carry through every row: an agent touches only the four ABI syscalls, and the runtime — not the agent — emits, scopes, validates, and gates every output (§5.1). Agents are gated **transitively**: an agent is available iff some licensed workflow references it (§8), so `entitlement_key` is null on all of them and the `module_key` on the workflow (Appendix B) is the license seam.

### A.1 Roster

| Key | Name | Kind | Produces | Primary workflow → module |
|---|---|---|---|---|
| `agent.document` | Document | worker | `document` | (entry to every chain) |
| `agent.tender` | Tender | worker | `tender_summary` | TenderLogix → `tenderlogix` |
| `agent.specification` | Specification | worker | `spec_clause` | DocLogix → `doclogix` |
| `agent.drawing` | Drawing | worker | `drawing_index`, `drawing_measurement` | DrawLogix → `drawlogix` |
| `agent.boq` | BOQ | worker | `boq_line` | QuantLogix → `quantlogix` |
| `agent.cost` | Cost | worker | `cost_line` | CostLogix → `costlogix` |
| `agent.schedule` | Schedule | worker | `schedule_activity` | ScheduleLogix → `schedulelogix` |
| `agent.procurement` | Procurement | worker | `procurement_package` | ProcureLogix → `procurelogix` |
| `agent.rfi` | RFI | worker | `rfi` | cross-cutting |
| `agent.compliance` | Compliance | worker | `compliance_item` | cross-cutting |
| `agent.proposal` | Proposal | worker | `proposal_doc` | TenderLogix → `tenderlogix` |
| `agent.knowledge` | Knowledge | service | *(none — returns context)* | all (called by agents) |
| `agent.construction_copilot` | Construction Copilot | supervisor | *(none — proposes deviations)* | all (the Orchestrator role, §6) |

### A.2 Per-agent I/O

Format: **consumes → produces** · *job_types (default tier)* · review behaviour.

- **Document** — file-page text (a Core ingestion input, not an artifact type; §7.4) **→ `document`** · *`document.classify_split` (standard)* · non-reviewable, auto-confirmed on emit (`document.is_reviewable = false`). Classifies and splits an ingested file into `document` artifacts carrying `file_id` + page range. The classification vocabulary (drawing / specification / tender letter / addendum) is pack data in the agent.
- **Tender** — `document` **→ `tender_summary`** · *`tender.extract_summary` (deep)* · reviewable proposal. The skeleton's scope-extraction step (§S).
- **Specification** — `document` **→ `spec_clause`** · *`spec.extract_clauses` (deep)* · reviewable. Pulls normative clauses (materials, tolerances, standards) from spec documents.
- **Drawing** — `document` **→ `drawing_index`, `drawing_measurement`** · *`drawing.index` (standard), `drawing.takeoff` (deep)* · reviewable. Indexes the sheet set, then measures quantities off page rasters (`file_page.raster_key`, §7.1). A **map** node fans takeoff out per drawing (§4.1).
- **BOQ** — `tender_summary`, `spec_clause`, `drawing_measurement` **→ `boq_line`** · *`boq.derive_lines` (deep)* · reviewable. Shared by TenderLogix (from `tender_summary`, §S) and QuantLogix (from measurements + clauses); defined once because I/O is workflow-independent (§2.1). May call **Knowledge** for precedent before proposing.
- **Cost** — `boq_line` + Library `rate_book` **→ `cost_line`** · *`cost.price_lines` (deep)* · reviewable. Provenance links each `cost_line` to its `boq_line` and the applied rate (§2.3); editing a rate re-plans downstream via the stale walk (§2.4).
- **Schedule** — `boq_line`, `cost_line` **→ `schedule_activity`** · *`schedule.build_programme` (deep)* · reviewable. Sequences activities with durations/dependencies from quantities and resources.
- **Procurement** — `boq_line`, `cost_line` **→ `procurement_package`** · *`procure.build_packages` (standard)* · reviewable. Groups scope into RFQ packages by trade/lead-time.
- **RFI** — `tender_summary`, `spec_clause`, `drawing_measurement` **→ `rfi`** · *`rfi.detect` (standard)* · reviewable. Detects ambiguities, gaps, and conflicts across the graph and raises clarification questions; cross-cutting, not tied to one workflow.
- **Compliance** — `tender_summary`, `spec_clause`, `proposal_doc` **→ `compliance_item`** · *`compliance.check` (deep)* · reviewable. Checks each mandatory requirement is addressed before submission.
- **Proposal** — `tender_summary`, `boq_line`, `cost_line`, `schedule_activity`, `procurement_package`, `compliance_item` **→ `proposal_doc`** · *`proposal.assemble` (deep)* · reviewable. Assembles the confirmed graph into the submittable bid; the chain's terminal artifact.
- **Knowledge** (service) — query-driven; calls Core semantic search over `chunk` (project graph + uploaded docs + Library, §7.3) **→ retrieved context** · *`knowledge.search` (routing)* · emits no artifact. Not a pipeline node; other agents invoke it (e.g. BOQ asking for precedent). Requires `artifact.read` on the caller's behalf.
- **Construction Copilot** (supervisor) — whole-run visibility over the run's artifacts and steps **→ deviations + chat** · *`copilot.respond` (deep), `copilot.review_run` (deep)* · emits no artifact. Fills the domain-neutral `Orchestrator` role (§6): cross-checks a run and proposes **deviations** from the closed set (rerun / insert-gate / skip / request-review / flag); a human approves, the runtime applies (§6.1). The one construction-named element on the platform, itself userland.

### A.3 Wiring rules

- **Type-checked at registration.** The workflow resolver (§4.1) verifies each agent node's `consumes` is reachable from upstream `produces`; a mis-wired pack workflow fails to register, not at runtime.
- **Reviewable vs canonical.** Only `document` is non-reviewable — every derived artifact is a proposal that a human confirms (or auto-accepts above threshold, §5.6). This is the human-in-the-loop line, expressed as pack data.
- **No new Core surface.** Every agent above is expressible with the existing four syscalls, the existing `agent` columns, and the twelve seeded artifact types. Adding the eighth workflow product later is another registry row, not a Core change — the property §D exists to guarantee.

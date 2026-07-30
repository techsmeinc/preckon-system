# Preckon — Standards & Rules Capability (v2)

**Status:** v2 design for review. Supersedes v1 (the lookup-and-apply engine already integrated at construction pack §3). v2 adds the **tier precedence hierarchy**, a **validation mode** (`standard_violation`), **client/project tiers**, and the **mechanism-in-Core / content-in-pack** split — while explicitly **not** promoting a "Standards Engine" to a first-class Core platform peer.
**Traces to:** framework §M (Library), §1.6 (the generic-mechanism-in-Core precedent), §5.6 (confidence), §6.4.2 (propose-vs-dispose) · pack §3, Appendix A/C · Doc 2.

---

## 1. What v2 adds (and the one thing it rejects)

**v1, already shipped (pack §3):** the `standard_rule` object, the Library two-tier (pack-shipped vs company), the Standards service + `standards_lookup` tool, lookup-and-apply, citation (`standard_refs`) and the confidence `agreement` signal.

**v2 adds four things and maps a fifth:**
1. **Tier precedence** — a fixed hierarchy so conflicts resolve *deterministically*, not just by `overrides` id. Fixes the canonical case: *company says m², statute says m³ → statute wins, always.*
2. **Validation mode** — standards run *against* confirmed artifacts, emitting `standard_violation` findings ("door 950 mm < min 1100 mm, high, OBC 3.4.3"). This is the concrete first form of the v2 Rules Engine.
3. **Client & Project tiers** — reusable per-client conventions and per-project overrides, as more tiers on the same mechanism.
4. **The Core-mechanism / pack-content split** — the *resolution + validation logic* becomes a thin, domain-neutral Core capability (mirroring the §1.6 lifecycle mechanism); all *rule content* stays pack/Library data.
5. **Reasoning policies (the doc's "Level 4")** are mapped onto existing Core governance + tier precedence — **not** modeled as new objects (§6).
6. **Licensing & provisioning** — how licensed vs. unlicensed content is provisioned (§10): the engine ships free; licensed standards are separately provisioned, only when required.

**Rejected — deliberately:** promoting a "Preckon Standards Engine" to a **first-class platform peer of Core** ("Construction Runtime = Standards Engine"). Standards *content* is domain-specific; making the engine a Core platform re-imports domain knowledge into Core, breaks the §D boundary, and voids the "second vertical, zero Core change" proof underwriting just cashed. The doc's own headline benefit — *"update one standard, every agent follows"* — needs only **shared Library content + one resolver**, which v1 already delivers. We take the power, not the promotion.

---

## 2. The tier & precedence hierarchy

Every `standard_rule` gains a **`tier`** (its authority/specificity band) and a **`binding`** (`mandatory` vs `default`). Resolution is then deterministic:

- **Mandatory rules are hard constraints.** They always apply. Between two *conflicting* mandatory rules, the **broadest authority wins** (statutory over a project mandate for a mutually-exclusive value); *compatible* mandatory constraints stack (a project 40 MPa minimum holds over a code 35 MPa minimum — stricter wins).
- **Default (preference) rules: most-specific wins.** With no mandatory rule dictating, `project` ▸ `company` ▸ `client` ▸ `industry` (most specific first).
- **Default vs mandatory → mandatory wins**, and the contradicting default is void and surfaced as a config inconsistency (a company rule that says m² where statute says m³ is flagged, not silently applied).

Tiers, broadest→most-specific: **`statutory` ▸ `industry` ▸ `client` ▸ `company` ▸ `project`** (the doc's nine "layers" collapse onto these five; see §3). "Agent preferences" — the doc's lowest layer — is **not** a rule tier; it's the agent's own fallback when the engine returns nothing.

The canonical example resolves correctly: `{statutory+mandatory: m³}` vs `{company+default: m²}` → **m³**. And `{project+default}` vs `{company+default}` → **project**.

Updated `standard_rule` (v2 — adds `tier`, `binding`, and optional `client_ref`/`project_ref` scope):

```json
{ "$id": "standard_rule", "type": "object", "additionalProperties": false,
  "required": ["rule_id","standard","category","tier","binding","jurisdiction","subject","result","status"],
  "properties": {
    "rule_id": { "type": "string" },
    "standard": { "type": "string" },
    "category": { "type": "string",
      "enum": ["measurement","classification","code","drawing","material","safety","cost","contract","quality","environmental"] },
    "tier": { "type": "string", "enum": ["statutory","industry","client","company","project"] },
    "binding": { "type": "string", "enum": ["mandatory","default"] },
    "jurisdiction": { "type": "string" },
    "client_ref": { "type": "string" },
    "project_ref": { "type": "string" },
    "version": { "type": "string" },
    "effective_date": { "type": "string", "format": "date" },
    "subject": { "type": "string" },
    "applies_when": { "type": "object" },
    "result": { "type": "object", "minProperties": 1 },
    "exceptions": { "type": "array", "items": {
      "type": "object", "required": ["when","result"],
      "properties": { "when": {"type":"string"}, "result": {"type":"object"} } } },
    "evidence_required": { "type": "array", "items": { "type": "string" } },
    "confidence_threshold": { "type": "number", "minimum": 0, "maximum": 1 },
    "source_ref": { "type": "string" },
    "overrides": { "type": "string" },
    "license": { "type": "string" },
    "licensed_to": { "type": "string" },
    "status": { "type": "string", "enum": ["active","superseded"] } } }
```

`overrides` remains as an optional explicit-audit link, but **tier precedence is now the general conflict-resolution mechanism** — no rule needs to name what it beats.

---

## 3. The tiers, mapped from the doc's layers

| v2 tier | binding (typical) | scope | The doc's layers it absorbs |
|---|---|---|---|
| `statutory` | mandatory | jurisdiction | National Standards (building/fire/electrical codes — "laws, cannot be violated") |
| `industry` | mostly default | jurisdiction | Industry + Engineering + Measurement + Material + Safety standards (CSI, ACI, ASHRAE, NRM, ASTM…) |
| `client` | default | `client_ref` | Client Standards (hospital/airport/government conventions) |
| `company` | default | tenant | Company Standards ("the moat") |
| `project` | default | `project_ref` | Project Standards ("override company defaults") |

"AI Standards" (Layer 9) is **not** a tier — see §6.

---

## 4. Validation mode & the `standard_violation` type

v1 *applies* standards (BOQ asks the unit). v2 adds the second mode: **validate** — run applicable **mandatory** rules against a confirmed artifact and emit findings.

- **Tool:** `standards_validate({ artifact }) → { violations }`, a sibling of `standards_lookup`. Backed by the same resolver (§5), it evaluates each applicable mandatory rule's `applies_when → result` against the artifact.
- **Emission:** the **Compliance** and **Risk** agents call it and emit `standard_violation` artifacts (reviewable) — the agent emits, the mechanism evaluates (Core never emits, §5).
- **v1 form:** agent-invoked validation (Compliance/Risk sweep on demand). **v2 form:** a deterministic Rules-Engine pass — a gate or scheduled sweep that validates the whole graph **with no LLM**, since mandatory rules are executable `applies_when → result`.

```json
{ "$id": "standard_violation", "type": "object", "additionalProperties": false,
  "required": ["rule_id","subject_artifact_id","severity","status"],
  "properties": {
    "rule_id": { "type": "string" },
    "subject_artifact_id": { "type": "string", "format": "uuid" },
    "observed": { "type": "object" },
    "expected": { "type": "object" },
    "severity": { "type": "string", "enum": ["info","low","medium","high","critical"] },
    "reference": { "type": "string" },
    "recommendation": { "type": "string" },
    "status": { "type": "string", "enum": ["open","waived","resolved"] } } }
```

A `standard_violation` participates in the graph like any artifact: it's reviewable, provenance-linked to the offending artifact and the rule (`rule_id@version`), and a high/critical open violation can gate a lifecycle transition (e.g. block `approving → submitted` until resolved or waived).

---

## 5. The Core-mechanism / pack-content split (the architecture stance)

The one deliberate Core change v2 justifies — and its exact boundary:

**Thin, domain-neutral Core capability (framework v1.2 → v1.3):** a **Standards resolution service** — `resolveStandards(context, query) → ranked rule` (the §2 tier precedence) and `validateStandards(artifact) → violations` (the §4 evaluation) — over the Library `standard_rule` collection, plus the generic `standard_rule` contract (§2), the `standards_lookup`/`standards_validate` tool contracts, and the generic `standard_violation` shape (§4). **This is pure mechanism — tier maths and predicate evaluation. It contains not one construction term.** It is the same move as §1.6: the *machine* is Core, the *content* is pack data.

**Everything domain stays pack/tenant data (zero Core content):** every rule instance (NRM2, MasterFormat, OBC, ACME company rules, per-client and per-project rules) is a Library `standard_rule`; which agents consult which categories is pack config; the seeded `standards` bundle is pack data.

**Why this, not PSE-as-platform:** you get the decoupling the doc wants ("change one rule, all agents follow" — because rules are shared Library content one resolver reads) and the "runtime" feel (a real Core service) **without** teaching Core a single domain fact. Promote the mechanism, never the content. (The commercial corollary — how licensed content is provisioned without cost until required — is §10.) The packs still add zero Core DDL; underwriting inherits tier precedence + validation for free — proving it's a *platform* capability, exactly as intended, but on the right side of the §D line.

---

## 6. Reasoning policies (the doc's "Level 4") — via existing governance, not new objects

The doc's Level 4 (how an agent thinks through ambiguity/conflict) is **already expressible** — it's tier precedence (§2) plus mechanisms Core already has. The escalation ladder maps one-to-one:

| The doc's reasoning step | Realized by |
|---|---|
| Check mandatory legal requirements first | `statutory + mandatory` wins (§2) |
| Apply project, then client, then company | most-specific `default` wins (§2) |
| If standards conflict | resolver flags it; a persona (`request_review`/`flag`, §6.4) surfaces it |
| If uncertainty remains, escalate to a human with evidence | confidence < threshold → review queue (§5.6); commercial decisions → `bid.approve`/`uw.authorize` gate |

So "AI Standards" (min confidence, evidence-required, escalate-below-threshold, human-approval-for-commercial) are **Core AI-governance, not domain standards** — they already live in §5.6 (confidence/auto-accept), §6.4.2 (propose-vs-dispose), and the permission gates. Modeling them as `standard_rule`s would blur Core policy and pack content; instead this spec **cross-references** them and adds nothing. That keeps the "engineering conscience" the doc wants — but assembled from the pieces already in place.

---

## 7. The four maturity levels, mapped

| Doc level | Preckon | Status |
|---|---|---|
| L1 Reference standards (PDFs) | Library `standard` docs (retrieved via `knowledge_search`) | exists |
| L2 Structured standards | `standard_rule` objects | **shipped (v1)** |
| L3 Executable rules (IF-THEN, validation) | `applies_when → result` + validation mode + `standard_violation` | **v2 (this spec)** |
| L4 Reasoning policies | tier precedence (§2) + Core governance escalation (§6) | realized by existing mechanisms |

---

## 8. Integration plan (next gate)

- **Framework v1.2 → v1.3:** the thin Core standards mechanism (§5) — the `standard_rule` contract, `resolveStandards`/`validateStandards`, the two tool contracts, the `standard_violation` shape. A new §-subsection alongside §M/§1.6, framed as domain-neutral mechanism.
- **Construction pack v1.2 → v1.3:** add `tier`/`binding` (and `client_ref`/`project_ref`) to the seeded rules; add example client- and project-tier rules; add the `standard_violation` artifact type (Appendix C); give Compliance & Risk the `standards_validate` tool; note the high/critical-violation gate on the bid-pursuit lifecycle.
- **Underwriting pack:** inherits the mechanism unchanged; may seed regulatory/appetite rules with tiers.
- Both packs still add **zero Core DDL**; the Core addition is one mechanism, no content.

---

## 9. Validation

Below: the v2 `standard_rule` schema (with `tier`/`binding`), the `standard_violation` schema, example rules across tiers, and the precedence resolver.

```json
{ "rule_id":"obc.measurement.concrete_wall","standard":"Ontario Building Code","category":"measurement",
  "tier":"statutory","binding":"mandatory","jurisdiction":"CA-ON","version":"2012","subject":"concrete wall",
  "result":{"measure_by":"volume","unit":"m3"},"evidence_required":["drawing"],"confidence_threshold":0.95,
  "source_ref":"OBC ref","status":"active" }
```
```json
{ "rule_id":"acme.measurement.concrete_wall","standard":"Acme Standards","category":"measurement",
  "tier":"company","binding":"default","jurisdiction":"CA-ON","version":"1.0","subject":"concrete wall",
  "result":{"measure_by":"area","unit":"m2","description_template":"Concrete wall, {thickness}mm"},
  "evidence_required":["drawing"],"confidence_threshold":0.9,"source_ref":"Acme BOQ Manual","status":"active" }
```
```json
{ "rule_id":"proj123.measurement.concrete_wall","standard":"Project 123","category":"measurement",
  "tier":"project","binding":"default","jurisdiction":"CA-ON","project_ref":"proj-123","version":"1.0",
  "subject":"concrete wall","result":{"measure_by":"volume","unit":"m3","min_strength_mpa":40},
  "evidence_required":["drawing"],"confidence_threshold":0.9,"source_ref":"Project 123 spec","status":"active" }
```
```json
{ "rule_id":"nrm2.measurement.concrete_wall","standard":"NRM2","category":"measurement",
  "tier":"industry","binding":"default","jurisdiction":"global","version":"2021","subject":"concrete wall",
  "result":{"measure_by":"volume","unit":"m3"},"evidence_required":["drawing","specification"],
  "confidence_threshold":0.9,"source_ref":"NRM2","status":"active" }
```
```json
{ "rule_id":"obc.exit.width@2012","subject_artifact_id":"018f2a00-0000-7000-8000-000000000001",
  "observed":{"width_mm":950},"expected":{"min_mm":1100},"severity":"high","reference":"OBC 3.4.3",
  "recommendation":"increase clear exit width to 1100mm","status":"open" }
```

---

## 10. Standards licensing & provisioning

**Not legal advice.** Standards licensing is fact-specific — verify per standard with the issuing body (CSI for MasterFormat/UniFormat/OmniClass, RICS for NRM, the relevant authority for building codes) and IP counsel before seeding or distributing any third-party standard.

**Why this stays cheap:** the engine (§5) is content-neutral and rule content is swappable, tenant-scoped Library data with `source_ref`/`version`/`license`. So the content that *may* carry a license (the `industry`/`statutory` tiers) is fully isolated from what never does (the mechanism + `company`/`client`/`project` rules). Preckon ships the engine; licensed *content* is provisioned separately, only when required.

**Exposure by tier** (from §2–§3):
- `company` / `client` / `project` — the tenant's own rules. **No third-party license.** The default value and the moat.
- `statutory` (codes) — often freely referenceable as law, but verbatim reproduction of *model* codes can be restricted; prefer requirements-as-facts. Verify per jurisdiction.
- `industry` (MasterFormat, NRM, ASTM…) — **licensable.** Even numbers + titles (e.g. MasterFormat) are copyrighted; a product that embeds and serves them to customers is commercial use that the issuer licenses.

**Three provisioning modes — all supported today, no new Core:**

1. **Default (launch) — license-clean.** The pack's seeded `standards` bundle carries **only** unlicensed content: company/client/project templates and code *requirements-as-facts* — **not** verbatim MasterFormat/NRM tables. Customers get the full engine and author their own rules. **Zero licensing cost.**
2. **Customer-provided license (BYO-license).** A client that holds its own MasterFormat/NRM/etc. license **imports** those rules as `standard_rule` entries into **its own tenant Library** (RLS-isolated). Preckon provides the import path; the client's license covers its tenant; the content is tagged `license` + `licensed_to` and never leaves that tenant. **Preckon carries no license cost and does no distribution.**
3. **Preckon-licensed premium data pack (future).** If Preckon licenses a standard centrally, it ships as a **separate, entitlement-gated standards data pack** — a paid add-on (a Host feature, e.g. `standards.masterformat`, §8), enabled per tenant who buys it, served under Preckon's master license. No architecture change — a gated content pack.

**The one affordance this adds:** an optional `license` marker on `standard_rule` — `{ license, licensed_to }` alongside `source_ref` — recording provenance and license scope. It lets the platform attribute/cite licensed content, gate Preckon-licensed packs by entitlement, keep BYO-license content inside the licensee's tenant, and prove provenance in audit. Optional pack/Library field — **no Core change.**

**Net:** launch on modes 1 + 2 (no spend); add mode 3 as a priced upgrade if demand justifies the license. Because the engine already isolates licensable content from the free mechanism, adding licensed data later is a commercial decision, not a re-build.

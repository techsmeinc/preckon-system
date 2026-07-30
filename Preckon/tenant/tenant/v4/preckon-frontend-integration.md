# Preckon — Frontend Integration & §D Reconciliation

**Purpose:** close the one inconsistency in the artifact set. Three early-session files were built on a `§D` design the **canonical framework does not use**. This doc retires them, states the canonical model, and specifies exactly how the tenant-app shell renders — off real Core endpoints, not a synthetic manifest.
**Canonical sources:** `preckon-tenant-platform-design.md` v1.2 (framework) · `preckon-construction-pack-design.md` v1.1 (pack) · `preckon-host-backend-design.md` (Host).

---

## 1. What was off-model

The canonical `§D` (framework) models a domain pack as **one `domain` row with a JSONB manifest**, first-party and compiled in (§D.2). There is **no** `pack_module` / `pack_role` / `pack_permission` cluster and **no** `GET /workspace/manifest`. A "module" is a **Host-catalog capability** (`module_key`) that a workflow maps to (§4.1), gated by **entitlements** (§8). The shell composes real endpoints; nothing reads a synthetic tenant-plane manifest.

Three files pre-date that canon and contradict it:

| Retired file | Was built on | Replaced by |
|---|---|---|
| `preckon-backend-design-section-D.md` | a `domain_pack` + `pack_module/role/permission/copilot/review_policy` cluster | canonical `§D` in the framework (single `domain` table + JSONB manifest) |
| `preckon-workspace-manifest-endpoint.ts` | a Drizzle resolver over `pack_*` → `GET /workspace/manifest` | canonical Core endpoints (§4.6, §8, §6.4.5, §1.6) + an optional app BFF (§4) |
| `preckon-manifest-layer.tsx` | consuming `/workspace/manifest` | **`preckon-workspace-layer.tsx`** (§5) |

Those three files have been **replaced in place with a one-line superseded stub** pointing here, so they can't be picked up by mistake.

---

## 2. The canonical rendering — what the shell reads

Every surface the shell needs already has a real endpoint. The shell composes them; it hardcodes no domain.

| Shell surface | Source (real endpoint) | Renders |
|---|---|---|
| **Module nav** | `GET /catalog/modules` (Host, display) ∩ `GET /entitlements` (§8, `licensed_modules`) | the licensed modules (the seven Logix), label/icon from the Host catalog |
| **Module actions** | `GET /workflows` (§4.6), grouped by `module_key` | the runs a user can start within a module (e.g. `tenderlogix` → TenderLogix, BidQualification, RiskReview, BidAssembly, ClarificationLoop) |
| **Personas (digital company)** | `GET /personas` (§6.4.5), entitlement-filtered | the roster; each opens a chat + a scoped review lens |
| **Review queue** | `GET /projects/{pid}/review-queue` (§2.6) and `…/personas/{key}/review-queue` (§6.4.5) | pending proposals — global or per-colleague |
| **Copilot / chat** | `…/conversations` (§6.3), `supervisor_key` per persona | persona threads + `copilot.respond` |
| **Bid pursuit lifecycle** | `GET /projects/{pid}/lifecycle` (§1.6) | current `lifecycle_state` + transitions available to the user |
| **White-label** | tenant branding settings (`admin.branding`) | logo + brand colour, composed on top — unchanged |

**The key correction:** module **display metadata** (label, icon, order) lives in the **Host product catalog** (`module.<logix>` features), read via **`GET /catalog/modules`** and joined app-side to the tenant's `licensed_modules` — *not* a tenant-plane table, *not* bundled in the per-tenant snapshot (display is edition-independent), and *not* hardcoded in the shell. Module identity is licensed data (`licensed_modules`), module presentation is Host-catalog data, and the shell just renders `catalog ∩ licensed`. This is delivered by `preckon-host-spec-touchup.md`.

**Nothing in the shell names a module, persona, or state.** Grep the shell for `TenderLogix`, `bidding`, `Commercial` → zero hits; those strings arrive as data.

---

## 3. Rendering rules (normative)

- **Nav = `licensed_modules` (from entitlements), in Host-catalog order.** A module the tenant isn't licensed for never appears. Selecting a module lists its `/workflows` (filtered by `module_key`) as the runnable actions.
- **Persona availability is transitive (§8).** `/personas` already returns only personas whose `scope.module_keys` intersect the licensed set — the shell renders whatever it returns.
- **Lifecycle drives the primary CTA.** On a tender project, the shell reads `/lifecycle` and surfaces the next transition's gating artifact (e.g. state `qualifying` → "Review the bid recommendation"). The Bid Manager persona proposes; the human confirms; state advances (§1.6). The shell never sets state.
- **Review is one concept, two lenses.** The global queue and each persona's scoped queue are the same view (§2.5) filtered — the shell shows counts per persona from the persona lenses.
- **No client permission math beyond membership.** Endpoints are already filtered server-side by entitlement + permission; the client only checks the permission set it's handed (e.g. show the `bid.approve` action only if held).

---

## 4. Optional — an app-side `/workspace` composer (BFF)

If the single-fetch ergonomics of the retired manifest are wanted, the **tenant app** (not Core) may expose a thin `GET /workspace` that fans out to the canonical endpoints and returns one payload:

```jsonc
// app BFF response — assembled from §8 /entitlements + §4.6 /workflows + §6.4.5 /personas
{
  "modules":  [ { "key": "tenderlogix", "label": "TenderLogix", "icon": "file-search",
                  "workflows": ["workflow.tenderlogix","workflow.bidqualification","workflow.bidassembly","…"] } ],
  "personas": [ { "key": "agent.construction_copilot", "label": "Construction Copilot", "isDefault": true } ],
  "permissions": ["project.read","artifact.confirm","workflow.run"]
}
```

This is **app/BFF code, not Core** — it composes Core reads, it does not read `pack_*` tables (there are none). The realigned layer (§5) works either way: point it at the composer, or let it fan out client-side.

---

## 5. The realigned frontend layer

`preckon-workspace-layer.tsx` replaces `preckon-manifest-layer.tsx`. It consumes the **canonical** endpoints (or the §4 composer), with:

- typed models for `/entitlements`, `/workflows`, `/personas`, `/lifecycle`;
- a `WorkspaceProvider` + `useWorkspace()` that composes modules (licensed ∩ their workflows) and personas;
- `useLifecycle(projectId)` for the pursuit state + next transitions;
- shell renderers `ModuleNav`, `PersonaBar`, `LifecycleBanner` — all data-driven, no domain literals.

It typechecks under `strict`. The provenance vs. the retired layer: same UX, correct data source.

---

## 6. Migration checklist

1. Delete the three stubbed files (they now only point here).
2. Repoint the shell: nav from `/entitlements`, actions from `/workflows`, personas from `/personas`, lifecycle from `/lifecycle` — or from the §4 composer.
3. **Host-spec touch-up** (delivered — `preckon-host-spec-touchup.md`): the Host catalog carries module display (`display_label`/`icon`/`sort_order` on `feature`) exposed via `GET /catalog/modules`; the app renders `catalog ∩ licensed_modules`. `bid.approve` confirmed tenant-plane; tender workflows license under the existing `module.tenderlogix`.
4. Confirm the shell has no module/persona/state string literals (grep clean).

With this, the artifact set is internally consistent: one canonical `§D`, one canonical rendering path, no synthetic manifest.

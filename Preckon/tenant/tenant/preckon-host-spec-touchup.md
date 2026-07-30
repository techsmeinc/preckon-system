# Preckon Host — Spec Touch-Up

**Applies to:** `preckon-host-backend-design.md` (§4 Product catalog, §5 Entitlements).
**Status:** patch / addendum — small, additive, non-breaking. Grounded in the Host doc's existing shapes (the unified `feature` registry keyed `module.<logix>`; the resolved entitlement snapshot with bare `licensed_modules`). Apply inline, or upload the Host doc and I'll integrate.
**Why:** the frontend reconciliation (`preckon-frontend-integration.md`) fixed the tenant-app nav to render modules from **Host-catalog display metadata** gated by the tenant's **licensed modules**. This makes the catalog carry that display and exposes it — and confirms tender management needs **no new Host module**.

---

## Change 1 — §4 Product catalog: module display metadata

Modules already exist as `feature` rows keyed `module.<logix>` (`kind = 'flag'`). Add three display fields so the tenant app can render nav without hardcoding a single module name (they stay null for non-module features):

```sql
alter table feature
  add column display_label text,   -- tenant-app label, e.g. 'TenderLogix'
  add column icon          text,   -- icon token, e.g. 'file-search'
  add column sort_order    int not null default 0;
```

Seed the seven module-features (icons are the tokens the tenant shell's icon map already knows):

| feature `key` | `display_label` | `icon` | `sort_order` |
|---|---|---|---|
| `module.tenderlogix` | TenderLogix | `file-search` | 10 |
| `module.drawlogix` | DrawLogix | `ruler` | 20 |
| `module.doclogix` | DocLogix | `file-text` | 30 |
| `module.quantlogix` | QuantLogix | `calculator` | 40 |
| `module.costlogix` | CostLogix | `dollar-sign` | 50 |
| `module.schedulelogix` | ScheduleLogix | `calendar-clock` | 60 |
| `module.procurelogix` | ProcureLogix | `shopping-cart` | 70 |

Display is **edition-independent** (a module's label/icon is universal); licensing (which modules a tenant has) stays the §5 snapshot's job. Keeping them separate is the point — display in the catalog, licensing in the per-tenant snapshot.

---

## Change 2 — the module catalog read

A view over the module-features, with the `module.` prefix stripped so `module_key` matches the tenant plane's bare `licensed_modules` keys (`tenderlogix`, not `module.tenderlogix`):

```sql
create view module_catalog as
select replace(key, 'module.', '') as module_key,
       coalesce(display_label, name) as label,
       icon,
       sort_order
from feature
where kind = 'flag' and key like 'module.%';
```

Two reads expose it (extending §4/§5 endpoints):

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/internal/catalog/modules` | *(service auth)* | the module display catalog, consumed by the tenant plane (like `/internal/entitlements/{tenant_id}`) |
| `GET` | `/catalog/modules` | `tenant.read` | console-facing (module list for the catalog UI) |

Response shape:

```jsonc
[ { "module_key": "tenderlogix", "label": "TenderLogix", "icon": "file-search", "sort_order": 10 }, … ]
```

---

## Change 3 — how the tenant app renders nav (no snapshot change)

`licensed_modules` in the §5 resolved snapshot **stays bare keys** — the containment resolution (`e.licensed_modules @> to_jsonb(w.module_key)`) is unchanged. Display is joined app-side:

```
nav = module_catalog  where module_key ∈ entitlement_snapshot.licensed_modules,  ordered by sort_order
```

So the tenant plane (or the app BFF, `preckon-frontend-integration.md` §4) reads `/internal/catalog/modules` once (cacheable) and intersects it with the per-tenant licensed set. **No change to `entitlement_snapshot`, the snapshot push, or the §8 resolution.**

---

## Change 4 — tender management: entitlement confirmations (no schema change)

The tender-management additions (pack v1.1) touch the Host **not at all** beyond the above:

- **No new module.** The four new workflows — `bidqualification`, `riskreview`, `bidassembly`, `clarificationloop` — all carry `module_key = tenderlogix` (pack Appendix C.4). They are licensed by the **existing** `module.tenderlogix` feature; the Host catalog needs no new row.
- **`bid.approve` is tenant-plane, not Host.** It is a **pack permission addition** (seeded from the construction manifest into the tenant permission catalog, framework §1.2 / pack §2), governing what a user *may* do. The Host owns *licensing* (entitlements), not *permissions* — so the Host catalog defines no `bid.approve` and needs no change for it. Permission (may) is tenant; entitlement (licensed) is Host; the pursuit's approval is a permission.
- **The bid-pursuit lifecycle is invisible to the Host.** It rides on the tenant-plane generic `project.lifecycle_*` field (framework §1.6); the Host models no lifecycle.

---

## Change 5 — align the frontend-integration doc

`preckon-frontend-integration.md` §2/§6 now sources module display from **`GET /catalog/modules`** joined to the snapshot's `licensed_modules`, rather than bundled inside the entitlement payload. (Aligned in that file.)

---

## Validation

DDL parses and executes against the recovered `feature` shape: the display columns add cleanly, `module_catalog` resolves with the prefix stripped, and `nav = catalog ∩ licensed_modules` returns the right display rows. No change to `entitlement_snapshot` or the §8 resolution — so nothing downstream re-validates.

## Suggested changelog entry (Host doc)

```
| 0.x | 2026-07-07 | §4: module display metadata (display_label / icon / sort_order) on `feature`
                     + `module_catalog` view + `/internal/catalog/modules` & `/catalog/modules` reads.
                     Tenant nav = catalog ∩ licensed_modules. No §5 snapshot change.
                     Confirmed: tender-management workflows license under existing `module.tenderlogix`;
                     `bid.approve` is a tenant-plane pack permission, not a Host entitlement. |
```

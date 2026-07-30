"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  useApi,
  usePagedList,
  useDebounced,
  unwrap,
  errMessage,
  useToast,
  useCan,
  fmtSeatCap,
  fmtDate,
  StatusChip,
  Drawer,
  Field,
  Segmented,
  Switch,
  Skeleton,
  ErrorBox,
  EmptyState,
} from "../_ui";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  region?: string;
  edition_key?: string;
  edition_name?: string;
  seat_cap?: string | null;
  subscription_status?: string | null;
  primary_contact_email?: string;
  trial_ends_at?: string | null;
}

interface TenantStats {
  total: number;
  by_status: { status: string; n: number }[];
}

// Real tenant.status values (schema chk_tenant_status). NOTE: "past due" is a
// subscription concept, not a tenant status, so it is intentionally not a tab
// here — a real "past due" filter would need to join subscription.
// Valid provisioning regions — a select prevents typos that would mint an
// unroutable tenant. Extend as new regions come online.
const REGIONS = [
  { value: "us-east", label: "US East" },
  { value: "us-west", label: "US West" },
  { value: "eu-west", label: "EU West" },
  { value: "eu-central", label: "EU Central" },
  { value: "ap-south", label: "Asia Pacific (South)" },
  { value: "me-central", label: "Middle East (Central)" },
];

const FILTERS = [
  { key: "all", label: "All", status: null },
  { key: "active", label: "Active", status: "active" },
  { key: "trial", label: "Trial", status: "trial" },
  { key: "suspended", label: "Suspended", status: "suspended" },
  { key: "offboarding", label: "Offboarding", status: "offboarding" },
];

export default function TenantsPage() {
  const toast = useToast();
  const canCreate = useCan("tenant.create");
  const canImpersonate = useCan("tenant.impersonate");
  const canUpdate = useCan("tenant.update");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");

  // Filtering, search and pagination are all server-side (indexed columns) so
  // nothing is silently truncated at a client-side page cap.
  const statusParam = FILTERS.find((f) => f.key === statusFilter)?.status ?? null;
  const path =
    "/tenants?limit=50" +
    (statusParam ? "&status=" + statusParam : "") +
    (debouncedSearch ? "&q=" + encodeURIComponent(debouncedSearch) : "");
  const { items, loading, loadingMore, error, hasMore, loadMore, reload } =
    usePagedList<Tenant>(path, [path]);

  // Accurate per-status counts for the tabs, independent of what's loaded.
  const stats = useApi<TenantStats>("/tenants/stats");
  const statCount = (status: string | null) => {
    if (!stats.data) return null;
    if (status === null) return stats.data.total;
    return stats.data.by_status.find((r) => r.status === status)?.n ?? 0;
  };

  // Local overrides let actions update a row optimistically; cleared on reload.
  const [overrides, setOverrides] = useState<Record<string, Partial<Tenant>>>({});
  useEffect(() => {
    setOverrides({});
  }, [items]);
  const rows: Tenant[] = useMemo(
    () => items.map((t) => ({ ...t, ...overrides[t.id] })),
    [items, overrides]
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function patchTenant(id: string, p: Partial<Tenant>) {
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...p } }));
  }

  async function suspend(t: Tenant) {
    const reason = window.prompt(`Suspend ${t.name}? This cuts tenant access. Reason:`);
    if (!reason) return;
    try {
      await api.post(`/tenants/${t.id}/suspend`, { reason });
      patchTenant(t.id, { status: "suspended" });
      toast("Tenant suspended");
    } catch (e) {
      toast(errMessage(e));
    }
  }
  async function restore(t: Tenant) {
    try {
      await api.post(`/tenants/${t.id}/restore`, {});
      patchTenant(t.id, { status: "active" });
      toast("Access restored");
    } catch (e) {
      toast(errMessage(e));
    }
  }
  async function impersonate(t: Tenant) {
    const reason = window.prompt(`Impersonate ${t.name} (audited). Reason:`);
    if (!reason) return;
    try {
      const res = await api.post<any>(`/tenants/${t.id}/impersonate`, { reason });
      toast(`Impersonating ${t.name} — session audited`);
      if (res?.url) window.open(res.url, "_blank");
    } catch (e) {
      toast(errMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Tenants</h2>
          <p>Every customer org — edition, status, usage and health. Open one to impersonate or manage.</p>
        </div>
        {canCreate && (
          <button className="mini pri" onClick={() => setShowCreate(true)}>
            + New tenant
          </button>
        )}
      </div>

      <div className="fbar">
        <div className="range">
          {FILTERS.map((f) => {
            const c = statCount(f.status);
            return (
              <button
                key={f.key}
                className={statusFilter === f.key ? "on" : ""}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
                {c !== null ? " " + c : ""}
              </button>
            );
          })}
        </div>
        <div className="fsearch">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            placeholder="Search tenants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Skeleton rows={8} />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No tenants match" sub="Try a different filter or search term." />
      ) : (
        <div className="card" style={{ padding: "14px 18px" }}>
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Edition</th>
                <th>Status</th>
                <th className="r">Seats</th>
                <th>Region</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(t.id)}>
                  <td>
                    <div className="t-name">{t.name}</div>
                    <div className="t-sub">{t.slug}.preckon.app</div>
                  </td>
                  <td className="num">{t.edition_name ?? t.edition_key ?? "—"}</td>
                  <td>
                    <StatusChip status={t.status} />
                  </td>
                  <td className="num r">{fmtSeatCap(t.seat_cap)}</td>
                  <td style={{ color: "var(--slate-500)", fontSize: 12 }}>{t.region ?? "—"}</td>
                  <td className="r">
                    <button
                      className="rowbtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(t.id);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div style={{ textAlign: "center", paddingTop: 14 }}>
              <button className="mini" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {openId && (
        <TenantDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          canImpersonate={canImpersonate}
          canUpdate={canUpdate}
          onSuspend={suspend}
          onRestore={restore}
          onImpersonate={impersonate}
        />
      )}

      {showCreate && (
        <CreateTenantDrawer
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}
    </>
  );
}

/* ── Detail drawer ─────────────────────────────────────────────────────────*/

function TenantDrawer({
  id,
  onClose,
  canImpersonate,
  canUpdate,
  onSuspend,
  onRestore,
  onImpersonate,
}: {
  id: string;
  onClose: () => void;
  canImpersonate: boolean;
  canUpdate: boolean;
  onSuspend: (t: any) => void;
  onRestore: (t: any) => void;
  onImpersonate: (t: any) => void;
}) {
  const { data, loading, error } = useApi<any>(`/tenants/${id}`);
  const t = data;
  const suspended = t ? t.status === "suspended" : false;

  return (
    <Drawer
      open
      title={t?.name ?? "Tenant"}
      titleExtra={t ? <StatusChip status={t.status} /> : null}
      onClose={onClose}
      footer={
        t && (
          <>
            {canImpersonate && (
              <button className="mini pri" onClick={() => onImpersonate(t)}>
                Impersonate
              </button>
            )}
            {canUpdate &&
              (suspended ? (
                <button className="mini" onClick={() => onRestore(t)}>
                  Restore access
                </button>
              ) : (
                <button className="mini btn-danger" onClick={() => onSuspend(t)}>
                  Suspend tenant
                </button>
              ))}
          </>
        )
      }
    >
      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !t ? (
        <EmptyState title="Not found" />
      ) : (
        <>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--slate-400)", marginBottom: 14 }}>
            {t.slug}.preckon.app
          </div>
          <div className="tstats">
            <div className="tstat">
              <div className="k">Edition</div>
              <div className="v" style={{ fontSize: 14 }}>
                {t.edition?.name ?? t.edition_name ?? "—"}
              </div>
            </div>
            <div className="tstat">
              <div className="k">Subscription</div>
              <div className="v" style={{ fontSize: 14 }}>
                {t.subscription ? (
                  <StatusChip status={t.subscription.status} />
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div className="tstat">
              <div className="k">Seats</div>
              <div className="v">
                {(t.seats_in_use ?? 0) + " / " + fmtSeatCap(t.seat_cap)}
              </div>
            </div>
            <div className="tstat">
              <div className="k">Region</div>
              <div className="v" style={{ fontSize: 14 }}>
                {t.region ?? "—"}
              </div>
            </div>
          </div>
          <div className="trow-lbl">
            Primary contact <b>{t.primary_contact_email ?? "—"}</b>
          </div>
          <a
            className="mini pri"
            href={process.env.NEXT_PUBLIC_TENANT_PLANE_URL ?? "http://localhost:3100"}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}
          >
            Open workspace ↗
          </a>
          {t.subscription?.cancel_at_period_end === 1 && (
            <div className="trow-lbl">
              Cancels at period end <b>{fmtDate(t.subscription?.current_period_end)}</b>
            </div>
          )}
          {t.trial_ends_at && (
            <div className="trow-lbl">
              Trial ends <b>{fmtDate(t.trial_ends_at)}</b>
            </div>
          )}

          <label className="fl" style={{ margin: "18px 0 8px" }}>
            Recent activity
          </label>
          {(t.recent_audit ?? []).length === 0 ? (
            <div className="csub">No recent audit entries.</div>
          ) : (
            <ul className="feed">
              {(t.recent_audit ?? []).map((a: any) => (
                <li key={a.id}>
                  <div className="dot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4l3 2" />
                    </svg>
                  </div>
                  <div>
                    <div className="tx">{a.summary ?? a.action}</div>
                    <div className="tm">{fmtDate(a.occurred_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Drawer>
  );
}

/* ── Create drawer ─────────────────────────────────────────────────────────*/

function CreateTenantDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const editions = useApi<any>("/editions");
  const edList: any[] = (unwrap(editions.data) ?? []).filter((e: any) => e.status === "published");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [region, setRegion] = useState("us-east");
  const [email, setEmail] = useState("");
  const [editionId, setEditionId] = useState("");
  const [trial, setTrial] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<any>(null);

  const editionId2 = editionId || edList[0]?.id || "";
  const tenantPlaneUrl = process.env.NEXT_PUBLIC_TENANT_PLANE_URL ?? "http://localhost:3100";

  async function create() {
    setErr(null);
    if (!name || !slug || !editionId2 || !email) {
      setErr("Name, subdomain, edition and owner email are required.");
      return;
    }
    setBusy(true);
    try {
      const res = unwrap<any>(
        await api.post(
          "/tenants",
          {
            name,
            slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, ""),
            region,
            edition_id: editionId2,
            primary_contact_email: email,
            start_as: trial ? "trial" : "active",
          },
          { "idempotency-key": crypto.randomUUID() }
        )
      );
      toast(`Tenant "${name}" provisioned`);
      // Keep the drawer open to show the owner's workspace credentials.
      setCreated({ ...(res?.provisioning ?? {}), name });
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Success state: the tenant's workspace is provisioned — hand these to the customer.
  if (created) {
    const prov = created;
    return (
      <Drawer
        open
        title="Tenant provisioned"
        onClose={() => { onCreated(); onClose(); }}
        footer={<button className="mini pri" onClick={() => { onCreated(); onClose(); }} style={{ flex: 1 }}>Done</button>}
      >
        <div className="auth-ok" style={{ marginBottom: 18 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12l4 4 10-10" /></svg>
          <span><b>{created.name}</b> is live. Its workspace was created on the tenant plane and the owner can sign in now.</span>
        </div>
        {prov.error ? (
          <div style={{ color: "var(--amber)", fontSize: 12.5 }}>Tenant created. Setting up the workspace is taking a moment — it will finish automatically and the owner can sign in shortly.</div>
        ) : (
          <>
            <Field label="Owner sign-in (tenant identity — separate from Host staff)">
              <input type="text" className="mono" readOnly value={prov.ownerEmail ?? email} />
            </Field>
            <Field label="Temporary password">
              <input type="text" className="mono" readOnly value={prov.ownerPassword ?? "(set via invite)"} />
            </Field>
            <a className="mini pri" href={tenantPlaneUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, textDecoration: "none" }}>
              Open workspace ↗
            </a>
          </>
        )}
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      title="New tenant"
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={create} disabled={busy}>
            {busy ? "Provisioning…" : "Create tenant"}
          </button>
        </>
      }
    >
      <Field label="Company name">
        <input type="text" placeholder="e.g. Apex Constructors" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Subdomain">
        <input type="text" className="mono" placeholder="apex" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--slate-400)", marginTop: 5 }}>
          {(slug || "subdomain").toLowerCase().replace(/[^a-z0-9]/g, "")}.preckon.app
        </div>
      </Field>
      <div className="two-col">
        <Field label="Region">
          <select className="mono" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner email">
          <input type="text" placeholder="owner@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <Field label="Edition">
        {editions.loading ? (
          <div className="csub">Loading editions…</div>
        ) : edList.length === 0 ? (
          <div className="csub">No published editions available.</div>
        ) : (
          <Segmented
            options={edList.map((e: any) => ({ value: e.id, label: e.name }))}
            value={editionId2}
            onChange={setEditionId}
          />
        )}
      </Field>
      <div className="checklist">
        <div className="cl">
          Start with a trial
          <Switch on={trial} onToggle={() => setTrial((v) => !v)} />
        </div>
      </div>
      {err && (
        <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>
      )}
    </Drawer>
  );
}

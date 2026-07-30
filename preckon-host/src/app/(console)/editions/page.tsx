"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  useApi,
  unwrap,
  errMessage,
  useToast,
  useCan,
  StatusChip,
  Drawer,
  Field,
  Segmented,
  Switch,
  Skeleton,
  ErrorBox,
  EmptyState,
} from "../_ui";

interface Edition {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  status: string;
  is_public?: number;
  trial_days?: number;
  module_count?: number;
  feature_count?: number;
  tenant_count?: number;
}

interface Cell {
  enabled?: boolean;
  limit_value?: number | null;
  enum_value?: string | null;
}
interface MatrixFeature {
  key: string;
  name: string;
  type: string;
  cells: Record<string, Cell | undefined>;
}
interface Matrix {
  editions: { id: string; key: string; name: string }[];
  groups: { category: string; features: MatrixFeature[] }[];
}

export default function EditionsPage() {
  const canWrite = useCan("edition.write");
  const editions = useApi<any>("/editions");
  const matrix = useApi<Matrix>("/editions/matrix");
  const [editing, setEditing] = useState<Edition | "new" | null>(null);

  const list: Edition[] = unwrap(editions.data) ?? [];
  const m = matrix.data;

  // Render one matrix cell. `cells[id]` may be undefined → blank.
  // Flags: check when enabled. Limits: numeric value, enum value, or "Unlimited".
  function cell(c: Cell | undefined, type: string) {
    if (!c || c.enabled === false) return <span className="mk-n" />;
    if (type === "flag") return <span className="mk-y">✓</span>;
    if (c.limit_value !== null && c.limit_value !== undefined)
      return <span className="lim">{c.limit_value}</span>;
    if (c.enum_value) return <span className="lim">{c.enum_value}</span>;
    return <span className="lim">Unlimited</span>;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Editions</h2>
          <p>The plans tenants can be on. Pick what each includes, then price it.</p>
        </div>
        {canWrite && (
          <button className="mini pri" onClick={() => setEditing("new")}>
            + New edition
          </button>
        )}
      </div>

      {editions.loading ? (
        <Skeleton rows={4} />
      ) : editions.error ? (
        <ErrorBox message={editions.error} onRetry={editions.reload} />
      ) : list.length === 0 ? (
        <EmptyState title="No editions yet" sub="Create the first plan tenants can subscribe to." />
      ) : (
        <div className="ecards">
          {list.map((e) => (
            <div className="ecard" key={e.id}>
              <div className="etop">
                <span className="en">{e.name}</span>
                <StatusChip status={e.status} />
              </div>
              <div className="edesc">{e.description ?? "—"}</div>
              <div className="eprice">
                {e.trial_days ? `${e.trial_days}-day trial` : "No trial"}
                {" · "}
                {e.is_public ? "Public" : "Private"}
              </div>
              <div className="emeta">
                <div>
                  <b>{e.module_count ?? 0}</b>modules
                </div>
                <div>
                  <b>{e.feature_count ?? 0}</b>features
                </div>
                <div>
                  <b>{e.tenant_count ?? 0}</b>tenants
                </div>
              </div>
              <div className="eact">
                {canWrite && (
                  <button className="mini" onClick={() => setEditing(e)}>
                    Edit
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="chead">
          <div>
            <h3>What each edition includes</h3>
            <div className="csub">Open an edition to toggle its features and limits</div>
          </div>
        </div>
        {matrix.loading ? (
          <Skeleton rows={6} />
        ) : matrix.error ? (
          <ErrorBox message={matrix.error} onRetry={matrix.reload} />
        ) : !m || m.groups.length === 0 ? (
          <EmptyState title="No matrix data" />
        ) : (
          <table className="matrix" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Feature</th>
                {m.editions.map((e) => (
                  <th className="c" key={e.id}>
                    {e.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.groups.map((g) => (
                <Fragment key={g.category}>
                  <tr className="grp-row">
                    <td>{g.category}</td>
                    {m.editions.map((e) => (
                      <td className="c" key={e.id}></td>
                    ))}
                  </tr>
                  {g.features.map((f) => (
                    <tr key={f.key}>
                      <td>{f.name}</td>
                      {m.editions.map((e) => (
                        <td className="c" key={e.id}>
                          {cell(f.cells[e.id], f.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EditionDrawer
          edition={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            editions.reload();
            matrix.reload();
          }}
        />
      )}
    </>
  );
}

/* ── Create / edit drawer ──────────────────────────────────────────────────*/

// One checklist row = a feature from the catalog + its state on this edition.
interface FeatureRow {
  key: string;
  name: string;
  category: string;
  type: string; // flag | limit | metric
  value_type: string; // boolean | numeric | enum
  allowed_values: string[] | null;
  enabled: boolean;
  limit_value: number | null;
  enum_value: string | null;
}

function EditionDrawer({
  edition,
  onClose,
  onSaved,
}: {
  edition: Edition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const catalog = useApi<any>("/features");
  const detail = useApi<any>(edition ? `/editions/${edition.id}` : null);

  const [name, setName] = useState(edition?.name ?? "");
  const [key, setKey] = useState(edition?.key ?? "");
  const [status, setStatus] = useState(edition?.status ?? "draft");
  const [description, setDescription] = useState(edition?.description ?? "");
  const [trialDays, setTrialDays] = useState(String(edition?.trial_days ?? 14));
  const [isPublic, setIsPublic] = useState<boolean>(!!edition?.is_public);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Build the checklist from the full feature catalog, overlaying the
  // edition's current enabled/limit/enum state from its detail record.
  useEffect(() => {
    const cat: any[] = unwrap(catalog.data) ?? [];
    if (cat.length === 0) return;
    const current = new Map<string, any>();
    for (const f of detail.data?.features ?? []) current.set(f.feature_key, f);
    setFeatures(
      cat.map((f) => {
        const cur = current.get(f.key);
        return {
          key: f.key,
          name: f.name,
          category: f.category,
          type: f.type,
          value_type: f.value_type,
          allowed_values: Array.isArray(f.allowed_values) ? f.allowed_values : null,
          enabled: cur ? !!cur.enabled : false,
          limit_value:
            cur && cur.limit_value !== null && cur.limit_value !== undefined
              ? Number(cur.limit_value)
              : null,
          enum_value: cur?.enum_value ?? null,
        };
      })
    );
  }, [catalog.data, detail.data]);

  function toggle(k: string) {
    setFeatures((fs) => fs.map((f) => (f.key === k ? { ...f, enabled: !f.enabled } : f)));
  }
  function setLimit(k: string, v: number | null) {
    setFeatures((fs) => fs.map((f) => (f.key === k ? { ...f, limit_value: v } : f)));
  }
  function setEnum(k: string, v: string) {
    setFeatures((fs) => fs.map((f) => (f.key === k ? { ...f, enum_value: v } : f)));
  }

  async function save() {
    setErr(null);
    if (!name || (!edition && !key)) {
      setErr("Name and key are required.");
      return;
    }
    setBusy(true);
    try {
      let id = edition?.id;
      if (edition) {
        await api.patch(`/editions/${id}`, {
          name,
          description: description || null,
          trial_days: Number(trialDays) || 0,
          is_public: isPublic,
          ...(status !== edition.status ? { status } : {}),
        });
      } else {
        const created = await api.post<any>("/editions", {
          key: key.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
          name,
          description: description || undefined,
          trial_days: Number(trialDays) || 0,
          is_public: isPublic,
        });
        id = created?.id ?? created?.data?.id;
      }
      // Set the edition's features. Shape each row per its type so the API's
      // §4.3 validation passes (flags carry no value; enum needs enum_value).
      if (id && features.length > 0) {
        const payload = features.map((f) => {
          const row: {
            feature_key: string;
            enabled: boolean;
            limit_value?: number | null;
            enum_value?: string | null;
          } = { feature_key: f.key, enabled: f.enabled };
          if (f.type !== "flag") {
            if (f.value_type === "enum") {
              if (f.enabled)
                row.enum_value = f.enum_value ?? f.allowed_values?.[0] ?? null;
            } else {
              row.limit_value = f.enabled ? f.limit_value : null;
            }
          }
          return row;
        });
        await api.put(`/editions/${id}/features`, { features: payload });
      }
      toast(edition ? "Edition saved" : "Edition created");
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Group features for the checklist.
  const grouped = features.reduce<Record<string, FeatureRow[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <Drawer
      open
      title={edition ? `Edit edition · ${edition.name}` : "New edition"}
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save edition"}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input type="text" placeholder="e.g. Professional" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="two-col">
        <Field label="Key">
          <input
            type="text"
            className="mono"
            placeholder="professional"
            value={key}
            disabled={!!edition}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <Segmented
            options={[
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
              { value: "archived", label: "Archived" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea placeholder="Who this plan is for…" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="two-col">
        <Field label="Trial length (days)">
          <input type="number" className="mono" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        </Field>
        <Field label="Publicly listed">
          <div className="cl" style={{ borderTop: "none", paddingTop: 4 }}>
            {isPublic ? "Public" : "Private"}
            <Switch on={isPublic} onToggle={() => setIsPublic((v) => !v)} />
          </div>
        </Field>
      </div>

      <label className="fl" style={{ marginBottom: 8 }}>
        Included features
      </label>
      {catalog.loading || detail.loading ? (
        <div className="csub">Loading features…</div>
      ) : features.length === 0 ? (
        <div className="csub">No features in the catalog.</div>
      ) : (
        <div className="checklist">
          {Object.entries(grouped).map(([cat, fs]) => (
            <div key={cat}>
              <div className="cl-grp">{cat}</div>
              {fs.map((f) => (
                <div className="cl" key={f.key}>
                  <span style={{ flex: 1 }}>{f.name}</span>
                  {f.enabled && f.type !== "flag" && (
                    f.value_type === "enum" ? (
                      <select
                        className="cl-input"
                        value={f.enum_value ?? f.allowed_values?.[0] ?? ""}
                        onChange={(e) => setEnum(f.key, e.target.value)}
                      >
                        {(f.allowed_values ?? []).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        className="cl-input mono"
                        placeholder="Unlimited"
                        value={f.limit_value ?? ""}
                        onChange={(e) =>
                          setLimit(f.key, e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    )
                  )}
                  <Switch on={f.enabled} onToggle={() => toggle(f.key)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

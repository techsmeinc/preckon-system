"use client";

import { Fragment, useMemo, useState } from "react";
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
  Skeleton,
  ErrorBox,
  EmptyState,
} from "../_ui";

interface Feature {
  id: string;
  key: string;
  name: string;
  description?: string;
  category: string;
  type: string;
  value_type?: string;
  status: string;
  editions?: string[];
}

export default function FeaturesPage() {
  const toast = useToast();
  const canWrite = useCan("feature.write");
  const features = useApi<any>("/features");
  const editions = useApi<any>("/editions");

  const [cat, setCat] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Feature | "new" | null>(null);

  const list: Feature[] = unwrap(features.data) ?? [];
  const edList: any[] = unwrap(editions.data) ?? [];

  const categories = useMemo(() => {
    const set = new Set(list.map((f) => f.category));
    return ["all", ...Array.from(set)];
  }, [list]);

  const filtered = list.filter((f) => {
    const okCat = cat === "all" || f.category === cat;
    const q = search.toLowerCase();
    const okQ = !q || (f.name + " " + f.key + " " + (f.description ?? "")).toLowerCase().includes(q);
    return okCat && okQ;
  });

  // Group filtered features by category, preserving list order.
  const groups = useMemo(() => {
    const g: Record<string, Feature[]> = {};
    const order: string[] = [];
    for (const f of filtered) {
      if (!g[f.category]) (g[f.category] = []), order.push(f.category);
      g[f.category].push(f);
    }
    return order.map((c) => ({ category: c, items: g[c] }));
  }, [filtered]);

  function pills(f: Feature) {
    const inEd = new Set(f.editions ?? []);
    return (
      <span className="ed-pills">
        {edList.map((e) => (
          <span key={e.id} className={"ep" + (inEd.has(e.key) ? " on" : "")}>
            {e.name[0].toUpperCase()}
          </span>
        ))}
      </span>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Features</h2>
          <p>The catalog editions draw from. Each feature is a flag or a limit an edition can switch on.</p>
        </div>
        {canWrite && (
          <button className="mini pri" onClick={() => setEditing("new")}>
            + New feature
          </button>
        )}
      </div>

      <div className="fbar">
        <div className="range">
          {categories.map((c) => (
            <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>
              {c === "all" ? "All" : c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <div className="fsearch">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input placeholder="Search features…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {features.loading ? (
        <Skeleton rows={8} />
      ) : features.error ? (
        <ErrorBox message={features.error} onRetry={features.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No features match" />
      ) : (
        <div className="card" style={{ padding: "14px 18px" }}>
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Type</th>
                <th>Description</th>
                <th>Editions</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.category}>
                  <tr className="grp-row">
                    <td colSpan={6}>
                      {g.category} · {g.items.length}
                    </td>
                  </tr>
                  {g.items.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <div className="t-name">{f.name}</div>
                        <div className="fkey">{f.key}</div>
                      </td>
                      <td>
                        <span className={"type-chip " + (f.type === "limit" ? "type-limit" : "type-flag")}>
                          {f.type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ color: "var(--slate-500)", fontSize: 12.5 }}>{f.description ?? "—"}</td>
                      <td>{pills(f)}</td>
                      <td>
                        <StatusChip status={f.status} />
                      </td>
                      <td className="r">
                        {canWrite && (
                          <button className="rowbtn" onClick={() => setEditing(f)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <FeatureDrawer
          feature={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            features.reload();
          }}
        />
      )}
    </>
  );
}

/* ── Create / edit drawer ──────────────────────────────────────────────────*/

const TYPE_TO_VALUE: Record<string, string> = { flag: "boolean", limit: "numeric", metric: "numeric" };

function FeatureDrawer({
  feature,
  onClose,
  onSaved,
}: {
  feature: Feature | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(feature?.name ?? "");
  const [key, setKey] = useState(feature?.key ?? "");
  const [category, setCategory] = useState(feature?.category ?? "module");
  const [type, setType] = useState(feature?.type ?? "flag");
  const [description, setDescription] = useState(feature?.description ?? "");
  const [status, setStatus] = useState(feature?.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!name || (!feature && !key)) {
      setErr("Name and key are required.");
      return;
    }
    setBusy(true);
    try {
      if (feature) {
        await api.patch(`/features/${feature.id}`, { name, description: description || null, status });
      } else {
        await api.post("/features", {
          key: key.toLowerCase().replace(/[^a-z0-9_.]/g, ""),
          name,
          description: description || undefined,
          category,
          type,
          value_type: TYPE_TO_VALUE[type] ?? "boolean",
        });
      }
      toast(feature ? "Feature saved" : "Feature created");
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title={feature ? `Edit feature · ${feature.name}` : "New feature"}
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save feature"}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input type="text" placeholder="e.g. Construction Copilot" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Key">
        <input
          type="text"
          className="mono"
          placeholder="cap.copilot"
          value={key}
          disabled={!!feature}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Field label="Category">
        <Segmented
          options={[
            { value: "module", label: "Module" },
            { value: "capability", label: "Capability" },
            { value: "limit", label: "Limit" },
            { value: "usage", label: "Usage" },
          ]}
          value={category}
          onChange={setCategory}
        />
      </Field>
      <Field label="Type">
        <Segmented
          options={[
            { value: "flag", label: "Flag" },
            { value: "limit", label: "Limit" },
            { value: "metric", label: "Metric" },
          ]}
          value={type}
          onChange={setType}
        />
      </Field>
      <Field label="Description">
        <textarea placeholder="What this feature does, in plain terms…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {feature && (
        <Field label="Status">
          <Segmented
            options={[
              { value: "active", label: "Active" },
              { value: "deprecated", label: "Deprecated" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </Field>
      )}
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

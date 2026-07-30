"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  useApi,
  errMessage,
  useToast,
  useCan,
  StatusChip,
  Drawer,
  Field,
  Switch,
  Skeleton,
  ErrorBox,
} from "../_ui";

// Flatten { namespaces: { ns: { "<key>": { value, description } } } } → { "<key>": value }.
function flattenSettings(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  const ns = data?.namespaces ?? {};
  for (const entries of Object.values(ns) as any[]) {
    for (const [key, meta] of Object.entries(entries as any)) {
      out[key] = (meta as any)?.value;
    }
  }
  return out;
}

const TABS = [
  { key: "general", label: "General" },
  { key: "security", label: "Security" },
  { key: "ai", label: "AI providers" },
  { key: "email", label: "Email" },
  { key: "maintenance", label: "Maintenance" },
];

export default function SettingsPage() {
  const toast = useToast();
  const canWrite = useCan("settings.write");
  const canAiWrite = useCan("settings.ai.write");
  const canMaint = useCan("maintenance.toggle");
  const [tab, setTab] = useState("general");

  const settings = useApi<any>("/settings");
  const providers = useApi<any>(tab === "ai" ? "/settings/ai/providers" : null);
  const routing = useApi<any>(tab === "ai" ? "/settings/ai/routing" : null);
  const emailCfg = useApi<any>(tab === "email" ? "/settings/email" : null);

  const flat = useMemo(() => flattenSettings(settings.data), [settings.data]);
  const [form, setForm] = useState<Record<string, any>>({});
  useEffect(() => {
    if (settings.data) setForm(flattenSettings(settings.data));
  }, [settings.data]);
  const val = (k: string, d: any = "") => (form[k] ?? flat[k] ?? d);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // PATCH the given keys; coerce back to the original scalar type. Never sends maintenance.*.
  async function saveSettings(keys: string[]) {
    if (!canWrite) return;
    const body: Record<string, any> = {};
    for (const k of keys) {
      if (k.startsWith("maintenance.")) continue;
      let v = form[k] ?? flat[k];
      if (typeof flat[k] === "number") v = Number(v);
      body[k] = v;
    }
    try {
      await api.patch("/settings", body);
      toast("Settings saved");
    } catch (e) {
      toast(errMessage(e));
    }
  }

  const [maintOn, setMaintOn] = useState(false);
  const [maintMsg, setMaintMsg] = useState("");
  useEffect(() => {
    setMaintOn(!!flat["maintenance.enabled"]);
    setMaintMsg(flat["maintenance.message"] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  async function saveMaintenance(next: boolean) {
    if (!canMaint) return;
    try {
      await api.post("/settings/maintenance", { enabled: next, message: maintMsg });
      setMaintOn(next);
      toast(next ? "Maintenance mode on" : "Maintenance mode off");
    } catch (e) {
      toast(errMessage(e));
    }
  }

  const providerRows: any[] = providers.data?.providers ?? [];
  const tiers: Record<string, any[]> = routing.data?.tiers ?? {};
  const emailConfig: Record<string, any> = emailCfg.data?.config ?? {};
  const domains: any[] = emailCfg.data?.domains ?? [];

  const [showProvider, setShowProvider] = useState(false);
  const [newDomain, setNewDomain] = useState("");

  async function addDomain() {
    if (!canWrite || !newDomain.trim()) return;
    try {
      await api.post("/settings/email/domains", { domain: newDomain.trim() });
      setNewDomain("");
      toast("Domain added");
      emailCfg.reload();
    } catch (e) {
      toast(errMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Host settings</h2>
          <p>Global configuration for the whole platform.</p>
        </div>
      </div>

      <div className="fbar">
        <div className="range">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {settings.loading ? (
        <Skeleton rows={6} />
      ) : settings.error && tab !== "ai" && tab !== "email" ? (
        <ErrorBox message={settings.error} onRetry={settings.reload} />
      ) : (
        <>
          {tab === "general" && (
            <div className="card">
              <h3>General</h3>
              <div className="csub">Platform basics</div>
              <div className="two-col" style={{ marginTop: 8 }}>
                <Field label="Platform name">
                  <input
                    type="text"
                    value={val("general.platform_name", "Preckon")}
                    onChange={(e) => set("general.platform_name", e.target.value)}
                  />
                </Field>
                <Field label="Impersonation time-box (minutes)">
                  <input
                    type="text"
                    className="mono"
                    value={val("impersonation.max_minutes", 30)}
                    onChange={(e) => set("impersonation.max_minutes", e.target.value)}
                  />
                </Field>
                <Field label="Offboarding retention (days)">
                  <input
                    type="text"
                    className="mono"
                    value={val("offboarding.retention_days", 30)}
                    onChange={(e) => set("offboarding.retention_days", e.target.value)}
                  />
                </Field>
                <Field label="Entitlement cache TTL (seconds)">
                  <input
                    type="text"
                    className="mono"
                    value={val("entitlements.cache_ttl_seconds", 300)}
                    onChange={(e) => set("entitlements.cache_ttl_seconds", e.target.value)}
                  />
                </Field>
              </div>
              {canWrite && (
                <button
                  className="mini pri"
                  style={{ marginTop: 4 }}
                  onClick={() =>
                    saveSettings([
                      "general.platform_name",
                      "impersonation.max_minutes",
                      "offboarding.retention_days",
                      "entitlements.cache_ttl_seconds",
                    ])
                  }
                >
                  Save
                </button>
              )}
            </div>
          )}

          {tab === "security" && (
            <div className="card">
              <h3>Security defaults</h3>
              <div className="csub">Applied across host staff accounts</div>
              <div
                className="csub"
                style={{ marginTop: 8, color: "var(--amber)", display: "flex", gap: 6, alignItems: "center" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v4M12 17v.4" />
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
                These policies apply platform-wide to every tenant and host user.
              </div>
              <div className="checklist" style={{ marginTop: 10 }}>
                <div className="cl">
                  Require 2FA for host users
                  <Switch on={!!val("security.require_2fa", true)} onToggle={() => set("security.require_2fa", !val("security.require_2fa", true))} />
                </div>
              </div>
              <div className="two-col" style={{ marginTop: 14 }}>
                <Field label="Session length (hours)">
                  <input
                    type="text"
                    className="mono"
                    value={val("security.session_max_hours", 12)}
                    onChange={(e) => set("security.session_max_hours", e.target.value)}
                  />
                </Field>
                <Field label="Password min length">
                  <input
                    type="text"
                    className="mono"
                    value={val("security.password_min_length", 12)}
                    onChange={(e) => set("security.password_min_length", e.target.value)}
                  />
                </Field>
              </div>
              {canWrite && (
                <button
                  className="mini pri"
                  onClick={() => saveSettings(["security.require_2fa", "security.session_max_hours", "security.password_min_length"])}
                >
                  Save
                </button>
              )}
            </div>
          )}

          {tab === "ai" && (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="chead">
                  <div>
                    <h3>AI providers</h3>
                    <div className="csub">Provider-independent — no single vendor sees a whole project</div>
                  </div>
                  {canAiWrite && (
                    <button className="mini" onClick={() => setShowProvider(true)}>
                      + Add provider
                    </button>
                  )}
                </div>
                {providers.loading ? (
                  <Skeleton rows={3} />
                ) : providers.error ? (
                  <ErrorBox message={providers.error} onRetry={providers.reload} />
                ) : providerRows.length === 0 ? (
                  <div className="csub" style={{ padding: "14px 0" }}>No providers configured.</div>
                ) : (
                  <table style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Kind</th>
                        <th>Base URL</th>
                        <th>API key</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerRows.map((p) => (
                        <tr key={p.id ?? p.key}>
                          <td className="t-name">{p.name}</td>
                          <td className="num">{p.kind ?? "—"}</td>
                          <td className="mono" style={{ fontSize: 11.5, color: "var(--slate-500)" }}>{p.base_url ?? "—"}</td>
                          <td className="mono" style={{ fontSize: 11.5, color: "var(--slate-400)" }}>{p.api_key_secret_ref ?? "••••"}</td>
                          <td>
                            <StatusChip status={p.status ?? "active"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card">
                <h3>Routing</h3>
                <div className="csub">Fallback order per tier</div>
                {routing.loading ? (
                  <Skeleton rows={2} />
                ) : routing.error ? (
                  <ErrorBox message={routing.error} onRetry={routing.reload} />
                ) : Object.keys(tiers).length === 0 ? (
                  <div className="csub" style={{ padding: "14px 0" }}>No routing rules configured.</div>
                ) : (
                  <table style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th>Priority</th>
                        <th>Provider</th>
                        <th>Model</th>
                        <th>Max tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(tiers).flatMap(([tier, rules]) =>
                        (rules ?? [])
                          .slice()
                          .sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0))
                          .map((r: any) => (
                            <tr key={r.id}>
                              <td className="num">{tier}</td>
                              <td className="num">{r.priority ?? 0}</td>
                              <td>{r.provider_name ?? "—"}</td>
                              <td className="mono" style={{ fontSize: 12 }}>{r.model ?? "—"}</td>
                              <td className="num">{r.params?.max_tokens ?? "—"}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {tab === "email" && (
            <div className="card">
              <h3>Email</h3>
              <div className="csub">How Preckon sends transactional and broadcast email</div>
              {emailCfg.loading ? (
                <Skeleton rows={3} />
              ) : emailCfg.error ? (
                <ErrorBox message={emailCfg.error} onRetry={emailCfg.reload} />
              ) : (
                <>
                  <div className="two-col" style={{ marginTop: 8 }}>
                    <Field label="Provider">
                      <input type="text" defaultValue={emailConfig["email.provider"] ?? ""} readOnly />
                    </Field>
                    <Field label="From address">
                      <input type="text" className="mono" defaultValue={emailConfig["email.from_address"] ?? ""} readOnly />
                    </Field>
                    <Field label="API key secret">
                      <input type="text" className="mono" defaultValue={emailConfig["email.api_key_secret_ref"] ?? ""} readOnly />
                    </Field>
                  </div>
                  <label className="fl" style={{ margin: "6px 0 8px" }}>
                    Sending domains
                  </label>
                  {domains.length === 0 ? (
                    <div className="csub">No domains added.</div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Domain</th>
                          <th>Status</th>
                          <th>DNS records</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map((d) => (
                          <tr key={d.id ?? d.domain}>
                            <td className="mono">{d.domain}</td>
                            <td>
                              <StatusChip status={d.status ?? "pending"} />
                            </td>
                            <td style={{ fontSize: 11 }}>
                              {(d.dns_records ?? []).map((rec: any, i: number) => (
                                <div key={i} className="mono" style={{ color: "var(--slate-500)" }}>
                                  {rec.type} {rec.host} → {rec.value}
                                </div>
                              ))}
                            </td>
                            <td className="r">
                              {canWrite && (
                                <button
                                  className="rowbtn"
                                  onClick={async () => {
                                    try {
                                      await api.post(`/settings/email/domains/${d.id}/verify`, {});
                                      toast("Verification run");
                                      emailCfg.reload();
                                    } catch (e) {
                                      toast(errMessage(e));
                                    }
                                  }}
                                >
                                  Verify
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {canWrite && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                      <input
                        type="text"
                        className="mono"
                        placeholder="mail.example.com"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        style={{ maxWidth: 260 }}
                      />
                      <button className="mini pri" onClick={addDomain} disabled={!newDomain.trim()}>
                        Add domain
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "maintenance" && (
            <div className="card">
              <div className="chead">
                <div>
                  <h3>Maintenance mode</h3>
                  <div className="csub">Show a banner and pause new jobs platform-wide</div>
                </div>
                {canMaint && <Switch on={maintOn} onToggle={() => saveMaintenance(!maintOn)} />}
              </div>
              <Field label="Message shown to tenants">
                <textarea
                  placeholder="e.g. Preckon is undergoing scheduled maintenance and will be back shortly."
                  value={maintMsg}
                  onChange={(e) => setMaintMsg(e.target.value)}
                />
              </Field>
              {canMaint && (
                <button className="mini pri" onClick={() => saveMaintenance(maintOn)}>
                  Save message
                </button>
              )}
            </div>
          )}
        </>
      )}

      {showProvider && (
        <ProviderDrawer
          onClose={() => setShowProvider(false)}
          onSaved={() => {
            setShowProvider(false);
            providers.reload();
          }}
        />
      )}
    </>
  );
}

/* ── Add AI provider drawer ────────────────────────────────────────────────*/

function ProviderDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [kind, setKind] = useState("llm");
  const [baseUrl, setBaseUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!name || !key) {
      setErr("Name and key are required.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/settings/ai/providers", {
        name,
        key,
        kind,
        base_url: baseUrl || undefined,
        api_key_secret_ref: secretRef || undefined,
      });
      toast(`Provider "${name}" added`);
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
      title="Add AI provider"
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Add provider"}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input type="text" placeholder="e.g. Anthropic" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Key">
        <input type="text" className="mono" placeholder="anthropic" value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="llm">llm</option>
          <option value="embedding">embedding</option>
        </select>
      </Field>
      <Field label="Base URL">
        <input type="text" className="mono" placeholder="https://api.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </Field>
      <Field label="API key secret ref">
        <input type="text" className="mono" placeholder="secret://ai/example" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} />
      </Field>
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useApi, useCan, useToast, Skeleton } from "@/lib/ui";
import { api } from "@/lib/apiclient";

// The tenant's assistant/domain: pick an industry template (onboarding) and edit
// the configured domain (names, assistant, module labels). Domain-agnostic —
// nothing here is construction-specific.
export default function AssistantPage() {
  const canEdit = useCan("admin.settings");
  const toast = useToast();
  const dom = useApi<any>("/domain");
  const templates = useApi<any[]>("/domain/templates");

  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [assistant, setAssistant] = useState("");
  const [mods, setMods] = useState<Record<string, { label: string; description: string }>>({});

  const d = dom.data;
  useEffect(() => {
    if (!d?.editable) return;
    setName(d.name ?? "");
    setAssistant(d.assistant?.name ?? "");
    const m: Record<string, { label: string; description: string }> = {};
    for (const x of d.modules ?? []) m[x.key] = { label: x.label ?? "", description: x.description ?? "" };
    setMods(m);
  }, [d]);

  async function pick(tk: string, tname: string) {
    if (!canEdit) { toast("You need admin.settings to change the industry"); return; }
    if (!window.confirm(`Configure this workspace as a "${tname}" assistant? New modules and stages apply; existing projects are kept.`)) return;
    setBusy(tk);
    try { await api.post("/domain/provision", { templateKey: tk }); toast(`Now a ${tname} assistant`); dom.reload(); }
    catch (e: any) { toast(e?.message ?? "Couldn’t configure"); }
    finally { setBusy(null); }
  }

  async function save() {
    try {
      await api.put("/domain", { name, assistantName: assistant, modules: Object.entries(mods).map(([key, v]) => ({ key, label: v.label, description: v.description })) });
      toast("Saved — your assistant is updated");
      dom.reload();
    } catch (e: any) { toast(e?.message ?? "Couldn’t save"); }
  }

  return (
    <>
      <div className="page-head"><div><h2>Your assistant</h2><p>Configure this tenant to your industry. Pick a starting point, then tailor it — no code.</p></div></div>

      {dom.loading ? <Skeleton rows={3} /> : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="chead"><h3>Current domain</h3>{d?.industry && <span className="chip plain">{d.industry}</span>}</div>
          {d?.domainKey ? (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <div><div className="csub" style={{ margin: 0 }}>Workspace</div><div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18 }}>{d.name}</div></div>
              <div><div className="csub" style={{ margin: 0 }}>Assistant</div><div style={{ fontSize: 15 }}>{d.assistant?.name ?? "—"}</div></div>
              <div><div className="csub" style={{ margin: 0 }}>Modules</div><div style={{ fontSize: 15 }}>{(d.modules ?? []).length}</div></div>
              {!d.editable && <span className="chip draft plain">first-party (read-only)</span>}
            </div>
          ) : <p className="csub" style={{ margin: 0 }}>No domain configured yet — pick an industry below to get started.</p>}
        </div>
      )}

      {d?.editable && canEdit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="chead"><h3>Tailor your assistant</h3><button className="mini sm pri" onClick={save}>Save changes</button></div>
          <div className="row two" style={{ marginBottom: 12 }}>
            <label style={{ display: "block" }}><div className="csub" style={{ margin: "0 0 4px" }}>Workspace name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inp} /></label>
            <label style={{ display: "block" }}><div className="csub" style={{ margin: "0 0 4px" }}>Assistant name</div>
              <input value={assistant} onChange={(e) => setAssistant(e.target.value)} style={inp} /></label>
          </div>
          <div className="csub" style={{ margin: "0 0 8px" }}>Modules (the stages your work flows through)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(d.modules ?? []).map((m: any) => (
              <div key={m.key} style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 9, padding: 8 }}>
                <span style={{ fontSize: 18, width: 26, textAlign: "center" }}>{m.icon}</span>
                <input value={mods[m.key]?.label ?? ""} onChange={(e) => setMods((s) => ({ ...s, [m.key]: { ...s[m.key], label: e.target.value } }))} style={{ ...inp, maxWidth: 180 }} />
                <input value={mods[m.key]?.description ?? ""} onChange={(e) => setMods((s) => ({ ...s, [m.key]: { ...s[m.key], description: e.target.value } }))} style={{ ...inp, flex: 1 }} placeholder="what this stage does" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="chead"><h3>Choose your industry</h3><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{templates.data?.length ?? 0} templates</span></div>
        {templates.loading ? <Skeleton rows={4} /> : (
          <div className="mcards">
            {(templates.data ?? []).map((t) => {
              const current = d?.templateKey === t.key;
              return (
                <div key={t.key} className="mcard" style={{ borderColor: current ? "var(--teal)" : undefined }}>
                  <div className="mtop"><span className="micon">{t.icon}</span>{current && <span className="chip confirmed" style={{ fontSize: 10 }}>current</span>}</div>
                  <div><div className="mkind">{t.industry}</div><div className="mname">{t.name}</div></div>
                  <div className="mdesc">{t.blurb}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
                    {(t.stages ?? []).map((s: string) => <span key={s} className="chip plain" style={{ fontSize: 10 }}>{s}</span>)}
                  </div>
                  <div className="mact">
                    <button className="mini sm pri" disabled={!canEdit || busy === t.key || current} onClick={() => pick(t.key, t.name)}>
                      {current ? "Active" : busy === t.key ? "Configuring…" : "Use this →"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!canEdit && <p className="csub" style={{ marginTop: 10 }}>Only an admin can change the workspace’s industry.</p>}
      </div>
    </>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--panel)", color: "var(--ink)", fontSize: 13 };

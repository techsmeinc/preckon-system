"use client";
import { use, useEffect, useState } from "react";
import { useApi, useToast, Skeleton, EmptyState } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { typeLabel, humanize } from "@/lib/catalog";

export default function ColleaguesPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const personas = useApi<any[]>("/personas");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!active && personas.data?.length) setActive(personas.data.find((p) => p.isDefault)?.key ?? personas.data[0].key);
  }, [personas.data, active]);

  if (personas.loading) return <Skeleton rows={4} />;
  if ((personas.data ?? []).length === 0) return <EmptyState title="No colleagues licensed" sub="Digital colleagues light up with your edition." />;

  const roster = personas.data ?? [];
  return (
    <>
      <p className="csub" style={{ marginTop: 0 }}>Digital colleagues preside over a slice of the work. They flag, propose and chat — a licensed human always disposes.</p>
      <div className="seg" style={{ marginBottom: 16 }}>
        {roster.map((p) => (
          <button key={p.key} className={active === p.key ? "on" : ""} onClick={() => setActive(p.key)}>{p.label}{p.isDefault ? " ·" : ""}</button>
        ))}
      </div>
      {active && <ColleaguePanel key={active} pid={pid} persona={roster.find((p) => p.key === active)} />}
    </>
  );
}

function ColleaguePanel({ pid, persona }: { pid: string; persona: any }) {
  const toast = useToast();
  const [cid, setCid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const lens = useApi<any[]>(`/projects/${pid}/personas/${persona.key}/review-queue`, [], { refreshMs: 3000 });
  const msgs = useApi<{ messages: any[] }>(cid ? `/projects/${pid}/conversations/${cid}` : null, [], { refreshMs: 1400 });

  useEffect(() => {
    api.post<{ id: string }>(`/projects/${pid}/conversations`, { supervisor_key: persona.key })
      .then((c) => setCid(c.id)).catch(() => {});
  }, [pid, persona.key]);

  useEffect(() => { if (msgs.data?.messages?.at(-1)?.role === "assistant") setThinking(false); }, [msgs.data]);

  async function send() {
    if (!cid || !text.trim()) return;
    const body = text; setText(""); setThinking(true);
    try { await api.post(`/projects/${pid}/conversations/${cid}/messages`, { content: body }); msgs.reload(); }
    catch (e: any) { toast(e?.message ?? "Failed"); setThinking(false); }
  }

  const messages = msgs.data?.messages ?? [];
  return (
    <div className="row two">
      <div className="card" style={{ display: "flex", flexDirection: "column" }}>
        <div className="chead"><h3>💬 {persona.label}</h3><span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{(persona.deviations ?? []).join(" · ") || "all deviations"}</span></div>
        <div className="chat">
          {messages.map((m) => <div key={m.id} className={"bubble " + m.role}>{m.content}</div>)}
          {thinking && <div className="bubble assistant"><span className="spin" /> thinking…</div>}
          {messages.length === 0 && !thinking && <div className="csub">Say hello — this colleague proposes, never disposes.</div>}
        </div>
        <div className="chat-in">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={`Ask ${persona.label}…`} />
          <button className="mini pri" onClick={send}>Send</button>
        </div>
      </div>
      <div className="card">
        <div className="chead"><h3>{persona.label}&apos;s lens</h3><span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{(lens.data ?? []).length} in scope</span></div>
        <p className="csub" style={{ marginTop: -6 }}>Pending proposals within this colleague&apos;s scope.</p>
        {lens.loading ? <Skeleton rows={2} /> : (lens.data ?? []).length === 0 ? <p className="csub" style={{ margin: 0 }}>Nothing in this colleague&apos;s scope right now.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(lens.data ?? []).map((it) => (
              <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 9 }}>
                <span className="chip pending">{typeLabel(it.type_key)}</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{humanize(it.source_agent_key)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

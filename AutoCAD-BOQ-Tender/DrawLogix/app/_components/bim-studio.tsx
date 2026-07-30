"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DIVISION_ROLES } from "@/auth/roles";
import { bimAgentAction } from "@/server/actions";
import { bimMetaAction, chatAction, loadBimModelAction, postChatAction, saveBimModelAction } from "@/server/collab-actions";
import { SPECIALIST_LIST, type SpecialistId } from "@/bim/agents";
import { UserMenu } from "./user-menu";
import { type ChatMsg, TeamChat } from "./team-chat";
import { useProjectStream } from "./use-project-stream";
import { type Command, type History, initHistory, redo, run, undo } from "@/bim/commands";
import { type BimDocument, CATALOG, type CatalogItem, catalogByDiscipline, type Discipline, DISCIPLINES, type Element, emptyDocument, list } from "@/bim/model";
import { BimPlan } from "./bim-plan";
import { BimViewport } from "./bim-viewport";

/**
 * DrawLogix BIM Studio — the AI-native, multi-discipline 3D BIM workspace. A discipline
 * ribbon (Architecture / Structural / Civil / Electrical / Mechanical / Plumbing / Fire),
 * a catalog toolbar, a 3D viewport, and an AI assistant (text + voice) — the toolbar and
 * the assistant drive the SAME command layer, with undo/redo across both.
 */

type Msg = { role: "user" | "assistant"; text: string };

const SPEC_EXAMPLES: Record<SpecialistId, string> = {
  all: "• “design a 8×6 m 2-bed apartment with doors, windows and bathroom fixtures”\n• “add structure, MEP and a site layout to this building”",
  architectural: "• “lay out a 12×9 m office: reception, 2 offices, meeting room, pantry, WC”\n• “add doors and windows to every room; make external walls 250 mm”",
  structural: "• “add a 6 m column grid with beams and pad footings”\n• “make the slab 300 mm and add shear walls at the core”",
  civil: "• “add a perimeter fence, main gate, 6 m access road and 20 parking bays”\n• “add site drainage with manholes and a graded pad”",
  electrical: "• “add a light to every room and two sockets per wall”\n• “add a distribution board per zone and a standby generator”",
  mechanical: "• “add a diffuser to each room and route supply ducts down the corridor”\n• “put an FCU above each office and a VRF unit on the roof”",
  plumbing: "• “add a WC and basin to each bathroom and a sink in the pantry”\n• “add a roof water tank with a booster pump and run pipes”",
  fire: "• “add sprinklers on a 3 m grid across all ceilings”\n• “add smoke detectors to every room and a hydrant outside”",
  general: "• “build something sensible for this model”",
};

export function BimStudio({
  user,
  project,
  initialDoc,
  initialMeta,
  team = [],
}: {
  user?: { id: string; name: string; role: string };
  project?: { id: string; name: string };
  initialDoc?: unknown | null;
  initialMeta?: { updatedAtMs: number; updatedByName: string | null } | null;
  team?: { id: string; name: string; role: string }[];
}) {
  const [history, setHistory] = useState<History>(() => initHistory(coerceDoc(initialDoc)));
  const [selected, setSelected] = useState<string | null>(null);
  const myDivision = user && (DIVISION_ROLES as string[]).includes(user.role) ? (user.role as Discipline) : "architectural";
  const [discipline, setDiscipline] = useState<Discipline>(myDivision);
  const [hidden, setHidden] = useState<Set<Discipline>>(() => new Set());
  const [viewMode, setViewMode] = useState<"3d" | "2d" | "split">("3d");
  const [mobilePanel, setMobilePanel] = useState<"tools" | "ai" | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Division users land on their own specialist; managers start on the Coordinator.
  const [specialist, setSpecialist] = useState<SpecialistId>(user && (DIVISION_ROLES as string[]).includes(user.role) ? (user.role as SpecialistId) : "all");
  const doc = history.doc;
  const activeSpec = SPECIALIST_LIST.find((s) => s.id === specialist) ?? SPECIALIST_LIST[0];

  // ── Collaboration (only when opened for a shared project) ──────────────────
  const collab = !!project && !!user;
  const [rightTab, setRightTab] = useState<"ai" | "team">("ai");
  const showTeam = collab && rightTab === "team";
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(initialMeta ? "saved" : "idle");
  const [remoteUpdate, setRemoteUpdate] = useState<{ by: string | null } | null>(null);
  const serverMsRef = useRef<number>(initialMeta?.updatedAtMs ?? 0);
  const firstSaveRef = useRef(true);
  const skipNextSaveRef = useRef(false);

  // Debounced auto-save of the shared model on any change.
  useEffect(() => {
    if (!collab || !project) return;
    if (firstSaveRef.current) { firstSaveRef.current = false; return; }
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        const { savedAtMs } = await saveBimModelAction(project.id, doc);
        serverMsRef.current = savedAtMs;
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, collab, project]);

  // Poll for changes made by teammates → offer a reload.
  useEffect(() => {
    if (!collab || !project) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const meta = await bimMetaAction(project.id);
        if (alive && meta && meta.updatedAtMs > serverMsRef.current + 250) setRemoteUpdate({ by: meta.updatedByName });
      } catch {
        /* transient */
      }
    }, 20000); // SSE delivers instantly; this is just a fallback
    return () => { alive = false; clearInterval(t); };
  }, [collab, project]);

  async function reloadModel() {
    if (!project) return;
    try {
      const { doc: d, meta } = await loadBimModelAction(project.id);
      skipNextSaveRef.current = true;
      setHistory(initHistory(coerceDoc(d)));
      setSelected(null);
      serverMsRef.current = meta?.updatedAtMs ?? serverMsRef.current;
      setRemoteUpdate(null);
      setSaveState("saved");
    } catch {
      /* ignore */
    }
  }

  // ── Live team chat (state lifted here so unread survives tab switches) ──────
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [unread, setUnread] = useState(0);
  const [live, setLive] = useState(false);

  // Initial load + a slow reconcile poll (safety net if the stream drops a beat).
  useEffect(() => {
    if (!collab || !project) return;
    let alive = true;
    const load = () => chatAction(project.id).then((m) => { if (alive) setChatMessages(m as ChatMsg[]); }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [collab, project]);

  // Real-time stream: chat messages + model-change nudges, pushed instantly.
  useProjectStream(collab && project ? project.id : undefined, {
    onStatus: (s) => setLive(s === "open"),
    onChat: (m) => {
      setChatMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.userId !== user?.id && rightTab !== "team") setUnread((u) => u + 1);
    },
    onModel: (meta) => {
      if (meta.updatedById && meta.updatedById === user?.id) return; // our own save
      if (meta.updatedAtMs > serverMsRef.current + 250) setRemoteUpdate({ by: meta.updatedByName });
    },
  });

  // Clear the unread badge whenever the Team tab is open.
  useEffect(() => { if (rightTab === "team") setUnread(0); }, [rightTab]);

  async function sendChat(body: string, mentions: string[]) {
    if (!project) return;
    const msg = await postChatAction(project.id, body, mentions);
    if (msg) setChatMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
  }

  const dispatch = (cmds: Command | Command[]) => setHistory((h) => run(h, cmds));
  const selEl = selected ? doc.elements[selected] : undefined;
  const firstWall = useMemo(() => list(doc).find((e) => e.geom.kind === "linear" && /wall/.test(e.category))?.id, [doc]);
  const tools = useMemo(() => catalogByDiscipline(discipline), [discipline]);

  function placeTool(item: CatalogItem) {
    const c = item.category;
    if (item.kind === "hosted") {
      const host = selEl?.geom.kind === "linear" ? selEl.id : firstWall;
      if (host) dispatch({ name: "add", args: { category: c, host } });
      return;
    }
    if (item.kind === "linear") dispatch({ name: "add", args: { category: c, start: { x: 0, y: 0 }, end: { x: 5, y: 0 } } });
    else if (item.kind === "area") dispatch({ name: "add", args: { category: c, outline: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] } });
    else dispatch({ name: "add", args: { category: c, at: { x: 0, y: 0 } } });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const { reply, doc: newDoc, commandCount } = await retry(() => bimAgentAction(doc, text, [], specialist));
      if (commandCount > 0 && newDoc) setHistory((h) => ({ doc: newDoc, past: [...h.past.slice(-99), h.doc], future: [] }));
      setMessages((m) => [...m, { role: "assistant", text: `${specialist === "all" ? "" : `[${activeSpec.short}] `}${reply}${commandCount ? `  ·  ${commandCount} action${commandCount === 1 ? "" : "s"}` : ""}` }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `Error: ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<Discipline, number>();
    for (const e of list(doc)) if (e.category !== "level") m.set(e.discipline, (m.get(e.discipline) ?? 0) + 1);
    return m;
  }, [doc]);

  return (
    <div className="flex h-full flex-col bg-[#0d1017] text-slate-100">
      {/* Top bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-white/10 bg-[#151a24] px-2 py-1.5 sm:px-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-gradient-to-br from-indigo-500 to-sky-500 text-[11px] font-bold text-white">DL</span>
          <span className="text-sm font-semibold">BIM Studio</span>
          {project ? (
            <span className="max-w-[40vw] truncate rounded bg-indigo-500/20 px-1.5 py-0.5 text-[11px] font-medium text-indigo-200 sm:max-w-none" title={`Project: ${project.name}`}>{project.name}</span>
          ) : (
            <span className="hidden rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 sm:inline">Multi-discipline</span>
          )}
          {collab && (
            <span className="hidden text-[10px] text-slate-500 sm:inline">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved to project" : ""}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1 flex items-center rounded border border-white/10 bg-white/5 p-0.5">
            {(["3d", "2d", "split"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setViewMode(m)} className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors sm:px-2 ${viewMode === m ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}>
                {m === "3d" ? "3D" : m === "2d" ? "2D" : "Split"}
              </button>
            ))}
          </div>
          <TopBtn onClick={() => { setHistory(undo); setSelected(null); }} disabled={!history.past.length}>↶</TopBtn>
          <TopBtn onClick={() => setHistory(redo)} disabled={!history.future.length}>↷</TopBtn>
          <span className="mx-1 hidden text-xs text-slate-400 md:inline">{list(doc).filter((e) => e.category !== "level").length} elements</span>
          <Link href="/projects" className="hidden rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10 sm:inline">← Projects</Link>
          {user && <UserMenu name={user.name} role={user.role} dark />}
        </div>
      </header>

      {/* Discipline ribbon */}
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 bg-[#11151d] px-2 py-1">
        {DISCIPLINES.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDiscipline(d.id)}
            className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ${discipline === d.id ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
          >
            {d.label}
            {counts.get(d.id) ? <span className="ml-1 rounded-full bg-white/20 px-1 text-[10px]">{counts.get(d.id)}</span> : null}
          </button>
        ))}
      </nav>

      {/* Mobile panel toggles (hidden on desktop where panels are always visible) */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#11151d] px-2 py-1.5 lg:hidden">
        <button type="button" onClick={() => setMobilePanel("tools")} className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10">🧰 Tools</button>
        <button type="button" onClick={() => setMobilePanel("ai")} className="flex-1 rounded border border-indigo-400/40 bg-indigo-500/20 px-2 py-1.5 text-xs font-medium text-slate-100 hover:bg-indigo-500/30">🤖 AI Assistant</button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Mobile backdrop */}
        {mobilePanel && <button type="button" aria-label="Close panel" className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobilePanel(null)} />}

        {/* Left: tools + visibility (drawer on mobile, column on desktop) */}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col gap-3 overflow-y-auto border-r border-white/10 bg-[#11151d] p-2.5 shadow-2xl transition-transform lg:static lg:z-auto lg:w-52 lg:shadow-none lg:transition-none ${mobilePanel === "tools" ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
          <button type="button" onClick={() => setMobilePanel(null)} className="mb-1 self-end rounded p-1 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Close">✕</button>
          <Section title={`${DISCIPLINES.find((d) => d.id === discipline)?.label} tools`}>
            {discipline === "architectural" && (
              <Tool onClick={() => dispatch({ name: "add_room", args: { x: 0, y: 0, width: 5, depth: 4 } })}>▭ Room (5×4) + floor</Tool>
            )}
            {tools.map((t) => (
              <Tool key={t.category} onClick={() => placeTool(t)} swatch={t.color}>
                {t.label}
              </Tool>
            ))}
            <Tool onClick={() => dispatch({ name: "add_level", args: { name: `Level ${list(doc).filter((e) => e.category === "level").length}`, elevation: list(doc).filter((e) => e.category === "level").length * 3 } })}>⬒ Add level</Tool>
          </Section>

          <Section title="Disciplines (show/hide)">
            {DISCIPLINES.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-300 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={!hidden.has(d.id)}
                  onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}
                  className="accent-indigo-500"
                />
                {d.label}
              </label>
            ))}
          </Section>

          <Section title="Model">
            <Tool onClick={() => { setHistory((h) => run(h, { name: "clear", args: {} })); setSelected(null); }}>🗑 Clear</Tool>
          </Section>
        </aside>

        {/* Center: 3D / 2D / split */}
        <main className="relative flex min-w-0 flex-1 flex-col md:flex-row">
          {remoteUpdate && (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-3 border-b border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-100 backdrop-blur">
              <span>{remoteUpdate.by ? `${remoteUpdate.by} updated this model.` : "This model was updated."}</span>
              <button type="button" onClick={reloadModel} className="rounded bg-amber-400/90 px-2 py-0.5 font-semibold text-amber-950 hover:bg-amber-300">Reload</button>
              <button type="button" onClick={() => setRemoteUpdate(null)} className="text-amber-200/70 hover:text-amber-100" aria-label="Dismiss">✕</button>
            </div>
          )}
          {viewMode !== "2d" && (
            <div className={viewMode === "split" ? "min-h-0 min-w-0 flex-1 border-b border-white/10 md:border-b-0 md:border-r" : "min-h-0 min-w-0 flex-1"}>
              <BimViewport doc={doc} selected={selected} onSelect={setSelected} hidden={hidden} />
            </div>
          )}
          {viewMode !== "3d" && (
            <div className="min-h-0 min-w-0 flex-1">
              <BimPlan doc={doc} selected={selected} onSelect={setSelected} hidden={hidden} />
            </div>
          )}
          <Legend doc={doc} hidden={hidden} />
          {list(doc).filter((e) => e.category !== "level").length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="max-w-sm rounded-lg bg-black/45 px-4 py-3 text-center text-sm text-slate-200 backdrop-blur">
                <p className="font-medium">Empty model</p>
                <p className="mt-1 text-xs text-slate-400">Pick a discipline and a tool on the left, or tell the assistant → “design a 2-storey office: structure, walls, MEP and site”.</p>
              </div>
            </div>
          )}
        </main>

        {/* Right: properties + AI (drawer on mobile, column on desktop) */}
        <aside className={`fixed inset-y-0 right-0 z-40 flex w-[min(22rem,92vw)] flex-col border-l border-white/10 bg-[#11151d] shadow-2xl transition-transform lg:static lg:z-auto lg:w-80 lg:shadow-none lg:transition-none ${mobilePanel === "ai" ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}>
          {selEl && selEl.category !== "level" && (
            <div className="border-b border-white/10 p-3">
              <p className="mb-1.5 text-[11px] text-slate-400">
                <span className="uppercase tracking-wide text-slate-300">{selEl.category}</span> <span className="text-slate-500">{selEl.id}</span> · {selEl.discipline}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {editableFields(selEl).map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{f.key}</span>
                    <input type="number" step="0.1" defaultValue={f.value} onBlur={(ev) => dispatch({ name: "set_param", args: { id: selEl.id, key: f.key, value: Number(ev.target.value) } })} className="mt-0.5 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-400" />
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => { dispatch({ name: "delete", args: { id: selEl.id } }); setSelected(null); }} className="mt-2 w-full rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/25">Delete element</button>
            </div>
          )}

          {/* Tab bar: AI assistant vs live team chat (chat only for shared projects) */}
          <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
            <button type="button" onClick={() => setRightTab("ai")} className={`rounded px-2.5 py-1 text-xs font-medium ${!showTeam ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}>🤖 AI</button>
            {collab && (
              <button type="button" onClick={() => setRightTab("team")} className={`relative rounded px-2.5 py-1 text-xs font-medium ${showTeam ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}>
                💬 Team{team.length ? ` · ${team.length}` : ""}
                {unread > 0 && !showTeam && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={() => setMobilePanel(null)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Close">✕</button>
          </div>

          {showTeam && user && project ? (
            <div className="flex min-h-0 flex-1">
              <TeamChat me={user} team={team} messages={chatMessages} onSend={sendChat} live={live} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Specialist</span>
                <select
                  value={specialist}
                  onChange={(e) => setSpecialist(e.target.value as SpecialistId)}
                  title="Hand the model to a division specialist"
                  className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-indigo-400"
                >
                  {SPECIALIST_LIST.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#151a24]">
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.length === 0 ? (
                  <div className="space-y-2 text-xs text-slate-500">
                    <p className="text-slate-400">
                      Talking to the <span className="font-semibold text-indigo-300">{activeSpec.label}</span>
                      {specialist !== "all" && <span> — it only edits {activeSpec.short} elements and coordinates with the rest.</span>}
                    </p>
                    <p className="whitespace-pre-line">{SPEC_EXAMPLES[specialist]}</p>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div key={`${m.role}-${i}`} className={m.role === "user" ? "text-right" : "text-left"}>
                      <span className={`inline-block max-w-[92%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs ${m.role === "user" ? "bg-indigo-500/25" : "bg-white/5 text-slate-200"}`}>{m.text}</span>
                    </div>
                  ))
                )}
                {busy && <p className="text-xs text-slate-500">Designing… (multi-step)</p>}
              </div>
              <form onSubmit={send} className="flex items-center gap-1.5 border-t border-white/10 p-2">
                <Dictate onText={(t) => setInput((v) => (v ? `${v} ${t}` : t))} />
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={specialist === "all" ? "Say what to build…" : `Ask the ${activeSpec.short}…`} disabled={busy} className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400" />
                <button type="submit" disabled={busy || !input.trim()} className="rounded bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40">Send</button>
              </form>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Accept a saved/loaded document if it looks like a BimDocument, else start empty. */
function coerceDoc(d: unknown): BimDocument {
  if (d && typeof d === "object" && (d as { elements?: unknown }).elements && typeof (d as { elements?: unknown }).elements === "object") return d as BimDocument;
  return emptyDocument();
}

function editableFields(el: Element): { key: string; value: number }[] {
  const g = el.geom;
  const f: { key: string; value: number }[] = [];
  const push = (k: string, v?: number) => v !== undefined && f.push({ key: k, value: v });
  if (g.kind === "linear") {
    push("width", g.width);
    push("height", g.height);
  } else if (g.kind === "area") {
    push("thickness", g.thickness);
  } else if (g.kind === "point") {
    push("width", g.width);
    push("depth", g.depth);
    push("height", g.height);
  } else {
    push("width", g.width);
    push("height", g.height);
    push("offset", g.offset);
    push("sill", g.sill);
  }
  push("elevation", g.elevation ?? 0);
  return f;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Drawing legend — only the element types actually present, grouped by discipline. */
function Legend({ doc, hidden }: { doc: import("@/bim/model").BimDocument; hidden: Set<Discipline> }) {
  const [open, setOpen] = useState(true);
  const groups = useMemo(() => {
    const count = new Map<string, number>();
    for (const e of list(doc)) {
      if (e.category === "level" || hidden.has(e.discipline)) continue;
      count.set(e.category, (count.get(e.category) ?? 0) + 1);
    }
    const g = new Map<Discipline, { category: string; label: string; color: number; n: number }[]>();
    for (const [category, n] of count) {
      const item = CATALOG[category];
      if (!item) continue;
      const arr = g.get(item.discipline) ?? [];
      arr.push({ category, label: item.label, color: item.color, n });
      g.set(item.discipline, arr);
    }
    return g;
  }, [doc, hidden]);

  if (groups.size === 0) return null;
  return (
    <div className="absolute right-2 top-2 z-10 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#151a24]/95 text-slate-200 shadow-xl backdrop-blur sm:w-52">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300 hover:bg-white/5">
        <span>Legend</span>
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto px-2.5 pb-2.5">
          {DISCIPLINES.filter((d) => groups.has(d.id)).map((d) => (
            <div key={d.id}>
              <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">{d.label}</p>
              <ul className="space-y-0.5">
                {(groups.get(d.id) ?? []).sort((a, b) => b.n - a.n).map((r) => (
                  <li key={r.category} className="flex items-center gap-1.5 text-[11px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20" style={{ background: hex(r.color) }} />
                    <span className="flex-1 truncate text-slate-300">{r.label}</span>
                    <span className="tabular-nums text-slate-500">{r.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
    <div className="space-y-1">{children}</div>
  </div>
);
const Tool = ({ onClick, children, swatch }: { onClick: () => void; children: React.ReactNode; swatch?: number }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-left text-xs text-slate-200 transition-colors hover:border-indigo-400/50 hover:bg-white/10">
    {swatch !== undefined && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `#${swatch.toString(16).padStart(6, "0")}` }} />}
    <span className="truncate">{children}</span>
  </button>
);
const TopBtn = ({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-30">{children}</button>
);

function Dictate({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const ref = useRef<{ start: () => void; stop: () => void; abort?: () => void } | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as unknown as (new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results?: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void; abort?: () => void }) | undefined;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript;
      if (t) onText(t.trim());
    };
    rec.onend = () => setOn(false);
    rec.onerror = () => setOn(false);
    ref.current = rec;
    return () => rec.abort?.();
  }, [onText]);
  return (
    <button type="button" title="Dictate" onClick={() => { const r = ref.current; if (!r) return; if (on) { r.stop(); setOn(false); } else { try { r.start(); setOn(true); } catch { /* running */ } } }} className={`shrink-0 rounded border px-2 py-1.5 text-sm ${on ? "border-rose-400/50 bg-rose-500/20" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>🎙</button>
  );
}

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!/unexpected response|Failed to fetch|NetworkError|ECONN|fetch failed/i.test((e as Error)?.message ?? "") || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

"use client";
// Shell furniture that lives above every screen: the ⌘K command palette and the
// docked Copilot. Both are global — Copilot follows you from project to project
// and keeps its thread, because "ask about this bid" is not a separate app.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./apiclient";
import { Icon, type IconName } from "./icons";
import { useI18n } from "./i18n";

export interface ProjectLite {
  id: string;
  name: string;
  client_name: string | null;
  code: string | null;
}

/* ── ⌘K command palette ──────────────────────────────────────────────────── */

interface Cmd {
  id: string;
  label: string;   // already translated
  hint?: string;
  icon: IconName;
  group: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  projects,
  onCopilot,
  canAdmin = true,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectLite[];
  onCopilot: () => void;
  canAdmin?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  const all: Cmd[] = useMemo(() => {
    const screens: Cmd[] = [
      { id: "s:dash", label: t("nav.dashboard"), icon: "overview", group: t("cmd.goTo"), run: () => go("/overview") },
      { id: "s:proj", label: t("nav.projects"), icon: "projects", group: t("cmd.goTo"), run: () => go("/projects") },
      { id: "s:lib", label: t("nav.library"), icon: "library", group: t("cmd.goTo"), run: () => go("/library") },
      ...(canAdmin ? [{ id: "s:admin", label: t("nav.admin"), icon: "admin" as IconName, group: t("cmd.goTo"), run: () => go("/admin") }] : []),
      { id: "s:set", label: t("nav.settings"), icon: "settings", group: t("cmd.goTo"), run: () => go("/settings") },
    ];
    const actions: Cmd[] = [
      { id: "a:cop", label: t("cmd.askCopilot"), hint: "⌘/", icon: "copilot", group: t("cmd.actions"), run: () => { onClose(); onCopilot(); } },
      { id: "a:new", label: t("shell.newProject"), icon: "add", group: t("cmd.actions"), run: () => go("/projects?new=1") },
    ];
    const projs: Cmd[] = projects.map((p) => ({
      id: `p:${p.id}`,
      label: p.name,
      hint: p.client_name ?? p.code ?? undefined,
      icon: "projects" as IconName,
      group: t("cmd.projects"),
      run: () => go(`/projects/${p.id}`),
    }));
    return [...actions, ...screens, ...projs];
  }, [projects, go, onClose, onCopilot, canAdmin, t]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(needle));
  }, [all, q]);

  useEffect(() => setSel(0), [q]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[sel]?.run(); }
    else if (e.key === "Escape") { onClose(); }
  }

  // Render group headings inline as the list is walked.
  let lastGroup = "";

  return (
    <div className={"cmd-overlay" + (open ? " on" : "")} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label={t("cmd.title")}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("cmd.placeholder")}
          aria-label={t("common.search")}
        />
        <div className="cmd-list">
          {filtered.length === 0 && <div className="grp">{t("cmd.noMatches")}</div>}
          {filtered.map((c, i) => {
            const head = c.group !== lastGroup ? ((lastGroup = c.group), c.group) : null;
            const I = Icon[c.icon];
            return (
              <div key={c.id}>
                {head && <div className="grp">{head}</div>}
                <button className={i === sel ? "sel" : ""} onMouseEnter={() => setSel(i)} onClick={c.run}>
                  <I />
                  <span>{c.label}</span>
                  {c.hint && <span className="hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Copilot ─────────────────────────────────────────────────────────────── */

interface Msg {
  id: string;
  role: string;
  content: string;
  referenced_artifact_ids: string[] | null;
  created_at: string;
}

const SUGGESTION_KEYS = ["copilot.suggest1", "copilot.suggest2", "copilot.suggest3"] as const;

/**
 * The docked Construction Copilot. It is a real supervisor-persona thread:
 * posting a message enqueues the persona's respond job, and the assistant turn
 * lands asynchronously on the worker callback — so this polls while open.
 */
export function CopilotDrawer({
  open,
  onClose,
  projects,
  currentProjectId,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectLite[];
  currentProjectId: string | null;
}) {
  const { t } = useI18n();
  const [pid, setPid] = useState<string | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Follow the project you're looking at; fall back to the newest one.
  useEffect(() => {
    if (!open) return;
    setPid((cur) => cur ?? currentProjectId ?? projects[0]?.id ?? null);
  }, [open, currentProjectId, projects]);
  useEffect(() => {
    if (currentProjectId) setPid(currentProjectId);
  }, [currentProjectId]);

  // One Copilot thread per project, created on first use.
  useEffect(() => {
    if (!open || !pid) return;
    let alive = true;
    setErr(null);
    setMessages([]);
    setCid(null);
    (async () => {
      try {
        const convos = await api.get<any[]>(`/projects/${pid}/conversations`);
        const mine = convos.find((c) => c.title === "Copilot") ?? convos[0];
        const id = mine?.id ?? (await api.post<{ id: string }>(`/projects/${pid}/conversations`, { title: "Copilot" })).id;
        if (alive) setCid(id);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? t("copilot.openFail"));
      }
    })();
    return () => { alive = false; };
  }, [open, pid]);

  const loadMessages = useCallback(async () => {
    if (!pid || !cid) return;
    try {
      const r = await api.get<{ messages: Msg[] }>(`/projects/${pid}/conversations/${cid}`);
      setMessages(r.messages ?? []);
    } catch {
      /* transient — the poll will retry */
    }
  }, [pid, cid]);

  useEffect(() => {
    if (!open || !cid) return;
    loadMessages();
    const t = setInterval(loadMessages, 2500);
    return () => clearInterval(t);
  }, [open, cid, loadMessages]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || !pid || !cid || busy) return;
    setBusy(true);
    setDraft("");
    // Optimistic user turn so the thread feels immediate.
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "user", content, referenced_artifact_ids: null, created_at: new Date().toISOString() },
    ]);
    try {
      await api.post(`/projects/${pid}/conversations/${cid}/messages`, { content });
      await loadMessages();
    } catch (e: any) {
      setErr(e?.message ?? t("copilot.sendFail"));
    } finally {
      setBusy(false);
    }
  }

  const project = projects.find((p) => p.id === pid);

  return (
    <div className={"drawer-overlay" + (open ? " on" : "")} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer cop" role="dialog" aria-modal="true" aria-label={t("copilot.title")}>
        <div className="dh">
          <h2>{t("copilot.title")}</h2>
          <button className="x" onClick={onClose} aria-label={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        {projects.length > 1 && (
          <div style={{ padding: "12px 20px 0" }}>
            <select
              className="mono"
              value={pid ?? ""}
              onChange={(e) => setPid(e.target.value)}
              aria-label={t("copilot.project")}
              style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--hairline)", borderRadius: 9, background: "var(--panel-2)", color: "var(--ink)", fontSize: 12 }}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div className="msgs" ref={bodyRef}>
          {!pid && <div className="m a"><div className="bub">{t("copilot.noProject")}</div></div>}
          {err && <div className="m a"><div className="bub" style={{ color: "var(--red)" }}>{err}</div></div>}
          {pid && messages.length === 0 && !err && (
            <div className="m a">
              <div className="bub">{t("copilot.intro", { project: project?.name ?? t("copilot.introFallback") })}</div>
              <div className="chips">
                {SUGGESTION_KEYS.map((k) => {
                  const s = t(k);
                  return <button key={k} onClick={() => send(s)}>{s}</button>;
                })}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={"m " + (m.role === "user" ? "u" : "a")}>
              <div className="bub">{m.content}</div>
              {m.role !== "user" && (m.referenced_artifact_ids?.length ?? 0) > 0 && (
                <div className="cite">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
                  {m.referenced_artifact_ids!.length === 1 ? t("copilot.source") : t("copilot.sources", { n: m.referenced_artifact_ids!.length })}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="m a"><div className="bub"><span className="spin" /> {t("copilot.thinking")}</div></div>}
        </div>

        <div className="inp">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(draft); }}
            placeholder={pid ? t("copilot.placeholder") : t("copilot.noProjectSelected")}
            disabled={!pid || !cid}
            aria-label={t("copilot.placeholder")}
          />
          <button onClick={() => send(draft)} disabled={!pid || !cid || busy || !draft.trim()} aria-label={t("copilot.send")}>
            <svg className="dir-flip" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
          </button>
        </div>
      </aside>
    </div>
  );
}

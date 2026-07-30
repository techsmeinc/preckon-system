"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { roleLabel } from "@/auth/roles";

interface Member {
  id: string;
  name: string;
  role: string;
}
export interface ChatMsg {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string | null;
  body: string;
  mentions: string[];
  at: number;
}

/**
 * Live per-project team chat with @-mentions. Presentational/controlled: messages arrive
 * via SSE (managed by the parent studio) and `onSend` posts one. `live` reflects the SSE
 * connection so users know delivery is real-time.
 */
export function TeamChat({
  me,
  team,
  messages,
  onSend,
  live,
}: {
  me: { id: string; name: string; role: string };
  team: Member[];
  messages: ChatMsg[];
  onSend: (body: string, mentions: string[]) => Promise<void>;
  live: boolean;
}) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  function onChange(v: string) {
    setText(v);
    const m = v.match(/@([\w-]*)$/); // typing a mention at the caret end
    setMentionQuery(m ? m[1].toLowerCase() : null);
  }

  function pickMention(member: Member) {
    setText((v) => v.replace(/@([\w-]*)$/, `@${member.name.replace(/\s+/g, "")} `));
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    const ids = team.filter((mem) => new RegExp(`@${mem.name.replace(/\s+/g, "")}(\\b|\\s|$)`, "i").test(body)).map((mem) => mem.id);
    setBusy(true);
    try {
      await onSend(body, ids);
      setText("");
      setMentionQuery(null);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = mentionQuery !== null ? team.filter((mem) => mem.id !== me.id && mem.name.toLowerCase().replace(/\s+/g, "").includes(mentionQuery)).slice(0, 6) : [];

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5 text-[10px] text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-slate-500"}`} />
        {live ? "Live" : "Reconnecting…"}
        <span className="ml-auto">{team.length} member{team.length === 1 ? "" : "s"}</span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">No messages yet. Say hi to the team, or @mention someone to get their attention.</p>
        ) : (
          messages.map((m) => {
            const mine = m.userId === me.id;
            const mentionsMe = m.mentions.includes(me.id);
            return (
              <div key={m.id} className={mine ? "text-right" : "text-left"}>
                <div className={`inline-block max-w-[92%] rounded-lg px-2.5 py-1.5 text-left text-xs ${mine ? "bg-indigo-500/25" : mentionsMe ? "border border-amber-400/50 bg-amber-500/10" : "bg-white/5"}`}>
                  {!mine && (
                    <p className="mb-0.5 text-[10px] font-semibold text-slate-300">
                      {m.userName} <span className="font-normal text-slate-500">· {roleLabel(m.userRole ?? "")}</span>
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-slate-100">{renderBody(m.body)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="relative border-t border-white/10 p-2">
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-lg border border-white/10 bg-[#1b2130] shadow-xl">
            {suggestions.map((s) => (
              <button key={s.id} type="button" onClick={() => pickMention(s)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-500/30 text-[10px] font-bold text-indigo-200">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="font-medium">{s.name}</span>
                <span className="text-[10px] text-slate-500">{roleLabel(s.role)}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Message the team… use @ to mention"
            disabled={busy}
            className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
          />
          <button type="submit" disabled={busy || !text.trim()} className="rounded bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40">Send</button>
        </form>
      </div>
    </div>
  );
}

/** Highlight @Mentions in a message body. */
function renderBody(body: string): ReactNode {
  return body.split(/(@[\w-]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split
      <span key={i} className="rounded bg-indigo-500/30 px-1 font-medium text-indigo-200">{part}</span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split
      <span key={i}>{part}</span>
    ),
  );
}

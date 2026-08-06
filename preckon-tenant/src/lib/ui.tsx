"use client";
// Shared UI kit for the tenant console — ported from the Host's _ui.tsx so both
// planes share the same primitives. Uses DS-01 classes from globals.css.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { api, ApiClientError } from "./apiclient";
import { useI18n } from "./i18n";

/* ── /me context ─────────────────────────────────────────────────────────── */
export interface Me {
  id: string; email: string; name: string | null;
  tenantId: string; domain?: string; permissions: string[];
  roles: { key: string; name: string }[];
}
export const MeContext = createContext<Me | null>(null);
export function useMe(): Me | null { return useContext(MeContext); }
export function useCan(perm: string): boolean {
  const me = useMe();
  if (!me) return false;
  return me.permissions.includes(perm);
}

/* ── Toast ───────────────────────────────────────────────────────────────── */
// A failure announced with a tick reads as a success at a glance, so the tone is
// explicit. Callers that don't pass one keep the confirming tick they had.
type ToastTone = "ok" | "bad";
type ToastFn = (msg: string, tone?: ToastTone) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export function useToast(): ToastFn { return useContext(ToastCtx); }
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>("ok");
  const tRef = useRef<number | undefined>(undefined);
  const show = useCallback((m: string, k: ToastTone = "ok") => {
    setMsg(m);
    setTone(k);
    window.clearTimeout(tRef.current);
    // Errors are longer and worth reading twice before they vanish.
    tRef.current = window.setTimeout(() => setMsg(null), k === "bad" ? 6000 : 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={"toast" + (msg ? " on" : "") + (tone === "bad" ? " bad" : "")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          {tone === "bad"
            ? <><path d="M12 7v6" /><path d="M12 17h.01" /></>
            : <path d="M5 12l4 4 10-10" />}
        </svg>
        <span>{msg}</span>
      </div>
    </ToastCtx.Provider>
  );
}

/* ── Data fetching ───────────────────────────────────────────────────────── */
export function errMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message || e.code;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export interface AsyncState<T> { data: T | null; loading: boolean; error: string | null; reload: () => void; }

/** GET a path once + on demand + optional polling. Polls don't flash the skeleton. */
export function useApi<T = any>(path: string | null, deps: any[] = [], opts?: { refreshMs?: number }): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadedRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => { loadedRef.current = false; }, [path]);
  useEffect(() => {
    if (path === null) return;
    let alive = true;
    if (!loadedRef.current) setLoading(true);
    setError(null);
    inFlightRef.current = true;
    api.get<T>(path)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(errMessage(e)); })
      .finally(() => {
        inFlightRef.current = false;
        if (alive) { loadedRef.current = true; setLoading(false); }
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  const refreshMs = opts?.refreshMs;
  useEffect(() => {
    if (path === null || !refreshMs) return;
    const id = setInterval(() => {
      // Never stack polls: a slow endpoint under a short interval otherwise
      // queues requests behind each other until the screen falls minutes behind.
      if (inFlightRef.current) return;
      // A backgrounded tab doesn't need fresh data — and shouldn't keep the
      // connection pool busy for every other tab that does.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setTick((t) => t + 1);
    }, refreshMs);
    return () => clearInterval(id);
  }, [path, refreshMs]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

/* ── Status chip ─────────────────────────────────────────────────────────── */
const CHIP_LABEL: Record<string, string> = {
  awaiting_review: "Awaiting review", auto_applied: "Auto-applied", no_bid: "No bid",
};
export function StatusChip({ status, label }: { status: string; label?: string }) {
  const key = (status ?? "").toLowerCase();
  const text = label ?? CHIP_LABEL[key] ?? (status ? status[0].toUpperCase() + status.slice(1).replace(/_/g, " ") : "—");
  return <span className={"chip " + key}>{text}</span>;
}

/* ── States ──────────────────────────────────────────────────────────────── */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk" style={{ width: `${90 - (i % 3) * 18}%`, opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  );
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="placeholder" style={{ borderColor: "var(--red)" }}>
      <div className="pic" style={{ background: "var(--red-tint)", color: "var(--red)" }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg>
      </div>
      <h3>{t("common.loadFail")}</h3>
      <p>{message}</p>
      {onRetry && <button className="mini" style={{ marginTop: 18 }} onClick={onRetry}>{t("common.retry")}</button>}
    </div>
  );
}
export function EmptyState({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="placeholder">
      <div className="pic">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
      </div>
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}
export function Placeholder({ title, sub, phase }: { title: string; sub?: string; phase?: string }) {
  return (
    <div className="placeholder">
      <div className="pic">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>
      </div>
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
      {phase && <span className="next">Arrives in {phase}</span>}
    </div>
  );
}

/* ── Drawer ──────────────────────────────────────────────────────────────── */
export function Drawer({ open, title, onClose, children, footer }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className={"drawer-overlay" + (open ? " on" : "")} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="dh">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </aside>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  // Wrapping associates the label with its control implicitly — no ids to
  // generate, and nothing to fall out of step. As siblings with no htmlFor the
  // label named nothing, and every field announced itself as blank.
  return <label className="fld"><span className="fl">{label}</span>{children}</label>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

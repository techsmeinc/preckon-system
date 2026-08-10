// Standalone stand-ins for the workspace hooks the two tools reach for.
//
// The editor and the studio are the only things in this build, so the concepts
// behind these hooks either do not exist here or collapse to a constant:
//
//   useCan   — permissions are a workspace idea. There is one person at this
//              machine holding a file they already opened, so everything is
//              permitted. Returning false would grey out the toolbar.
//   useToast — the workspace renders these in a shell that is not here, so it
//              is reimplemented, small, in the corner.
//   useMe    — nobody is signed in to anything.
//
// Kept deliberately literal rather than clever: this file's whole job is to let
// the REAL components run unmodified, so the desktop build and the browser
// build stay the same code rather than drifting into two editors.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastTone = "ok" | "bad";
export type ToastFn = (msg: string, tone?: ToastTone) => void;

const ToastCtx = createContext<ToastFn>(() => {});
export function useToast(): ToastFn { return useContext(ToastCtx); }

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>("ok");
  const timer = useRef<number | undefined>(undefined);

  const push = useCallback<ToastFn>((m, tn = "ok") => {
    setMsg(m);
    setTone(tn);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {msg && <div className={"ws-toast" + (tone === "bad" ? " bad" : "")} role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/** One person, their own machine, a file they opened themselves. */
export const useCan = (_perm: string): boolean => true;
export const useMe = () => null;

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div>{Array.from({ length: rows }, (_, i) => <div key={i} className="sk" />)}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card">
      <p className="csub" style={{ margin: 0 }}>{message}</p>
      {onRetry && <button className="mini sm" onClick={onRetry} style={{ marginTop: 8 }}>Try again</button>}
    </div>
  );
}

/** Nothing here fetches — every tool in this build is handed its data. */
export function useApi<T>(_path: string | null, _deps?: unknown[]) {
  return { data: null as T | null, loading: false, error: null as string | null, reload: () => {} };
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="cad-empty">
      <h4>{title}</h4>
      {sub && <p className="csub">{sub}</p>}
    </div>
  );
}

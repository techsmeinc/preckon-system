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
import { api, ApiClientError } from "./apiclient";

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

/* ── who is signed in ────────────────────────────────────────────────────────
 *
 * Fetched once and shared, the way the workspace does it: several components
 * ask `useCan` on the same render, and each of them firing its own /me would
 * be a handful of identical requests every time a tool mounts.
 */
interface Me { id: string; name?: string; email?: string; permissions: string[] }

let mePromise: Promise<Me | null> | null = null;
const meListeners = new Set<(m: Me | null) => void>();
let meValue: Me | null = null;

export function refreshMe(): Promise<Me | null> {
  mePromise = api.get<Me>("/me")
    .then((m) => { meValue = m; return m; })
    .catch(() => { meValue = null; return null; })
    .finally(() => { for (const fn of meListeners) fn(meValue); });
  return mePromise;
}

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(meValue);
  useEffect(() => {
    meListeners.add(setMe);
    if (!mePromise) void refreshMe();
    else void mePromise.then(() => setMe(meValue));
    return () => { meListeners.delete(setMe); };
  }, []);
  return me;
}

/* The workspace's real permissions when signed in. Signed OUT, everything is
   permitted — because with no workspace the only thing on screen is a file off
   this disk, and greying out the toolbar of a drawing somebody just opened
   would be absurd. The server is still the one that decides: a save without a
   session comes back 401 whatever this returns. */
export function useCan(perm: string): boolean {
  const me = useMe();
  return me ? me.permissions.includes(perm) : true;
}

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

/**
 * The workspace's useApi, over the main-process client.
 *
 * Real, not a stub — which is what lets BimStudioPanel and the rest run here
 * unmodified, and is why this build has the takeoff, the assistants and
 * save-to-project rather than imitations of them.
 *
 * A null path means "nothing to fetch yet" and stays idle, exactly as the
 * workspace version does, so a component can hold off until it knows its id.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setError(null);
    api.get<T>(path)
      .then((d) => { if (live) setData(d); })
      .catch((e: unknown) => {
        if (!live) return;
        // 401 is not an error worth shouting: the shell is already offering a
        // way to sign in, and a red box under it says the same thing twice.
        const msg = e instanceof ApiClientError && e.status === 401
          ? null
          : (e as Error)?.message ?? "Could not load";
        setError(msg);
        setData(null);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="cad-empty">
      <h4>{title}</h4>
      {sub && <p className="csub">{sub}</p>}
    </div>
  );
}

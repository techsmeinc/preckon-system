"use client";

// Shared UI primitives for the Host console screens.
// Reuses DS-01 class names from globals.css verbatim — no styling is defined here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiClientError } from "@/lib/api";

/* ────────────────────────────────────────────────────────────────────────── */
/* /me context                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Me {
  id: string;
  email: string;
  display_name: string;
  role: { key: string; name: string };
  permissions: string[];
  two_factor_enabled: boolean;
}

export const MeContext = createContext<Me | null>(null);
export function useMe(): Me | null {
  return useContext(MeContext);
}
/** True when the current staff member holds the given permission key.
 *  Degrades open when /me returned no permission list at all (dev fallback). */
export function useCan(perm: string): boolean {
  const me = useMe();
  if (!me) return true;
  if (!me.permissions || me.permissions.length === 0) return true;
  return me.permissions.includes(perm);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Toast                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

type ToastFn = (msg: string) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export function useToast(): ToastFn {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout((show as any)._t);
    (show as any)._t = window.setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={"toast" + (msg ? " on" : "")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M5 12l4 4 10-10" />
        </svg>
        <span>{msg}</span>
      </div>
    </ToastCtx.Provider>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Data fetching                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Unwrap the two envelope shapes the API uses: `ok({data})` / `list()` → .data,
 *  or `ok(resource)` → the value itself. */
export function unwrap<T = any>(res: any): T {
  if (res && typeof res === "object" && "data" in res) return res.data as T;
  return res as T;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * GET a path once (and on demand). Never throws — errors surface as strings.
 * Pass `opts.refreshMs` to poll: background refreshes update the data in place
 * WITHOUT flipping `loading` (so the skeleton doesn't flash every interval).
 */
export function useApi<T = any>(
  path: string | null,
  deps: any[] = [],
  opts?: { refreshMs?: number }
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Only the first load for a given path shows the skeleton; reloads/polls
  // keep the last data visible while fetching.
  const loadedRef = useRef(false);

  useEffect(() => {
    loadedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    if (!loadedRef.current) setLoading(true);
    setError(null);
    api
      .get<any>(path)
      .then((res) => {
        if (alive) setData(res as T);
      })
      .catch((e: unknown) => {
        if (alive) setError(errMessage(e));
      })
      .finally(() => {
        if (alive) {
          loadedRef.current = true;
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  const refreshMs = opts?.refreshMs;
  useEffect(() => {
    if (path === null || !refreshMs) return;
    const id = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(id);
  }, [path, refreshMs]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

export function errMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message || e.code;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export interface PagedState<T> {
  items: T[];
  loading: boolean;      // first page in flight
  loadingMore: boolean;  // subsequent page in flight
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Cursor-paginated GET over the `{ data, next_cursor }` list envelope (§0.5).
 * Resets and refetches the first page whenever `basePath`/`deps` change; keeps
 * accumulating pages via loadMore(). Never throws — errors surface as strings.
 */
export function usePagedList<T = any>(basePath: string | null, deps: any[] = []): PagedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(basePath !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (basePath === null) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<any>(basePath)
      .then((res) => {
        if (!alive) return;
        setItems(res?.data ?? []);
        setNextCursor(res?.next_cursor ?? null);
      })
      .catch((e: unknown) => {
        if (alive) setError(errMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, tick, ...deps]);

  const loadMore = useCallback(() => {
    if (!nextCursor || basePath === null) return;
    const sep = basePath.includes("?") ? "&" : "?";
    setLoadingMore(true);
    api
      .get<any>(`${basePath}${sep}cursor=${encodeURIComponent(nextCursor)}`)
      .then((res) => {
        setItems((prev) => [...prev, ...(res?.data ?? [])]);
        setNextCursor(res?.next_cursor ?? null);
      })
      .catch((e: unknown) => setError(errMessage(e)))
      .finally(() => setLoadingMore(false));
  }, [nextCursor, basePath]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: !!nextCursor,
    loadMore,
    reload: () => setTick((t) => t + 1),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Money                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const CURRENCY: Record<string, { symbol: string; minor: number }> = {
  USD: { symbol: "$", minor: 2 },
  CAD: { symbol: "C$", minor: 2 },
  EUR: { symbol: "€", minor: 2 },
  GBP: { symbol: "£", minor: 2 },
  AED: { symbol: "AED ", minor: 2 },
  JPY: { symbol: "¥", minor: 0 },
};

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AED"];

/** Format integer minor units to a currency string using the currency's minor_unit. */
export function fmtMoney(minor: number | null | undefined, code = "USD"): string {
  if (minor === null || minor === undefined || Number.isNaN(Number(minor))) return "—";
  const c = CURRENCY[code] ?? { symbol: code + " ", minor: 2 };
  const v = Number(minor) / Math.pow(10, c.minor);
  return c.symbol + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: c.minor });
}

/** Compact form, e.g. $12.4k — used in KPI tiles. */
export function fmtMoneyShort(minor: number | null | undefined, code = "USD"): string {
  if (minor === null || minor === undefined || Number.isNaN(Number(minor))) return "—";
  const c = CURRENCY[code] ?? { symbol: code + " ", minor: 2 };
  const v = Number(minor) / Math.pow(10, c.minor);
  if (Math.abs(v) >= 1000) return c.symbol + (v / 1000).toFixed(1) + "k";
  return c.symbol + v.toLocaleString();
}

export function currencyMinor(code: string): number {
  return (CURRENCY[code] ?? { minor: 2 }).minor;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Status / formatting helpers (shared by Overview, Tenants, …)                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Normalise assorted status spellings into four display buckets. */
export function statusBucket(s: string | null | undefined): "active" | "trial" | "pastdue" | "suspended" {
  const k = (s || "").toLowerCase();
  if (k.startsWith("trial")) return "trial";
  if (k === "past_due" || k === "pastdue" || k === "unpaid") return "pastdue";
  if (k === "suspended" || k === "canceled") return "suspended";
  return "active";
}

/** seat_cap arrives as a decimal string ("25.0000"); null/undefined means no cap. */
export function fmtSeatCap(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "Unlimited";
  const n = Number(v);
  return Number.isNaN(n) ? "—" : String(n);
}

/** ISO datetime → locale date, tolerant of null/garbage. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Debounce a rapidly-changing value (e.g. a search box) by `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Status chips                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

// Maps assorted status strings onto the DS-01 chip colour classes.
const CHIP_CLASS: Record<string, string> = {
  active: "active",
  trialing: "trial",
  trial: "trial",
  past_due: "pastdue",
  pastdue: "pastdue",
  unpaid: "pastdue",
  suspended: "suspended",
  canceled: "suspended",
  incomplete: "pastdue",
  paused: "draft",
  // invoices
  paid: "active",
  open: "trial",
  failed: "suspended",
  void: "draft",
  uncollectible: "suspended",
  // editions/features
  published: "pub",
  draft: "draft",
  beta: "beta",
  deprecated: "deprecated",
  // host users
  invited: "invited",
  disabled: "disabled",
  // ops status language
  queued: "draft",
  processing: "trial",
  "needs-review": "pastdue",
  approved: "active",
  error: "suspended",
  operational: "active",
  connected: "active",
};

const CHIP_LABEL: Record<string, string> = {
  past_due: "Past due",
  pastdue: "Past due",
  trialing: "Trial",
  "needs-review": "Needs review",
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const key = (status ?? "").toLowerCase();
  const cls = CHIP_CLASS[key] ?? "draft";
  const text = label ?? CHIP_LABEL[key] ?? (status ? status[0].toUpperCase() + status.slice(1) : "—");
  return <span className={"chip " + cls}>{text}</span>;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* States: loading / error / empty                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card" style={{ padding: "18px" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 14,
            borderRadius: 6,
            background: "var(--panel-2)",
            margin: "10px 0",
            width: `${90 - (i % 3) * 18}%`,
            opacity: 1 - i * 0.08,
          }}
        />
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="placeholder" style={{ borderColor: "var(--red)" }}>
      <div className="pic" style={{ background: "var(--red-tint)", color: "var(--red)" }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16v.5" />
        </svg>
      </div>
      <h3>Couldn&apos;t load this</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="mini" style={{ marginTop: 18 }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="placeholder">
      <div className="pic">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </div>
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Drawer                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export function Drawer({
  open,
  title,
  titleExtra,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  titleExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={"drawer-overlay" + (open ? " on" : "")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog">
        <div className="dh">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3>{title}</h3>
            {titleExtra}
          </div>
          <div className="x" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </div>
        </div>
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </aside>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small form controls (segmented + switch) mirroring the mock                 */
/* ────────────────────────────────────────────────────────────────────────── */

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <div className={"switch" + (on ? " on" : "")} onClick={onToggle} />;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="fld">
      <label className="fl">{label}</label>
      {children}
    </div>
  );
}

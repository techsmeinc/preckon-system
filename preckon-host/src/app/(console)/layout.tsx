"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { MeContext, ToastProvider, unwrap, type Me } from "./_ui";

/* ── Nav model ─────────────────────────────────────────────────────────────*/

interface NavItem {
  href: string;
  label: string;
  perm?: string;
  icon: ReactNode;
}
interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: "Platform",
    items: [
      {
        href: "/overview",
        label: "Overview",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
        ),
      },
      {
        href: "/tenants",
        label: "Tenants",
        perm: "tenant.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4" />
          </svg>
        ),
      },
      {
        href: "/subscriptions",
        label: "Subscriptions",
        perm: "billing.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "Product",
    items: [
      {
        href: "/editions",
        label: "Editions",
        perm: "edition.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />
          </svg>
        ),
      },
      {
        href: "/features",
        label: "Features",
        perm: "feature.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M4 6h16M4 12h16M4 18h16" />
            <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
            <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        href: "/pricing",
        label: "Pricing",
        perm: "pricing.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="9" />
            <path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.5 0-2.5 1-2.5 2s1 1.5 2.5 2 2.5 1 2.5 2-1 2-2.5 2A2.5 2.5 0 0 1 9.5 15M12 6v1.5M12 16.5V18" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "Operations",
    items: [
      {
        href: "/observability",
        label: "Observability",
        perm: "observability.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M3 12h4l3 8 4-16 3 8h4" />
          </svg>
        ),
      },
      {
        href: "/audit",
        label: "Audit log",
        perm: "audit.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        ),
      },
      {
        href: "/notifications",
        label: "Notifications",
        perm: "notification.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        ),
      },
    ],
  },
  {
    group: "Administration",
    items: [
      {
        href: "/hostusers",
        label: "Host users & roles",
        perm: "host_user.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="9" cy="8" r="3" />
            <path d="M3 20v-1a5 5 0 0 1 10 0v1" />
            <path d="M16 3.1a3 3 0 0 1 0 5.8M21 20v-1a5 5 0 0 0-3.5-4.8" />
          </svg>
        ),
      },
      {
        href: "/settings",
        label: "Host settings",
        perm: "settings.read",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.4 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
          </svg>
        ),
      },
    ],
  },
];

const TITLES: Record<string, string> = {
  overview: "Overview",
  tenants: "Tenants",
  subscriptions: "Subscriptions",
  editions: "Editions",
  features: "Features",
  pricing: "Pricing",
  observability: "Observability",
  audit: "Audit log",
  notifications: "Notifications",
  hostusers: "Host users & roles",
  settings: "Host settings",
};

function initials(name: string): string {
  return (name || "")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/* ── Bell ──────────────────────────────────────────────────────────────────*/

interface HostNotif {
  id: string;
  title: string;
  body?: string;
  category?: string;
  created_at?: string;
  read_at?: string | null;
  is_read?: boolean;
}

function Bell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<HostNotif[]>([]);

  const loadCount = useCallback(() => {
    api
      .get<any>("/host-notifications/unread-count")
      .then((r) => setCount(Number(r?.count ?? r?.data?.count ?? unwrap(r) ?? 0) || 0))
      .catch(() => setCount(0));
  }, []);

  useEffect(() => {
    loadCount();
    const t = window.setInterval(loadCount, 60000);
    return () => window.clearInterval(t);
  }, [loadCount]);

  useEffect(() => {
    if (!open) return;
    api
      .get<any>("/host-notifications")
      .then((r) => setItems(unwrap<HostNotif[]>(r) ?? []))
      .catch(() => setItems([]));
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".bell-wrap")) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  function unread(n: HostNotif) {
    return n.is_read === false || (n.read_at === null && n.is_read !== true);
  }
  async function markAll() {
    try {
      await api.post("/host-notifications/read-all");
    } catch {
      /* degrade */
    }
    setItems((xs) => xs.map((n) => ({ ...n, is_read: true, read_at: "now" })));
    setCount(0);
  }
  async function markOne(id: string) {
    try {
      await api.post(`/host-notifications/${id}/read`);
    } catch {
      /* degrade */
    }
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, is_read: true, read_at: "now" } : n)));
    setCount((c) => Math.max(0, c - 1));
  }

  return (
    <div className="bell-wrap">
      <button
        className="tb-btn"
        title="Notifications"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <span className={"bell-badge" + (count > 0 ? " show" : "")}>{count}</span>
      </button>
      <div className={"bell-dd" + (open ? " on" : "")}>
        <div className="bell-hd">
          <h4>Notifications</h4>
          <button onClick={markAll}>Mark all read</button>
        </div>
        <div className="bell-list">
          {items.length === 0 ? (
            <div style={{ padding: "22px 15px", fontSize: 12.5, color: "var(--slate-500)", textAlign: "center" }}>
              You&apos;re all caught up.
            </div>
          ) : (
            items.slice(0, 6).map((n) => (
              <div
                key={n.id}
                className={"bell-item" + (unread(n) ? " unread" : "")}
                onClick={() => markOne(n.id)}
              >
                <div className="bi">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  </svg>
                </div>
                <div>
                  <div className="bt">{n.title}</div>
                  {n.body && <div className="bb">{n.body}</div>}
                  {n.created_at && <div className="btm">{n.created_at}</div>}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="bell-ft">
          <Link href="/notifications" onClick={() => setOpen(false)}>
            <button>Open inbox</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────────*/

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { setNavOpen(false); }, [pathname]);
  useEffect(() => { try { setCollapsed(localStorage.getItem("preckon-host-nav-collapsed") === "1"); } catch { /* ignore */ } }, []);
  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => { const n = !c; try { localStorage.setItem("preckon-host-nav-collapsed", n ? "1" : "0"); } catch { /* ignore */ } return n; });
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Me>("/me")
      .then((m) => {
        if (alive) {
          setMe(m);
          setStatus("ready");
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiClientError && e.status === 401) {
          router.replace("/");
        } else {
          // API not up yet — render the shell anyway (nav degrades open).
          setStatus("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const toggleTheme = useCallback(() => {
    const el = document.documentElement;
    const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
    el.setAttribute("data-theme", next);
    try {
      localStorage.setItem("preckon-host-theme", next);
    } catch {
      /* ignore */
    }
  }, []);

  async function doSignOut() {
    try {
      await signOut();
    } catch {
      /* ignore */
    }
    router.push("/");
  }

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--slate-500)" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading console…</div>
      </div>
    );
  }

  const active = "/" + (pathname?.split("/")[1] ?? "overview");
  const screenKey = pathname?.split("/")[1] ?? "overview";
  const crumb = TITLES[screenKey] ?? "Overview";
  const perms = me?.permissions ?? [];
  const canSee = (perm?: string) => !perm || perms.length === 0 || perms.includes(perm);

  return (
    <MeContext.Provider value={me}>
      <ToastProvider>
        <div className={"app on" + (navOpen ? " nav-open" : "") + (collapsed ? " nav-collapsed" : "")}>
          <div className="nav-scrim" onClick={() => setNavOpen(false)} />
          <aside className="side">
            <div className="side-top">
              <svg viewBox="0 0 48 56" width="20" height="24" fill="none" aria-hidden="true">
                <path
                  d="M16 50V8h14a13 13 0 0 1 0 26H16"
                  stroke="var(--ink)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="25" cy="21" r="3.6" fill="var(--teal)" />
              </svg>
              <span className="wm">
                Preck<span className="o">o</span>n
              </span>
              <span className="env">PROD</span>
            </div>
            <nav className="nav">
              {NAV.map((g) => {
                const items = g.items.filter((it) => canSee(it.perm));
                if (items.length === 0) return null;
                return (
                  <div key={g.group}>
                    <div className="grp">{g.group}</div>
                    {items.map((it) => (
                      <Link
                        key={it.href}
                        href={it.href}
                        className={active === it.href ? "active" : ""}
                      >
                        {it.icon}
                        <span>{it.label}</span>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </nav>
            <div className="side-user">
              <div className="avatar">{initials(me?.display_name ?? "Host")}</div>
              <div>
                <div className="nm">{me?.display_name ?? "Host operator"}</div>
                <div className="rl">{me?.role?.name ?? "—"}</div>
              </div>
              <div className="out" title="Sign out" onClick={doSignOut}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </div>
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <button className="hamb" aria-label="Open menu" onClick={() => setNavOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
              </button>
              <button className="nav-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapse}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />{collapsed ? <path d="M14 9l3 3-3 3" /> : <path d="M17 9l-3 3 3 3" />}</svg>
              </button>
              <div className="crumb">
                <span className="dim">Host</span> / <span>{crumb}</span>
              </div>
              <div style={{ marginLeft: "auto" }} />
              <button className="tb-btn" title="Toggle theme" onClick={toggleTheme}>
                <svg className="ic-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
                <svg className="ic-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
                </svg>
              </button>
              <Bell />
            </header>

            <div className="content">{children}</div>
          </div>
        </div>
      </ToastProvider>
    </MeContext.Provider>
  );
}

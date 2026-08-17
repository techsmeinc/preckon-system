"use client";
// The app shell — the frame every screen slots into (blueprint §4).
// Sidebar: workspace switcher, New project, the areas, user + sign out.
// Topbar:  breadcrumb, ⌘K search, Copilot, theme.
// Global:  the command palette and the docked Copilot, reachable anywhere.
//
// The shell is wrapped in I18nProvider so every screen below it can translate,
// and so <html lang/dir> follows the resolved locale.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/apiclient";
import { MeContext, ToastProvider, useApi, type Me } from "@/lib/ui";
import { Icon, type IconName } from "@/lib/icons";
import { CommandPalette, CopilotDrawer, type ProjectLite } from "@/lib/shell";
import { applyBrand, readBrand, saveBrand } from "@/lib/brand";
import { CopilotCtx, WorkspaceCtx, type WorkspaceSettings } from "@/lib/appctx";
import { I18nProvider, LOCALES, useI18n, type Key, type Locale } from "@/lib/i18n";

const NAV: { group: Key; items: { href: string; label: Key; icon: IconName }[] }[] = [
  { group: "nav.workspace", items: [
    { href: "/overview", label: "nav.dashboard", icon: "overview" },
    { href: "/projects", label: "nav.projects", icon: "projects" },
  ] },
  { group: "nav.tools", items: [
    // The drawing editor is reached from a drawing — Drawings -> Edit & mark up
    // — rather than from the rail, where it invited people to open an editor
    // with nothing in it. The route still works and the deep link still lands.
    { href: "/library", label: "nav.library", icon: "library" },
    // Findable, not promoted. Somebody who never opens a .dwg has no reason to
    // install anything, so this sits at the end of Tools rather than shouting
    // from a banner on every screen.
    { href: "/desktop", label: "nav.desktop", icon: "desktop" },
  ] },
  // Admin is role-gated (blueprint §1) — see ADMIN_PERMS below.
  { group: "nav.manage", items: [
    { href: "/admin", label: "nav.admin", icon: "admin" },
  ] },
];

/** Any of these means the person has something to do under Admin. */
const ADMIN_PERMS = ["admin.users", "admin.settings", "billing.view"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const authed = !isPending && !!session?.user;
  const settings = useApi<WorkspaceSettings>(authed ? "/settings" : null);

  // Mirror the workspace language so the pre-paint script in the root layout can
  // apply dir="rtl" on the next load, before React is anywhere near the DOM.
  useEffect(() => {
    const l = settings.data?.locale;
    if (!l) return;
    try { localStorage.setItem("preckon-tenant-locale", l); } catch { /* private mode */ }
  }, [settings.data?.locale]);

  return (
    <I18nProvider tenantLocale={settings.data?.locale ?? "en"}>
      <AppShell settings={settings} session={session} isPending={isPending}>
        {children}
      </AppShell>
    </I18nProvider>
  );
}

function AppShell({
  children, settings, session, isPending,
}: {
  children: React.ReactNode;
  settings: ReturnType<typeof useApi<WorkspaceSettings>>;
  session: any;
  isPending: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale, setUserLocale } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [copOpen, setCopOpen] = useState(false);

  const authed = !isPending && !!session?.user;
  const projects = useApi<ProjectLite[]>(authed ? "/projects" : null);
  const domain = useApi<{ name: string | null }>(authed ? "/domain" : null);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) { router.replace("/login"); return; }
    api.get<Me>("/me").then(setMe).catch(() => setMe(null));
  }, [isPending, session, router]);

  // The tenant's accent is authoritative from the API; the local copy only
  // exists so the shell paints in-brand before that request lands.
  useEffect(() => {
    const remote = settings.data?.brandColor;
    if (remote) { if (remote !== readBrand()) saveBrand(remote); else applyBrand(remote); }
  }, [settings.data?.brandColor]);

  useEffect(() => { try { setCollapsed(localStorage.getItem("preckon-nav-collapsed") === "1"); } catch {} }, []);
  function toggleCollapse() {
    setCollapsed((c) => { const n = !c; try { localStorage.setItem("preckon-nav-collapsed", n ? "1" : "0"); } catch {} return n; });
  }

  useEffect(() => { setNavOpen(false); }, [pathname]);

  const openCopilot = useCallback(() => setCopOpen(true), []);

  // ⌘K palette · ⌘/ Copilot — the two shortcuts a work tool owes you.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((o) => !o); }
      else if (meta && e.key === "/") { e.preventDefault(); setCopOpen((o) => !o); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const currentProjectId = useMemo(() => {
    const m = pathname.match(/^\/projects\/([^/]+)/);
    return m ? m[1] : null;
  }, [pathname]);

  const projectList = projects.data ?? [];
  // Until an admin names the workspace under Admin → Branding, fall back to the
  // bound domain — never to the signed-in person's name, which reads as if the
  // workspace belongs to them.
  const wsName = settings.data?.workspaceName ?? domain.data?.name ?? t("shell.workspace");
  const wsInitials = wsName.split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "PK";

  if (isPending || !session?.user) {
    return <div className="login-wrap"><span className="spin" /></div>;
  }

  const initials = (me?.name ?? me?.email ?? "?").slice(0, 2).toUpperCase();
  const roleLabel = me?.roles?.[0]?.name ?? t("shell.member");
  const canAdmin = ADMIN_PERMS.some((p) => me?.permissions?.includes(p));

  /* Light → Dark → System, rather than a two-way flip. Without System in the
     cycle, the only way back to "follow my machine" was to clear storage. */
  function toggleTheme() {
    const order = ["light", "dark", "system"] as const;
    const current = (document.documentElement.getAttribute("data-theme-pref") ?? "system") as (typeof order)[number];
    const next = order[(order.indexOf(current) + 1) % order.length];
    const resolved =
      next === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-pref", next);
    try { localStorage.setItem("preckon-theme", next); } catch {}
  }

  return (
    <MeContext.Provider value={me}>
      <WorkspaceCtx.Provider value={{
        workspaceName: settings.data?.workspaceName ?? null,
        brandColor: settings.data?.brandColor ?? null,
        locale: settings.data?.locale ?? null,
        reload: settings.reload,
      }}>
        <CopilotCtx.Provider value={openCopilot}>
          <ToastProvider>
            <div className={"app" + (navOpen ? " nav-open" : "") + (collapsed ? " nav-collapsed" : "")}>
              <div className="nav-scrim" onClick={() => setNavOpen(false)} />

              {/* 2.4.1 Bypass Blocks — first in the tab order, off-screen
                  until focused. */}
              <a className="skip" href="#main">Skip to main content</a>
              <aside className="side">
                <div className="side-top">
                  <div className="ws-switch">
                    <div className="ws-logo">{wsInitials}</div>
                    <div className="nm">
                      {wsName}
                      <small>{(me?.domain ?? "tenant")}.preckon.app</small>
                    </div>
                  </div>
                </div>

                <div className="side-new">
                  <button className="btn btn-primary" onClick={() => router.push("/projects?new=1")}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
                    <span>{t("shell.newProject")}</span>
                  </button>
                </div>

                <nav className="nav" aria-label={t("nav.workspace")}>
                  {NAV.filter((g) => g.group !== "nav.manage" || canAdmin).map((g) => (
                    <div key={g.group}>
                      <div className="grp">{t(g.group)}</div>
                      {/* A real button. As an anchor with no href it was not a
                          link, and role="button" on top of that is the ARIA
                          misuse Lighthouse flags — as well as needing its own
                          keyboard handler to do what a button does for free. */}
                      {g.group === "nav.tools" && (
                        <button type="button" className="navbtn" onClick={openCopilot}>
                          <Icon.copilot /><span>{t("nav.copilot")}</span>
                        </button>
                      )}
                      {g.items.map((it) => {
                        const active = pathname === it.href || pathname.startsWith(it.href + "/");
                        const I = Icon[it.icon];
                        return (
                          <Link key={it.href} href={it.href} className={active ? "active" : ""}>
                            <I /><span>{t(it.label)}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </nav>

                <div style={{ padding: "0 10px 8px" }}>
                  <nav className="nav" aria-label={t("nav.manage")} style={{ padding: 0, flex: "none" }}>
                    <Link href="/settings" className={pathname.startsWith("/settings") ? "active" : ""}>
                      <Icon.settings /><span>{t("nav.settings")}</span>
                    </Link>
                  </nav>
                </div>

                <div className="side-user">
                  <div className="avatar">{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{me?.name ?? me?.email ?? "…"}</div>
                    <div className="rl">{roleLabel}</div>
                  </div>
                  <button className="out" title={t("shell.signOut")} aria-label={t("shell.signOut")}
                          onClick={() => authClient.signOut().then(() => router.replace("/login"))}>
                    <svg className="dir-flip" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 12H3M8 7l-5 5 5 5" /><path d="M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6" /></svg>
                  </button>
                </div>
              </aside>

              <div className="main">
                <header className="topbar">
                  <button className="hamb" aria-label={t("shell.openMenu")} onClick={() => setNavOpen(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
                  </button>
                  <button className="nav-toggle" aria-label={collapsed ? t("shell.expand") : t("shell.collapse")} onClick={toggleCollapse}>
                    <svg className="dir-flip" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />{collapsed ? <path d="M14 9l3 3-3 3" /> : <path d="M17 9l-3 3 3 3" />}</svg>
                  </button>
                  <span className="crumb">{crumbFor(pathname, projectList, t)}</span>

                  <div className="tb-right">
                    <label className="lang" title={t("settings.language")}>
                      <Icon.globe />
                      <select
                        value={locale}
                        onChange={(e) => setUserLocale(e.target.value as Locale)}
                        aria-label={t("settings.language")}
                      >
                        {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
                      </select>
                    </label>
                    <button className="kbd" onClick={() => setCmdOpen(true)} aria-label={t("common.search")}>
                      <Icon.search />
                      <span className="lbl">{t("common.search")}</span>
                      <span className="keys">⌘K</span>
                    </button>
                    {/* The label span is hidden below 760px to save room, which
                        takes the button's only accessible name with it — at phone
                        width this announced as "button". The aria-label survives
                        the media query. */}
                    <button className="cop-btn" onClick={openCopilot} aria-label={t("nav.copilot")}>
                      <Icon.copilot /><span>{t("nav.copilot")}</span>
                    </button>
                    <button className="tb-btn" onClick={toggleTheme} title={t("shell.toggleTheme")} aria-label={t("shell.toggleTheme")}>
                      <svg className="ic-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
                      <svg className="ic-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>
                    </button>
                  </div>
                </header>

                <main className="content" id="main" tabIndex={-1}>{children}</main>
              </div>
            </div>

            <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} projects={projectList} onCopilot={openCopilot} canAdmin={canAdmin} />
            <CopilotDrawer open={copOpen} onClose={() => setCopOpen(false)} projects={projectList} currentProjectId={currentProjectId} />
          </ToastProvider>
        </CopilotCtx.Provider>
      </WorkspaceCtx.Provider>
    </MeContext.Provider>
  );
}

function crumbFor(path: string, projects: ProjectLite[], t: (k: Key) => string): React.ReactNode {
  const dim = (s: string) => <span className="dim">{s}</span>;
  const m = path.match(/^\/projects\/([^/]+)/);
  if (m) {
    const p = projects.find((x) => x.id === m[1]);
    return <>{dim(t("nav.projects"))} / {p?.name ?? t("nav.projects")}</>;
  }
  if (path.startsWith("/overview")) return t("nav.dashboard");
  if (path.startsWith("/projects")) return t("nav.projects");
  if (path.startsWith("/drawings")) return t("nav.drawings");
  if (path.startsWith("/library")) return t("nav.library");
  if (path.startsWith("/admin")) return t("nav.admin");
  if (path.startsWith("/settings")) return t("nav.settings");
  return t("shell.workspace");
}

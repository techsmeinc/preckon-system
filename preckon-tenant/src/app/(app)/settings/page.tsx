"use client";
// Settings — personal to you. The workspace-level things (team, branding, plan)
// live under Admin; this is profile, notifications and display preferences.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi, useMe, useToast, Skeleton } from "@/lib/ui";
import { readPref, writePref } from "@/lib/brand";
import { LOCALES, localeMeta, useI18n, type Key, type Locale } from "@/lib/i18n";

const TABS: { key: string; label: Key }[] = [
  { key: "profile", label: "settings.tabProfile" },
  { key: "notifs", label: "settings.tabNotifs" },
  { key: "prefs", label: "settings.tabPrefs" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState("profile");
  const { t } = useI18n();
  return (
    <>
      <div className="page-head">
        <div><h1>{t("settings.title")}</h1><p>{t("settings.sub")}</p></div>
      </div>
      <nav className="pw-tabs">
        {TABS.map((x) => (
          <button key={x.key} className={tab === x.key ? "on" : ""} onClick={() => setTab(x.key)}>{t(x.label)}</button>
        ))}
      </nav>
      {tab === "profile" ? <Profile /> : tab === "notifs" ? <Notifications /> : <Preferences />}
    </>
  );
}

function Profile() {
  const me = useMe();
  const { t } = useI18n();
  const ent = useApi<{ editionRef: string | null; licensedModules: any[] }>("/entitlements");
  const initials = (me?.name ?? me?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="row two">
      <div className="card">
        <h3>{t("settings.profile")}</h3>
        <div className="csub">{t("settings.profileSub")}</div>
        <div className="brand-prev">
          <div className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{initials}</div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--ink)" }}>{me?.name ?? me?.email ?? "—"}</div>
            <div style={{ fontSize: 12, color: "var(--slate-500)" }}>{me?.roles?.map((r) => r.name).join(", ") || t("settings.noRole")}</div>
          </div>
        </div>
        <div className="trow-lbl" style={{ marginTop: 14 }}>{t("settings.email")} <b className="mono">{me?.email ?? "—"}</b></div>
        <div className="trow-lbl">{t("settings.domain")} <b style={{ textTransform: "capitalize" }}>{me?.domain ?? "—"}</b></div>
        <div className="trow-lbl">{t("settings.edition")} <b style={{ textTransform: "capitalize" }}>{ent.data?.editionRef ?? "—"}</b></div>
        <p className="csub" style={{ marginTop: 14, marginBottom: 0 }}>
          {t("settings.profileNote")}
        </p>
      </div>

      <div className="card">
        <h3>{t("settings.canDo")}</h3>
        <div className="csub">{t("settings.canDoSub")}</div>
        {!me ? <Skeleton rows={3} /> : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {me.permissions.map((p) => (
              <span key={p} className="chip plain" style={{ color: "var(--slate-600)", background: "var(--panel-2)" }}>{p}</span>
            ))}
            {me.permissions.length === 0 && <p className="csub" style={{ margin: 0 }}>{t("settings.noPerms")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const NOTIF_ROWS: { key: string; title: Key; desc: Key }[] = [
  { key: "review_ready", title: "settings.notifReview", desc: "settings.notifReviewSub" },
  { key: "run_failed", title: "settings.notifRun", desc: "settings.notifRunSub" },
  { key: "deadline", title: "settings.notifDeadline", desc: "settings.notifDeadlineSub" },
  { key: "weekly", title: "settings.notifWeekly", desc: "settings.notifWeeklySub" },
];

function Notifications() {
  const toast = useToast();
  const { t } = useI18n();
  const [on, setOn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOn(readPref("notifs", { review_ready: true, run_failed: true, deadline: true, weekly: false } as Record<string, boolean>));
  }, []);

  function toggle(key: string) {
    const next = { ...on, [key]: !on[key] };
    setOn(next);
    writePref("notifs", next);
    toast(t("toast.prefSaved"));
  }

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h3>{t("settings.notifs")}</h3>
      <div className="csub">{t("settings.notifsSub")}</div>
      {NOTIF_ROWS.map((r) => (
        <div className="set-row" key={r.key}>
          <div><div className="sl">{t(r.title)}</div><div className="desc">{t(r.desc)}</div></div>
          <button className={"switch" + (on[r.key] ? " on" : "")} onClick={() => toggle(r.key)} aria-label={t(r.title)} aria-pressed={!!on[r.key]} />
        </div>
      ))}
      <p className="csub" style={{ marginTop: 16, marginBottom: 0 }}>
        {t("settings.notifNote")}
      </p>
    </div>
  );
}

function Preferences() {
  const toast = useToast();
  const { t, locale, userLocale, tenantLocale, setUserLocale } = useI18n();
  const [theme, setTheme] = useState("light");
  const [prefs, setPrefs] = useState<{ currency: string; dateFormat: string }>({ currency: "USD", dateFormat: "DD MMM YYYY" });

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") ?? "light");
    setPrefs(readPref("display", { currency: "USD", dateFormat: "DD MMM YYYY" }));
  }, []);

  function setThemeMode(mode: string) {
    setTheme(mode);
    document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem("preckon-theme", mode); } catch {}
  }
  function setPref(k: "currency" | "dateFormat", v: string) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    writePref("display", next);
    toast(t("toast.prefSaved"));
  }

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h3>{t("settings.prefs")}</h3>
      <div className="csub">{t("settings.prefsSub")}</div>

      {/* Language is per-person; leaving it on the workspace default means a new
          admin choice takes effect here without anyone having to change it. */}
      <div className="set-row">
        <div><div className="sl">{t("settings.language")}</div><div className="desc">{t("settings.languageSub")}</div></div>
        <select
          value={userLocale ?? ""}
          onChange={(e) => setUserLocale(e.target.value ? (e.target.value as Locale) : null)}
          aria-label={t("settings.language")}
        >
          <option value="">{t("settings.languageWorkspace", { name: localeMeta(tenantLocale).native })}</option>
          {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
        </select>
      </div>

      <div className="set-row">
        <div><div className="sl">{t("settings.theme")}</div><div className="desc">{t("settings.themeSub")}</div></div>
        <div className="range">
          <button className={theme !== "dark" ? "on" : ""} onClick={() => setThemeMode("light")}>{t("settings.light")}</button>
          <button className={theme === "dark" ? "on" : ""} onClick={() => setThemeMode("dark")}>{t("settings.dark")}</button>
        </div>
      </div>

      <div className="set-row">
        <div><div className="sl">{t("settings.currency")}</div><div className="desc">{t("settings.currencySub")}</div></div>
        <select value={prefs.currency} onChange={(e) => setPref("currency", e.target.value)}>
          {["USD", "CAD", "EUR", "GBP", "AED"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="set-row">
        <div><div className="sl">{t("settings.dateFormat")}</div><div className="desc">{t("settings.dateFormatSub")}</div></div>
        <select value={prefs.dateFormat} onChange={(e) => setPref("dateFormat", e.target.value)}>
          {["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => <option key={f}>{f}</option>)}
        </select>
      </div>

      <p className="csub" style={{ marginTop: 16, marginBottom: 0 }}>
        {t("settings.planLink")} <Link className="rowbtn" href="/admin">{t("nav.admin")}</Link>
      </p>
    </div>
  );
}

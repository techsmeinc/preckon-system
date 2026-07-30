"use client";
// Tenant admin (blueprint §7) — what the customer's own admin manages, scoped
// entirely to their org: their people, their white-label branding, their plan.

import { useEffect, useState } from "react";
import { useApi, useCan, useToast, Skeleton } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { useWorkspace } from "@/lib/appctx";
import { applyBrand, saveBrand, readBrand, BRAND_SWATCHES, BRAND_DEFAULT } from "@/lib/brand";
import { useProjectBundles } from "@/lib/bundles";
import TeamAdmin from "@/lib/admin/team";
import { LOCALES, useI18n, type Key, type Locale } from "@/lib/i18n";

const TABS: { key: string; label: Key }[] = [
  { key: "team", label: "admin.tabTeam" },
  { key: "branding", label: "admin.tabBranding" },
  { key: "plan", label: "admin.tabPlan" },
];

export default function AdminPage() {
  const [tab, setTab] = useState("team");
  const { t } = useI18n();
  return (
    <>
      <div className="page-head">
        <div><h2>{t("admin.title")}</h2><p>{t("admin.sub")}</p></div>
      </div>
      <nav className="pw-tabs">
        {TABS.map((x) => (
          <button key={x.key} className={tab === x.key ? "on" : ""} onClick={() => setTab(x.key)}>{t(x.label)}</button>
        ))}
      </nav>
      {tab === "team" ? <TeamAdmin /> : tab === "branding" ? <Branding /> : <Plan />}
    </>
  );
}

/* ── Branding — the white-label control (§7) ─────────────────────────────── */

function Branding() {
  const toast = useToast();
  const { t, tenantLocale, setUserLocale, userLocale } = useI18n();
  const canManage = useCan("admin.settings");
  const ws = useWorkspace();
  const [hex, setHex] = useState(BRAND_DEFAULT);
  const [name, setName] = useState("");
  const [lang, setLang] = useState<Locale>("en");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHex(ws.brandColor ?? readBrand());
    setName(ws.workspaceName ?? "");
    setLang(tenantLocale);
  }, [ws.brandColor, ws.workspaceName, tenantLocale]);

  // Preview live — the accent is one variable, so the whole app follows.
  function preview(next: string) {
    setHex(next);
    applyBrand(next);
  }

  async function save() {
    setBusy(true);
    try {
      await api.put("/settings", { brandColor: hex, workspaceName: name.trim() || undefined, locale: lang });
      saveBrand(hex);
      ws.reload();
      // A person following the workspace default should see the new language at
      // once; someone who chose their own keeps it.
      if (!userLocale) setUserLocale(null);
      toast(t("admin.brandSaved"));
    } catch (e: any) {
      toast(e?.message ?? t("admin.brandFail"));
    } finally { setBusy(false); }
  }

  function reset() {
    preview(BRAND_DEFAULT);
  }

  return (
    <div className="row two">
      <div className="card">
        <h3>{t("admin.brandColour")}</h3>
        <div className="csub">{t("admin.brandColourSub")}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <input type="color" value={hex} onChange={(e) => preview(e.target.value)} disabled={!canManage} aria-label={t("admin.brandColour")} />
          <span className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>{hex.toUpperCase()}</span>
        </div>

        <div className="swatches">
          {BRAND_SWATCHES.map((s) => (
            <button key={s} style={{ background: s }} onClick={() => preview(s)} disabled={!canManage} aria-label={`Use ${s}`} />
          ))}
        </div>

        <div className="brand-prev">
          <button className="mini pri">{t("admin.primaryButton")}</button>
          <span className="brand-node">C1</span>
          <div className="prog" style={{ width: 90 }}><span style={{ width: "62%" }} /></div>
          <span style={{ fontSize: 12, color: "var(--slate-500)" }}>{t("admin.livePreview")}</span>
        </div>

        {canManage ? (
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="mini" onClick={reset}>{t("admin.reset")}</button>
            <button className="mini pri" disabled={busy} onClick={save}>{busy ? t("common.saving") : t("admin.saveForEveryone")}</button>
          </div>
        ) : (
          <p className="csub" style={{ marginTop: 14, marginBottom: 0 }}>{t("admin.brandNoRights")}</p>
        )}

        <div style={{ fontSize: 11, color: "var(--slate-500)", marginTop: 14 }}>
          {t("admin.brandNote")}
        </div>
      </div>

      <div className="card">
        <h3>{t("admin.workspaceName")}</h3>
        <div className="csub">{t("admin.workspaceNameSub")}</div>
        <div className="fld" style={{ marginTop: 8 }}>
          <label className="fl">{t("admin.name")}</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
        </div>

        <div className="fld">
          <label className="fl">{t("admin.language")}</label>
          <select value={lang} onChange={(e) => setLang(e.target.value as Locale)} disabled={!canManage} aria-label={t("admin.language")}>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </select>
          <div className="csub" style={{ marginTop: 6 }}>{t("admin.languageSub")}</div>
          {lang === "ar" && <div className="csub" style={{ marginTop: 4 }}>{t("admin.rtlNote")}</div>}
        </div>

        {canManage && <button className="mini pri" disabled={busy} onClick={save}>{busy ? t("common.saving") : t("common.save")}</button>}

        <div className="brand-prev" style={{ marginTop: 18 }}>
          <div className="ws-logo" style={{ width: 44, height: 44, fontSize: 15 }}>
            {(name || t("shell.workspace")).split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--ink)" }}>{name || t("admin.yourWorkspace")}</div>
            <div style={{ fontSize: 11.5, color: "var(--slate-500)" }}>{t("admin.switcherPreview")}</div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--slate-500)", marginTop: 14 }}>
          {t("admin.logoNote")}
        </div>
      </div>
    </div>
  );
}

/* ── Plan & usage — resolved from the Host's entitlement snapshot (§8) ────── */

function Plan() {
  const { t } = useI18n();
  const ent = useApi<{ licensedModules: any[]; maxTier: string; features: Record<string, boolean>; editionRef: string | null; seats: number | null }>("/entitlements");
  const users = useApi<any[]>("/users");
  const { bundles, projects, loading } = useProjectBundles(40);

  const seats = ent.data?.seats ?? null;
  const used = users.data?.length ?? null;
  const artifacts = (bundles ?? []).reduce((n, b) => n + b.artifacts.length, 0);
  const runs = (bundles ?? []).reduce((n, b) => n + b.runs.length, 0);
  const features = ent.data?.features ?? {};

  return (
    <>
      <div className="row two">
        <div className="card">
          <h3>{t("admin.plan")}</h3>
          <div className="csub">{t("admin.planSub")}</div>
          <div className="brand-prev" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, color: "var(--ink)", textTransform: "capitalize" }}>
                {ent.data?.editionRef ?? "—"}
              </div>
              <div style={{ fontSize: 12, color: "var(--slate-500)" }}>
                {used != null && seats != null ? t("admin.seatsUsed", { used, total: seats }) : t("admin.people_n", { n: used ?? 0 })}
              </div>
            </div>
            <span className="chip active">{t("admin.activeChip")}</span>
          </div>
          <div className="trow-lbl" style={{ marginTop: 14 }}>{t("admin.licensedProducts")} <b>{ent.data?.licensedModules?.length ?? "—"}</b></div>
          <div className="trow-lbl">{t("admin.tierCap")} <b style={{ textTransform: "capitalize" }}>{ent.data?.maxTier ?? "—"}</b></div>
          <p className="csub" style={{ marginTop: 14, marginBottom: 0 }}>
            {t("admin.editionNote")}
          </p>
        </div>

        <div className="card">
          <h3>{t("admin.usage")}</h3>
          <div className="csub">{t("admin.usageSub")}</div>
          {loading ? <Skeleton rows={3} /> : (
            <>
              <Bar label={t("admin.seats")} used={used ?? 0} total={seats ?? Math.max(used ?? 1, 1)} />
              <Bar label={t("admin.projects")} used={projects.length} total={Math.max(projects.length, 10)} />
              <div className="trow-lbl">{t("admin.recordsOnGraph")} <b className="mono">{artifacts}</b></div>
              <div className="trow-lbl">{t("admin.workflowRuns")} <b className="mono">{runs}</b></div>
            </>
          )}
          <p className="csub" style={{ marginTop: 14, marginBottom: 0 }}>
            {t("admin.usageNote")}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="chead"><div><h3>{t("admin.capabilities")}</h3><div className="csub">{t("admin.capabilitiesSub")}</div></div></div>
        {ent.loading ? <Skeleton rows={3} /> : Object.keys(features).length === 0 ? (
          <p className="csub" style={{ margin: 0 }}>{t("admin.noFlags")}</p>
        ) : (
          <table>
            <tbody>
              {Object.entries(features).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</td>
                  <td className="r">{v ? <span className="chip active plain">{t("admin.on")}</span> : <span className="chip draft plain">{t("admin.off")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Bar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="usage-row">
      <div className="ul"><span>{label}</span><b>{used} / {total}</b></div>
      <div className="prog lg"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

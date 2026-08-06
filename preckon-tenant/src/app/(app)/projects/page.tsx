"use client";
// Projects — every bid, and where each one is in the chain. Filterable by the
// state that actually matters to an estimator (who is waiting on whom), not by
// database status.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, useCan, useToast, Skeleton, ErrorBox, EmptyState, Drawer, Field } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { Icon } from "@/lib/icons";
import { moneyShort } from "@/lib/chain";
import { useI18n, fmtDateLocal, type Key } from "@/lib/i18n";
import { useProjectBundles, bundleStatus, STATUS_CHIP, type Bundle, type BundleStatus } from "@/lib/bundles";

const FILTERS: { key: BundleStatus | "all"; label: Key }[] = [
  { key: "all", label: "projects.filterAll" },
  { key: "review", label: "projects.filterReview" },
  { key: "processing", label: "projects.filterProcessing" },
  { key: "ready", label: "projects.filterReady" },
  { key: "setup", label: "projects.filterSetup" },
];

/** The list fans out per project; keep it generous but bounded. */
const MAX = 40;

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <ProjectsInner />
    </Suspense>
  );
}

function ProjectsInner() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const { t } = useI18n();
  const canCreate = useCan("project.create");
  const canArchive = useCan("project.archive");
  const { bundles, projects, loading, error, reload } = useProjectBundles(MAX);
  const domain = useApi<any>("/domain");
  const lifecycleKey = domain.data?.lifecycleKey ?? "bid_pursuit";

  const [filter, setFilter] = useState<BundleStatus | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [client, setClient] = useState("");
  const [pursuit, setPursuit] = useState(true);
  const [busy, setBusy] = useState(false);

  // ⌘K → "New project" and the sidebar button both land here with ?new=1.
  useEffect(() => {
    if (search.get("new") === "1" && canCreate) {
      setOpen(true);
      router.replace("/projects");
    }
  }, [search, canCreate, router]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: (bundles ?? []).length };
    for (const b of bundles ?? []) {
      const s = bundleStatus(b);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [bundles]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (bundles ?? []).filter((b) => {
      const okStatus = filter === "all" || bundleStatus(b) === filter;
      const hay = `${b.project.name} ${b.project.client_name ?? ""} ${b.project.code ?? ""}`.toLowerCase();
      return okStatus && (!needle || hay.includes(needle));
    });
  }, [bundles, filter, q]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ id: string }>("/projects", {
        name,
        code: code || undefined,
        client_name: client || undefined,
        lifecycle_key: pursuit ? lifecycleKey : undefined,
      });
      toast(t("newProject.created"));
      setOpen(false); setName(""); setCode(""); setClient("");
      router.push(`/projects/${res.id}/documents`);
    } catch (e: any) {
      toast(e?.message ?? t("newProject.createFail"));
    } finally { setBusy(false); }
  }

  async function archive(b: Bundle, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(t("projects.archiveConfirm", { name: b.project.name }))) return;
    try { await api.del(`/projects/${b.project.id}`); toast(t("projects.archived")); reload(); }
    catch (err: any) { toast(err?.message ?? t("projects.archiveFail")); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>{t("projects.title")}</h1><p>{t("projects.sub")}</p></div>
        {canCreate && <button className="mini pri" onClick={() => setOpen(true)}><Icon.add /> {t("shell.newProject")}</button>}
      </div>

      <div className="fbar">
        <div className="range">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {t(f.label)} {counts[f.key] ?? 0}
            </button>
          ))}
        </div>
        <div className="fsearch">
          <Icon.search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("projects.search")} aria-label={t("projects.search")} />
        </div>
      </div>

      {loading ? <Skeleton rows={6} /> : error ? <ErrorBox message={error} onRetry={reload} /> :
        projects.length === 0 ? (
          <EmptyState
            title={t("projects.noneTitle")}
            sub={t("projects.noneSub")}
            action={canCreate ? <button className="mini pri" onClick={() => setOpen(true)}>{t("shell.newProject")}</button> : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={t("projects.noMatch")} sub={t("projects.noMatchSub")} />
        ) : (
          <div className="card" style={{ padding: "14px 18px" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("projects.colProject")}</th><th>{t("projects.colClient")}</th><th>{t("projects.colStage")}</th><th>{t("projects.colProgress")}</th>
                  <th className="r">{t("projects.colValue")}</th><th className="r">{t("projects.colDue")}</th><th>{t("common.status")}</th>{canArchive && <th><span className="vh">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const bs = bundleStatus(b);
                  const st = STATUS_CHIP[bs];
                  return (
                    <tr key={b.project.id} className="clickable" onClick={() => router.push(`/projects/${b.project.id}`)}>
                      <td><div className="t-name">{b.project.name}</div><div className="t-sub">{b.project.code ?? "—"}</div></td>
                      <td>{b.project.client_name ?? "—"}</td>
                      <td>{b.hydrated ? <span className="stage">{b.stage ? t(`stage.${b.stage.key}` as Key) : "—"}</span> : <span className="csub">…</span>}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div className="prog"><span style={{ width: `${b.progress}%` }} /></div>
                          <span className="mono" style={{ fontSize: 11, color: "var(--slate-500)" }}>{b.hydrated ? `${b.progress}%` : "—"}</span>
                        </div>
                      </td>
                      <td className="num r">{b.value ? moneyShort(b.value.minor, b.value.ccy) : "—"}</td>
                      <td className="r" style={{ color: "var(--slate-500)", fontSize: 12 }}>
                        {b.deadline ? fmtDateLocal(b.deadline, { day: "numeric", month: "short" }) : "—"}
                      </td>
                      <td><span className={"chip " + st.chip}>{t(`bundle.${bs}` as Key)}</span></td>
                      {canArchive && (
                        <td className="r" style={{ width: 44 }}>
                          <button
                            title={t("projects.archive")} aria-label={t("projects.archive")} onClick={(e) => archive(b, e)}
                            style={{ background: "transparent", border: "1px solid var(--hairline)", borderRadius: 7, padding: "4px 6px", color: "var(--slate-400)", cursor: "pointer", lineHeight: 0 }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6" /></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {projects.length > MAX && (
              <p className="csub" style={{ marginTop: 12, marginBottom: 0 }}>
                {t("projects.showingOf", { n: MAX, total: projects.length })}
              </p>
            )}
          </div>
        )}

      <ArchivedProjects onRestored={reload} />

      <Drawer
        open={open} title={t("newProject.title")} onClose={() => setOpen(false)}
        footer={<><button className="mini" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="mini pri" disabled={busy || !name.trim()} onClick={create}>{busy ? t("newProject.creating") : t("newProject.create")}</button></>}
      >
        <Field label={t("newProject.name")}><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("newProject.namePlaceholder")} /></Field>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("newProject.code")}><input type="text" className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MER-001" /></Field>
          <Field label={t("newProject.client")}><input type="text" value={client} onChange={(e) => setClient(e.target.value)} /></Field>
        </div>
        <Field label={t("newProject.lifecycle")}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--slate-600)" }}>
            <input type="checkbox" checked={pursuit} onChange={(e) => setPursuit(e.target.checked)} style={{ width: "auto" }} />
            {t("newProject.pursuit")}
          </label>
        </Field>
        <div style={{ fontSize: 11.5, color: "var(--slate-500)", display: "flex", gap: 7, alignItems: "center" }}>
          <span style={{ color: "var(--teal-press)", lineHeight: 0 }}><Icon.upload /></span>
          {t("newProject.uploadNext")}
        </div>
      </Drawer>
    </>
  );
}

/**
 * The archived projects, and the way back.
 *
 * Archiving told the estimator "its history is kept" and then removed the only
 * route to that history — the project left the list and no screen anywhere
 * showed it again. Kept-but-unreachable is indistinguishable from deleted, so
 * they live here: named, dated, and restorable in one click.
 *
 * It renders nothing at all when nothing is archived, so a clean workspace is
 * not given a permanently empty section to scroll past.
 */
function ArchivedProjects({ onRestored }: { onRestored: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const canArchive = useCan("project.archive");
  const { data, loading, reload } = useApi<any[]>("/projects?archived=1", []);
  const [openList, setOpenList] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = data ?? [];

  if (loading || rows.length === 0) return null;

  async function restore(p: any) {
    setBusyId(p.id);
    try {
      await api.patch(`/projects/${p.id}`, { status: "active" });
      toast(t("projects.restored"));
      reload();
      onRestored();
    } catch (e: any) {
      toast(e?.message ?? t("projects.restoreFail"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card sch" style={{ marginTop: 16 }}>
      <button className="sch-head" onClick={() => setOpenList((v) => !v)} aria-expanded={openList}>
        <span className="tw-glyph" aria-hidden>{openList ? "▾" : "▸"}</span>
        <span className="sch-name">{t("projects.archivedTitle")}</span>
        <span className="sch-meta mono">{rows.length}</span>
      </button>
      {openList && (
        <>
          <div className="csub" style={{ padding: "0 2px 10px" }}>{t("projects.archivedSub")}</div>
          <div className="tw">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("projects.colProject")}</th>
                  <th>{t("projects.colClient")}</th>
                  <th className="r">{t("projects.archivedOn")}</th>
                  <th><span className="vh">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                      {p.code && <div className="csub mono">{p.code}</div>}
                    </td>
                    <td>{p.client_name ?? "—"}</td>
                    <td className="r" style={{ color: "var(--slate-500)", fontSize: 12 }}>
                      {p.updated_at ? fmtDateLocal(p.updated_at, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="r">
                      {canArchive && (
                        <button className="mini sm" disabled={busyId === p.id} onClick={() => restore(p)}>
                          {busyId === p.id ? t("common.saving") : t("projects.restore")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

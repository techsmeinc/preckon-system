"use client";
// Dashboard — an estimator's landing. What needs me, what's due, where each bid
// sits in the chain. Everything here is derived from real artifacts and runs;
// nothing is a static number.

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, useCan, useMe, Skeleton, EmptyState } from "@/lib/ui";
import { Icon } from "@/lib/icons";
import { typeLabel, humanize } from "@/lib/catalog";
import { moduleForType, confPct, moneyShort, timeAgo, STAGE_ICON } from "@/lib/chain";
import { useProjectBundles, bundleStatus, STATUS_CHIP, type Bundle } from "@/lib/bundles";
import { useI18n, fmtDateLocal, type Key } from "@/lib/i18n";

/** Dashboards fan out; cap the fan-out so a 200-project tenant stays fast. */
const MAX_BUNDLES = 8;

export default function DashboardPage() {
  const router = useRouter();
  const me = useMe();
  const { t } = useI18n();
  const canAudit = useCan("admin.settings");
  const audit = useApi<any[]>(canAudit ? "/audit" : null, [], { refreshMs: 20000 });
  const { bundles, projects: projectList, loading, hydrating } = useProjectBundles(MAX_BUNDLES);

  const totals = useMemo(() => {
    const b = bundles ?? [];
    const pending = b.reduce((n, x) => n + x.pending.length, 0);
    const running = b.reduce((n, x) => n + x.runs.filter((r) => r.status === "running").length, 0);
    const value = b.reduce((n, x) => n + (x.value?.minor ?? 0), 0);
    const ccy = b.find((x) => x.value)?.value?.ccy ?? "";
    const soon = b.filter((x) => {
      const d = x.deadline ? daysUntil(x.deadline) : null;
      return d !== null && d >= 0 && d <= 7;
    });
    return { pending, running, value, ccy, soon };
  }, [bundles]);

  // The cross-project review queue — oldest waiting proposal first, because a
  // proposal nobody looks at is the one that quietly ages out the bid.
  const queue = useMemo(() => {
    const rows = (bundles ?? []).flatMap((b) =>
      b.pending.map((a) => ({ artifact: a, project: b.project, module: moduleForType(a.type_key) }))
    );
    return rows.sort((x, y) => +new Date(x.artifact.created_at) - +new Date(y.artifact.created_at)).slice(0, 6);
  }, [bundles]);

  const deadlines = useMemo(
    () =>
      (bundles ?? [])
        .filter((b) => b.deadline)
        .map((b) => ({ ...b, days: daysUntil(b.deadline!) ?? -1 }))
        .filter((b) => b.days >= 0)
        .sort((a, b) => a.days - b.days)
        .slice(0, 5),
    [bundles]
  );

  const feed = useMemo(
    () => activityFeed(bundles ?? [], audit.data ?? [], canAudit, t),
    [bundles, audit.data, canAudit, t]
  );
  const firstName = (me?.name ?? me?.email ?? "").split(/[\s@.]/)[0];
  const bidsWaiting = (bundles ?? []).filter((b) => b.pending.length).length;

  const greetingKey: Key = (() => {
    const h = new Date().getHours();
    return h < 12 ? "dash.morning" : h < 18 ? "dash.afternoon" : "dash.evening";
  })();

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{firstName ? t("dash.greeting", { greeting: t(greetingKey), name: cap(firstName) }) : t(greetingKey)}</h2>
          <p>
            {hydrating ? t("dash.reading")
              : totals.pending === 0
                ? t("dash.clear", { n: projectList.length })
                : t("dash.waiting", { n: totals.pending, bids: bidsWaiting })}
          </p>
        </div>
        <button className="mini pri" onClick={() => router.push("/projects?new=1")}>{t("shell.newProject")}</button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k"><Icon.projects />{t("dash.activeBids")}</div>
          <div className="v">{loading ? "—" : projectList.length}</div>
          <div className="sub">{totals.value ? t("dash.priced", { value: moneyShort(totals.value, totals.ccy) }) : t("dash.noPriced")}</div>
        </div>
        <div className="kpi">
          <div className="k"><Icon.clock />{t("dash.dueThisWeek")}</div>
          <div className="v" style={{ color: totals.soon.length ? "var(--amber-ink)" : undefined }}>{hydrating ? "—" : totals.soon.length}</div>
          <div className="sub">{totals.soon.length ? totals.soon.map((b) => b.project.name).join(" · ").slice(0, 42) : t("dash.fromDeadlines")}</div>
        </div>
        <div className="kpi">
          <div className="k"><Icon.review />{t("dash.awaitingReview")}</div>
          <div className="v" style={{ color: totals.pending ? "var(--amber-ink)" : undefined }}>{hydrating ? "—" : totals.pending}</div>
          <div className="sub">{t("dash.needEyes")}</div>
        </div>
        <div className="kpi">
          <div className="k"><Icon.copilot />{t("dash.inProgress")}</div>
          <div className="v">{hydrating ? "—" : totals.running}</div>
          <div className="sub">{t("dash.runsNow")}</div>
        </div>
      </div>

      <div className="row two">
        <div className="card">
          <div className="chead">
            <div><h3>{t("dash.needsReview")}</h3><div className="csub">{t("dash.needsReviewSub")}</div></div>
            <Link className="rowbtn" href="/projects">{t("dash.allProjects")}</Link>
          </div>
          {hydrating && queue.length === 0 ? <Skeleton rows={4} /> : queue.length === 0 ? (
            <p className="csub" style={{ margin: 0 }}>{t("dash.chainRunning")}</p>
          ) : (
            <ul className="rq">
              {queue.map(({ artifact, project, module }) => {
                const pct = confPct(artifact.confidence);
                const low = pct != null && pct < 90;
                const I = (Icon as any)[STAGE_ICON[module ?? ""] ?? "review"] ?? Icon.review;
                return (
                  <li key={artifact.id}>
                    <div className={"ic" + (low ? " hot" : "")}><I /></div>
                    <div className="tx">
                      <div className="tt">{typeLabel(artifact.type_key, t)} — {project.name}</div>
                      <div className="mt">{humanize(artifact.source_agent_key ?? "agent")} · {timeAgo(artifact.created_at)}</div>
                    </div>
                    {pct != null && <span className={"conf" + (low ? " warn" : "")}>{pct}%</span>}
                    <Link className="mini pri sm" href={module ? `/projects/${project.id}/modules/${module}` : `/projects/${project.id}`}>
                      {t("dash.review")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <h3>{t("dash.deadlines")}</h3>
          <div className="csub">{t("dash.deadlinesSub")}</div>
          {hydrating && deadlines.length === 0 ? <Skeleton rows={3} /> : deadlines.length === 0 ? (
            <p className="csub" style={{ margin: 0 }}>{t("dash.noDeadlines")}</p>
          ) : (
            <ul className="dl">
              {deadlines.map((b) => {
                const d = new Date(b.deadline!);
                return (
                  <li key={b.project.id}>
                    <div className="day">
                      <div className="d">{d.getDate()}</div>
                      <div className="m">{fmtDateLocal(b.deadline, { month: "short" })}</div>
                    </div>
                    <div className="nm">
                      {b.project.name}
                      <small>{b.project.client_name ?? "—"} · {b.days === 0 ? t("dash.dueToday") : t("dash.daysLeft", { n: b.days })}</small>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead">
          <div><h3>{t("dash.yourProjects")}</h3><div className="csub">{t("dash.yourProjectsSub")}</div></div>
          <Link className="rowbtn" href="/projects">{t("dash.viewAll")}</Link>
        </div>
        {loading ? <Skeleton rows={4} /> : projectList.length === 0 ? (
          <EmptyState title={t("dash.noProjects")} sub={t("dash.noProjectsSub")}
            action={<button className="mini pri" onClick={() => router.push("/projects?new=1")}>{t("shell.newProject")}</button>} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("projects.colProject")}</th><th>{t("projects.colStage")}</th><th>{t("projects.colProgress")}</th>
                <th className="r">{t("projects.colValue")}</th><th className="r">{t("projects.colDue")}</th><th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {(bundles ?? []).map((b) => (
                <tr key={b.project.id} className="clickable" onClick={() => router.push(`/projects/${b.project.id}`)}>
                  <td><div className="t-name">{b.project.name}</div><div className="t-sub">{b.project.client_name ?? b.project.code ?? "—"}</div></td>
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
                  <td><span className={"chip " + STATUS_CHIP[bundleStatus(b)].chip}>{t(`bundle.${bundleStatus(b)}` as Key, {})}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {projectList.length > MAX_BUNDLES && (
          <p className="csub" style={{ marginTop: 12, marginBottom: 0 }}>
            {t("dash.showingOf", { n: MAX_BUNDLES, total: projectList.length })} <Link className="rowbtn" href="/projects">{t("dash.seeAll")}</Link>
          </p>
        )}
      </div>

      <div className="card">
        <h3>{t("dash.recentActivity")}</h3>
        <div className="csub">{canAudit ? t("dash.activityAudit") : t("dash.activityPlain")}</div>
        {hydrating && feed.length === 0 ? <Skeleton rows={4} /> : feed.length === 0 ? (
          <p className="csub" style={{ margin: 0 }}>{t("dash.noActivity")}</p>
        ) : (
          <ul className="feed">
            {feed.map((a) => (
              <li key={a.id}>
                <div className="dot">{a.icon}</div>
                <div>
                  <div className="tx">{a.text}</div>
                  <div className="tm">{timeAgo(a.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function daysUntil(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

/**
 * The feed prefers the audit chain (who did what, tamper-evident) and falls
 * back to artifact emissions for roles that can't read the audit log. Each row
 * is one whole translated sentence — never fragments glued together, which
 * would come out backwards in Arabic.
 */
function activityFeed(
  bundles: Bundle[],
  auditRows: any[],
  canAudit: boolean,
  t: (k: Key, vars?: Record<string, string | number>) => string
) {
  const nameOf = (pid: string | null) =>
    bundles.find((b) => b.project.id === pid)?.project.name ?? t("feed.theWorkspace");

  if (canAudit && auditRows.length) {
    return auditRows.slice(0, 6).map((e: any) => {
      const [subject, ...rest] = String(e.action).split(".");
      return {
        id: `a${e.seq}`,
        at: e.created_at,
        icon: <Icon.trace />,
        text: t("feed.audit", { subject: humanize(subject), action: rest.join(" "), project: nameOf(e.project_id) }),
      };
    });
  }
  return bundles
    .flatMap((b) => b.artifacts.map((a) => ({ a, b })))
    .sort((x, y) => +new Date(y.a.created_at) - +new Date(x.a.created_at))
    .slice(0, 6)
    .map(({ a, b }) => ({
      id: a.id,
      at: a.created_at,
      icon: a.status === "confirmed" ? <Icon.review /> : <Icon.docs />,
      text: t(a.status === "confirmed" ? "feed.confirmed" : "feed.proposed", {
        agent: humanize(a.source_agent_key ?? "You"),
        type: typeLabel(a.type_key, t).toLowerCase(),
        project: b.project.name,
      }),
    }));
}

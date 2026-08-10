"use client";
// Get the desktop app.
//
// One job: put the right installer one click away, and be honest about what it
// is for. The desktop build is not a better Preckon — it is the same Preckon
// with the drawings moved onto your own machine, which matters to exactly the
// people who open .dwg files and wait on 9 MB sheets. Everybody else should
// read this page and decide they do not need it.

import { useEffect, useState } from "react";
import { useApi, EmptyState } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { desktop } from "@/lib/desktop";

type Platform = "windows" | "mac" | "linux";
interface Build {
  file: string; platform: Platform; size: number; version: string | null; portable: boolean; updated: string;
}

const LABEL: Record<Platform, string> = { windows: "Windows", mac: "macOS", linux: "Linux" };

/** Which build this machine wants, so the obvious button is the right one. */
function thisPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const s = `${navigator.platform} ${navigator.userAgent}`;
  if (/Win/i.test(s)) return "windows";
  if (/Mac/i.test(s)) return "mac";
  if (/Linux|X11/i.test(s)) return "linux";
  return null;
}

const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;

export default function DesktopPage() {
  const { t } = useI18n();
  const builds = useApi<Build[]>("/desktop", []);
  // Read after mount: the server has no navigator, and a page whose highlighted
  // button differs between the server's HTML and the client's is a hydration
  // mismatch.
  const [mine, setMine] = useState<Platform | null>(null);
  const [inApp, setInApp] = useState(false);
  useEffect(() => { setMine(thisPlatform()); setInApp(desktop() !== null); }, []);

  const all = builds.data ?? [];
  // One per platform — the newest. listBuilds already sorted by date, so the
  // first of each is the one to offer; older files stay on disk as a rollback.
  const latest = (["windows", "mac", "linux"] as Platform[])
    .map((p) => all.find((b) => b.platform === p))
    .filter(Boolean) as Build[];

  return (
    <>
      <div className="phead">
        <div>
          <h1>{t("desktop.title")}</h1>
          <p>{t("desktop.sub")}</p>
        </div>
      </div>

      {/* Said plainly rather than sold. Somebody who only reviews BOQ lines
          should leave this page without downloading anything. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead">
          <div>
            <h2>{t("desktop.whatTitle")}</h2>
            <div className="csub">{t("desktop.whatSub")}</div>
          </div>
        </div>
        <ul className="sch-notes">
          <li>{t("desktop.pointDwg")}</li>
          <li>{t("desktop.pointCache")}</li>
          <li>{t("desktop.pointSame")}</li>
        </ul>
        <p className="csub" style={{ marginTop: 12, marginBottom: 0 }}>{t("desktop.notOffline")}</p>
      </div>

      {inApp ? (
        <div className="card">
          <p className="csub" style={{ margin: 0 }}>{t("desktop.alreadyHere")}</p>
        </div>
      ) : builds.loading ? null : latest.length === 0 ? (
        <EmptyState title={t("desktop.noneTitle")} sub={t("desktop.noneSub")} />
      ) : (
        <div className="card">
          <div className="chead">
            <div>
              <h2>{t("desktop.downloadTitle")}</h2>
              <div className="csub">{t("desktop.downloadSub")}</div>
            </div>
          </div>
          <div className="tw">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("desktop.platform")}</th>
                  <th>{t("desktop.version")}</th>
                  <th className="num">{t("desktop.size")}</th>
                  <th><span className="vh">{t("desktop.download")}</span></th>
                </tr>
              </thead>
              <tbody>
                {latest.map((b) => (
                  <tr key={b.file}>
                    <td>
                      <b>{LABEL[b.platform]}</b>
                      <div className="csub">
                        {b.platform === mine ? `${t("desktop.thisMachine")} · ` : ""}
                        {b.portable ? t("desktop.portable") : t("desktop.installer")}
                      </div>
                    </td>
                    <td className="mono">{b.version ?? "—"}</td>
                    <td className="num mono">{mb(b.size)}</td>
                    <td className="num">
                      <a
                        className={b.platform === mine ? "btn btn-primary" : "btn btn-ghost"}
                        href={`/api/v1/desktop/${encodeURIComponent(b.file)}`}
                        download={b.file}
                      >
                        {t("desktop.download")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Unsigned builds trip SmartScreen and Gatekeeper. Better said here,
              before the download, than discovered as a scary warning after it. */}
          <p className="csub" style={{ marginTop: 12, marginBottom: 0 }}>{t("desktop.unsigned")}</p>
        </div>
      )}
    </>
  );
}

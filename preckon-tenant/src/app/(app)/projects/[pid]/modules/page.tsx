"use client";
import { use } from "react";
import Link from "next/link";
import { useApi, Skeleton } from "@/lib/ui";
import { MODULE_META } from "@/lib/catalog";

export default function ModulesPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const ent = useApi<{ licensedModules: any[] }>("/entitlements");
  const workflows = useApi<any[]>("/workflows");

  const modules = ent.data?.licensedModules ?? [];
  const wfByModule = new Map<string, any[]>();
  for (const w of workflows.data ?? []) { const a = wfByModule.get(w.moduleKey) ?? []; a.push(w); wfByModule.set(w.moduleKey, a); }

  return (
    <>
      <p className="csub" style={{ marginTop: 0 }}>Each licensed product is a workspace over the shared project graph. Open one to run it and see its outputs.</p>
      {ent.loading ? <Skeleton rows={4} /> : (
        <div className="mcards">
          {modules.map((m) => {
            const meta = MODULE_META[m.key] ?? { icon: m.icon ?? "▶", kind: m.label ?? "", desc: m.description ?? "" };
            const count = (wfByModule.get(m.key) ?? []).length;
            return (
              <Link key={m.key} href={`/projects/${pid}/modules/${m.key}`} className="mcard" style={{ color: "inherit" }}>
                <div className="mtop"><span className="micon">{meta.icon}</span><span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{count} workflow{count !== 1 ? "s" : ""}</span></div>
                <div><div className="mkind">{meta.kind}</div><div className="mname">{m.label}</div></div>
                <div className="mdesc">{meta.desc}</div>
                <div className="mact"><span className="mini sm">Open workspace →</span></div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

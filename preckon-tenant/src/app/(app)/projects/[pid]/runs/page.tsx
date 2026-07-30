"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, useCan, useToast, Skeleton, EmptyState, Drawer, Field, fmtDateTime } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { humanize } from "@/lib/catalog";
import { Icon } from "@/lib/icons";

export default function RunsPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const router = useRouter();
  const toast = useToast();
  const canRun = useCan("workflow.run");
  const runs = useApi<any[]>(`/projects/${pid}/runs`, [], { refreshMs: 2500 });
  const workflows = useApi<any[]>("/workflows");
  const [open, setOpen] = useState(false);
  const [wf, setWf] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!wf) return;
    setBusy(true);
    try {
      const res = await api.post<{ id: string }>(`/projects/${pid}/runs`, { workflow_key: wf });
      toast("Run started — agents are working");
      setOpen(false);
      router.push(`/projects/${pid}/runs/${res.id}`);
    } catch (e: any) { toast(e?.message ?? "Couldn’t start run"); }
    finally { setBusy(false); }
  }

  const list = runs.data ?? [];
  const wfName = (k: string) => (workflows.data ?? []).find((w) => w.key === k)?.name ?? humanize(k);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <p className="csub" style={{ margin: 0 }}>Every run writes the same project artifact graph. Start one, then confirm its proposals in the Review queue.</p>
        {canRun && <button className="mini pri" onClick={() => { setWf(workflows.data?.[0]?.key ?? ""); setOpen(true); }}><Icon.add /> Start a run</button>}
      </div>

      {runs.loading ? <Skeleton rows={5} /> : list.length === 0 ? (
        <EmptyState title="No runs yet" sub="Start a workflow to generate proposals for review."
          action={canRun ? <button className="mini pri" onClick={() => { setWf(workflows.data?.[0]?.key ?? ""); setOpen(true); }}>Start a run</button> : undefined} />
      ) : (
        <div className="card">
          <table>
            <thead><tr><th>Workflow</th><th>Status</th><th className="r">Started</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => router.push(`/projects/${pid}/runs/${r.id}`)}>
                  <td><span className="t-name">{wfName(r.workflow_key)}</span><div className="t-sub">v{r.workflow_version}</div></td>
                  <td><span className={"chip " + r.status}>{r.status.replace(/_/g, " ")}</span></td>
                  <td className="r mono" style={{ fontSize: 11.5 }}>{fmtDateTime(r.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={open} title="Start a run" onClose={() => setOpen(false)}
        footer={<><button className="mini" onClick={() => setOpen(false)}>Cancel</button><button className="mini pri" disabled={busy || !wf} onClick={start}>{busy ? "Starting…" : "Start run"}</button></>}>
        <p className="csub">Pick a workflow to run. Its AI agents produce proposals for your team to review and confirm.</p>
        <Field label="Workflow">
          <select value={wf} onChange={(e) => setWf(e.target.value)}>
            {(workflows.data ?? []).map((w) => <option key={w.key} value={w.key}>{w.name} — {w.moduleKey}</option>)}
          </select>
        </Field>
      </Drawer>
    </>
  );
}

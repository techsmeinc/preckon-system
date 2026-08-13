"use client";
import { use, useState } from "react";
import { useApi, useCan, useToast, Skeleton, EmptyState, Drawer, Field } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { typeLabel, humanize, PayloadView } from "@/lib/catalog";

export default function ReviewPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const toast = useToast();
  const canConfirm = useCan("artifact.confirm");
  const canEdit = useCan("artifact.edit");
  const queue = useApi<any[]>(`/projects/${pid}/review-queue`, [], { refreshMs: 2000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [payloads, setPayloads] = useState<Record<string, any>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadPayload(id: string) {
    if (payloads[id]) return payloads[id];
    const a = await api.get<any>(`/projects/${pid}/artifacts/${id}`);
    setPayloads((p) => ({ ...p, [id]: a.payload }));
    return a.payload;
  }
  async function toggleInspect(id: string) {
    if (openId === id) { setOpenId(null); return; }
    await loadPayload(id); setOpenId(id);
  }
  async function confirm(id: string) { setBusy(true); try { await api.post(`/projects/${pid}/artifacts/${id}/confirm`); toast("Confirmed"); queue.reload(); } catch (e: any) { toast(e?.message ?? "Failed"); } finally { setBusy(false); } }
  async function reject(id: string) { setBusy(true); try { await api.post(`/projects/${pid}/artifacts/${id}/reject`); toast("Rejected"); queue.reload(); } catch (e: any) { toast(e?.message ?? "Failed"); } finally { setBusy(false); } }
  async function openEdit(id: string) { const p = await loadPayload(id); setEditText(JSON.stringify(p, null, 2)); setEditId(id); }
  async function saveEdit() {
    if (!editId) return;
    let parsed: any;
    try { parsed = JSON.parse(editText); } catch { toast("Invalid JSON"); return; }
    setBusy(true);
    try { const r = await api.patch<{ staleCount: number }>(`/projects/${pid}/artifacts/${editId}`, { payload: parsed }); toast(`Edited — ${r.staleCount} downstream marked stale`); setEditId(null); queue.reload(); }
    catch (e: any) { toast(e?.message ?? "Failed"); } finally { setBusy(false); }
  }

  const items = queue.data ?? [];
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <p className="csub" style={{ margin: 0 }}>Agents propose; you dispose. Every confirm lands on the tamper-evident audit chain.</p>
        <span className={"chip " + (items.length ? "pending" : "draft") + " plain"}>{items.length} pending</span>
      </div>

      {queue.loading ? <Skeleton rows={4} /> : items.length === 0 ? (
        <EmptyState title="Nothing awaiting review" sub="Start a run from the Modules or Runs tab to generate proposals." />
      ) : items.map((it: any) => (
        <div key={it.id} className="qitem">
          <div className="qh">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="chip pending">{typeLabel(it.type_key)}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{humanize(it.source_agent_key)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--slate-500)" }}>conf {it.confidence ?? "—"}</span>
              <button className="rowbtn" onClick={() => toggleInspect(it.id)}>{openId === it.id ? "Hide" : "Inspect"}</button>
            </div>
          </div>
          {openId === it.id && <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--panel-2)", border: "1px solid var(--hairline)", borderRadius: 9 }}><PayloadView payload={payloads[it.id] ?? {}} /></div>}
          {canConfirm && (
            <div className="qactions">
              <button className="mini pri" disabled={busy} onClick={() => confirm(it.id)}>Confirm</button>
              <button className="mini" disabled={busy} onClick={() => reject(it.id)}>Reject</button>
              {canEdit && <button className="mini" disabled={busy} onClick={() => openEdit(it.id)}>Edit…</button>}
            </div>
          )}
        </div>
      ))}

      <Drawer open={!!editId} title="Edit artifact" onClose={() => setEditId(null)}
        footer={<><button className="mini" onClick={() => setEditId(null)}>Cancel</button><button className="mini pri" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save — supersede & re-plan"}</button></>}>
        <p className="csub">Editing creates a new version and flags everything derived from it as <b>out of date</b>. Re-run the producing step to refresh it.</p>
        <Field label="Payload (JSON)">
          <textarea className="mono" value={editText} onChange={(e) => setEditText(e.target.value)} style={{ minHeight: 260 }} />
        </Field>
      </Drawer>
    </>
  );
}

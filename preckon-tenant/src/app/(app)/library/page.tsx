"use client";
import { useState } from "react";
import { useApi, useCan, useToast, Skeleton, EmptyState, Drawer, Field } from "@/lib/ui";
import { LearnedLessons } from "@/lib/learned";
import { api } from "@/lib/apiclient";
import { Icon } from "@/lib/icons";
import { useI18n } from "@/lib/i18n";

const SUGGESTED = ["reference", "glossary", "policy", "template", "rate_book", "standard", "precedent"];
const label = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

type KV = { k: string; v: string };
type EditState = { mode: "new" | "edit"; id?: string; collection: string; entryKey: string; fields: KV[] };

export default function LibraryPage() {
  const canManage = useCan("library.manage");
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading, error, reload } = useApi<any[]>("/library", [], { refreshMs: 8000 });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [q, setQ] = useState("");

  const grouped = new Map<string, any[]>();
  for (const e of data ?? []) { const g = grouped.get(e.collection) ?? []; g.push(e); grouped.set(e.collection, g); }
  const collections = [...new Set([...(data ?? []).map((e) => e.collection)])];

  // Collections are the tenant's own taxonomy (rate books, historical bids,
  // standards…), so the tabs are whatever they've actually created.
  const needle = q.trim().toLowerCase();
  const visible = [...grouped.entries()]
    .filter(([col]) => tab === "all" || col === tab)
    .map(([col, entries]) => [
      col,
      entries.filter((e) => !needle || `${e.entry_key ?? ""} ${JSON.stringify(e.payload ?? {})}`.toLowerCase().includes(needle)),
    ] as [string, any[]])
    .filter(([, entries]) => entries.length > 0 || !needle);

  function openNew() { setEdit({ mode: "new", collection: "", entryKey: "", fields: [{ k: "", v: "" }] }); }
  function openEdit(e: any) {
    const fields = Object.entries(e.payload ?? {}).map(([k, v]) => ({ k, v: typeof v === "object" ? JSON.stringify(v) : String(v) }));
    setEdit({ mode: "edit", id: e.id, collection: e.collection, entryKey: e.entry_key ?? "", fields: fields.length ? fields : [{ k: "", v: "" }] });
  }
  async function remove(e: any) {
    if (!window.confirm(t("library.removeConfirm", { key: e.entry_key ?? e.id.slice(0, 8), collection: label(e.collection) }))) return;
    try { await api.del(`/library/${e.id}`); toast(t("library.removed")); reload(); }
    catch (err: any) { toast(err?.message ?? t("library.removeFail")); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>{t("library.title")}</h1><p>{t("library.sub")}</p></div>
        {canManage && <button className="mini pri" onClick={openNew}><Icon.add /> {t("library.addEntry")}</button>}
      </div>

      {collections.length > 0 && (
        <>
          <nav className="pw-tabs">
            <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>{t("library.all")} {(data ?? []).length}</button>
            {collections.map((c) => (
              <button key={c} className={tab === c ? "on" : ""} onClick={() => setTab(c)}>
                {label(c)} {grouped.get(c)?.length ?? 0}
              </button>
            ))}
          </nav>
          <div className="fbar">
            <div className="fsearch">
              <Icon.search />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("library.search")} aria-label={t("library.search")} />
            </div>
          </div>
        </>
      )}

      {loading ? <Skeleton rows={5} /> : error ? <EmptyState title={t("library.loadFail")} sub={error} /> :
        (data ?? []).length === 0 ? (
          <EmptyState title={t("library.emptyTitle")} sub={t("library.emptySub")}
            action={canManage ? <button className="mini pri" onClick={openNew}>{t("library.addFirst")}</button> : undefined} />
        ) : (
          visible.map(([col, entries]) => (
            <div className="card" key={col} style={{ marginBottom: 16 }}>
              <div className="chead">
                <div><h2>{label(col)}</h2><div className="csub">{t("library.entryCount", { n: entries.length })}</div></div>
              </div>
              <table>
                <thead><tr><th>{t("library.colKey")}</th><th>{t("library.colDetails")}</th><th className="r">{t("library.colVersion")}</th>{canManage && <th></th>}</tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="t-name mono">{e.entry_key ?? e.id.slice(0, 8)}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--slate-500)" }}>{summarise(e.payload)}</td>
                      <td className="r num">v{e.version}</td>
                      {canManage && (
                        <td className="r" style={{ whiteSpace: "nowrap" }}>
                          <button className="mini sm" onClick={() => openEdit(e)}>{t("common.edit")}</button>{" "}
                          <button className="mini sm" onClick={() => remove(e)}>{t("common.remove")}</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}

      {edit && <EntryDrawer edit={edit} setEdit={setEdit} collections={collections} onDone={() => { setEdit(null); reload(); }} toast={toast} />}
    </>
  );
}

function EntryDrawer({ edit, setEdit, collections, onDone, toast }: any) {
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EditState>) => setEdit({ ...edit, ...patch });
  const setField = (i: number, patch: Partial<KV>) => set({ fields: edit.fields.map((f: KV, j: number) => (j === i ? { ...f, ...patch } : f)) });
  const addField = () => set({ fields: [...edit.fields, { k: "", v: "" }] });
  const rmField = (i: number) => set({ fields: edit.fields.filter((_: KV, j: number) => j !== i) });

  async function submit() {
    const payload: Record<string, unknown> = {};
    for (const f of edit.fields) if (f.k.trim()) {
      const n = Number(f.v);
      payload[f.k.trim()] = f.v !== "" && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(f.v.trim()) ? n : f.v;
    }
    setBusy(true);
    try {
      if (edit.mode === "new") await api.post("/library", { collection: edit.collection, entryKey: edit.entryKey || undefined, payload });
      else await api.patch(`/library/${edit.id}`, { entryKey: edit.entryKey || null, payload });
      toast(edit.mode === "new" ? "Entry added" : "Entry updated");
      onDone();
    } catch (e: any) { toast(e?.message ?? "Couldn’t save"); } finally { setBusy(false); }
  }

  return (
    <Drawer open title={edit.mode === "new" ? "Add library entry" : "Edit entry"} onClose={() => setEdit(null)}
      footer={<><button className="mini" onClick={() => setEdit(null)}>Cancel</button><button className="mini pri" disabled={busy || !edit.collection.trim()} onClick={submit}>{busy ? "Saving…" : edit.mode === "new" ? "Add entry" : "Save"}</button>
      <LearnedLessons />
    </>}>
      <Field label="Collection">
        <input list="lib-collections" value={edit.collection} disabled={edit.mode === "edit"} onChange={(e) => set({ collection: e.target.value })} placeholder="e.g. rate_book, glossary, policy" />
        <datalist id="lib-collections">{[...new Set([...collections, ...SUGGESTED])].map((c: string) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Key (optional)"><input className="mono" value={edit.entryKey} onChange={(e) => set({ entryKey: e.target.value })} placeholder="e.g. C20, term-abc" /></Field>
      <Field label="Fields">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {edit.fields.map((f: KV, i: number) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="mono" value={f.k} onChange={(e) => setField(i, { k: e.target.value })} placeholder="name" style={{ maxWidth: 150 }} />
              <input value={f.v} onChange={(e) => setField(i, { v: e.target.value })} placeholder="value" style={{ flex: 1 }} />
              <button className="mini sm" onClick={() => rmField(i)} title="Remove field">✕</button>
            </div>
          ))}
          <button className="mini sm" onClick={addField} style={{ alignSelf: "flex-start" }}>+ Add field</button>
        </div>
      </Field>
    </Drawer>
  );
}

function summarise(payload: any): string {
  if (!payload || typeof payload !== "object") return String(payload ?? "—");
  return Object.entries(payload).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

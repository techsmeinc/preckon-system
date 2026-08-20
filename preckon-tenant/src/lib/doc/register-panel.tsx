"use client";
// The controlled document register, on screen.
//
// Everything DocLogix does was reachable only over HTTP until this existed,
// which meant the register — the thing whose entire job is to tell a room full
// of people what has been issued and what is late — could only be read by
// someone with a terminal.
//
// It sits beside the intake screen rather than replacing it, because they are
// different jobs: intake is "files arrived, classify them", the register is
// "these documents exist, at these revisions, and this is what went out". A
// file can arrive without being a controlled document, and a controlled
// document exists from the moment it is required, long before its file does.
//
// The table does the work. Everything you can do to a document is on its row —
// the drawer is for detail, not for actions — because a register is read in a
// meeting, and "open this, then open that" is not how anybody reads in a
// meeting.

import { useMemo, useState } from "react";
import { api } from "@/lib/apiclient";
import { useApi, useCan, useToast, Skeleton, EmptyState, Drawer, Field, StatusChip, errMessage, fmtDate } from "@/lib/ui";

interface Doc {
  id: string;
  document_number: string;
  title: string;
  doc_type?: string | null;
  discipline?: string | null;
  status?: string | null;
  required_by?: string | null;
  current_revision?: string | null;
}

interface Segment { key: string; label: string; kind: string; values?: string[]; optional?: boolean }
interface Scheme { id: string | null; key: string; name: string; segments: Segment[]; example: string }

type SortKey = "document_number" | "title" | "discipline" | "current_revision" | "required_by";

/** Past its required-by date with nothing issued. The row the register is for. */
const isLate = (d: Doc) =>
  !!d.required_by && !d.current_revision && Date.parse(d.required_by) < Date.now();

export function RegisterPanel({ pid }: { pid: string }) {
  const toast = useToast();
  const canEdit = useCan("artifact.edit");
  const canIssue = useCan("artifact.confirm");
  const reg = useApi<{ documents: Doc[]; schemes: Scheme[] }>(`/projects/${pid}/documents`, []);
  const transmittals = useApi<any>(`/projects/${pid}/transmittals`, []);

  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "late" | "issued" | "unissued">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "document_number", dir: 1 });

  const scheme = reg.data?.schemes?.[0];
  const all = reg.data?.documents ?? [];

  const docs = useMemo(() => {
    const text = q.trim().toLowerCase();
    const rows = all.filter((d) => {
      if (text && !`${d.document_number} ${d.title} ${d.discipline ?? ""}`.toLowerCase().includes(text)) return false;
      if (filter === "late") return isLate(d);
      if (filter === "issued") return !!d.current_revision;
      if (filter === "unissued") return !d.current_revision;
      return true;
    });
    return [...rows].sort((a, b) => {
      const av = String(a[sort.key] ?? ""), bv = String(b[sort.key] ?? "");
      // Numeric-aware, so sheet 10 sorts after sheet 2 rather than before it.
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * sort.dir;
    });
  }, [all, q, filter, sort]);

  const lateCount = all.filter(isLate).length;
  const toggle = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }));

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="sortable" onClick={() => toggle(k)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {children}<span className="dir">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
    </th>
  );

  return (
    <>
      <div className="card" style={{ padding: "14px 18px" }}>
        <div className="chead">
          <div>
            <h2>Document register</h2>
            <div className="csub">
              {reg.loading ? "Loading…" : `${docs.length} of ${all.length} controlled document${all.length === 1 ? "" : "s"}`}
              {scheme ? ` · numbering: ${scheme.key}` : ""}
              {lateCount > 0 && <> · <b style={{ color: "var(--red-ink)" }}>{lateCount} late</b></>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Filters rather than a search-only box: "what is late" is the
                question this screen is opened to answer, and making somebody
                construct it out of a text search is making them work. */}
            <div className="ws-tabs" role="group" aria-label="Filter">
              {([["all", "All"], ["late", `Late${lateCount ? ` (${lateCount})` : ""}`], ["issued", "Issued"], ["unissued", "Not issued"]] as const).map(([k, label]) => (
                <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            <input
              className="inp" placeholder="Filter by number, title or discipline" value={q}
              onChange={(e) => setQ(e.target.value)} style={{ width: 240 }}
            />
            {canEdit && <button className="btn btn-primary" onClick={() => setAdding(true)}>Register a document</button>}
          </div>
        </div>

        {reg.loading ? <Skeleton rows={4} /> : all.length === 0 ? (
          <EmptyState
            title="Nothing registered yet"
            sub="A document belongs in the register from the moment it is required — before its file exists. That is what makes the register able to tell you what is late."
          />
        ) : docs.length === 0 ? (
          <EmptyState title="Nothing matches" sub="No document matches this filter." />
        ) : (
          <div className="tw">
            <table className="tbl">
              <thead>
                <tr>
                  <Th k="document_number">Number</Th>
                  <Th k="title">Title</Th>
                  <Th k="discipline">Discipline</Th>
                  <Th k="current_revision">Current</Th>
                  <th>Status</th>
                  <Th k="required_by">Required by</Th>
                  <th style={{ textAlign: "right" }}><span className="vh">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                      <button className="linkish" onClick={() => setOpen(d)}>{d.document_number}</button>
                    </td>
                    <td>{d.title}</td>
                    <td>{d.discipline ?? "—"}</td>
                    <td><b>{d.current_revision ?? "—"}</b></td>
                    <td>
                      {isLate(d)
                        ? <StatusChip status="late" label="Late" />
                        : <StatusChip status={d.status ?? "registered"} />}
                    </td>
                    <td style={{ color: isLate(d) ? "var(--red-ink)" : undefined, whiteSpace: "nowrap" }}>
                      {d.required_by ? fmtDate(d.required_by) : "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="mini sm" onClick={() => setOpen(d)}>Open</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TransmittalCard state={transmittals} />

      {adding && scheme && (
        <RegisterDrawer
          pid={pid} scheme={scheme}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); reg.reload(); toast("Registered"); }}
        />
      )}

      {open && (
        <DocumentDrawer
          pid={pid} doc={open} canEdit={canEdit} canIssue={canIssue}
          onClose={() => setOpen(null)}
          onChanged={() => { reg.reload(); transmittals.reload(); }}
        />
      )}
    </>
  );
}

/* ── registering ──────────────────────────────────────────────────────────── */

function RegisterDrawer({ pid, scheme, onClose, onDone }: {
  pid: string; scheme: Scheme; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [segments, setSegments] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  // The sequence segment is allocated by the server, so it is shown as such
  // rather than offered as a field somebody can fight with.
  const editable = scheme.segments.filter((s) => s.kind !== "sequence");

  /* The number as it will be, updating as the form is filled.
     Filling six segments and finding out afterwards is how people discover
     they have used the wrong originator code on document forty. */
  const preview = scheme.segments
    .map((s) => (s.kind === "sequence" ? "####" : (segments[s.key] || (s.optional ? "" : "…"))))
    .filter(Boolean)
    .join(scheme.separator ?? "-");

  async function submit() {
    setBusy(true); setIssues([]);
    try {
      const res: any = await api.post(`/projects/${pid}/documents`, { title, segments });
      if (res?.error === "invalid_number") { setIssues(res.issues ?? []); return; }
      onDone();
    } catch (e) {
      toast(errMessage(e), "bad");
    } finally { setBusy(false); }
  }

  return (
    <Drawer
      open title="Register a document" onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!title.trim() || busy} onClick={submit}>
          {busy ? "Registering…" : "Register"}
        </button>
      }
    >
      <Field label="Title"><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>

      <div className="csub" style={{ margin: "10px 0 4px" }}>{scheme.name}</div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 13, padding: "8px 10px",
        background: "var(--panel-2)", borderRadius: 8, marginBottom: 12,
      }}>
        {preview || scheme.example}
        <div className="csub" style={{ fontFamily: "var(--font-body)", marginTop: 2 }}>
          #### is allocated when you register.
        </div>
      </div>

      {editable.map((s) => (
        <Field key={s.key} label={s.label + (s.optional ? " (optional)" : "")}>
          {s.kind === "enum" ? (
            <select className="inp" value={segments[s.key] ?? ""}
                    onChange={(e) => setSegments({ ...segments, [s.key]: e.target.value })}>
              <option value="">Choose…</option>
              {(s.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : (
            <input className="inp" value={segments[s.key] ?? ""}
                   onChange={(e) => setSegments({ ...segments, [s.key]: e.target.value.toUpperCase() })} />
          )}
        </Field>
      ))}

      {/* Validation failures come back BEFORE a number is allocated, so nothing
          is burned by a rejected attempt. Shown per segment rather than as one
          blanket "invalid". */}
      {issues.length > 0 && (
        <div className="ws-note" role="alert" style={{ marginTop: 12 }}>
          <b>Not a valid number under this scheme.</b> No number was allocated.
          <ul style={{ margin: "6px 0 0 16px" }}>
            {issues.map((i, n) => <li key={n}>{i.message ?? JSON.stringify(i)}</li>)}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

/* ── one document: revision timeline, review, issue, send ─────────────────── */

function DocumentDrawer({ pid, doc, canEdit, canIssue, onClose, onChanged }: {
  pid: string; doc: Doc; canEdit: boolean; canIssue: boolean;
  onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const revisions = useApi<any>(`/projects/${pid}/documents/${doc.id}/revisions`, [doc.id]);
  const reviews = useApi<any>(`/projects/${pid}/documents/${doc.id}/reviews`, [doc.id]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<any | null>(null);

  const rows: any[] = revisions.data?.revisions ?? revisions.data ?? [];

  async function addRevision() {
    setBusy(true);
    try {
      await api.post(`/projects/${pid}/documents/${doc.id}/revisions`, {
        suitability: "S2", description: "Raised from the register",
      });
      revisions.reload(); onChanged(); toast("Revision raised");
    } catch (e) { toast(errMessage(e), "bad"); } finally { setBusy(false); }
  }

  async function issue(rid: string) {
    setBusy(true);
    try {
      const res: any = await api.post(`/projects/${pid}/documents/${doc.id}/revisions/${rid}/issue`, {});
      // The review gate answers 409 with the reason. Showing that sentence is
      // the difference between a user resolving the review and working around
      // the system.
      if (res?.error === "review_incomplete") { toast(res.message, "bad"); return; }
      revisions.reload(); reviews.reload(); onChanged(); toast("Issued");
    } catch (e) { toast(errMessage(e), "bad"); } finally { setBusy(false); }
  }

  async function openReview(rid: string) {
    setBusy(true);
    try {
      await api.post(`/projects/${pid}/documents/${doc.id}/reviews`, {
        revision_id: rid, stage: "internal", min_approvals: 1, parties: ["Discipline lead"],
      });
      reviews.reload(); toast("Sent for review");
    } catch (e) { toast(errMessage(e), "bad"); } finally { setBusy(false); }
  }

  async function decide(rvid: string, decision: string) {
    setBusy(true);
    try {
      const res: any = await api.post(`/projects/${pid}/documents/${doc.id}/reviews/${rvid}`, {
        party: "Discipline lead", decision,
      });
      if (res?.error) { toast(res.message, "bad"); return; }
      reviews.reload(); toast(`Recorded: ${decision.replace(/_/g, " ")}`);
    } catch (e) { toast(errMessage(e), "bad"); } finally { setBusy(false); }
  }

  const cyclesFor = (rid: string) =>
    (reviews.data?.reviews ?? []).find((r: any) => r.revision_id === rid)?.cycles ?? [];

  return (
    <Drawer open title={doc.document_number} onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{doc.title}</div>
      <div className="csub" style={{ marginBottom: 14 }}>
        {[doc.doc_type, doc.discipline].filter(Boolean).join(" · ") || "—"}
        {doc.required_by ? ` · required by ${fmtDate(doc.required_by)}` : ""}
      </div>

      {canEdit && (
        <button className="mini" disabled={busy} onClick={addRevision} style={{ marginBottom: 14 }}>
          Raise a revision
        </button>
      )}

      {revisions.loading ? <Skeleton rows={2} /> : rows.length === 0 ? (
        <div className="csub">No revisions yet.</div>
      ) : (
        /* A timeline rather than a stack of equal cards: revisions are a
           sequence, and which one is current is the first thing anybody wants
           from it. */
        <ol style={{ listStyle: "none", margin: 0, padding: 0, borderInlineStart: "2px solid var(--hairline)" }}>
          {rows.map((r: any) => {
            const state: string = r.state ?? "draft";
            const issued = state === "current" || state === "superseded";
            const cycles = cyclesFor(r.id);
            const openCycle = cycles.find((c: any) => c.status === "open");

            return (
              <li key={r.id} style={{ position: "relative", padding: "0 0 16px 14px" }}>
                <span style={{
                  position: "absolute", insetInlineStart: -6, top: 4, width: 10, height: 10, borderRadius: "50%",
                  background: state === "current" ? "var(--teal)" : state === "superseded" ? "var(--slate-300)" : "var(--amber)",
                }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <b style={{ fontFamily: "var(--font-mono)" }}>{r.revision_code ?? r.revisionCode}</b>
                    {r.suitability ? <span className="csub"> · {r.suitability}</span> : null}
                  </div>
                  <StatusChip status={state} />
                </div>
                {r.description && <div className="csub">{r.description}</div>}
                <div className="csub">
                  {r.issued_at ? `Issued ${r.issued_at}` : r.created_at ? `Raised ${r.created_at}` : ""}
                </div>

                {cycles.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {cycles.map((c: any) => (
                      <div key={c.id} className="csub" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <StatusChip status={c.status === "open" ? "in_review" : (c.state?.outcome ?? "completed")} />
                        <span>{c.description}</span>
                        {c.status === "open" && canEdit && (
                          <>
                            <button className="mini sm" disabled={busy} onClick={() => decide(c.id, "approved")}>Approve</button>
                            <button className="mini sm" disabled={busy} onClick={() => decide(c.id, "revise_and_resubmit")}>Revise</button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {canEdit && !openCycle && !issued && (
                    <button className="mini sm" disabled={busy} onClick={() => openReview(r.id)}>Send for review</button>
                  )}
                  {canIssue && !issued && (
                    <button className="mini sm" disabled={busy} onClick={() => issue(r.id)}>Issue</button>
                  )}
                  {/* Issuing used to leave the reader at "Nothing transmitted yet
                      — issue a revision, then send it", with nothing anywhere
                      that sends one. An instruction with no button is worse than
                      no instruction. */}
                  {canEdit && state === "current" && (
                    <button className="mini sm" disabled={busy} onClick={() => setSending(r)}>Send to…</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {sending && (
        <SendDrawer
          pid={pid} doc={doc} revision={sending}
          onClose={() => setSending(null)}
          onSent={() => { setSending(null); onChanged(); toast("Transmitted"); }}
        />
      )}
    </Drawer>
  );
}

/**
 * Compose and send a transmittal.
 *
 * Creates and sends in one action, because that is one act to the person doing
 * it — but the two API calls stay separate, since a transmittal that is created
 * and not sent is a real state (a draft nobody released) and collapsing them
 * would make it unreachable.
 */
function SendDrawer({ pid, doc, revision, onClose, onSent }: {
  pid: string; doc: Doc; revision: any; onClose: () => void; onSent: () => void;
}) {
  const toast = useToast();
  const [purpose, setPurpose] = useState("For construction");
  const [subject, setSubject] = useState(`${doc.document_number} revision ${revision.revision_code ?? ""}`.trim());
  const [party, setParty] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const created: any = await api.post(`/projects/${pid}/transmittals`, {
        purpose, subject,
        revision_ids: [revision.id],
        recipients: [{ party: party.trim(), kind: "to" }],
      });
      const id = created?.id ?? created?.transmittal?.id;
      if (!id) { toast("The transmittal was not created.", "bad"); return; }
      await api.post(`/projects/${pid}/transmittals/${id}/send`, {});
      onSent();
    } catch (e) {
      toast(errMessage(e), "bad");
    } finally { setBusy(false); }
  }

  return (
    <Drawer
      open title="Send a transmittal" onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!party.trim() || !purpose.trim() || busy} onClick={send}>
          {busy ? "Sending…" : "Send"}
        </button>
      }
    >
      <div className="csub" style={{ marginBottom: 12 }}>
        Sending <b style={{ fontFamily: "var(--font-mono)" }}>{doc.document_number}</b> revision{" "}
        <b>{revision.revision_code}</b>. A transmittal carries the revision, so this stays a record of
        exactly what went out even after the document moves on.
      </div>
      <Field label="Purpose"><input className="inp" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
      <Field label="Subject"><input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="To"><input className="inp" placeholder="Main Contractor" value={party} onChange={(e) => setParty(e.target.value)} /></Field>
    </Drawer>
  );
}

/* ── transmittals ─────────────────────────────────────────────────────────── */

function TransmittalCard({ state }: { state: any }) {
  const rows: any[] = state.data?.transmittals ?? state.data ?? [];
  return (
    <div className="card" style={{ padding: "14px 18px", marginTop: 16 }}>
      <div className="chead">
        <div>
          <h2>Transmittals</h2>
          {/* Worth stating on the screen: this is why a transmittal still shows
              revision A after the document has moved to B. */}
          <div className="csub">What was sent, to whom, and when they acknowledged. A transmittal carries revisions, not documents.</div>
        </div>
      </div>
      {state.loading ? <Skeleton rows={2} /> : rows.length === 0 ? (
        <EmptyState title="Nothing transmitted yet" sub="Open a document, then Send to… on its current revision." />
      ) : (
        <div className="tw">
          <table className="tbl">
            <thead>
              <tr><th>Number</th><th>Purpose</th><th>Subject</th><th>Status</th><th className="num">Items</th><th className="num">To</th><th>Sent</th></tr>
            </thead>
            <tbody>
              {rows.map((t: any) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{t.transmittal_number ?? "—"}</td>
                  <td>{t.purpose}</td>
                  <td>{t.subject ?? "—"}</td>
                  <td><StatusChip status={t.status ?? "draft"} /></td>
                  <td className="num">{t.item_count ?? "—"}</td>
                  <td className="num">{t.recipient_count ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{t.sent_at ? fmtDate(t.sent_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

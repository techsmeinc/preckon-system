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

import { useState } from "react";
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

export function RegisterPanel({ pid }: { pid: string }) {
  const toast = useToast();
  const canEdit = useCan("artifact.edit");
  const canIssue = useCan("artifact.confirm");
  const reg = useApi<{ documents: Doc[]; schemes: Scheme[] }>(`/projects/${pid}/documents`, []);
  const transmittals = useApi<any>(`/projects/${pid}/transmittals`, []);

  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const [q, setQ] = useState("");

  const scheme = reg.data?.schemes?.[0];
  const docs = (reg.data?.documents ?? []).filter(
    (d) => !q || `${d.document_number} ${d.title}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <div className="card" style={{ padding: "14px 18px" }}>
        <div className="chead">
          <div>
            <h2>Document register</h2>
            <div className="csub">
              {reg.loading ? "Loading…" : `${docs.length} controlled document${docs.length === 1 ? "" : "s"}`}
              {scheme ? ` · numbering: ${scheme.key}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="inp" placeholder="Filter by number or title" value={q}
              onChange={(e) => setQ(e.target.value)} style={{ width: 220 }}
            />
            {canEdit && <button className="btn btn-primary" onClick={() => setAdding(true)}>Register a document</button>}
          </div>
        </div>

        {reg.loading ? <Skeleton rows={4} /> : docs.length === 0 ? (
          <EmptyState
            title="Nothing registered yet"
            sub="A document belongs in the register from the moment it is required — before its file exists. That is what makes the register able to tell you what is late."
          />
        ) : (
          <div className="tw">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Number</th><th>Title</th><th>Discipline</th>
                  <th>Current</th><th>Status</th><th>Required by</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} onClick={() => setOpen(d)} style={{ cursor: "pointer" }}>
                    <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{d.document_number}</td>
                    <td>{d.title}</td>
                    <td>{d.discipline ?? "—"}</td>
                    <td>{d.current_revision ?? "—"}</td>
                    <td><StatusChip status={d.status ?? "registered"} /></td>
                    {/* A required-by date in the past with nothing issued is the
                        row this whole screen exists to make visible. */}
                    <td style={{ color: isLate(d) ? "var(--red-ink)" : undefined }}>
                      {d.required_by ? fmtDate(d.required_by) : "—"}
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

const isLate = (d: Doc) =>
  !!d.required_by && !d.current_revision && Date.parse(d.required_by) < Date.now();

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

      <div className="csub" style={{ margin: "10px 0 6px" }}>
        {scheme.name}. Example: <b style={{ fontFamily: "var(--font-mono)" }}>{scheme.example}</b>
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

/* ── one document: revisions, issue, review ───────────────────────────────── */

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
        revision_id: rid, stage: "internal", min_approvals: 1,
        parties: ["Discipline lead"],
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
        <button className="mini" disabled={busy} onClick={addRevision} style={{ marginBottom: 12 }}>
          Raise a revision
        </button>
      )}

      {revisions.loading ? <Skeleton rows={2} /> : rows.length === 0 ? (
        <div className="csub">No revisions yet.</div>
      ) : rows.map((r: any) => {
        const cycles = cyclesFor(r.id);
        const openCycle = cycles.find((c: any) => c.status === "open");
        /* The column is `state`, not `status` — draft | current | superseded.
           Reading the wrong field left every revision showing "Draft" after it
           had been issued, and left Issue offered on a revision that was
           already the current one. */
        const state: string = r.state ?? "draft";
        const issued = state === "current" || state === "superseded";
        return (
          <div key={r.id} className="card" style={{ padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <b style={{ fontFamily: "var(--font-mono)" }}>{r.revision_code ?? r.revisionCode}</b>
                {r.suitability ? <span className="csub"> · {r.suitability}</span> : null}
                <div className="csub">{r.description ?? ""}</div>
                {r.issued_at ? <div className="csub">Issued {r.issued_at}</div> : null}
              </div>
              <StatusChip status={state} />
            </div>

            {cycles.length > 0 && (
              <div className="csub" style={{ marginTop: 6 }}>
                {cycles.map((c: any) => (
                  <div key={c.id}>
                    {c.description}
                    {c.status === "open" && canEdit && (
                      <span style={{ marginInlineStart: 8, display: "inline-flex", gap: 6 }}>
                        <button className="mini sm" disabled={busy} onClick={() => decide(c.id, "approved")}>Approve</button>
                        <button className="mini sm" disabled={busy} onClick={() => decide(c.id, "revise_and_resubmit")}>Revise</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {canEdit && !openCycle && !issued && (
                <button className="mini sm" disabled={busy} onClick={() => openReview(r.id)}>Send for review</button>
              )}
              {canIssue && !issued && (
                <button className="mini sm" disabled={busy} onClick={() => issue(r.id)}>Issue</button>
              )}
              {/* Issuing used to leave the reader at "Nothing transmitted yet —
                  issue a revision, then send it", with nothing anywhere that
                  sends one. An instruction with no button is worse than no
                  instruction. */}
              {canEdit && state === "current" && (
                <button className="mini sm" disabled={busy} onClick={() => setSending(r)}>Send to…</button>
              )}
            </div>
          </div>
        );
      })}

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
 * Issues and sends in one action, because that is one act to the person doing
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
        purpose,
        subject,
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
        <EmptyState title="Nothing transmitted yet" sub="Issue a revision, then send it." />
      ) : (
        <div className="tw">
          <table className="tbl">
            <thead>
              <tr><th>Number</th><th>Purpose</th><th>Subject</th><th>Status</th><th>Items</th><th>To</th><th>Sent</th></tr>
            </thead>
            <tbody>
              {rows.map((t: any) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{t.transmittal_number ?? "—"}</td>
                  <td>{t.purpose}</td>
                  <td>{t.subject ?? "—"}</td>
                  <td><StatusChip status={t.status ?? "draft"} /></td>
                  <td>{t.item_count ?? "—"}</td>
                  <td>{t.recipient_count ?? "—"}</td>
                  <td>{t.sent_at ? fmtDate(t.sent_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

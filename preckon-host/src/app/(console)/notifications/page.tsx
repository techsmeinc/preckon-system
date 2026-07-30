"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  useApi,
  useDebounced,
  unwrap,
  errMessage,
  useToast,
  useCan,
  StatusChip,
  Drawer,
  Field,
  Segmented,
  Switch,
  Skeleton,
  ErrorBox,
  EmptyState,
} from "../_ui";

interface Sent {
  id: string;
  title: string;
  body?: string;
  audience_type?: string;
  status?: string;
  sent_at?: string | null;
  deliver_in_app?: number;
  deliver_email?: number;
  recipient_count?: number;
  read_count?: number;
}
interface Inbox {
  id: string;
  kind?: string;
  severity?: string;
  title: string;
  body?: string;
  link?: string;
  created_at?: string;
  is_read?: number | boolean;
  read_at?: string | null;
}

const AUDIENCE_LABEL: Record<string, string> = {
  all_tenants: "All tenants",
  by_edition: "By edition",
  by_status: "By status",
  specific: "Specific tenants",
};

// ISO string → readable local timestamp.
function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function channelLabel(s: Sent): string {
  const c: string[] = [];
  if (s.deliver_in_app) c.push("In-app");
  if (s.deliver_email) c.push("Email");
  return c.join(" + ") || "—";
}

export default function NotificationsPage() {
  const toast = useToast();
  const canSend = useCan("notification.send");
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [compose, setCompose] = useState(false);

  const sent = useApi<any>(tab === "sent" ? "/notifications?limit=50" : null);
  const inbox = useApi<any>(tab === "inbox" ? "/host-notifications" : null);

  const sentRows: Sent[] = unwrap(sent.data) ?? [];
  const [inboxRows, setInboxRows] = useState<Inbox[]>([]);
  useEffect(() => {
    if (inbox.data) setInboxRows(unwrap(inbox.data) ?? []);
  }, [inbox.data]);

  function unread(n: Inbox) {
    return !n.is_read;
  }
  async function markRead(id: string) {
    setInboxRows((xs) => xs.map((n) => (n.id === id ? { ...n, is_read: 1, read_at: "now" } : n)));
    try {
      await api.post(`/host-notifications/${id}/read`);
    } catch {
      /* degrade */
    }
  }
  async function markAll() {
    setInboxRows((xs) => xs.map((n) => ({ ...n, is_read: 1, read_at: "now" })));
    try {
      await api.post("/host-notifications/read-all");
    } catch {
      /* degrade */
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Notifications</h2>
          <p>Your inbox, and announcements sent to tenants.</p>
        </div>
        {canSend && (
          <button className="mini pri" onClick={() => setCompose(true)}>
            + New notification
          </button>
        )}
      </div>

      <div className="fbar">
        <div className="range">
          <button className={tab === "inbox" ? "on" : ""} onClick={() => setTab("inbox")}>
            Inbox
          </button>
          <button className={tab === "sent" ? "on" : ""} onClick={() => setTab("sent")}>
            Sent
          </button>
        </div>
        {tab === "inbox" && inboxRows.length > 0 && (
          <button className="mini" style={{ marginLeft: "auto" }} onClick={markAll}>
            Mark all read
          </button>
        )}
      </div>

      <div className="card" style={{ padding: "14px 18px" }}>
        {tab === "inbox" ? (
          inbox.loading ? (
            <Skeleton rows={5} />
          ) : inbox.error ? (
            <ErrorBox message={inbox.error} onRetry={inbox.reload} />
          ) : inboxRows.length === 0 ? (
            <EmptyState title="Inbox zero" sub="No notifications for you right now." />
          ) : (
            <ul className="feed" style={{ padding: "2px 4px 0" }}>
              {inboxRows.map((n) => (
                <li key={n.id} onClick={() => markRead(n.id)} style={{ cursor: "pointer" }}>
                  <div className="dot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="tx">
                      <b>{n.title}</b>
                      {n.severity && <StatusChip status={n.severity} label={n.severity} />}
                      {unread(n) && <span className="undot" />}
                    </div>
                    {n.body && <div className="tx" style={{ color: "var(--slate-500)" }}>{n.body}</div>}
                    <div className="tm">{fmtTime(n.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : sent.loading ? (
          <Skeleton rows={5} />
        ) : sent.error ? (
          <ErrorBox message={sent.error} onRetry={sent.reload} />
        ) : sentRows.length === 0 ? (
          <EmptyState title="Nothing sent yet" sub="Compose a broadcast to your tenants." />
        ) : (
          <table style={{ marginTop: 2 }}>
            <thead>
              <tr>
                <th>Notification</th>
                <th>Audience</th>
                <th>Channel</th>
                <th>Status</th>
                <th className="r">Sent</th>
                <th className="r">Read / Recipients</th>
              </tr>
            </thead>
            <tbody>
              {sentRows.map((s) => (
                <tr key={s.id}>
                  <td className="t-name">{s.title}</td>
                  <td className="num">{AUDIENCE_LABEL[s.audience_type ?? ""] ?? s.audience_type ?? "—"}</td>
                  <td style={{ color: "var(--slate-500)", fontSize: 12.5 }}>{channelLabel(s)}</td>
                  <td>
                    <StatusChip status={s.status ?? "sent"} />
                  </td>
                  <td className="r" style={{ color: "var(--slate-500)", fontSize: 12 }}>{fmtTime(s.sent_at)}</td>
                  <td className="num r">
                    {(s.read_count ?? 0)} / {s.recipient_count ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {compose && (
        <ComposeDrawer
          onClose={() => setCompose(false)}
          onSent={() => {
            setCompose(false);
            setTab("sent");
            sent.reload();
          }}
        />
      )}
    </>
  );
}

/* ── Compose broadcast drawer ──────────────────────────────────────────────*/

function ComposeDrawer({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const editions = useApi<any>("/editions");
  const editionRows: any[] = unwrap(editions.data) ?? [];

  const [audience, setAudience] = useState("all_tenants");
  const [editionId, setEditionId] = useState("");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [tenantIds, setTenantIds] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);
  const [preview, setPreview] = useState<{ count: number; sample: { name: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Build the audience_filter object the API expects for each audience type.
  function buildFilter(): Record<string, unknown> {
    if (audience === "by_edition") return editionId ? { edition_id: editionId } : {};
    if (audience === "by_status") return { status: tenantStatus };
    if (audience === "specific")
      return { tenant_ids: tenantIds.split(",").map((s) => s.trim()).filter(Boolean) };
    return {};
  }
  const filterObj = buildFilter();
  const filterJson = JSON.stringify(filterObj);
  // Debounced so typing specific tenant IDs doesn't fire a preview per keystroke.
  const debFilterJson = useDebounced(filterJson, 400);

  // Live audience preview whenever audience type / filter changes.
  useEffect(() => {
    let alive = true;
    const qp = `audience_type=${encodeURIComponent(audience)}&filter=${encodeURIComponent(debFilterJson)}`;
    api
      .get<any>(`/notifications/audience-preview?${qp}`)
      .then((r) => {
        if (!alive) return;
        setPreview({ count: r.matched_count ?? 0, sample: Array.isArray(r.sample) ? r.sample : [] });
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [audience, debFilterJson]);

  async function send() {
    setErr(null);
    if (!title || !message) {
      setErr("Title and message are required.");
      return;
    }
    if (!inApp && !email) {
      setErr("Pick at least one delivery channel.");
      return;
    }
    // Broadcasts are irreversible and can reach every tenant — confirm first.
    const who =
      preview?.count != null
        ? `${preview.count} tenant${preview.count === 1 ? "" : "s"}`
        : "the selected tenants";
    if (!window.confirm(`Send "${title}" to ${who}? This can't be unsent.`)) return;
    setBusy(true);
    try {
      await api.post("/notifications", {
        title,
        body: message,
        audience_type: audience,
        audience_filter: filterObj,
        deliver_in_app: inApp ? 1 : 0,
        deliver_email: email ? 1 : 0,
        status: "sent",
      });
      toast(preview ? `Notification sent to ${preview.count} tenants` : "Notification sent");
      onSent();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title="New notification"
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send notification"}
          </button>
        </>
      }
    >
      <Field label="Audience">
        <Segmented
          options={[
            { value: "all_tenants", label: "All tenants" },
            { value: "by_edition", label: "By edition" },
            { value: "by_status", label: "By status" },
            { value: "specific", label: "Specific" },
          ]}
          value={audience}
          onChange={setAudience}
        />
      </Field>
      {audience === "by_edition" && (
        <Field label="Edition">
          <select value={editionId} onChange={(e) => setEditionId(e.target.value)}>
            <option value="">Select an edition…</option>
            {editionRows.map((ed) => (
              <option key={ed.id} value={ed.id}>
                {ed.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {audience === "by_status" && (
        <Field label="Tenant status">
          <select value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="suspended">Suspended</option>
            <option value="past_due">Past due</option>
          </select>
        </Field>
      )}
      {audience === "specific" && (
        <Field label="Tenant IDs (comma-separated)">
          <input type="text" className="mono" value={tenantIds} onChange={(e) => setTenantIds(e.target.value)} />
        </Field>
      )}
      <Field label="Title">
        <input type="text" placeholder="e.g. Scheduled maintenance" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Message">
        <textarea placeholder="Write the announcement…" style={{ minHeight: 120 }} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <Field label="Deliver via">
        <div className="checklist">
          <div className="cl">
            In-app
            <Switch on={inApp} onToggle={() => setInApp((v) => !v)} />
          </div>
          <div className="cl">
            Email
            <Switch on={email} onToggle={() => setEmail((v) => !v)} />
          </div>
        </div>
      </Field>
      <div style={{ fontSize: 11.5, color: "var(--slate-500)", display: "flex", gap: 7, alignItems: "center" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--teal-press)" }}>
          <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
        </svg>
        {preview ? `Sends to ${preview.count} tenant${preview.count === 1 ? "" : "s"}.` : "Resolving audience…"}
      </div>
      {preview && preview.sample.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--slate-400)", marginTop: 4 }}>
          e.g. {preview.sample.slice(0, 4).map((t) => t.name).join(", ")}
          {preview.count > 4 ? "…" : ""}
        </div>
      )}
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  useApi,
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

interface HostUser {
  id: string;
  email: string;
  display_name: string;
  role_name?: string;
  role_key?: string;
  status: string;
  two_factor_enabled?: number;
  last_login_at?: string | null;
}
interface Role {
  id: string;
  key: string;
  name: string;
  description?: string;
  is_system?: boolean;
  user_count?: number;
  permission_keys?: string[];
}
interface Perm {
  key: string;
  name: string;
  category: string;
}

// Flatten the /permissions catalog { groups:[{ category, permissions:[{key,description}] }] }.
function normalizePerms(raw: any): Perm[] {
  if (!raw || !Array.isArray(raw.groups)) return [];
  return raw.groups.flatMap((g: any) =>
    (g.permissions ?? []).map((p: any) => ({
      key: p.key,
      name: p.description ?? p.key,
      category: g.category ?? p.category ?? "General",
    }))
  );
}

function initials(n: string) {
  return (n || "").split(" ").map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

// ISO string → local short date; null/undefined → "Never".
function fmtDate(iso?: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export default function HostUsersPage() {
  const canManageUsers = useCan("host_user.manage");
  const canManageRoles = useCan("role.manage");

  const users = useApi<any>("/host-users?limit=100");
  const roles = useApi<any>("/roles");
  const permissions = useApi<any>("/permissions");

  const [showInvite, setShowInvite] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);

  const userRows: HostUser[] = unwrap(users.data) ?? [];
  const roleRows: Role[] = unwrap(roles.data) ?? [];
  const perms: Perm[] = useMemo(() => normalizePerms(permissions.data), [permissions.data]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Host users &amp; roles</h2>
          <p>Your internal staff and what each role can do.</p>
        </div>
        {canManageUsers && (
          <button className="mini pri" onClick={() => setShowInvite(true)}>
            + Invite user
          </button>
        )}
      </div>

      <div className="card" style={{ padding: "14px 18px", marginBottom: 16 }}>
        {users.loading ? (
          <Skeleton rows={6} />
        ) : users.error ? (
          <ErrorBox message={users.error} onRetry={users.reload} />
        ) : userRows.length === 0 ? (
          <EmptyState title="No host users yet" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>2FA</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>
                        {initials(u.display_name)}
                      </div>
                      <div>
                        <div className="t-name">{u.display_name}</div>
                        <div className="t-sub">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="role-chip">{u.role_name ?? u.role_key ?? "—"}</span>
                  </td>
                  <td>
                    <StatusChip status={u.status} />
                  </td>
                  <td>
                    <span className={"twofa " + (!!u.two_factor_enabled ? "on" : "off")}>
                      {!!u.two_factor_enabled ? "On" : "Off"}
                    </span>
                  </td>
                  <td style={{ color: "var(--slate-500)", fontSize: 12 }}>{fmtDate(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="chead">
          <div>
            <h3>Roles &amp; permissions</h3>
            <div className="csub">What each role can do</div>
          </div>
          {canManageRoles && (
            <button className="mini" onClick={() => setShowRole(true)}>
              + New role
            </button>
          )}
        </div>
        {roles.loading || permissions.loading ? (
          <Skeleton rows={6} />
        ) : roles.error ? (
          <ErrorBox message={roles.error} onRetry={roles.reload} />
        ) : perms.length === 0 ? (
          <EmptyState title="No permission catalog" sub="The /permissions endpoint returned nothing." />
        ) : (
          <table className="matrix" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Permission</th>
                {roleRows.map((r) => (
                  <th
                    className="c"
                    key={r.id}
                    style={canManageRoles ? { cursor: "pointer" } : undefined}
                    title={canManageRoles ? "Edit role" : undefined}
                    onClick={canManageRoles ? () => setEditRole(r) : undefined}
                  >
                    {r.name}
                    {!!r.is_system && " ·"}
                    <span className="fkey" style={{ display: "block", fontWeight: 400 }}>
                      {r.user_count ?? 0} users
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p.key}>
                  <td>{p.name}</td>
                  {roleRows.map((r) => (
                    <td className="c" key={r.id}>
                      {(r.permission_keys ?? []).includes(p.key) ? (
                        <span className="mk-y">✓</span>
                      ) : (
                        <span className="mk-n">✕</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && (
        <InviteDrawer
          roles={roleRows}
          onClose={() => setShowInvite(false)}
          onSaved={() => {
            setShowInvite(false);
            users.reload();
          }}
        />
      )}
      {showRole && (
        <RoleDrawer
          perms={perms}
          onClose={() => setShowRole(false)}
          onSaved={() => {
            setShowRole(false);
            roles.reload();
          }}
        />
      )}
      {editRole && (
        <RoleDrawer
          perms={perms}
          role={editRole}
          onClose={() => setEditRole(null)}
          onSaved={() => {
            setEditRole(null);
            roles.reload();
          }}
        />
      )}
    </>
  );
}

/* ── Invite user drawer ────────────────────────────────────────────────────*/

function InviteDrawer({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setErr(null);
    if (!email || !name || !roleId) {
      setErr("Email, name and role are required.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/host-users", { email, display_name: name, role_id: roleId });
      toast("Invitation sent");
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title="Invite host user"
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </>
      }
    >
      <Field label="Email">
        <input type="text" placeholder="name@preckon.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Name">
        <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Role">
        {roles.length === 0 ? (
          <div className="csub">No roles available.</div>
        ) : (
          <Segmented options={roles.map((r) => ({ value: r.id, label: r.name }))} value={roleId} onChange={setRoleId} />
        )}
      </Field>
      <div style={{ fontSize: 11.5, color: "var(--slate-500)", display: "flex", gap: 7, alignItems: "center", marginTop: 2 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--teal-press)" }}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l3 2" />
        </svg>
        The invite expires in 7 days.
      </div>
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

/* ── Role builder drawer ───────────────────────────────────────────────────*/

const PRESETS: Record<string, (key: string) => boolean> = {
  blank: () => false,
  owner: () => true,
  support: (k) =>
    ["tenant.read", "tenant.impersonate", "notification.read", "notification.send", "audit.read", "observability.read"].includes(k),
  read_only: (k) => k.endsWith(".read"),
};

function RoleDrawer({
  perms,
  role,
  onClose,
  onSaved,
}: {
  perms: Perm[];
  role?: Role;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!role;
  // System roles (Owner, etc.) have a fixed permission set — the server rejects
  // permission changes, so present them read-only rather than offer a dead action.
  const systemLocked = !!role?.is_system;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [preset, setPreset] = useState(isEdit ? "current" : "blank");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permission_keys ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyPreset(p: string) {
    setPreset(p);
    if (p === "current") {
      setSelected(new Set(role?.permission_keys ?? []));
      return;
    }
    const fn = PRESETS[p] ?? PRESETS.blank;
    setSelected(new Set(perms.filter((x) => fn(x.key)).map((x) => x.key)));
  }
  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function save() {
    setErr(null);
    if (!name) {
      setErr("Role name is required.");
      return;
    }
    setBusy(true);
    try {
      const body: {
        name: string;
        description?: string;
        permission_keys?: string[];
      } = { name, description: description || undefined };
      // Don't send permissions for a system role — they're immutable server-side.
      if (!systemLocked) body.permission_keys = Array.from(selected);
      if (isEdit) {
        await api.patch(`/roles/${role!.id}`, body);
        toast(`Role "${name}" updated`);
      } else {
        await api.post("/roles", body);
        toast(`Role "${name}" created`);
      }
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = perms.reduce<Record<string, Perm[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <Drawer
      open
      title={isEdit ? "Edit role" : "New role"}
      titleExtra={isEdit && !!role?.is_system ? <span className="chip draft">System</span> : undefined}
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create role"}
          </button>
        </>
      }
    >
      <Field label="Role name">
        <input type="text" placeholder="e.g. Support Lead" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea placeholder="What this role is for…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {!systemLocked && (
        <Field label="Start from">
          <Segmented
            options={[
              ...(isEdit ? [{ value: "current", label: "Current" }] : []),
              { value: "blank", label: "Blank" },
              { value: "owner", label: "Owner (all)" },
              { value: "support", label: "Support" },
              { value: "read_only", label: "Read-only" },
            ]}
            value={preset}
            onChange={applyPreset}
          />
        </Field>
      )}
      <label className="fl" style={{ marginBottom: 8 }}>
        Permissions{systemLocked && " (system role — read-only)"}
      </label>
      {perms.length === 0 ? (
        <div className="csub">No permission catalog loaded.</div>
      ) : (
        <div className="checklist" style={systemLocked ? { opacity: 0.6 } : undefined}>
          {Object.entries(grouped).map(([cat, ps]) => (
            <div key={cat}>
              <div className="cl-grp">{cat}</div>
              {ps.map((p) => (
                <div className="cl" key={p.key}>
                  {p.name}
                  <Switch
                    on={selected.has(p.key)}
                    onToggle={() => {
                      if (!systemLocked) toggle(p.key);
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

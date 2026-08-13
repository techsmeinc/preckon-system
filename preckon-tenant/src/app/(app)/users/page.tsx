"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, useCan, useToast, Skeleton, EmptyState, StatusChip, Drawer, Field, fmtDate } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { Icon } from "@/lib/icons";

const TIERS = ["owner_admin", "delivery", "review", "view"];
const TIER_LABEL: Record<string, string> = { owner_admin: "Owner / Admin", delivery: "Delivery", review: "Review", view: "View only" };

export default function UsersPage() {
  const canManage = useCan("admin.users");
  const toast = useToast();
  const users = useApi<any[]>("/users", [], { refreshMs: 8000 });
  const roles = useApi<any[]>("/roles");
  const perms = useApi<any[]>("/permissions");

  const roleList = roles.data ?? [];
  const permsByDomain = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of perms.data ?? []) { const a = m.get(p.domain) ?? []; a.push(p); m.set(p.domain, a); }
    return [...m.entries()];
  }, [perms.data]);

  // ── drawers
  const [addUser, setAddUser] = useState(false);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [roleDrawer, setRoleDrawer] = useState<null | { mode: "new" | "edit"; role?: any }>(null);
  const [invite, setInvite] = useState<{ email: string; password: string } | null>(null);

  return (
    <>
      <div className="page-head">
        <div><h2>Users &amp; roles</h2><p>Who&apos;s in this workspace and what they can do.</p></div>
        {canManage && <button className="mini pri" onClick={() => setAddUser(true)}><Icon.add /> Add user</button>}
      </div>

      {invite && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)", background: "var(--teal-tint)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 3 }}>User added — share these sign-in details</div>
              <div style={{ fontSize: 13 }}><span className="mono">{invite.email}</span> · temporary password <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{invite.password}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="mini sm" onClick={() => { navigator.clipboard?.writeText(`${invite.email} / ${invite.password}`); toast("Copied"); }}>Copy</button>
              <button className="mini sm" onClick={() => setInvite(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead"><h3>People</h3><span className="mono" style={{ fontSize: 11, color: "var(--slate-400)" }}>{(users.data ?? []).length}</span></div>
        {users.loading ? <Skeleton rows={3} /> : users.error ? <EmptyState title="Couldn’t load users" sub={users.error} /> : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th className="r">Joined</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="t-name">{u.name ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{u.email}</td>
                  <td>{u.roles ? u.roles.split(", ").map((r: string) => <span key={r} className="chip plain" style={{ marginRight: 4, color: "var(--slate-600)", background: "var(--panel-2)" }}>{r}</span>) : <span className="csub">no roles</span>}</td>
                  <td><StatusChip status={u.status} /></td>
                  <td className="r mono" style={{ fontSize: 11.5 }}>{fmtDate(u.created_at)}</td>
                  {canManage && (
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      <button className="mini sm" onClick={() => setEditUser(u)}>Roles</button>{" "}
                      <button className="mini sm" onClick={async () => {
                        const status = u.status === "suspended" ? "active" : "suspended";
                        try { await api.patch(`/users/${u.id}`, { status }); toast(status === "active" ? "User activated" : "User deactivated"); users.reload(); }
                        catch (e: any) { toast(e?.message ?? "Couldn’t update"); }
                      }}>{u.status === "suspended" ? "Activate" : "Deactivate"}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="chead"><h3>Roles</h3>{canManage && <button className="mini sm pri" onClick={() => setRoleDrawer({ mode: "new" })}><Icon.add /> New role</button>}</div>
        {roles.loading ? <Skeleton rows={3} /> : (
          <table>
            <thead><tr><th>Role</th><th>Key</th><th>Tier</th><th className="r">Permissions</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {roleList.map((r) => (
                <tr key={r.id}>
                  <td className="t-name">{r.name}{r.is_system ? <span className="chip plain" style={{ marginLeft: 6, color: "var(--teal-press)", background: "var(--teal-tint)" }}>system</span> : null}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.key}</td>
                  <td style={{ fontSize: 12.5 }}>{TIER_LABEL[r.tier] ?? r.tier}</td>
                  <td className="r num">{r.permissions}</td>
                  {canManage && (
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {r.is_system ? <span className="csub" style={{ fontSize: 11 }}>read-only</span> : (
                        <>
                          <button className="mini sm" onClick={() => setRoleDrawer({ mode: "edit", role: r })}>Edit</button>{" "}
                          <button className="mini sm" onClick={async () => {
                            if (!window.confirm(`Delete role “${r.name}”? Users lose it.`)) return;
                            try { await api.del(`/roles/${r.id}`); toast("Role deleted"); roles.reload(); users.reload(); }
                            catch (e: any) { toast(e?.message ?? "Couldn’t delete"); }
                          }}>Delete</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addUser && <AddUserDrawer roles={roleList} onClose={() => setAddUser(false)} onDone={(res: any) => { setAddUser(false); users.reload(); if (res?.password) setInvite({ email: res.email, password: res.password }); }} toast={toast} />}
      {editUser && <EditUserDrawer user={editUser} roles={roleList} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); users.reload(); }} toast={toast} />}
      {roleDrawer && <RoleDrawer drawer={roleDrawer} permsByDomain={permsByDomain} onClose={() => setRoleDrawer(null)} onDone={() => { setRoleDrawer(null); roles.reload(); }} toast={toast} />}
    </>
  );
}

function RoleCheck({ roles, selected, toggle }: { roles: any[]; selected: Set<string>; toggle: (k: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {roles.map((r) => (
        <label key={r.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} style={{ width: "auto" }} />
          {r.name} <span className="mono" style={{ fontSize: 10.5, color: "var(--slate-400)" }}>{r.key}</span>
        </label>
      ))}
    </div>
  );
}

function AddUserDrawer({ roles, onClose, onDone, toast }: any) {
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [pw, setPw] = useState(""); const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function submit() {
    if (!email.trim()) return; setBusy(true);
    try {
      const res = await api.post<any>("/users", { email, name: name || undefined, roleKeys: [...sel], password: pw || undefined });
      toast("User added");
      onDone(res);
    } catch (e: any) { toast(e?.message ?? "Couldn’t add user"); } finally { setBusy(false); }
  }
  return (
    <Drawer open title="Add user" onClose={onClose}
      footer={<><button className="mini" onClick={onClose}>Cancel</button><button className="mini pri" disabled={busy || !email.trim()} onClick={submit}>{busy ? "Adding…" : "Add user"}</button></>}>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></Field>
      <Field label="Temp password (optional)"><input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="auto-generated if blank" /></Field>
      <Field label="Roles"><RoleCheck roles={roles} selected={sel} toggle={toggle} /></Field>
    </Drawer>
  );
}

function EditUserDrawer({ user, roles, onClose, onDone, toast }: any) {
  const initial = new Set<string>((user.role_keys ? String(user.role_keys).split(",") : []).filter(Boolean));
  const [sel, setSel] = useState<Set<string>>(initial);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function submit() {
    setBusy(true);
    try { await api.patch(`/users/${user.id}`, { roleKeys: [...sel] }); toast("Roles updated"); onDone(); }
    catch (e: any) { toast(e?.message ?? "Couldn’t update"); } finally { setBusy(false); }
  }
  return (
    <Drawer open title={`Roles — ${user.name ?? user.email}`} onClose={onClose}
      footer={<><button className="mini" onClick={onClose}>Cancel</button><button className="mini pri" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save roles"}</button></>}>
      <RoleCheck roles={roles} selected={sel} toggle={toggle} />
    </Drawer>
  );
}

function RoleDrawer({ drawer, permsByDomain, onClose, onDone, toast }: any) {
  const editing = drawer.mode === "edit";
  const [name, setName] = useState(editing ? drawer.role.name : "");
  const [tier, setTier] = useState(editing ? drawer.role.tier : "delivery");
  const [sel, setSel] = useState<Set<string>>(new Set(editing && drawer.role.permission_keys ? String(drawer.role.permission_keys).split(",").filter(Boolean) : []));
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function submit() {
    if (!name.trim()) return; setBusy(true);
    try {
      if (editing) await api.patch(`/roles/${drawer.role.id}`, { name, permissions: [...sel] });
      else await api.post("/roles", { name, tier, permissions: [...sel] });
      toast(editing ? "Role updated" : "Role created"); onDone();
    } catch (e: any) { toast(e?.message ?? "Couldn’t save role"); } finally { setBusy(false); }
  }
  return (
    <Drawer open title={editing ? `Edit role — ${drawer.role.name}` : "New role"} onClose={onClose}
      footer={<><button className="mini" onClick={onClose}>Cancel</button><button className="mini pri" disabled={busy || !name.trim()} onClick={submit}>{busy ? "Saving…" : editing ? "Save role" : "Create role"}</button></>}>
      <Field label="Role name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reviewer" /></Field>
      {!editing && (
        <Field label="Tier">
          <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--panel)", color: "var(--ink)" }}>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t] ?? t}</option>)}
          </select>
        </Field>
      )}
      <Field label={`Permissions (${sel.size})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto" }}>
          {permsByDomain.map(([domain, list]: any) => (
            <div key={domain}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate-400)", marginBottom: 5 }}>{domain}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {list.map((p: any) => (
                  <label key={p.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
                    <input type="checkbox" checked={sel.has(p.key)} onChange={() => toggle(p.key)} style={{ width: "auto", marginTop: 2 }} />
                    <span><span className="mono" style={{ fontSize: 11.5, color: "var(--ink)" }}>{p.key}</span> <span className="csub">— {p.description}</span></span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Field>
    </Drawer>
  );
}

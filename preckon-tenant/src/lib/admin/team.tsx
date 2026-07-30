"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, useCan, useToast, Skeleton, EmptyState, StatusChip, Drawer, Field, fmtDate } from "@/lib/ui";
import { api } from "@/lib/apiclient";
import { Icon } from "@/lib/icons";
import { useI18n, type Key } from "@/lib/i18n";

const TIERS = ["owner_admin", "delivery", "review", "view"];
const tierLabel = (t: (k: Key) => string, tier: string) => t(("tier." + tier) as Key);

/** Team & roles — the customer's own RBAC surface, used by Admin → Team. */
export default function TeamAdmin() {
  const canManage = useCan("admin.users");
  const toast = useToast();
  const { t } = useI18n();
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

      {invite && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)", background: "var(--teal-tint)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 3 }}>{t("team.inviteHeading")}</div>
              <div style={{ fontSize: 13 }}><span className="mono">{invite.email}</span> · {t("team.tempPassword")} <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{invite.password}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="mini sm" onClick={() => { navigator.clipboard?.writeText(`${invite.email} / ${invite.password}`); toast(t("team.copied")); }}>{t("team.copy")}</button>
              <button className="mini sm" onClick={() => setInvite(null)}>{t("team.dismiss")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead">
          <div><h3>{t("admin.people")}</h3><div className="csub">{t("admin.peopleSub", { n: (users.data ?? []).length })}</div></div>
          {canManage && <button className="mini sm pri" onClick={() => setAddUser(true)}><Icon.add /> {t("admin.invite")}</button>}
        </div>
        {users.loading ? <Skeleton rows={3} /> : users.error ? <EmptyState title={t("team.loadFail")} sub={users.error} /> : (
          <table>
            <thead><tr><th>{t("team.colMember")}</th><th>{t("settings.email")}</th><th>{t("team.colRole")}</th><th>{t("common.status")}</th><th className="r">{t("team.colLastActive")}</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="t-name">{u.name ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{u.email}</td>
                  <td>{u.roles ? u.roles.split(", ").map((r: string) => <span key={r} className="chip plain" style={{ marginRight: 4, color: "var(--slate-600)", background: "var(--panel-2)" }}>{r}</span>) : <span className="csub">{t("team.noRoles")}</span>}</td>
                  <td><StatusChip status={u.status} /></td>
                  <td className="r mono" style={{ fontSize: 11.5 }}>{fmtDate(u.created_at)}</td>
                  {canManage && (
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      <button className="mini sm" onClick={() => setEditUser(u)}>{t("team.rolesBtn")}</button>{" "}
                      <button className="mini sm" onClick={async () => {
                        const status = u.status === "suspended" ? "active" : "suspended";
                        try { await api.patch(`/users/${u.id}`, { status }); toast(status === "active" ? t("team.activated") : t("team.deactivated")); users.reload(); }
                        catch (e: any) { toast(e?.message ?? t("team.updateFail")); }
                      }}>{u.status === "suspended" ? t("team.activate") : t("team.deactivate")}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="chead"><h3>{t("team.roles")}</h3>{canManage && <button className="mini sm pri" onClick={() => setRoleDrawer({ mode: "new" })}><Icon.add /> {t("team.newRole")}</button>}</div>
        {roles.loading ? <Skeleton rows={3} /> : (
          <table>
            <thead><tr><th>{t("team.colRoleName")}</th><th>{t("team.colKey")}</th><th>{t("team.colTier")}</th><th className="r">{t("team.colPerms")}</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {roleList.map((r) => (
                <tr key={r.id}>
                  <td className="t-name">{r.name}{r.is_system ? <span className="chip plain" style={{ marginLeft: 6, color: "var(--teal-press)", background: "var(--teal-tint)" }}>{t("team.systemChip")}</span> : null}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.key}</td>
                  <td style={{ fontSize: 12.5 }}>{tierLabel(t, r.tier)}</td>
                  <td className="r num">{r.permissions}</td>
                  {canManage && (
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {r.is_system ? <span className="csub" style={{ fontSize: 11 }}>{t("team.readOnly")}</span> : (
                        <>
                          <button className="mini sm" onClick={() => setRoleDrawer({ mode: "edit", role: r })}>{t("common.edit")}</button>{" "}
                          <button className="mini sm" onClick={async () => {
                            if (!window.confirm(t("team.deleteRoleConfirm", { name: r.name }))) return;
                            try { await api.del(`/roles/${r.id}`); toast(t("team.roleDeleted")); roles.reload(); users.reload(); }
                            catch (e: any) { toast(e?.message ?? t("team.roleDeleteFail")); }
                          }}>{t("common.remove")}</button>
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

      {addUser && <AddUserDrawer roles={roleList} onClose={() => setAddUser(false)} onDone={(res: any) => { setAddUser(false); users.reload(); if (res?.password) setInvite({ email: res.email, password: res.password }); }} toast={toast} t={t} />}
      {editUser && <EditUserDrawer user={editUser} roles={roleList} onClose={() => setEditUser(null)} onDone={() => { setEditUser(null); users.reload(); }} toast={toast} t={t} />}
      {roleDrawer && <RoleDrawer drawer={roleDrawer} permsByDomain={permsByDomain} onClose={() => setRoleDrawer(null)} onDone={() => { setRoleDrawer(null); roles.reload(); }} toast={toast} t={t} />}
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

function AddUserDrawer({ roles, onClose, onDone, toast, t }: any) {
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [pw, setPw] = useState(""); const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function submit() {
    if (!email.trim()) return; setBusy(true);
    try {
      const res = await api.post<any>("/users", { email, name: name || undefined, roleKeys: [...sel], password: pw || undefined });
      toast(t("team.added"));
      onDone(res);
    } catch (e: any) { toast(e?.message ?? t("team.addFail")); } finally { setBusy(false); }
  }
  return (
    <Drawer open title={t("team.addMember")} onClose={onClose}
      footer={<><button className="mini" onClick={onClose}>{t("common.cancel")}</button><button className="mini pri" disabled={busy || !email.trim()} onClick={submit}>{busy ? t("team.adding") : t("team.addMember")}</button></>}>
      <Field label={t("team.fieldEmail")}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" /></Field>
      <Field label={t("team.fieldName")}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("team.fieldTempPw")}><input value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("team.tempPwHint")} /></Field>
      <Field label={t("team.roles")}><RoleCheck roles={roles} selected={sel} toggle={toggle} /></Field>
    </Drawer>
  );
}

function EditUserDrawer({ user, roles, onClose, onDone, toast, t }: any) {
  const initial = new Set<string>((user.role_keys ? String(user.role_keys).split(",") : []).filter(Boolean));
  const [sel, setSel] = useState<Set<string>>(initial);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  async function submit() {
    setBusy(true);
    try { await api.patch(`/users/${user.id}`, { roleKeys: [...sel] }); toast(t("team.rolesUpdated")); onDone(); }
    catch (e: any) { toast(e?.message ?? t("team.updateFail")); } finally { setBusy(false); }
  }
  return (
    <Drawer open title={t("team.rolesFor", { name: user.name ?? user.email })} onClose={onClose}
      footer={<><button className="mini" onClick={onClose}>{t("common.cancel")}</button><button className="mini pri" disabled={busy} onClick={submit}>{busy ? t("common.saving") : t("team.saveRoles")}</button></>}>
      <RoleCheck roles={roles} selected={sel} toggle={toggle} />
    </Drawer>
  );
}

function RoleDrawer({ drawer, permsByDomain, onClose, onDone, toast, t }: any) {
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
      toast(editing ? t("team.roleUpdated") : t("team.roleCreated")); onDone();
    } catch (e: any) { toast(e?.message ?? t("team.roleSaveFail")); } finally { setBusy(false); }
  }
  return (
    <Drawer open title={editing ? t("team.editRole", { name: drawer.role.name }) : t("team.newRole")} onClose={onClose}
      footer={<><button className="mini" onClick={onClose}>{t("common.cancel")}</button><button className="mini pri" disabled={busy || !name.trim()} onClick={submit}>{busy ? t("common.saving") : editing ? t("team.saveRole") : t("team.createRole")}</button></>}>
      <Field label={t("team.roleName")}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {!editing && (
        <Field label={t("team.tier")}>
          <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--panel)", color: "var(--ink)" }}>
            {TIERS.map((tr) => <option key={tr} value={tr}>{tierLabel(t, tr)}</option>)}
          </select>
        </Field>
      )}
      <Field label={t("team.permissionsCount", { n: sel.size })}>
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

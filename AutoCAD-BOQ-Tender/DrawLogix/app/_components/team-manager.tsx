"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { type Role, ROLE_LABELS, ROLES, roleLabel } from "@/auth/roles";
import { archiveUserAction, createUserAction } from "@/server/auth-actions";
import { Button, Card, Input } from "@/ui";
import { UserMenu } from "./user-menu";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function TeamManager({ me, users }: { me: { id: string; name: string; role: string }; users: TeamUser[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("architectural");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createUserAction({ name, email, password, role });
      setName("");
      setEmail("");
      setPassword("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/30 text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/projects" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Projects
            </Link>
            <span className="h-5 w-px bg-border" />
            <h1 className="text-sm font-semibold">Team</h1>
          </div>
          <UserMenu name={me.name} role={me.role} />
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Team members</h2>
          <p className="text-sm text-muted-foreground">Create accounts for your coordinator and each division specialist. They sign in with their email and password.</p>
        </div>

        {/* Create */}
        <Card className="rounded-xl border-border/80">
          <form onSubmit={create} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</label>
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 chars" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role / Division</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary">
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={busy || !name || !email || password.length < 6}>{busy ? "Adding…" : "Add member"}</Button>
            {error && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-5">{error}</p>}
          </form>
        </Card>

        {/* List */}
        <Card className="rounded-xl border-border/80">
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{u.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name}{u.id === me.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{roleLabel(u.role)}</span>
                {u.id !== me.id && (
                  <button type="button" onClick={async () => { await archiveUserAction(u.id); router.refresh(); }} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { DIVISION_ROLES, isManager } from "@/auth/roles";
import { assignProjectAction } from "@/server/auth-actions";
import { createProjectAction } from "@/server/actions";
import { Button, Card, Input } from "@/ui";
import { UserMenu } from "./user-menu";

export interface ProjectRow {
  id: string;
  name: string;
  client: string | null;
  status: string;
  divisions: string[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-success/10 text-success" },
  generating: { label: "Generating", cls: "bg-warning/15 text-warning" },
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
};
const cap = (d: string) => (d === "architectural" ? "Architecture" : d.charAt(0).toUpperCase() + d.slice(1));

export function ProjectsHome({ user, projects }: { user: { name: string; role: string }; projects: ProjectRow[] }) {
  const router = useRouter();
  const manager = isManager(user.role);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<ProjectRow | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setPending(true);
    try {
      const { id } = await createProjectAction({ name, client });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/30 text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-500 text-xs font-bold text-white">DL</span>
            <div>
              <p className="text-sm font-semibold leading-tight">DrawLogix</p>
              <p className="text-xs text-muted-foreground">Projects</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/studio" className="hidden items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:inline-flex">BIM Studio</Link>
            {manager && (
              <Link href="/team" className="hidden items-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted sm:inline-flex">Team</Link>
            )}
            <UserMenu name={user.name} role={user.role} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight">{manager ? "Projects" : "My Projects"}</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              {manager
                ? "Create projects, assign each to the divisions that will work on it, then hand them off to your team."
                : "Projects your Project Coordinator has assigned to your division."}
            </p>
          </div>
          {manager && (
            <Button className="gap-2" onClick={() => setOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New project
            </Button>
          )}
        </div>

        {manager && open && (
          <Card className="mt-5 rounded-xl border-border/80">
            <form onSubmit={create} className="flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-[200px] flex-1 space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project name</label>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Al-Salam Warehouse Yard" />
              </div>
              <div className="min-w-[180px] flex-1 space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client (optional)</label>
                <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Ministry of Works" />
              </div>
              <Button type="submit" disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create"}</Button>
              {error && <p className="w-full text-sm text-destructive">{error}</p>}
            </form>
          </Card>
        )}

        {projects.length === 0 ? (
          <Card className="mt-6 rounded-xl border-dashed">
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6" aria-hidden>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" strokeLinecap="round" />
                </svg>
              </span>
              <p className="font-medium">{manager ? "No projects yet" : "Nothing assigned to you yet"}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {manager ? "Create a project, then assign it to the divisions that will work on it." : "When the Coordinator assigns a project to your division, it will appear here."}
              </p>
              {manager && !open && <Button className="mt-2" onClick={() => setOpen(true)}>New project</Button>}
            </div>
          </Card>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const s = STATUS[p.status] ?? STATUS.draft;
              return (
                <li key={p.id}>
                  <Card className="flex h-full flex-col rounded-xl border-border/80 transition-all hover:border-primary/60 hover:shadow-md">
                    <Link href={`/projects/${p.id}`} className="group block">
                      <div className="flex items-start justify-between gap-2 p-4 pb-2">
                        <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden>
                            <rect x="4" y="3" width="16" height="18" rx="2" />
                            <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
                      </div>
                      <div className="px-4 pb-2">
                        <p className="font-semibold leading-snug transition-colors group-hover:text-primary">{p.name}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{p.client ?? "—"}</p>
                      </div>
                    </Link>
                    <div className="flex flex-1 flex-wrap items-center gap-1 px-4 pb-3">
                      {p.divisions.length ? (
                        p.divisions.map((d) => (
                          <span key={d} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{cap(d)}</span>
                        ))
                      ) : (
                        <span className="text-[11px] italic text-muted-foreground">{manager ? "Not assigned" : ""}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 border-t border-border/70 px-4 py-2 text-xs font-medium">
                      <Link href={`/projects/${p.id}`} className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary">
                        Open workspace
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </Link>
                      {manager && (
                        <button type="button" onClick={() => setAssignFor(p)} className="ml-auto rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted">Assign</button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {assignFor && <AssignDialog project={assignFor} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); router.refresh(); }} />}
    </div>
  );
}

// ── Assign-to-divisions dialog (Coordinator/Admin) ───────────────────────────
function AssignDialog({ project, onClose, onSaved }: { project: ProjectRow; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(project.divisions));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (d: string) => setSel((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Assign divisions</p>
          <p className="truncate text-xs text-muted-foreground">{project.name}</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 p-4">
          {DIVISION_ROLES.map((d) => (
            <label key={d} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors ${sel.has(d) ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}>
              <input type="checkbox" checked={sel.has(d)} onChange={() => toggle(d)} className="accent-indigo-500" />
              {cap(d)}
            </label>
          ))}
        </div>
        {err && <p className="px-4 text-sm text-destructive">{err}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await assignProjectAction(project.id, [...sel]); onSaved(); }
            catch (e) { setErr((e as Error).message); setBusy(false); }
          }}>{busy ? "Saving…" : "Save assignment"}</Button>
        </div>
      </Card>
    </div>
  );
}

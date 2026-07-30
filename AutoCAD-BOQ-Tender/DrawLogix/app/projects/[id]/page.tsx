import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, isManager } from "@/auth/session";
import { getAssignments } from "@/domain/access";
import { getProject } from "@/domain/projects";
import { UserMenu } from "../../_components/user-menu";
import { ProjectWorkspace } from "../../_components/project-workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getProject(user.orgId, id);
  if (!data) notFound();

  // Access control: a division user may only open projects assigned to their division.
  const assignments = await getAssignments(user.orgId, id);
  const divisions = assignments.map((a) => a.division);
  if (!isManager(user.role) && !divisions.includes(user.role)) redirect("/projects");

  const { project, documents, drawings, messages } = data;
  const drawing = drawings[0] ?? null; // latest first (query orders by createdAt desc)

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/projects" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Projects
          </Link>
          <span className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-sky-500 text-[11px] font-bold text-white">DL</span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight">{project.name}</h1>
              {project.client && <p className="truncate text-xs text-muted-foreground">{project.client}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {divisions.length > 0 && (
            <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary md:inline">
              {divisions.length} division{divisions.length === 1 ? "" : "s"}
            </span>
          )}
          <Link href={`/studio?project=${project.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-indigo-400/40 bg-indigo-500/15 px-3 py-1.5 text-sm font-medium text-indigo-100 transition-colors hover:bg-indigo-500/25">
            Open in BIM Studio
          </Link>
          <UserMenu name={user.name} role={user.role} />
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <ProjectWorkspace
          project={{ id: project.id, name: project.name, status: project.status, client: project.client }}
          documents={documents.map((d) => ({ id: d.id, name: d.name, docType: d.docType, content: d.content }))}
          drawing={
            drawing
              ? { id: drawing.id, title: drawing.title, kind: drawing.kind, svg: drawing.svg, dxf: drawing.dxf, lifecycleState: drawing.lifecycleState }
              : null
          }
          messages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
        />
      </div>
    </div>
  );
}

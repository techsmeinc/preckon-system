import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth/session";
import { canAccessProject, projectTeam } from "@/domain/access";
import { loadBimModel } from "@/domain/bim-store";
import { getProjectName } from "@/domain/projects";
import { BimStudio } from "../_components/bim-studio";

export const dynamic = "force-dynamic";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = { id: user.id, name: user.name, role: user.role };

  const { project: projectId } = await searchParams;
  if (!projectId) {
    // Scratch mode — no shared project, no collaboration.
    return <BimStudio user={me} />;
  }

  if (!(await canAccessProject(user, projectId))) redirect("/projects");
  const [name, saved, team] = await Promise.all([
    getProjectName(user.orgId, projectId),
    loadBimModel(user.orgId, projectId),
    projectTeam(user.orgId, projectId),
  ]);

  return (
    <BimStudio
      user={me}
      project={{ id: projectId, name: name ?? "Project" }}
      initialDoc={saved?.doc ?? null}
      initialMeta={saved?.meta ?? null}
      team={team}
    />
  );
}

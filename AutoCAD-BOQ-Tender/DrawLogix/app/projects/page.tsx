import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth/session";
import { assignmentsForProjects, listProjectsForUser } from "@/domain/access";
import { ProjectsHome } from "../_components/projects-home";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const projects = await listProjectsForUser(user);
  const assignMap = await assignmentsForProjects(user.orgId, projects.map((p) => p.id));

  return (
    <ProjectsHome
      user={{ name: user.name, role: user.role }}
      projects={projects.map((p) => ({ id: p.id, name: p.name, client: p.client, status: p.status, divisions: assignMap.get(p.id) ?? [] }))}
    />
  );
}

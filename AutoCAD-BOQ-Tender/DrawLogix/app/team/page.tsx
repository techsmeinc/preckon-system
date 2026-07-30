import { redirect } from "next/navigation";
import { getSessionUser, isManager } from "@/auth/session";
import { listUsers } from "@/domain/access";
import { TeamManager } from "../_components/team-manager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isManager(user.role)) redirect("/projects");

  const users = await listUsers(user.orgId);
  return (
    <TeamManager
      me={{ id: user.id, name: user.name, role: user.role }}
      users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
    />
  );
}

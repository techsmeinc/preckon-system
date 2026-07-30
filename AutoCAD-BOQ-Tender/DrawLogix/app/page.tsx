import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth/session";
import { getActiveOrgId, listOrgs } from "@/db/tenant";
import { DxfEditor } from "./_components/dxf-editor";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [orgs, activeOrgId] = await Promise.all([listOrgs(), getActiveOrgId()]);
  const orgName = orgs.find((o) => o.id === activeOrgId)?.name ?? null;
  return <DxfEditor orgName={orgName} />;
}

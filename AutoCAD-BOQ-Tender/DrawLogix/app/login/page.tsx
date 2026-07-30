import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth/session";
import { LoginForm } from "../_components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/projects");
  return (
    <div className="h-full">
      <LoginForm />
    </div>
  );
}

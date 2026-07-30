"use server";

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, type Role, requireManager, requireUser, setSession, verifyPassword } from "@/auth/session";
import { db, schema } from "@/db/client";
import { ACTIVE_ORG_COOKIE } from "@/db/tenant";
import { archiveUser, createUser, setAssignments } from "@/domain/access";

/** Log in with email + password; sets the session and selects the user's org. */
export async function loginAction(email: string, password: string): Promise<{ ok: true; role: Role }> {
  const em = (email ?? "").trim().toLowerCase();
  const user = (await db.select().from(schema.dlUsers).where(and(eq(schema.dlUsers.email, em), isNull(schema.dlUsers.archivedAt))).limit(1))[0];
  if (!user || !verifyPassword(password ?? "", user.passwordHash)) throw new Error("Invalid email or password.");
  await setSession(user.id);
  (await cookies()).set(ACTIVE_ORG_COOKIE, user.orgId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { ok: true, role: user.role as Role };
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

/** Coordinator/Admin: create a team member with a division role. */
export async function createUserAction(input: { name: string; email: string; password: string; role: Role }) {
  const me = await requireManager();
  return createUser(me.orgId, input);
}

export async function archiveUserAction(userId: string) {
  const me = await requireManager();
  if (me.id === userId) throw new Error("You can't remove your own account.");
  return archiveUser(me.orgId, userId);
}

/** Coordinator/Admin: set which divisions a project is assigned to. */
export async function assignProjectAction(projectId: string, divisions: string[]) {
  const me = await requireManager();
  await setAssignments(me.orgId, projectId, divisions, me.id);
  return { ok: true };
}

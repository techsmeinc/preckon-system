import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { hashPassword, isManager, type Role, type SessionUser } from "@/auth/session";
import { db, schema } from "@/db/client";
import { withTenant } from "@/db/tenant";

/**
 * Role-based access + assignment queries. Managers (admin/coordinator) see every project
 * in the org; a division user sees only projects assigned to their division.
 */

/** Projects visible to a user, honouring their role. */
export async function listProjectsForUser(user: SessionUser) {
  const all = await db
    .select()
    .from(schema.drawingProjects)
    .where(and(eq(schema.drawingProjects.orgId, user.orgId), isNull(schema.drawingProjects.archivedAt)))
    .orderBy(desc(schema.drawingProjects.createdAt));
  if (isManager(user.role)) return all;
  const mine = await db
    .select({ projectId: schema.projectAssignments.projectId })
    .from(schema.projectAssignments)
    .where(and(eq(schema.projectAssignments.orgId, user.orgId), eq(schema.projectAssignments.division, user.role)));
  const ids = new Set(mine.map((m) => m.projectId));
  return all.filter((p) => ids.has(p.id));
}

/** Can this user open the project? (manager, or their division is assigned to it) */
export async function canAccessProject(user: SessionUser, projectId: string): Promise<boolean> {
  if (isManager(user.role)) return true;
  const rows = await db
    .select({ division: schema.projectAssignments.division })
    .from(schema.projectAssignments)
    .where(and(eq(schema.projectAssignments.orgId, user.orgId), eq(schema.projectAssignments.projectId, projectId), eq(schema.projectAssignments.division, user.role)))
    .limit(1);
  return rows.length > 0;
}

/** The people on a project (managers + users in the assigned divisions) — for @mentions. */
export async function projectTeam(orgId: string, projectId: string): Promise<{ id: string; name: string; role: string }[]> {
  const divisions = new Set((await getAssignments(orgId, projectId)).map((a) => a.division));
  const users = await listUsers(orgId);
  return users.filter((u) => isManager(u.role) || divisions.has(u.role)).map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

/** Divisions assigned to a project (with status). */
export async function getAssignments(orgId: string, projectId: string) {
  return db
    .select({ division: schema.projectAssignments.division, status: schema.projectAssignments.status })
    .from(schema.projectAssignments)
    .where(and(eq(schema.projectAssignments.orgId, orgId), eq(schema.projectAssignments.projectId, projectId)));
}

/** Which divisions each project is assigned to (for list badges). */
export async function assignmentsForProjects(orgId: string, projectIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .select({ projectId: schema.projectAssignments.projectId, division: schema.projectAssignments.division })
    .from(schema.projectAssignments)
    .where(and(eq(schema.projectAssignments.orgId, orgId), inArray(schema.projectAssignments.projectId, projectIds)));
  for (const r of rows) map.set(r.projectId, [...(map.get(r.projectId) ?? []), r.division]);
  return map;
}

/** Replace a project's division assignments (Coordinator action). */
export async function setAssignments(orgId: string, projectId: string, divisions: string[], assignedBy: string) {
  const clean = [...new Set(divisions.filter(Boolean))];
  await withTenant(orgId, async (tx) => {
    await tx.delete(schema.projectAssignments).where(and(eq(schema.projectAssignments.orgId, orgId), eq(schema.projectAssignments.projectId, projectId)));
    for (const division of clean) {
      await tx.insert(schema.projectAssignments).values({ id: randomUUID(), orgId, projectId, division, assignedBy, status: "assigned" });
    }
  });
}

// ── User management (Coordinator/Admin) ──────────────────────────────────────
export async function listUsers(orgId: string) {
  return db
    .select({ id: schema.dlUsers.id, name: schema.dlUsers.name, email: schema.dlUsers.email, role: schema.dlUsers.role, createdAt: schema.dlUsers.createdAt })
    .from(schema.dlUsers)
    .where(and(eq(schema.dlUsers.orgId, orgId), isNull(schema.dlUsers.archivedAt)))
    .orderBy(desc(schema.dlUsers.createdAt));
}

export async function createUser(orgId: string, input: { name: string; email: string; password: string; role: Role }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || !email) throw new Error("Name and email are required.");
  if ((input.password ?? "").length < 6) throw new Error("Password must be at least 6 characters.");
  const existing = (await db.select({ id: schema.dlUsers.id }).from(schema.dlUsers).where(and(eq(schema.dlUsers.orgId, orgId), eq(schema.dlUsers.email, email))).limit(1))[0];
  if (existing) throw new Error("A user with that email already exists.");
  const id = randomUUID();
  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.dlUsers).values({ id, orgId, name, email, passwordHash: hashPassword(input.password), role: input.role });
  });
  return { id };
}

export async function archiveUser(orgId: string, userId: string) {
  await withTenant(orgId, async (tx) => {
    await tx.update(schema.dlUsers).set({ archivedAt: new Date() }).where(and(eq(schema.dlUsers.orgId, orgId), eq(schema.dlUsers.id, userId)));
  });
}

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { withTenant } from "@/db/tenant";

export async function listProjects(orgId: string) {
  return db
    .select()
    .from(schema.drawingProjects)
    .where(and(eq(schema.drawingProjects.orgId, orgId), isNull(schema.drawingProjects.archivedAt)))
    .orderBy(desc(schema.drawingProjects.createdAt));
}

/** Just the project's name (light lookup for headers/scoping). */
export async function getProjectName(orgId: string, projectId: string): Promise<string | null> {
  const row = (
    await db
      .select({ name: schema.drawingProjects.name })
      .from(schema.drawingProjects)
      .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)))
      .limit(1)
  )[0];
  return row?.name ?? null;
}

export async function createProject(orgId: string, input: { name: string; client?: string; description?: string }) {
  const name = input.name?.trim();
  if (!name) throw new Error("Project name is required");
  const id = randomUUID();
  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.drawingProjects).values({
      id,
      orgId,
      name,
      client: input.client?.trim() || null,
      description: input.description?.trim() || null,
    });
  });
  return { id };
}

export async function archiveProject(orgId: string, projectId: string) {
  await withTenant(orgId, async (tx) => {
    await tx
      .update(schema.drawingProjects)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)));
  });
}

/** The full project view: project + documents + requirements + drawings + chat. */
export async function getProject(orgId: string, projectId: string) {
  const project = (
    await db
      .select()
      .from(schema.drawingProjects)
      .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)))
      .limit(1)
  )[0];
  if (!project) return null;

  const [documents, requirements, drawings, messages] = await Promise.all([
    db
      .select()
      .from(schema.drawingDocuments)
      .where(
        and(
          eq(schema.drawingDocuments.orgId, orgId),
          eq(schema.drawingDocuments.projectId, projectId),
          isNull(schema.drawingDocuments.archivedAt),
        ),
      )
      .orderBy(desc(schema.drawingDocuments.createdAt)),
    db
      .select()
      .from(schema.drawingRequirements)
      .where(and(eq(schema.drawingRequirements.orgId, orgId), eq(schema.drawingRequirements.projectId, projectId)))
      .orderBy(asc(schema.drawingRequirements.seq)),
    db
      .select()
      .from(schema.drawings)
      .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId), isNull(schema.drawings.archivedAt)))
      .orderBy(desc(schema.drawings.createdAt)),
    db
      .select()
      .from(schema.drawingMessages)
      .where(and(eq(schema.drawingMessages.orgId, orgId), eq(schema.drawingMessages.projectId, projectId)))
      .orderBy(asc(schema.drawingMessages.createdAt)),
  ]);

  return { project, documents, requirements, drawings, messages };
}

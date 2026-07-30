import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { publishCollab } from "./collab-bus";

/**
 * Per-project SHARED 3D BIM model storage. One row per project — the Coordinator and
 * every division load the same document, so an Architect opens whatever the team has
 * already built. Last-write-wins with an updated-by stamp so the UI can show who changed
 * it and offer a reload.
 */

export interface BimMeta {
  updatedAtMs: number;
  updatedByName: string | null;
}

async function latestRow(orgId: string, projectId: string) {
  return (
    await db
      .select()
      .from(schema.bimModels)
      .where(and(eq(schema.bimModels.orgId, orgId), eq(schema.bimModels.projectId, projectId), isNull(schema.bimModels.archivedAt)))
      .orderBy(desc(schema.bimModels.updatedAt))
      .limit(1)
  )[0];
}

/** Load the saved model for a project (parsed), or null if none saved yet. */
export async function loadBimModel(orgId: string, projectId: string): Promise<{ doc: unknown | null; meta: BimMeta } | null> {
  const row = await latestRow(orgId, projectId);
  if (!row) return null;
  let doc: unknown = null;
  try {
    doc = row.doc ? JSON.parse(row.doc) : null;
  } catch {
    doc = null;
  }
  return { doc, meta: { updatedAtMs: row.updatedAt?.getTime() ?? 0, updatedByName: row.updatedByName ?? null } };
}

/** Cheap metadata (no doc) for polling whether the model changed. */
export async function bimModelMeta(orgId: string, projectId: string): Promise<BimMeta | null> {
  const row = (
    await db
      .select({ updatedAt: schema.bimModels.updatedAt, updatedByName: schema.bimModels.updatedByName })
      .from(schema.bimModels)
      .where(and(eq(schema.bimModels.orgId, orgId), eq(schema.bimModels.projectId, projectId), isNull(schema.bimModels.archivedAt)))
      .orderBy(desc(schema.bimModels.updatedAt))
      .limit(1)
  )[0];
  return row ? { updatedAtMs: row.updatedAt?.getTime() ?? 0, updatedByName: row.updatedByName ?? null } : null;
}

/** Upsert the project's model (last write wins). Returns the new updatedAt ms. */
export async function saveBimModel(orgId: string, projectId: string, doc: unknown, user: { id: string; name: string }): Promise<number> {
  const json = JSON.stringify(doc);
  const now = new Date();
  const existing = await latestRow(orgId, projectId);
  await withTenant(orgId, async (tx) => {
    if (existing) {
      await tx.update(schema.bimModels).set({ doc: json, updatedById: user.id, updatedByName: user.name, updatedAt: now }).where(eq(schema.bimModels.id, existing.id));
    } else {
      await tx.insert(schema.bimModels).values({ id: randomUUID(), orgId, projectId, doc: json, updatedById: user.id, updatedByName: user.name });
    }
  });
  // Live nudge to teammates viewing the model → instant "reload" banner.
  publishCollab(orgId, projectId, { type: "model", meta: { updatedAtMs: now.getTime(), updatedByName: user.name, updatedById: user.id } });
  return now.getTime();
}

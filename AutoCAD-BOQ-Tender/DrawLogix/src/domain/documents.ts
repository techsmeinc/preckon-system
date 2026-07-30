import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db/client";
import { withTenant } from "@/db/tenant";

const DOC_TYPES = ["sow", "interview", "spec", "rfp", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Add an input document (pasted/extracted text) to a project. */
export async function addDocument(
  orgId: string,
  input: { projectId: string; name: string; docType: string; content: string },
) {
  const name = input.name?.trim();
  if (!name) throw new Error("Document name is required");
  if (!input.content?.trim()) throw new Error("Paste the document text so the concept can be generated from it");
  const docType = (DOC_TYPES as readonly string[]).includes(input.docType) ? (input.docType as DocType) : "sow";
  const id = randomUUID();
  await withTenant(orgId, async (tx) => {
    await tx.insert(schema.drawingDocuments).values({
      id,
      orgId,
      projectId: input.projectId,
      name,
      docType,
      content: input.content.trim(),
      status: "processed",
    });
  });
  return { id };
}

export async function archiveDocument(orgId: string, documentId: string) {
  await withTenant(orgId, async (tx) => {
    await tx
      .update(schema.drawingDocuments)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.drawingDocuments.orgId, orgId), eq(schema.drawingDocuments.id, documentId)));
  });
}

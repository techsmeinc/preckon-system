import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/**
 * Persisted SOW outline — the scope-area breakdown the multi-agent pipeline
 * extracts from the uploaded tender documents (see sow-outline.ts). One row per
 * outline node (top-level divisions AND their subsections), saved during
 * /generate-boq-multi so the priced-BOQ Excel export can title each
 * sheet/section with the document's OWN division headings instead of a static
 * discipline name or the AI's short trade tag.
 *
 * The export keys on `sowRef` to resolve a division/section title; `parentSowRef`
 * links a subsection back to its top-level division.
 */
export const sowSectionsTable = mysqlTable("sow_sections", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // Display/sort order as it appeared in the extracted outline.
  seq: int("seq").notNull().default(0),
  // The document's own ref for this node ("D", "2.1", "Lot 3", "4.1").
  sowRef: varchar("sow_ref", { length: 64 }).notNull(),
  // Our internal sequential ref for the node ("4", "4.1"), if any.
  ourRef: varchar("our_ref", { length: 64 }),
  // The top-level division ref this node sits under; null for a top-level node.
  parentSowRef: varchar("parent_sow_ref", { length: 64 }),
  // The division/section heading, taken verbatim from the documents.
  title: varchar("title", { length: 500 }).notNull(),
  // QS measurement note for the node ("LS", "m3", "BoQ", or a phrase).
  measurementBasis: varchar("measurement_basis", { length: 200 }),
  // Free-text scope notes the extractor captured for the node.
  scopeNotes: text("scope_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSowSectionSchema = createInsertSchema(sowSectionsTable).omit({ id: true, createdAt: true });
export type InsertSowSection = z.infer<typeof insertSowSectionSchema>;
export type SowSection = typeof sowSectionsTable.$inferSelect;

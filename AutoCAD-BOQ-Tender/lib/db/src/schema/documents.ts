import { mysqlTable, int, varchar, longtext, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const documentsTable = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 500 }).notNull(),
  originalName: varchar("original_name", { length: 500 }).notNull(),
  documentType: varchar("document_type", { length: 50 }).notNull(), // drawing | tender | sow | other
  fileSize: int("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  filePath: varchar("file_path", { length: 1024 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("uploaded"), // uploaded | processing | processed | failed
  extractedText: longtext("extracted_text"),
  // pending | running | succeeded | failed | skipped — drives the CAD ingest
  // pipeline. "skipped" means we received a file we don't try to parse (e.g.
  // a PDF tender doc when CAD extractor only handles dwg/dxf).
  cadExtractionStatus: varchar("cad_extraction_status", { length: 32 }).default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;

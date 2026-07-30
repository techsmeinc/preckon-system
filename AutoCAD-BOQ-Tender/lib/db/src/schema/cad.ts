import { mysqlTable, int, varchar, text, longtext, json, timestamp, mysqlEnum } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { documentsTable } from "./documents";

// One row per document we attempt to parse with the CAD extractor sidecar.
// `summary` holds the full JSON returned by the Python service (capped on the
// Python side). `embeddingStats` records how many chunks/dimensions/etc. were
// produced so the UI can show ingest progress.
export const cadExtractionsTable = mysqlTable("cad_extractions", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "running", "succeeded", "failed"]).notNull().default("pending"),
  summary: json("summary"),
  errorMessage: text("error_message"),
  layerCount: int("layer_count"),
  blockDefinitionCount: int("block_definition_count"),
  blockInstanceTotal: int("block_instance_total"),
  textAnnotationCount: int("text_annotation_count"),
  scheduleCount: int("schedule_count"),
  chunkCount: int("chunk_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// Searchable retrieval unit. Each chunk has an embedding (JSON-encoded float
// array) so we can cosine-search in Node, plus structural fields (layer,
// blockName, sheet) so the agentic tools can filter exactly.
export const cadChunksTable = mysqlTable("cad_chunks", {
  id: int("id").autoincrement().primaryKey(),
  extractionId: int("extraction_id").notNull().references(() => cadExtractionsTable.id, { onDelete: "cascade" }),
  documentId: int("document_id").notNull().references(() => documentsTable.id, { onDelete: "cascade" }),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // text | block_count | layer | schedule | title_block | dimension
  chunkType: varchar("chunk_type", { length: 32 }).notNull(),
  // The originating document type — "drawing", "tender", "rfp", "sow",
  // "addendum", "specification", "other". Lets retrieval filter by document
  // origin without a JOIN onto documents.
  sourceDocumentType: varchar("source_document_type", { length: 32 }),
  // Section heading for text-document chunks (RFP/SOW/spec) — null for
  // drawing chunks.
  section: varchar("section", { length: 500 }),
  // Page number on the source PDF, if known (text-document chunks).
  page: int("page"),
  layer: varchar("layer", { length: 255 }),
  blockName: varchar("block_name", { length: 255 }),
  sheet: varchar("sheet", { length: 255 }),
  // Stable identifier that can be referenced from a BOQ item, e.g.
  // "doc:42/block:LIGHT_2x2_LED" or "doc:42/layer:E-LIGHT-FIX"
  refId: varchar("ref_id", { length: 255 }),
  text: longtext("text").notNull(),
  embedding: json("embedding"), // number[] | null when embedding failed
  embeddingModel: varchar("embedding_model", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCadExtractionSchema = createInsertSchema(cadExtractionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCadExtraction = z.infer<typeof insertCadExtractionSchema>;
export type CadExtraction = typeof cadExtractionsTable.$inferSelect;

export const insertCadChunkSchema = createInsertSchema(cadChunksTable).omit({ id: true, createdAt: true });
export type InsertCadChunk = z.infer<typeof insertCadChunkSchema>;
export type CadChunk = typeof cadChunksTable.$inferSelect;

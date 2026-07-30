import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft | processing | completed
  // BOQ / tender export details — stamped onto the exported Bill of Quantities
  // meta block (filled once per project, reused on every export). All optional.
  location: varchar("location", { length: 255 }),          // "Project Location"
  client: varchar("client", { length: 255 }),              // "Submitted to"
  quotationRef: varchar("quotation_ref", { length: 255 }), // export ref (print header)
  submissionDate: varchar("submission_date", { length: 100 }), // free-text, e.g. "23rd August 2025"
  // Work-programme commencement (day 0) as an ISO date string "YYYY-MM-DD".
  // When set, the Gantt shows real calendar dates instead of week numbers.
  commencementDate: varchar("commencement_date", { length: 20 }),
  // 1 = archived/inactive (hidden from the main Projects list + dashboard,
  // shown only in the collapsed "Inactive projects" section). 0 = active.
  archived: int("archived").notNull().default(0),
  // Multi-agent BOQ result cache key. A SHA-256 fingerprint of the generation
  // INPUTS (model + document set + extraction/chunk state) taken at the last
  // successful run. Re-clicking "Multi-Agent BOQ" with an unchanged fingerprint
  // returns the SAME persisted BOQ instead of re-rolling a different one (the LLM
  // is non-deterministic). Cleared/overwritten on every forced regenerate.
  boqFingerprint: varchar("boq_fingerprint", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

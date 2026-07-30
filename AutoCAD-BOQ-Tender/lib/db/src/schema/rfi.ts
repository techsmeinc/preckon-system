import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const rfiItemsTable = mysqlTable("rfi_items", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  queryNumber: varchar("query_number", { length: 50 }),
  query: text("query").notNull(),
  answer: text("answer"),
  status: varchar("status", { length: 50 }).notNull().default("open"),
  raisedBy: varchar("raised_by", { length: 255 }),
  answeredBy: varchar("answered_by", { length: 255 }),
  deadline: varchar("deadline", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRfiItemSchema = createInsertSchema(rfiItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRfiItem = z.infer<typeof insertRfiItemSchema>;
export type RfiItem = typeof rfiItemsTable.$inferSelect;

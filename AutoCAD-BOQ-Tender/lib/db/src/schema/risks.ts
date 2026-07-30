import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const riskItemsTable = mysqlTable("risk_items", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  riskCode: varchar("risk_code", { length: 50 }),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }).default("Other"),
  likelihood: varchar("likelihood", { length: 50 }).default("Medium"),
  impact: varchar("impact", { length: 50 }).default("Medium"),
  mitigation: text("mitigation"),
  owner: varchar("owner", { length: 255 }),
  aiGenerated: varchar("ai_generated", { length: 10 }).default("false"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRiskItemSchema = createInsertSchema(riskItemsTable).omit({ id: true, createdAt: true });
export type InsertRiskItem = z.infer<typeof insertRiskItemSchema>;
export type RiskItem = typeof riskItemsTable.$inferSelect;

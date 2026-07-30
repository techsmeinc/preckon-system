import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { projectsTable } from "./projects";

export const tenderIntelligenceTable = mysqlTable("tender_intelligence", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  goNoGoScore: int("go_no_go_score"),
  recommendation: varchar("recommendation", { length: 50 }),
  scopeSummary: text("scope_summary"),
  keyStrengths: text("key_strengths"),
  keyRisks: text("key_risks"),
  requiredClarifications: text("required_clarifications"),
  competitiveAdvantages: text("competitive_advantages"),
  estimatedValue: varchar("estimated_value", { length: 100 }),
  complexity: varchar("complexity", { length: 50 }),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type TenderIntelligence = typeof tenderIntelligenceTable.$inferSelect;

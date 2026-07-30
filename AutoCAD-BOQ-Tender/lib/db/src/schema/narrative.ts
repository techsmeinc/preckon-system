import { mysqlTable, int, varchar, text, boolean, timestamp, unique } from "drizzle-orm/mysql-core";
import { projectsTable } from "./projects";

/**
 * One saved Technical Narrative section per project (executive-summary,
 * technical-approach, ...). The draft is generated/edited on screen and saved
 * here so it survives reloads; `verified` records that a human has reviewed it.
 */
export const narrativeSectionsTable = mysqlTable(
  "narrative_sections",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    sectionKey: varchar("section_key", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content"),
    verified: boolean("verified").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    // One row per (project, section) — saving a section upserts onto this key.
    projectSection: unique("narrative_project_section").on(table.projectId, table.sectionKey),
  }),
);

export type NarrativeSectionRow = typeof narrativeSectionsTable.$inferSelect;

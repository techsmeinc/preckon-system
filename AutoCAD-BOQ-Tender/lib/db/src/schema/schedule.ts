import { mysqlTable, int, varchar, text, decimal, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/**
 * Project Resources / Team — the people (or crews) an activity can be assigned
 * to, the way Primavera P6 assigns Resources to activities. One row per resource
 * per project; an activity references one via `resourceId`. Kept project-scoped
 * (not a global users table) because each tender has its own proposed team.
 */
export const projectResourcesTable = mysqlTable("project_resources", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  // Role / trade / discipline, e.g. "Site Engineer", "MEP Foreman".
  role: varchar("role", { length: 120 }),
  // Accent colour (hex incl. '#') used to tint this resource's bars/avatar.
  color: varchar("color", { length: 9 }),
  // ── P6-style resource attributes (cost / power / capacity / status) ──────────
  // Resource type. 'labour' (a person/crew), 'equipment' (a machine — carries a
  // power rating), or 'material'. Drives which extra fields are meaningful.
  kind: varchar("kind", { length: 16 }).notNull().default("labour"),
  // How `rate` is charged: 'hourly' (× hours/day from the calendar) or 'daily'.
  rateBasis: varchar("rate_basis", { length: 8 }).notNull().default("daily"),
  // Cost rate in `currency`. KWD has 3 decimal places (fils) → scale 3.
  rate: decimal("rate", { precision: 14, scale: 3 }),
  currency: varchar("currency", { length: 8 }),
  // Power draw for equipment, in kilowatts (the "wattage" roll-up).
  powerKw: decimal("power_kw", { precision: 10, scale: 3 }),
  // How many of this resource exist (e.g. 3 identical excavators / a crew size).
  capacity: int("capacity").notNull().default(1),
  // 'active' | 'inactive'. (On-leave for a given day is derived from resource_leave.)
  status: varchar("status", { length: 16 }).notNull().default("active"),
  // Optional resource-specific calendar override; NULL ⇒ uses the project default.
  calendarId: int("calendar_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectResourceSchema = createInsertSchema(projectResourcesTable).omit({ id: true, createdAt: true });
export type InsertProjectResource = z.infer<typeof insertProjectResourceSchema>;
export type ProjectResource = typeof projectResourcesTable.$inferSelect;

/**
 * Project work-programme / time-schedule activities, AI-generated from the SOW
 * + project documents (see schedule-builder.ts). One row per programme activity.
 * Durations and offsets are in CALENDAR DAYS measured from project commencement
 * (day 0); the AIGCC Excel export turns these into a week-by-week Gantt on a
 * dedicated "Programme" sheet.
 */
export const scheduleActivitiesTable = mysqlTable("schedule_activities", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // Display/sort order within the programme.
  seq: int("seq").notNull().default(0),
  // Grouping phase, e.g. "Mobilization", "Construction", "Testing & Commissioning".
  phase: varchar("phase", { length: 120 }),
  // Links back to the SOW outline section this activity came from (optional).
  sowRef: varchar("sow_ref", { length: 32 }),
  activity: varchar("activity", { length: 500 }).notNull(),
  // Self-reference: a sub-activity points at its parent activity's id. NULL for
  // top-level activities. (The Section level is the `phase` string grouping.)
  // The parent/child cascade is enforced in application code so the generator
  // can wipe-and-reinsert the whole programme freely.
  parentId: int("parent_id"),
  // Duration in calendar days.
  durationDays: int("duration_days").notNull().default(1),
  // Start offset in calendar days from project commencement (day 0).
  startOffsetDays: int("start_offset_days").notNull().default(0),
  // Human-readable predecessor note (e.g. "after Mobilization"). Free text.
  predecessor: varchar("predecessor", { length: 200 }),
  // Comma-separated predecessor activity ids — legacy Finish-to-Start mirror,
  // kept in sync with `dependencies` for any reader that only understands plain
  // ids (e.g. "12,15").
  predecessorIds: varchar("predecessor_ids", { length: 200 }),
  // Structured typed dependency network (JSON), the source of truth for CPM:
  //   [{ "id": 12, "type": "FS"|"SS"|"FF"|"SF", "lag": 0 }, ...]
  // The forward/backward pass in schedule-cpm.ts derives every activity's dates
  // and the critical path from these links. See parseDependencies().
  dependencies: text("dependencies"),
  // 1 = milestone (zero-duration marker), 0 = normal activity bar.
  isMilestone: int("is_milestone").notNull().default(0),
  // Assigned resource (P6-style). NULL = unassigned. Set-null on resource delete
  // so removing a team member doesn't wipe the activity.
  resourceId: int("resource_id").references(() => projectResourcesTable.id, { onDelete: "set null" }),
  // Progress 0–100. The Gantt bar fills proportionally; phases/project roll up a
  // duration-weighted average. Milestones are 0 or 100 (done/not-done).
  percentComplete: int("percent_complete").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScheduleActivitySchema = createInsertSchema(scheduleActivitiesTable).omit({ id: true, createdAt: true });
export type InsertScheduleActivity = z.infer<typeof insertScheduleActivitySchema>;
export type ScheduleActivity = typeof scheduleActivitiesTable.$inferSelect;

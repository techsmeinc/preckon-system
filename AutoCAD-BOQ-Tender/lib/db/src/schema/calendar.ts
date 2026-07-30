import { mysqlTable, int, varchar, text, decimal, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { projectResourcesTable, scheduleActivitiesTable } from "./schedule";

/**
 * Work calendars (Primavera-P6 "Calendars"). A project gets one default calendar
 * (GCC Fri/Sat by default); additional named calendars can model a "resource
 * calendar" that a resource references via `project_resources.calendar_id`. The
 * calendar-engine.ts module interprets these to decide working vs non-working
 * days when the CPM runs in calendar mode.
 */
export const projectCalendarsTable = mysqlTable("project_calendars", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull().default("Project Calendar"),
  // 1 = the project's default calendar (used when an activity/resource doesn't
  // point at a specific one). Exactly one row per project should carry this.
  isDefault: int("is_default").notNull().default(0),
  // JS weekday numbers (0=Sun … 6=Sat) that are non-working, as JSON, e.g. [5,6].
  weekendDays: text("weekend_days"),
  // Working hours in a full working day — drives hours/cost math.
  hoursPerDay: decimal("hours_per_day", { precision: 5, scale: 2 }).notNull().default("8"),
  // JSON array of holiday entries: [{ "date": "2026-12-02", "name": "..." }, ...]
  // or ranges [{ "from": "...", "to": "...", "name": "..." }].
  holidays: text("holidays"),
  // The preset this calendar was seeded from (e.g. "uae", "ksa"), for the UI.
  preset: varchar("preset", { length: 32 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectCalendarSchema = createInsertSchema(projectCalendarsTable).omit({ id: true, createdAt: true });
export type InsertProjectCalendar = z.infer<typeof insertProjectCalendarSchema>;
export type ProjectCalendar = typeof projectCalendarsTable.$inferSelect;

/**
 * Resource leave / vacation periods. A resource on leave during an activity it
 * drives extends that activity's calendar span (the days inside the window become
 * non-working for it) and raises a conflict the UI can resolve by extending or
 * reassigning. Inclusive `fromDate`..`toDate` (ISO "YYYY-MM-DD").
 */
export const resourceLeaveTable = mysqlTable("resource_leave", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  resourceId: int("resource_id").notNull().references(() => projectResourcesTable.id, { onDelete: "cascade" }),
  // 'vacation' | 'sick' | 'other'.
  type: varchar("type", { length: 16 }).notNull().default("vacation"),
  fromDate: varchar("from_date", { length: 20 }).notNull(),
  toDate: varchar("to_date", { length: 20 }).notNull(),
  note: varchar("note", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertResourceLeaveSchema = createInsertSchema(resourceLeaveTable).omit({ id: true, createdAt: true });
export type InsertResourceLeave = z.infer<typeof insertResourceLeaveSchema>;
export type ResourceLeave = typeof resourceLeaveTable.$inferSelect;

/**
 * Activity ⇄ resource assignments (P6 multi-resource). An activity can carry
 * several resources, each at an `allocationPct` (% of capacity) and `unitsPerDay`
 * (how many units). Exactly one assignment per activity is the `isDriving` one —
 * the resource whose calendar/leave governs the activity's dates and that the
 * legacy `schedule_activities.resource_id` mirror points at.
 */
export const activityResourcesTable = mysqlTable("activity_resources", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  activityId: int("activity_id").notNull().references(() => scheduleActivitiesTable.id, { onDelete: "cascade" }),
  resourceId: int("resource_id").notNull().references(() => projectResourcesTable.id, { onDelete: "cascade" }),
  // Allocation as a percentage of the resource (100 = full-time on this activity).
  allocationPct: int("allocation_pct").notNull().default(100),
  // Number of units assigned (e.g. 2 excavators). Multiplies hours & cost.
  unitsPerDay: decimal("units_per_day", { precision: 8, scale: 2 }).notNull().default("1"),
  // 1 = the driving resource for this activity (governs dates + legacy mirror).
  isDriving: int("is_driving").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertActivityResourceSchema = createInsertSchema(activityResourcesTable).omit({ id: true, createdAt: true });
export type InsertActivityResource = z.infer<typeof insertActivityResourceSchema>;
export type ActivityResource = typeof activityResourcesTable.$inferSelect;

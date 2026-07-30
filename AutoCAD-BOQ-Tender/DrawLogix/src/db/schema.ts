import { sql } from "drizzle-orm";
import { char, customType, datetime, decimal, int, longtext, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { v7 as uuidv7 } from "uuid";

/**
 * Self-contained schema for the standalone DrawLogix app. These are the SAME tables
 * the platform created (migrations 0005/0006/0007) in the construction_intelligence
 * database — this app just owns its own typed view of them, with no @ci/* dependency.
 */

/** Portable JSON for MariaDB (reports JSON as LONGTEXT, so parse/stringify by hand). */
const json = <TData>(name: string) =>
  customType<{ data: TData; driverData: string }>({
    dataType: () => "json",
    toDriver: (v: TData) => JSON.stringify(v),
    fromDriver: (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as TData,
  })(name);

/** The base spine every owned table carries (org_id is the tenant key). */
const baseColumns = {
  id: char("id", { length: 36 }).primaryKey().$defaultFn(() => uuidv7()),
  orgId: char("org_id", { length: 36 }).notNull(),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  archivedAt: datetime("archived_at", { mode: "date", fsp: 3 }),
};

// Read-only view of the platform's tenant table — used by the org selector.
export const orgs = mysqlTable("orgs", {
  id: char("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
});

export const drawingProjects = mysqlTable("drawing_projects", {
  ...baseColumns,
  name: varchar("name", { length: 255 }).notNull(),
  client: varchar("client", { length: 255 }),
  description: text("description"),
  status: varchar("status", { length: 32 }).notNull().default("draft"), // draft | generating | ready
});

export const drawingDocuments = mysqlTable("drawing_documents", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  docType: varchar("doc_type", { length: 32 }).notNull().default("sow"), // sow | interview | spec | rfp | other
  content: longtext("content"),
  fileKey: varchar("file_key", { length: 1024 }),
  status: varchar("status", { length: 32 }).notNull().default("received"), // received | processed | failed
});

export const drawingRequirements = mysqlTable("drawing_requirements", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  ref: varchar("ref", { length: 32 }).notNull(), // "R-001"
  seq: int("seq").notNull().default(0),
  category: varchar("category", { length: 32 }).notNull().default("space"), // space | constraint | assumption | exclusion | clarification
  title: varchar("title", { length: 500 }).notNull(),
  detail: text("detail"),
  sourceDocumentId: char("source_document_id", { length: 36 }),
});

export interface ScheduleRow {
  ref: string;
  room: string;
  areaSqm: number;
  requirementRef?: string;
  // Solved floor-plan geometry (metres). Absent on legacy/area-only schedules.
  kind?: string; // circulation | wet | service | habitable
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  floor?: number; // storey (1 = ground); absent = single-storey
}

export const drawings = mysqlTable("drawings", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull().default("concept_plan"), // concept_plan | area_schedule
  lifecycleState: varchar("lifecycle_state", { length: 32 }).notNull().default("ai_generated"),
  svg: longtext("svg"),
  dxf: longtext("dxf"),
  schedule: json<ScheduleRow[]>("schedule"),
  traceability: json<string[]>("traceability"),
  aiConfidence: decimal("ai_confidence", { precision: 4, scale: 3 }),
  generationMethod: varchar("generation_method", { length: 50 }).default("ai_concept"),
});

export const drawingMessages = mysqlTable("drawing_messages", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(), // user | assistant
  content: text("content").notNull(),
});

/**
 * DrawLogix users — a role-based access layer on top of the org tenancy. A Coordinator
 * or Admin creates accounts; each user's `role` is either a management role
 * (admin/coordinator) or a construction DIVISION (architectural/structural/…/fire).
 * A division user only sees projects that have been assigned to their division.
 */
export const dlUsers = mysqlTable("dl_users", {
  ...baseColumns,
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("architectural"), // admin | coordinator | <division>
});

/** A project assigned to a division (department). Every user in that division sees it. */
export const projectAssignments = mysqlTable("project_assignments", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  division: varchar("division", { length: 32 }).notNull(), // architectural | structural | … | fire
  assignedBy: char("assigned_by", { length: 36 }), // user id of the coordinator
  status: varchar("status", { length: 24 }).notNull().default("assigned"), // assigned | in_progress | done
  note: text("note"),
});

/** The shared 3D BIM model for a project (one row per project, upserted). Everyone on the
 *  project loads this; each division edits their own elements via the scoped AI agent. */
export const bimModels = mysqlTable("bim_models", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  doc: longtext("doc"), // JSON BimDocument
  updatedById: char("updated_by_id", { length: 36 }),
  updatedByName: varchar("updated_by_name", { length: 255 }),
});

/** Live per-project team chat. `mentions` holds the @-mentioned user ids. */
export const projectChat = mysqlTable("project_chat", {
  ...baseColumns,
  projectId: char("project_id", { length: 36 }).notNull(),
  userId: char("user_id", { length: 36 }),
  userName: varchar("user_name", { length: 255 }).notNull(),
  userRole: varchar("user_role", { length: 32 }),
  body: text("body").notNull(),
  mentions: json<string[]>("mentions"),
});

export const schema = {
  orgs,
  drawingProjects,
  drawingDocuments,
  drawingRequirements,
  drawings,
  drawingMessages,
  dlUsers,
  projectAssignments,
  bimModels,
  projectChat,
};

import { mysqlTable, int, varchar, text, decimal, json, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const boqItemsTable = mysqlTable("boq_items", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 100 }).notNull(),
  itemCode: varchar("item_code", { length: 100 }),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }),
  totalPrice: decimal("total_price", { precision: 14, scale: 2 }),
  notes: text("notes"),
  aiConfidence: decimal("ai_confidence", { precision: 4, scale: 3 }),
  verificationStatus: varchar("verification_status", { length: 50 }).default("unverified"),
  verificationNotes: text("verification_notes"),
  // Human-in-the-loop review gate. A QS reviews each AI/imported line and marks
  // it "approved" once happy with it; ONLY items with approvalStatus="approved"
  // are written to the exported priced-BOQ Excel. Defaults to "pending" so
  // nothing is exported until a human has signed off on it.
  approvalStatus: varchar("approval_status", { length: 20 }).default("pending"),
  generationMethod: varchar("generation_method", { length: 50 }).default("single"),
  // AIGCC 4-level priced-BOQ hierarchy. Matches the columns of the priced-BOQ
  // Excel template the QS team uses: SOW Ref. No. | Our Ref. No. | Sub. Ref. |
  // Sr.No. Populated by the SOW-driven multi-agent pipeline so a line item can
  // be slotted under the right SOW chapter in the AIGCC export. All optional
  // because single-LLM /generate-boq still produces flat-category rows.
  sowRef: varchar("sow_ref", { length: 32 }),
  ourRef: varchar("our_ref", { length: 32 }),
  subRef: varchar("sub_ref", { length: 32 }),
  srNo: varchar("sr_no", { length: 32 }),
  // The "Remarks" column from the AIGCC priced-BOQ template. Used for QS-facing
  // free text that doesn't fit in description/notes (e.g. "by client",
  // "subject to MEW approval"). Distinct from notes which is for internal
  // generation provenance.
  remarks: text("remarks"),
  // Provenance back into the CAD drawings: array of { refId, layer, blockName,
  // sheet, documentId, snippet, type }. Populated by the agentic CAD pipeline
  // so a QS can trace each line item to where in the drawings it came from.
  drawingReferences: json("drawing_references"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBoqItemSchema = createInsertSchema(boqItemsTable).omit({ id: true, createdAt: true });
export type InsertBoqItem = z.infer<typeof insertBoqItemSchema>;
export type BoqItem = typeof boqItemsTable.$inferSelect;

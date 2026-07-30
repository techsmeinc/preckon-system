import { mysqlTable, int, longtext, timestamp } from "drizzle-orm/mysql-core";
import { z } from "zod/v4";
import { documentsTable } from "./documents";
import { projectsTable } from "./projects";

// Markup + measurement overlay for a CAD drawing. One row per document holds the
// full set of annotations as a JSON array (drawn client-side over the rendered
// SVG; the original DWG/DXF is never modified). Stored opaque to the server —
// the shape is owned by the CadEditor component.
export const cadAnnotationsTable = mysqlTable("cad_annotations", {
  documentId: int("document_id")
    .primaryKey()
    .references(() => documentsTable.id, { onDelete: "cascade" }),
  projectId: int("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  // JSON array of annotation objects (points are in the SVG view-box coords).
  data: longtext("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type CadAnnotationRow = typeof cadAnnotationsTable.$inferSelect;

// One annotation, as persisted. `points` is a flat [x0,y0,x1,y1,…] list in the
// drawing's SVG view-box coordinate space so it tracks pan/zoom exactly.
export const cadAnnotationSchema = z.object({
  id: z.string(),
  type: z.enum(["rect", "arrow", "cloud", "pen", "text", "highlight", "dist", "area", "angle"]),
  points: z.array(z.number()),
  color: z.string(),
  text: z.string().optional(),
});
export type CadAnnotation = z.infer<typeof cadAnnotationSchema>;
export const cadAnnotationsSchema = z.array(cadAnnotationSchema);

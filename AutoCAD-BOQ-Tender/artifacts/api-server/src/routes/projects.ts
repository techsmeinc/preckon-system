import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, documentsTable, boqItemsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { CreateProjectBody } from "@workspace/api-zod";
import { quantityConfidence } from "../lib/estimator-style";

const router = Router();

// GET /projects/stats - dashboard stats (must be before /:id)
router.get("/projects/stats", async (req, res) => {
  try {
    const [projectStats] = await db
      .select({
        totalProjects: sql<number>`cast(count(*) as signed)`,
        processingProjects: sql<number>`cast(sum(case when status = 'processing' then 1 else 0 end) as signed)`,
        completedProjects: sql<number>`cast(sum(case when status = 'completed' then 1 else 0 end) as signed)`,
      })
      .from(projectsTable);

    const [documentStats] = await db
      .select({ totalDocuments: sql<number>`cast(count(*) as signed)` })
      .from(documentsTable);

    const [boqStats] = await db
      .select({ totalBoqItems: sql<number>`cast(count(*) as signed)` })
      .from(boqItemsTable);

    const recentProjects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.archived, 0))   // hide archived/inactive projects from the dashboard
      .orderBy(desc(projectsTable.createdAt))
      .limit(5);

    const projectsWithCounts = await Promise.all(
      recentProjects.map(async (p) => {
        const [docCount] = await db
          .select({ count: sql<number>`cast(count(*) as signed)` })
          .from(documentsTable)
          .where(eq(documentsTable.projectId, p.id));
        const [boqCount] = await db
          .select({ count: sql<number>`cast(count(*) as signed)`, total: sql<string>`cast(coalesce(sum(total_price), 0) as char)` })
          .from(boqItemsTable)
          .where(eq(boqItemsTable.projectId, p.id));
        return {
          ...p,
          documentCount: Number(docCount?.count ?? 0),
          boqItemCount: Number(boqCount?.count ?? 0),
          totalCost: boqCount?.total ? parseFloat(boqCount.total) : null,
        };
      })
    );

    res.json({
      totalProjects: Number(projectStats?.totalProjects ?? 0),
      totalDocuments: Number(documentStats?.totalDocuments ?? 0),
      totalBoqItems: Number(boqStats?.totalBoqItems ?? 0),
      processingProjects: Number(projectStats?.processingProjects ?? 0),
      completedProjects: Number(projectStats?.completedProjects ?? 0),
      recentProjects: projectsWithCounts,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /projects
router.get("/projects", async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
    const projectsWithCounts = await Promise.all(
      projects.map(async (p) => {
        const [docCount] = await db
          .select({ count: sql<number>`cast(count(*) as signed)` })
          .from(documentsTable)
          .where(eq(documentsTable.projectId, p.id));
        const [boqCount] = await db
          .select({ count: sql<number>`cast(count(*) as signed)`, total: sql<string>`cast(coalesce(sum(total_price), 0) as char)` })
          .from(boqItemsTable)
          .where(eq(boqItemsTable.projectId, p.id));
        return {
          ...p,
          documentCount: Number(docCount?.count ?? 0),
          boqItemCount: Number(boqCount?.count ?? 0),
          totalCost: boqCount?.total ? parseFloat(boqCount.total) : null,
        };
      })
    );
    res.json(projectsWithCounts);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects
router.post("/projects", async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const d = parsed.data;
    const blankToNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
    const [{ id: newId }] = await db
      .insert(projectsTable)
      .values({
        name: d.name,
        description: d.description,
        location: blankToNull(d.location),
        client: blankToNull(d.client),
        quotationRef: blankToNull(d.quotationRef),
        submissionDate: blankToNull(d.submissionDate),
      })
      .$returningId();
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, newId));
    res.status(201).json({ ...project, documentCount: 0, boqItemCount: 0, totalCost: null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /projects/:id
router.get("/projects/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    const documents = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
    const rawBoqItems = await db.select().from(boqItemsTable).where(eq(boqItemsTable.projectId, id));
    // Attach the LIVE evidence confidence so the UI matches the export (single
    // source of truth) instead of reading a possibly-stale conf:TBD note tag.
    const boqItems = rawBoqItems.map(it => {
      const confidence = quantityConfidence({
        description: it.description, category: it.category, unit: it.unit, notes: it.notes,
        quantity: it.quantity, drawingRefCount: Array.isArray(it.drawingReferences) ? (it.drawingReferences as unknown[]).length : 0,
      });
      return { ...it, confidence, isTbd: confidence === "TBD" };
    });
    res.json({ ...project, documents, boqItems });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /projects/:id
// Updates editable project fields. Currently used to save the BOQ/tender export
// details (location, client, quotation ref, submission date) that get stamped on
// the exported Bill of Quantities meta block, plus name/description.
router.patch("/projects/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const body = req.body ?? {};
    const update: Record<string, unknown> = {};
    // Whitelist the editable string fields. Empty string clears the value (null).
    const str = (v: unknown) => (typeof v === "string" ? (v.trim() || null) : undefined);
    for (const key of ["name", "description", "location", "client", "quotationRef", "submissionDate"] as const) {
      if (key in body) {
        const v = str(body[key]);
        // "name" is NOT NULL — ignore an attempt to blank it.
        if (key === "name" && (v === null || v === undefined)) continue;
        update[key] = v;
      }
    }
    // archived: 0 = active, 1 = inactive/hidden. Accepts boolean or 0/1.
    if ("archived" in body) update.archived = body.archived ? 1 : 0;
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }
    update.updatedAt = new Date();
    await db.update(projectsTable).set(update).where(eq(projectsTable.id, id));
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    res.json(project);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /projects/:id
router.delete("/projects/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

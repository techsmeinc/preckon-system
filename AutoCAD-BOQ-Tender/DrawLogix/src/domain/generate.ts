import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type DesignConstruction, extractDesignFromDocuments } from "@/ai/agent";
import { db, schema, type ScheduleRow } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { deriveSchedule, extractRequirements } from "./concept";
import {
  buildProjectDxf,
  buildProjectSvg,
  type Construction,
  DEFAULT_CONSTRUCTION,
  encodeConstruction,
  type Floor,
  floorLabel,
  floorsFromSchedule,
} from "./drafting";
import { type Envelope, resolvePlan, solveFloorPlan } from "./floorplan";
import { buildFreeformDxf, buildFreeformSvg } from "./freeform";

/** Look up a project's name for the drawing title block (best-effort). */
async function projectName(orgId: string, projectId: string): Promise<string> {
  const row = (
    await db.select({ name: schema.drawingProjects.name }).from(schema.drawingProjects).where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId))).limit(1)
  )[0];
  return row?.name ?? "DrawLogix Concept";
}

/**
 * Generate (or regenerate) the concept for a project from its documents. Replaces the
 * project's prior requirements + drawings so re-running is idempotent. Produces one
 * concept_plan drawing (SVG + DXF + area schedule) in the `ai_generated` state.
 */
export async function generateConcept(orgId: string, projectId: string) {
  const docs = await db
    .select({ id: schema.drawingDocuments.id, content: schema.drawingDocuments.content })
    .from(schema.drawingDocuments)
    .where(
      and(
        eq(schema.drawingDocuments.orgId, orgId),
        eq(schema.drawingDocuments.projectId, projectId),
        isNull(schema.drawingDocuments.archivedAt),
      ),
    );

  if (docs.length === 0) throw new Error("Add at least one document before generating a concept");

  const requirements = extractRequirements(docs);
  const baseRooms = deriveSchedule(requirements);
  const schedule = solveFloorPlan(baseRooms.map((s) => ({ name: s.room, areaSqm: s.areaSqm, requirementRef: s.requirementRef })));
  const name = await projectName(orgId, projectId);
  const floors: Floor[] = [{ label: floorLabel(1), plan: resolvePlan(schedule) }];
  const svg = buildProjectSvg(floors, DEFAULT_CONSTRUCTION, name);
  const dxf = buildProjectDxf(floors, DEFAULT_CONSTRUCTION, name);
  const traceability = [encodeConstruction(DEFAULT_CONSTRUCTION), ...new Set(schedule.map((s) => s.requirementRef).filter((r): r is string => Boolean(r)))];
  const drawingId = randomUUID();

  await withTenant(orgId, async (tx) => {
    // Replace prior generated artifacts for this project (idempotent regenerate).
    await tx.delete(schema.drawingRequirements).where(and(eq(schema.drawingRequirements.orgId, orgId), eq(schema.drawingRequirements.projectId, projectId)));
    await tx.delete(schema.drawings).where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId)));

    for (const r of requirements) {
      await tx.insert(schema.drawingRequirements).values({
        id: randomUUID(),
        orgId,
        projectId,
        ref: r.ref,
        seq: r.seq,
        category: r.category,
        title: r.title,
        detail: r.detail ?? null,
        sourceDocumentId: r.sourceDocumentId ?? null,
      });
    }

    await tx.insert(schema.drawings).values({
      id: drawingId,
      orgId,
      projectId,
      title: "Concept Floor Plan",
      kind: "concept_plan",
      lifecycleState: "ai_generated",
      svg,
      dxf,
      schedule,
      traceability,
      aiConfidence: "0.820",
      generationMethod: "rule_based_concept",
    });

    await tx
      .update(schema.drawingProjects)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)));
  });

  return { drawingId, requirements: requirements.length, rooms: schedule.length };
}

/**
 * AI generation: Claude READS the project's documents, extracts categorised
 * requirements + a room programme grounded in them, and we render + persist the
 * concept (with each space traced to the requirement it satisfies). Same DXF/SVG/IFC
 * pipeline as the rule-based path — just a far better understanding of the brief.
 */
export async function generateConceptAI(orgId: string, projectId: string) {
  const docs = await db
    .select({
      name: schema.drawingDocuments.name,
      docType: schema.drawingDocuments.docType,
      content: schema.drawingDocuments.content,
    })
    .from(schema.drawingDocuments)
    .where(
      and(
        eq(schema.drawingDocuments.orgId, orgId),
        eq(schema.drawingDocuments.projectId, projectId),
        isNull(schema.drawingDocuments.archivedAt),
      ),
    );

  if (docs.length === 0) throw new Error("Add at least one document before generating a concept");

  let result: Awaited<ReturnType<typeof extractDesignFromDocuments>>;
  try {
    result = await extractDesignFromDocuments(docs.map((d) => ({ name: d.name, docType: d.docType, content: d.content ?? "" })));
  } catch {
    // AI tier failed (e.g. unreadable docs) — fall back to rule-based so the user still gets a plan.
    return generateConcept(orgId, projectId);
  }

  // Freeform path: Claude chose a schematic / site plan / detail rather than a room plan.
  if (result.mode === "freeform") {
    const svg = buildFreeformSvg(result.entities, result.title);
    const dxf = buildFreeformDxf(result.entities, result.title);
    const drawingId = randomUUID();
    await withTenant(orgId, async (tx) => {
      await tx.delete(schema.drawingRequirements).where(and(eq(schema.drawingRequirements.orgId, orgId), eq(schema.drawingRequirements.projectId, projectId)));
      await tx.delete(schema.drawings).where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId)));
      await tx.insert(schema.drawings).values({
        id: drawingId,
        orgId,
        projectId,
        title: result.title || "Concept Drawing",
        kind: "freeform_sketch",
        lifecycleState: "ai_generated",
        svg,
        dxf,
        // Store the raw primitives (not ScheduleRow[]) so the CAD exporter can rebuild a
        // professional DXF/DWG from source geometry.
        schedule: result.entities as unknown as ScheduleRow[],
        traceability: [],
        aiConfidence: "0.850",
        generationMethod: "ai_freeform",
      });
      await tx
        .update(schema.drawingProjects)
        .set({ status: "ready", updatedAt: new Date() })
        .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)));
    });
    return { drawingId, requirements: 0, rooms: 0 };
  }

  const design = result.design;
  // If the AI couldn't find a programme in the documents, fall back rather than error out.
  if (design.rooms.length === 0) return generateConcept(orgId, projectId);

  // Solve ONE plan per storey (corridor spine, true areas, doors, windows). Honour the
  // stated footprint (shared across floors so they stack), expand repeats, nest en-suites.
  const dc: DesignConstruction = design.construction;
  const envelope: Envelope | undefined = design.footprint
    ? { widthAcross: Math.min(design.footprint.widthM, design.footprint.lengthM), lengthAlong: Math.max(design.footprint.widthM, design.footprint.lengthM) }
    : undefined;

  const byFloor = new Map<number, typeof design.rooms>();
  for (const r of design.rooms) {
    const fl = Math.min(Math.max(1, Math.round(r.floor ?? 1)), Math.max(1, dc.storeys));
    if (!byFloor.has(fl)) byFloor.set(fl, []);
    byFloor.get(fl)?.push(r);
  }

  const floors: Floor[] = [];
  const schedule: ScheduleRow[] = [];
  for (const n of [...byFloor.keys()].sort((a, b) => a - b)) {
    const solved = solveFloorPlan(
      (byFloor.get(n) ?? []).map((r) => ({
        name: r.name,
        areaSqm: r.areaSqm,
        kind: r.kind,
        connectsTo: r.connectsTo,
        requirementRef: r.requirementRef,
        count: r.count,
        ensuiteSqm: r.ensuiteSqm,
      })),
      envelope,
    );
    if (solved.length === 0) continue;
    for (const row of solved) schedule.push({ ...row, floor: n });
    floors.push({ label: floorLabel(n), plan: resolvePlan(solved) });
  }
  if (floors.length === 0) throw new Error("Couldn't lay out a plan from these documents — add more detail to the brief.");

  const construction: Construction = { extWallMm: dc.extWallMm, intWallMm: dc.intWallMm, floorToFloorM: dc.floorToFloorM, unit: dc.unit, storeys: floors.length };
  const name = await projectName(orgId, projectId);
  const svg = buildProjectSvg(floors, construction, name);
  const dxf = buildProjectDxf(floors, construction, name);
  const traceability = [encodeConstruction(construction), ...new Set(schedule.map((s) => s.requirementRef).filter((r): r is string => Boolean(r)))];
  const drawingId = randomUUID();

  await withTenant(orgId, async (tx) => {
    await tx.delete(schema.drawingRequirements).where(and(eq(schema.drawingRequirements.orgId, orgId), eq(schema.drawingRequirements.projectId, projectId)));
    await tx.delete(schema.drawings).where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId)));

    let seq = 0;
    for (const r of design.requirements) {
      seq += 1;
      await tx.insert(schema.drawingRequirements).values({
        id: randomUUID(),
        orgId,
        projectId,
        ref: r.ref,
        seq,
        category: r.category,
        title: r.title,
        detail: r.detail ?? null,
        sourceDocumentId: null,
      });
    }

    await tx.insert(schema.drawings).values({
      id: drawingId,
      orgId,
      projectId,
      title: floors.length > 1 ? `Concept Floor Plans (${floors.length} storeys)` : "Concept Floor Plan",
      kind: "concept_plan",
      lifecycleState: "ai_generated",
      svg,
      dxf,
      schedule,
      traceability,
      aiConfidence: "0.880",
      generationMethod: "ai_document_understanding",
    });

    await tx
      .update(schema.drawingProjects)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)));
  });

  return { drawingId, requirements: design.requirements.length, rooms: schedule.length };
}

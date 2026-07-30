import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type ScheduleRow } from "@/db/client";
import { withTenant } from "@/db/tenant";
import {
  buildFreeformSheetDxf,
  buildFreeformSheetSvg,
  buildProjectDxf,
  buildProjectSvg,
  decodeConstruction,
  encodeConstruction,
  floorsFromSchedule,
  freeformConstruction,
} from "./drafting";
import { type DxfModel, modelToSvg, serializeModel } from "./dxf-model";
import { solveFloorPlan } from "./floorplan";

/**
 * Re-render a schedule (SVG + DXF, AutoCAD-grade via the drafting engine) and upsert it
 * as the project's concept drawing. Reuses the construction params persisted on the
 * existing drawing (walls/units) so copilot edits keep the same standard; groups the
 * schedule by `floor` so multi-storey drawings survive a re-render. Shared by the AI
 * copilot and design-from-brief flows.
 */
export async function saveConcept(orgId: string, projectId: string, scheduleInput: ScheduleRow[]): Promise<string> {
  // Keep the caller's geometry when it's already a solved plan (the architect agent
  // solves footprint/count/en-suites/adjacency itself — re-solving here would drop
  // them). Only re-solve a bare area schedule (legacy / area-only input).
  const alreadySolved = scheduleInput.length > 0 && scheduleInput.every((s) => typeof s.w === "number" && (s.w as number) > 0);
  const schedule = alreadySolved
    ? scheduleInput
    : solveFloorPlan(scheduleInput.map((s) => ({ name: s.room, areaSqm: s.areaSqm, kind: s.kind, requirementRef: s.requirementRef })));

  return withTenant(orgId, async (tx) => {
    const existing = (
      await tx
        .select({ id: schema.drawings.id, traceability: schema.drawings.traceability })
        .from(schema.drawings)
        .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId), isNull(schema.drawings.archivedAt)))
        .orderBy(desc(schema.drawings.createdAt))
        .limit(1)
    )[0];

    const construction = decodeConstruction(existing?.traceability ?? null);
    const floors = floorsFromSchedule(schedule);
    const project = (await tx.select({ name: schema.drawingProjects.name }).from(schema.drawingProjects).where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId))).limit(1))[0];
    const name = project?.name ?? "DrawLogix Concept";
    const con = { ...construction, storeys: Math.max(1, floors.length) };
    const svg = buildProjectSvg(floors, con, name);
    const dxf = buildProjectDxf(floors, con, name);

    if (existing) {
      await tx
        .update(schema.drawings)
        .set({ schedule, svg, dxf, updatedAt: new Date() })
        .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.id, existing.id)));
      return existing.id;
    }

    const id = randomUUID();
    await tx.insert(schema.drawings).values({
      id,
      orgId,
      projectId,
      title: "Concept Floor Plan",
      kind: "concept_plan",
      lifecycleState: "ai_generated",
      svg,
      dxf,
      schedule,
      traceability: [encodeConstruction(con)],
      aiConfidence: "0.850",
      generationMethod: "ai_agent",
    });
    await tx
      .update(schema.drawingProjects)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(schema.drawingProjects.orgId, orgId), eq(schema.drawingProjects.id, projectId)));
    return id;
  });
}

/**
 * Re-render an edited freeform drawing (DXF + SVG from an editable DxfModel) and update
 * the project's latest drawing in place. Used by the modification assistant on freeform
 * (non-room-plan) drawings.
 */
/**
 * Persist a copilot GEOMETRY edit on ANY drawing: serialize the edited model back to DXF
 * and render it faithfully to SVG (every entity as-is — no sheet re-wrapping), then update
 * the project's latest drawing in place. This is what lets the AI copilot add/remove ANY
 * geometry on both floor plans and site plans and have the change show up.
 */
export async function saveDrawingGeometry(orgId: string, projectId: string, model: DxfModel): Promise<string> {
  const dxf = serializeModel(model);
  const svg = modelToSvg(model);
  return withTenant(orgId, async (tx) => {
    const existing = (
      await tx
        .select({ id: schema.drawings.id })
        .from(schema.drawings)
        .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId), isNull(schema.drawings.archivedAt)))
        .orderBy(desc(schema.drawings.createdAt))
        .limit(1)
    )[0];
    if (!existing) throw new Error("No drawing to edit — generate one first.");
    await tx.update(schema.drawings).set({ dxf, svg, updatedAt: new Date() }).where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.id, existing.id)));
    return existing.id;
  });
}

export async function saveFreeform(orgId: string, projectId: string, model: DxfModel): Promise<string> {
  const con = freeformConstruction(model);
  return withTenant(orgId, async (tx) => {
    const existing = (
      await tx
        .select({ id: schema.drawings.id, title: schema.drawings.title })
        .from(schema.drawings)
        .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.projectId, projectId), isNull(schema.drawings.archivedAt)))
        .orderBy(desc(schema.drawings.createdAt))
        .limit(1)
    )[0];
    if (!existing) throw new Error("No drawing to edit — generate one first.");
    const name = existing.title || "Concept Drawing";
    const dxf = buildFreeformSheetDxf(model, name, con);
    const svg = buildFreeformSheetSvg(model, name, con);
    await tx
      .update(schema.drawings)
      .set({ dxf, svg, updatedAt: new Date() })
      .where(and(eq(schema.drawings.orgId, orgId), eq(schema.drawings.id, existing.id)));
    return existing.id;
  });
}

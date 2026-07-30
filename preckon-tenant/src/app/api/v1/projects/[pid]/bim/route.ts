import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { errBadRequest } from "@/lib/errors";
import { emptyDocument } from "@/lib/bim/model";

// GET/PUT /projects/{pid}/bim — the BIM Studio model for a project.
//
// A working model, not a proposal: it is saved directly rather than going
// through the review queue (see db/migrations/004_bim_document.sql for why).
// The takeoff derived from it is what becomes a reviewable artifact.

export const GET = route<{ pid: string }>(async (_req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);
  const row = await queryOne<{ doc: any; version: number; updated_at: string }>(
    "SELECT doc, version, updated_at FROM bim_document WHERE tenant_id = ? AND project_id = ?",
    [ctx.tenantId, pid]
  );
  // A project that has never been modelled gets a fresh document with its
  // Ground Floor level, so the Studio always opens on something valid.
  if (!row) return ok({ doc: emptyDocument(), version: 0, updated_at: null });
  return ok({ doc: row.doc, version: row.version, updated_at: row.updated_at });
});

const Save = z.object({
  doc: z.object({
    elements: z.record(z.any()),
    order: z.array(z.string()),
    seq: z.number(),
    units: z.literal("m"),
  }),
  /** The version the client loaded. Omit only for a first save. */
  baseVersion: z.number().int().nonnegative().optional(),
});

export const PUT = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Save.parse(await req.json());

  const version = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const cur = await queryOne<{ version: number }>(
      "SELECT version FROM bim_document WHERE tenant_id = ? AND project_id = ? FOR UPDATE",
      [ctx.tenantId, pid]
    );
    // Optimistic concurrency: two people modelling the same project should get a
    // conflict they can act on, not a silent overwrite of each other's work.
    if (cur && body.baseVersion != null && body.baseVersion !== cur.version) {
      throw errBadRequest(
        `The model moved on (you have v${body.baseVersion}, the project is at v${cur.version}). Reload before saving.`
      );
    }
    const next = (cur?.version ?? 0) + 1;
    const json = JSON.stringify(body.doc);
    if (cur) {
      await query(
        "UPDATE bim_document SET doc = ?, version = ?, updated_by = ? WHERE tenant_id = ? AND project_id = ?",
        [json, next, ctx.user.id, ctx.tenantId, pid]
      );
    } else {
      await query(
        "INSERT INTO bim_document (project_id, tenant_id, doc, version, updated_by) VALUES (?,?,?,?,?)",
        [pid, ctx.tenantId, json, next, ctx.user.id]
      );
    }
    // One audit line per save, summarising the model — enough to reconstruct who
    // grew the model and when, without logging every keystroke.
    audit({
      action: "bim.save",
      targetKind: "bim_document",
      targetId: pid,
      projectId: pid,
      summary: { version: next, elements: body.doc.order.length },
    });
    return next;
  });

  return ok({ version });
});

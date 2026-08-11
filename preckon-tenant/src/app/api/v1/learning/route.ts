import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { errBadRequest } from "@/lib/errors";

// GET  /learning        — everything this workspace has learned from corrections
// PATCH /learning       — retire a lesson, or bring one back
//
// A lesson changes what the agents propose, so it has to be something a person
// can read and switch off. That is the whole argument for doing this with rows
// rather than by training a model: an estimator who disagrees with a learned
// rate can see it, see how many times it was applied, and retire it — none of
// which is possible once a preference is baked into weights.

export const GET = route(async (_req, ctx) => {
  requirePermission(ctx, "artifact.read");
  const rows = await query(
    `SELECT l.id, l.type_key, l.subject, l.field, l.was_value, l.now_value,
            l.times_seen, l.status, l.updated_at, p.name AS learned_on
       FROM learned_lesson l
       LEFT JOIN project p ON p.id = l.project_id
      WHERE l.tenant_id = ?
      ORDER BY l.status ASC, l.times_seen DESC, l.updated_at DESC
      LIMIT 500`,
    [ctx.tenantId]
  );
  return ok(rows);
});

const Patch = z.object({ id: z.string().min(1), status: z.enum(["active", "retired"]) });

export const PATCH = route(async (req, ctx) => {
  // Changing what the agents learn is a library-level act, not an everyday one.
  requirePermission(ctx, "library.manage");
  const { id, status } = Patch.parse(await req.json());
  // Retired rather than deleted on purpose - see the migration. A lesson that
  // turned out to be wrong is worth being able to look back at.
  const res = (await query(
    "UPDATE learned_lesson SET status = ?, updated_at = NOW(3) WHERE tenant_id = ? AND id = ?",
    [status, ctx.tenantId, id]
  )) as unknown as { affectedRows?: number };
  // An UPDATE returns a result header, not rows, so the object itself is always
  // truthy - checking it would have accepted any id at all and reported success
  // for a lesson that was never touched.
  if (!res?.affectedRows) throw errBadRequest("No such lesson");
  return ok({ id, status });
});

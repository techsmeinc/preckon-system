import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { query, queryOne } from "@/lib/db";
import { errBadRequest, errNotFound } from "@/lib/errors";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { editArtifact, emitArtifact } from "@/lib/store";
import { captureCorrections } from "@/lib/learning";

// PUT /projects/{pid}/boq/rate — put a rate on a bill line by hand.
//
// WHY THIS EXISTS
//
// Rates arrived one way: the estimate stage produced cost_line records and the
// bill read them back. A line the agents had not priced showed a dash, and
// there was nothing to do about it — an estimator who knew the rate could not
// enter it. On a bill of 97 lines waiting on a pricing run, that is most of the
// screen unusable for the person who actually knows the number.
//
// WHY IT IS NOT JUST POST /artifacts
//
// The amount. amount_minor must equal round(rate_minor x quantity), and that
// arithmetic belongs on the server for the same reason it was taken away from
// the model: a browser computing it can be a version behind on the quantity, or
// round differently, and a bill that does not add up is worse than one with a
// gap in it. Core holds the quantity, so Core does the multiplication.
//
// It also feeds the learning loop. A rate typed by a human on this project is
// exactly the sort of thing that should be offered on the next one.

const Body = z.object({
  code: z.string().min(1),
  // Minor units — cents, fils, paise. Integer on purpose: a rate held as a
  // float is a rounding error waiting to appear three stages downstream.
  rate_minor: z.number().int().min(0),
  currency: z.string().min(3).max(3).optional(),
});

export const PUT = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const body = Body.parse(await req.json());

  // The bill line being priced. Non-superseded, because a rate must attach to
  // the current version of a line and not to one somebody has since corrected.
  const line = await queryOne<{ id: string; type_key: string; payload: any }>(
    `SELECT id, type_key, payload FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%boq_line'
        AND status <> 'superseded'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.code')) = ?
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.tenantId, pid, body.code]
  );
  if (!line) throw errNotFound(`BOQ line ${body.code}`);

  const quantity = Number(line.payload?.quantity);
  if (!Number.isFinite(quantity)) throw errBadRequest(`BOQ line ${body.code} has no quantity to price against`);

  // Any existing rate for this code, so a second edit corrects rather than
  // duplicates — two cost lines against one bill line would double the total.
  const existing = await queryOne<{ id: string; type_key: string; payload: any }>(
    `SELECT id, type_key, payload FROM artifact
      WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%cost_line'
        AND status <> 'superseded'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.boq_code')) = ?
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.tenantId, pid, body.code]
  );

  // The currency of the bill, not of this line: a bill is priced in one
  // currency, and asking for it per line is how two end up in the same total.
  const currency =
    body.currency ??
    existing?.payload?.currency ??
    (await queryOne<{ ccy: string }>(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.currency')) AS ccy FROM artifact
        WHERE tenant_id = ? AND project_id = ? AND type_key LIKE '%cost_line'
          AND status <> 'superseded' AND JSON_EXTRACT(payload, '$.currency') IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenantId, pid]
    ))?.ccy ??
    "USD";

  const payload = {
    boq_code: body.code,
    rate_minor: body.rate_minor,
    amount_minor: Math.round(body.rate_minor * quantity),
    currency,
    // Says where it came from, so a reviewer reading the bill later can tell a
    // typed rate from a derived one without opening the trace.
    rate_source: "Manual",
    rate_book_ref: "entered by hand",
  };

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    if (existing) {
      // editArtifact supersedes, re-points downstream provenance, marks what
      // was derived from it stale — and captures the correction as a lesson.
      const r = await editArtifact(ctx.tenantId, existing.id, payload, ctx.user.id, audit);
      return { id: r.newId, replaced: existing.id, stale: r.staleIds.length };
    }
    const created = await emitArtifact(
      {
        tenantId: ctx.tenantId,
        projectId: pid,
        typeKey: costTypeFor(line.type_key),
        payload,
        source: "human",
        createdBy: ctx.user.id,
        // The rate is priced FROM this bill line, and saying so is what makes
        // the trace work and what marks this rate stale if the quantity moves.
        provenance: [line.id],
      },
      audit
    );
    return { id: created.id, replaced: null, stale: 0 };
  });

  /* A first rate is not a correction, so editArtifact never sees it — but it is
     still this contractor deciding what this work costs, which is precisely
     what the next project should be offered. Recorded as a lesson with no prior
     value, which is how it reads on the Library screen: "6.13 rate 118000". */
  if (!existing) {
    void captureCorrections(
      ctx.tenantId, pid, costTypeFor(line.type_key),
      { boq_code: body.code }, payload, ctx.user.id
    );
  }

  return ok(result);
});

/** The cost_line type key from this pack — derived from the bill line's own key
 *  rather than hardcoded, so a second vertical's pack keeps working. */
const costTypeFor = (boqTypeKey: string) => boqTypeKey.replace(/boq_line$/, "cost_line");

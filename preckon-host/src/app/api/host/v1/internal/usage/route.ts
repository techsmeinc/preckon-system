import { z } from "zod";
import { requireServiceAuth } from "@/lib/context";
import { pool, queryOne } from "@/lib/db";
import { errNotFound, errUnprocessable } from "@/lib/errors";
import { handle, ok, parseBody } from "@/lib/http";
import { newId } from "@/lib/ids";

const Body = z.object({
  tenant_id: z.string().min(1),
  feature_key: z.string().min(1),
  quantity: z.number().positive(),
  occurred_at: z.string().min(1),
  idempotency_key: z.string().min(1),
  subscription_id: z.string().min(1).nullable().optional(),
});

// POST /internal/usage — service-auth metered usage ingestion (§7.3, §7.6).
// Exactly-once via the UNIQUE idempotency_key: retries collide and no-op.
export const POST = handle(async (req) => {
  requireServiceAuth(req);
  const body = await parseBody(req, Body);

  const feature = await queryOne<{ id: string; type: string }>(
    "SELECT id, type FROM feature WHERE `key` = ?",
    [body.feature_key]
  );
  if (!feature) throw errNotFound("Feature");
  if (feature.type !== "metric")
    throw errUnprocessable(`Feature '${body.feature_key}' is not a metric`, { type: feature.type });

  try {
    await pool.query(
      `INSERT INTO usage_record
         (id, tenant_id, feature_id, subscription_id, quantity, occurred_at, idempotency_key, metadata)
       VALUES (?,?,?,?,?,?,?, JSON_OBJECT())`,
      [newId(), body.tenant_id, feature.id, body.subscription_id ?? null,
        body.quantity, body.occurred_at, body.idempotency_key]
    );
  } catch (err: any) {
    // Duplicate idempotency_key → already ingested. Exactly-once no-op success.
    if (err?.code === "ER_DUP_ENTRY" || err?.errno === 1062) {
      return ok({ accepted: true, duplicate: true }, 202);
    }
    throw err;
  }

  return ok({ accepted: true }, 202);
});

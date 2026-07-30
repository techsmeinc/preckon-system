import { createHash } from "crypto";
import { getAuthContext, requirePermission } from "@/lib/context";
import { query } from "@/lib/db";
import { handle, ok, q } from "@/lib/http";

interface ChainRow {
  seq: number | string;
  ts: string; // CAST(UNIX_TIMESTAMP(occurred_at) AS CHAR)
  actor_host_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_tenant_id: string | null;
  metadata_str: string; // CAST(metadata AS CHAR)
  prev_hash: string | null;
  hash: string;
}

// GET /audit-events/verify — re-walk the hash chain in seq order and re-derive each row's
// hash exactly as append_audit_event does, comparing to the stored hash. Optional ?from&?to. (§2.4)
export const GET = handle(async (req) => {
  const ctx = await getAuthContext(req);
  requirePermission(ctx, "audit.read");

  const where: string[] = [];
  const params: any[] = [];
  const from = q(req, "from");
  const to = q(req, "to");
  if (from) (where.push("occurred_at >= ?"), params.push(from));
  if (to) (where.push("occurred_at <= ?"), params.push(to));
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  // Fetch the exact string forms MySQL used inside the stored procedure so the
  // canonical string (and therefore SHA-256) matches byte-for-byte.
  const rows = await query<ChainRow>(
    `SELECT seq,
            CAST(UNIX_TIMESTAMP(occurred_at) AS CHAR) AS ts,
            actor_host_user_id, action, target_type, target_id, target_tenant_id,
            CAST(metadata AS CHAR) AS metadata_str,
            prev_hash, hash
       FROM audit_event
       ${whereSql}
      ORDER BY seq ASC`,
    params
  );

  for (const r of rows) {
    // CONCAT_WS('|', ...) with every argument COALESCE'd to a non-null string.
    const canon = [
      String(r.seq),
      r.ts,
      r.actor_host_user_id ?? "",
      r.action,
      r.target_type ?? "",
      r.target_id ?? "",
      r.target_tenant_id ?? "",
      r.metadata_str,
      r.prev_hash ?? "",
    ].join("|");
    const expected = createHash("sha256").update(canon, "utf8").digest("hex");
    if (expected !== r.hash) {
      return ok({ ok: false, first_broken_seq: Number(r.seq) });
    }
  }

  return ok({ ok: true });
});

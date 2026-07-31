// Retire a project's artifacts so a demo starts from a clean chain.
//
// Why supersede rather than DELETE: an artifact is a link in a provenance chain,
// and downstream records point at it. Deleting one leaves a BOQ line whose
// measurement no longer exists, which is worse than a stale record — it is an
// unexplained gap. Superseding is what the runtime itself does when work is
// redone: the record stops counting as live, stays queryable, and its lineage
// survives. One audit entry records the whole sweep and why.
//
//   node scripts/retire-artifacts.mjs --project <pid>
//   node scripts/retire-artifacts.mjs --project <pid> --before 2026-07-31
//   node scripts/retire-artifacts.mjs --project <pid> --dry-run
//
// --before is the common case: it retires everything a project accumulated
// before a cutoff — e.g. output from the deterministic stub agents that ran
// before a real API key was configured — while leaving today's real work alone.

import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const projectId = flag("project");
const before = flag("before");
const dryRun = has("dry-run");
const reason = flag("reason", before ? `retired: superseded by work after ${before}` : "retired: chain reset");

if (!projectId) {
  console.error("usage: node scripts/retire-artifacts.mjs --project <pid> [--before YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3308),
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "preckon",
  database: process.env.DATABASE_NAME ?? "preckon_tenant",
});

const where = ["project_id = ?", "status <> 'superseded'"];
const params = [projectId];
if (before) {
  where.push("created_at < ?");
  params.push(before);
}

const [rows] = await conn.execute(
  `SELECT tenant_id, type_key, status, COUNT(*) n
     FROM artifact WHERE ${where.join(" AND ")}
    GROUP BY tenant_id, type_key, status ORDER BY type_key`,
  params
);

if (rows.length === 0) {
  console.log("Nothing to retire — no live artifacts match.");
  await conn.end();
  process.exit(0);
}

const total = rows.reduce((t, r) => t + Number(r.n), 0);
const tenantId = rows[0].tenant_id;
console.log(`${dryRun ? "Would retire" : "Retiring"} ${total} artifact(s) on project ${projectId}${before ? ` created before ${before}` : ""}:`);
for (const r of rows) console.log(`  ${String(r.type_key).padEnd(22)} ${String(r.status).padEnd(10)} ${r.n}`);

if (dryRun) {
  console.log("\n--dry-run — nothing changed.");
  await conn.end();
  process.exit(0);
}

await conn.beginTransaction();
try {
  const [res] = await conn.execute(
    `UPDATE artifact SET status = 'superseded', updated_at = NOW(3) WHERE ${where.join(" AND ")}`,
    params
  );

  // Append through the stored procedure, never by hand. It locks the tenant's
  // chain head FOR UPDATE and computes the hash over its own canonical form —
  // a hand-rolled INSERT would produce a hash `verify` then rejects, and an
  // AFTER trigger forbids the direct write anyway.
  await conn.query("CALL append_audit_event(?,?,?,?,?,?,?,?,?)", [
    randomUUID(),
    tenantId,
    "system",
    null,
    "artifact.retire",
    "project",
    projectId,
    projectId,
    JSON.stringify({
      retired: res.affectedRows,
      before: before ?? null,
      reason,
      by_type: rows.map((r) => ({ type: r.type_key, status: r.status, n: Number(r.n) })),
    }),
  ]);

  await conn.commit();
  console.log(`\nRetired ${res.affectedRows}. Audit entry written (artifact.retire).`);
} catch (err) {
  await conn.rollback();
  console.error("Rolled back:", err.message);
  process.exitCode = 1;
}

await conn.end();

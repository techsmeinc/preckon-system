// Apply every migration in db/migrations, in order.
//
// The schema file runs once, when the database volume is first created.
// Migrations have only ever been applied by hand, which works right up until
// somebody deploys code that reads a column nobody added — at which point the
// projects list returns nothing and the cause is three layers away from the
// symptom.
//
// Every migration in this project is written to be re-runnable (each ALTER is
// guarded on information_schema), so this can be run on every deploy without
// bookkeeping. It applies them in filename order and stops at the first real
// failure rather than carrying on into a half-migrated schema.
//
//   node scripts/migrate.mjs            apply everything
//   node scripts/migrate.mjs --dry      list what would run
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const DIR = path.join(process.cwd(), "db", "migrations");
const dry = process.argv.includes("--dry");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run this where the app runs, or export it first.");
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
if (!files.length) {
  console.log("No migrations found.");
  process.exit(0);
}

console.log(`${files.length} migration(s) in ${DIR}\n`);
if (dry) {
  for (const f of files) console.log("  would run  " + f);
  process.exit(0);
}

// multipleStatements: a migration is a script, not a statement — the guarded
// ALTERs here are PREPARE/EXECUTE/DEALLOCATE triples.
const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
let failed = 0;

for (const f of files) {
  const sql = fs.readFileSync(path.join(DIR, f), "utf8");
  try {
    await conn.query(sql);
    console.log(`  ok        ${f}`);
  } catch (e) {
    failed++;
    console.error(`  FAILED    ${f}\n            ${e.message}`);
    break;   // a half-migrated schema is worse than an unmigrated one
  }
}

await conn.end();
if (failed) {
  console.error("\nStopped. Fix the migration above and run again — they are all re-runnable.");
  process.exit(1);
}
console.log("\nSchema is up to date.");

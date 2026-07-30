// Imports db/schema.sql (and db/seed.sql unless --schema-only) into MySQL/MariaDB.
// Usage:
//   node scripts/db-import.mjs            # schema + seed
//   node scripts/db-import.mjs --seed-only
//   node scripts/db-import.mjs --schema-only
// Reads connection from .env. You can also import the .sql files directly via
// phpMyAdmin → Import; this script is a convenience.
//
// The schema uses `DELIMITER $$` for the audit stored procedure + triggers.
// `DELIMITER` is a client directive, not server SQL, so we parse it here and
// send each statement on its own — works on MySQL 8 and MariaDB (XAMPP) alike.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const seedOnly = args.includes("--seed-only");
const schemaOnly = args.includes("--schema-only");

// Split a .sql file into individual statements, honoring DELIMITER directives
// and skipping full-line comments. Good enough for our controlled SQL.
function splitStatements(sql) {
  const out = [];
  let delimiter = ";";
  let buf = "";
  for (const rawLine of sql.split(/\r?\n/)) {
    // Strip inline `-- ` comments (whitespace-preceded, so hex '#...' and
    // '--' inside string literals are untouched — our SQL has none of those).
    const line = rawLine.replace(/(^|\s)--\s.*$/, "$1").replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("--") || trimmed.startsWith("#")) continue;
    const dm = trimmed.match(/^DELIMITER\s+(\S+)$/i);
    if (dm) {
      delimiter = dm[1];
      continue;
    }
    buf += line + "\n";
    // statement ends when the trimmed buffer ends with the active delimiter
    const b = buf.trimEnd();
    if (b.endsWith(delimiter)) {
      const stmt = b.slice(0, b.length - delimiter.length).trim();
      if (stmt) out.push(stmt);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  multipleStatements: false,
});

async function runFile(name) {
  const sql = readFileSync(join(root, "db", name), "utf8");
  const statements = splitStatements(sql);
  process.stdout.write(`→ importing db/${name} (${statements.length} statements) ... `);
  for (const stmt of statements) await conn.query(stmt);
  console.log("done");
}

try {
  if (!seedOnly) await runFile("schema.sql");
  if (!schemaOnly) await runFile("seed.sql");
  console.log("\n✔ Database ready. Next: npm run seed:owner");
} catch (err) {
  console.error("\n✖ Import failed:", err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}

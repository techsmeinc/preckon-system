#!/usr/bin/env node
// Drop + recreate the target MySQL database, then push the Drizzle schema.
//
// Use this when:
//   - You're setting up the app for the first time.
//   - `drizzle-kit push --force` blocks on an FK-constraint TRUNCATE error
//     (MySQL won't truncate a table that's referenced by a FK from another).
//
// DESTRUCTIVE: wipes all data in the target database.
//
// Reads the same env vars as the rest of the dev workflow:
//   $env:DATABASE_URL = "mysql://root@localhost:3306/boq_tender"  # default

import mysql from "mysql2/promise";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "mysql://root@localhost:3306/boq_tender";

let parsed;
try {
  parsed = new URL(DATABASE_URL);
} catch {
  console.error(`Could not parse DATABASE_URL: ${DATABASE_URL}`);
  process.exit(1);
}

const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!dbName) {
  console.error("DATABASE_URL must include a database name (e.g. /boq_tender).");
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username || "root"),
  password: parsed.password ? decodeURIComponent(parsed.password) : "",
  multipleStatements: true,
});

console.log(`Dropping and recreating database "${dbName}" on ${parsed.hostname}:${parsed.port || 3306}...`);
await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
await conn.query(
  `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await conn.end();
console.log(`Database "${dbName}" recreated.\n`);

console.log("Pushing Drizzle schema...");
const child = spawn(
  "pnpm",
  [
    "--filter",
    "@workspace/db",
    "exec",
    "drizzle-kit",
    "push",
    "--force",
    "--config",
    "./drizzle.config.ts",
  ],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));

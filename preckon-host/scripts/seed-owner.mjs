// Creates the first OWNER staff account (Better Auth credential + host_user).
// The dev server must be running (npm run dev) so Better Auth can hash + store
// the credential through its own pipeline.
//
//   OWNER_EMAIL=you@techsme.com OWNER_PASSWORD='at-least-12-chars' npm run seed:owner
//
// Defaults: admin@techsme.com / preckon-admin-2026

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { uuidv7 } from "uuidv7";

dotenv.config();

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const email = (process.env.OWNER_EMAIL ?? "admin@techsme.com").toLowerCase();
const password = process.env.OWNER_PASSWORD ?? "preckon-admin-2026";
const name = process.env.OWNER_NAME ?? "Platform Owner";

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  database: process.env.DATABASE_NAME ?? "preckon_host",
});

async function ensureAuthUser() {
  // Try to create via Better Auth sign-up (hashes the password correctly).
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    // Better Auth CSRF-checks the Origin against BETTER_AUTH_URL.
    headers: { "content-type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password, name }),
  }).catch((e) => {
    throw new Error(
      `Could not reach ${BASE}. Is the dev server running (npm run dev)?  (${e.message})`
    );
  });

  if (res.ok) {
    const data = await res.json();
    return data.user?.id;
  }
  // Already exists → look it up.
  const [rows] = await conn.query("SELECT id FROM `user` WHERE email = ?", [email]);
  if (rows[0]) {
    console.log("• Auth user already exists, reusing it.");
    return rows[0].id;
  }
  throw new Error(`Sign-up failed (${res.status}): ${await res.text()}`);
}

try {
  const authUserId = await ensureAuthUser();
  const [ownerRole] = await conn.query("SELECT id FROM host_role WHERE `key` = 'owner'");
  if (!ownerRole[0]) throw new Error("owner role missing — run the seed first (npm run db:seed)");

  const [existing] = await conn.query("SELECT id FROM host_user WHERE auth_user_id = ?", [
    authUserId,
  ]);
  if (existing[0]) {
    await conn.query("UPDATE host_user SET role_id = ?, status = 'active' WHERE id = ?", [
      ownerRole[0].id,
      existing[0].id,
    ]);
    console.log("✔ Existing host_user promoted to Owner.");
  } else {
    await conn.query(
      "INSERT INTO host_user (id, auth_user_id, email, display_name, role_id, status, two_factor_enabled) VALUES (?,?,?,?,?,'active',FALSE)",
      [uuidv7(), authUserId, email, name, ownerRole[0].id]
    );
    console.log("✔ Owner host_user created.");
  }
  console.log(`\n  Sign in at ${BASE}  →  ${email} / ${password}`);
} catch (err) {
  console.error("✖", err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}

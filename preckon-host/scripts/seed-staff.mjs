// Creates demo STAFF host users (Admin role) with a known password, so the
// control-plane logins are reproducible. Mirrors seed-owner.mjs. The app must be
// running so Better Auth can hash + store the credential.
//
//   node scripts/seed-staff.mjs        (defaults below)
//
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { uuidv7 } from "uuidv7";

dotenv.config();
const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const PASSWORD = process.env.STAFF_PASSWORD ?? "preckon-2026";
const ROLE = process.env.STAFF_ROLE ?? "admin";

// Demo staff (operator domain). Add/remove entries here.
const STAFF = [
  { email: "shruthi@techsme.com", name: "Shruthi" },
  { email: "pranavi@techsme.com", name: "Pranavi" },
];

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  database: process.env.DATABASE_NAME ?? "preckon_host",
});

async function ensureAuthUser(email, name) {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  }).catch((e) => { throw new Error(`Could not reach ${BASE} — is the app running? (${e.message})`); });
  if (res.ok) return (await res.json()).user?.id;
  const [rows] = await conn.query("SELECT id FROM `user` WHERE email = ?", [email]);
  if (rows[0]) return rows[0].id;
  throw new Error(`Sign-up failed for ${email} (${res.status}): ${await res.text()}`);
}

try {
  const [role] = await conn.query("SELECT id FROM host_role WHERE `key` = ?", [ROLE]);
  if (!role[0]) throw new Error(`role '${ROLE}' missing — run the base seed first`);
  for (const s of STAFF) {
    const email = s.email.toLowerCase();
    const authUserId = await ensureAuthUser(email, s.name);
    const [existing] = await conn.query("SELECT id FROM host_user WHERE email = ?", [email]);
    if (existing[0]) {
      await conn.query("UPDATE host_user SET role_id = ?, status = 'active', display_name = ? WHERE id = ?", [role[0].id, s.name, existing[0].id]);
    } else {
      await conn.query(
        "INSERT INTO host_user (id, auth_user_id, email, display_name, role_id, status, two_factor_enabled) VALUES (?,?,?,?,?,'active',FALSE)",
        [uuidv7(), authUserId, email, s.name, role[0].id]
      );
    }
    console.log(`✔ ${s.name}  →  ${email} / ${PASSWORD}  (${ROLE})`);
  }
} catch (err) {
  console.error("✖", err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}

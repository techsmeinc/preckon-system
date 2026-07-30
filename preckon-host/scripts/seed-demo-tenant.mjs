// Registers the demo "Riverside" tenant in the Host control plane using the SAME
// tenant id the tenant plane seeded (00000000-…-01), so the Host lists and manages
// the very tenant you log into at :3100. Idempotent.
//
//   node scripts/seed-demo-tenant.mjs
//
// Env: DATABASE_HOST/PORT/USER/PASSWORD/NAME (defaults suit the docker db on :3307
// when run from the host machine).

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const TENANT_ID = "00000000-0000-7000-8000-000000000001"; // must match the tenant plane
const SLUG = "riverside";
const NAME = "Riverside Construction (demo)";
const EMAIL = "owner@riverside.build";
const REGION = "ca-central";

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER ?? "root",
  password: process.env.DATABASE_PASSWORD ?? "",
  database: process.env.DATABASE_NAME ?? "preckon_host",
});

try {
  const [eds] = await conn.query(
    "SELECT id, `key` FROM edition WHERE status = 'published' ORDER BY sort_order LIMIT 1"
  );
  if (!eds[0]) throw new Error("No published edition — run the host seed (npm run db:seed) first.");
  const editionId = eds[0].id;

  const [existing] = await conn.query("SELECT id FROM tenant WHERE id = ?", [TENANT_ID]);
  if (existing[0]) {
    await conn.query(
      "UPDATE tenant SET name = ?, primary_contact_email = ?, current_edition_id = ?, status = 'active' WHERE id = ?",
      [NAME, EMAIL, editionId, TENANT_ID]
    );
    console.log("• Demo tenant already registered — refreshed.");
  } else {
    // slug is unique; if a different tenant took 'riverside', suffix it.
    let slug = SLUG;
    const [slugTaken] = await conn.query("SELECT id FROM tenant WHERE slug = ?", [slug]);
    if (slugTaken[0]) slug = `${SLUG}-demo`;
    await conn.query(
      `INSERT INTO tenant (id, slug, name, status, region, current_edition_id, primary_contact_email)
       VALUES (?,?,?, 'active', ?, ?, ?)`,
      [TENANT_ID, slug, NAME, REGION, editionId, EMAIL]
    );
    await conn.query(
      "INSERT IGNORE INTO tenant_theme (tenant_id, theme_tokens) VALUES (?, JSON_OBJECT())",
      [TENANT_ID]
    );
    console.log(`✔ Demo tenant registered in the Host (edition ${eds[0].key}).`);
  }
  console.log(`  Host now lists: ${NAME}  →  ${EMAIL}  (id ${TENANT_ID})`);
} catch (err) {
  console.error("✖", err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}

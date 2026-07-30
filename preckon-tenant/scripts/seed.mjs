import "dotenv/config";
import { pool } from "../src/lib/db.ts";
import { seedCatalog } from "../src/lib/provisioning.ts";

// Construction-only base seed: registers the construction pack catalog. The sole
// demo tenant — AIGCC Group — is provisioned over HTTP by scripts/seed-aigcc.mjs
// once the app is up (it also seeds the team, library and a live pursuit portfolio).
async function main() {
  await seedCatalog();
  console.log("✓ catalog + construction pack registered");
  console.log("\nNext (app must be up): node scripts/seed-aigcc.mjs   → the AIGCC Group demo tenant");
  await pool.end();
  console.log("\nSeed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

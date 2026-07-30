import { defineConfig } from "drizzle-kit";

// Defaults to the local XAMPP MySQL used by the dev workflow.
// Override by setting DATABASE_URL in your shell, e.g.
//   $env:DATABASE_URL = "mysql://user:pass@host:3306/dbname"
const url = process.env.DATABASE_URL ?? "mysql://root@localhost:3306/boq_tender";

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "mysql",
  dbCredentials: { url },
});

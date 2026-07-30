import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// §5.1 trust boundary — the worker is stateless and has NO store access. Here we
// assert that structurally: the worker package declares no database driver and
// the worker source imports no DB module. The property is enforced by
// construction, not convention.
const workerDir = path.resolve(__dirname, "../worker");

describe("worker trust boundary (§5.1)", () => {
  it("the worker package declares no database dependency", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(workerDir, "package.json"), "utf8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const forbidden of ["mysql2", "mysql", "pg", "better-auth", "drizzle-orm"]) {
      expect(deps[forbidden]).toBeUndefined();
    }
    expect(Object.keys(pkg.dependencies ?? {}).length).toBe(0);
  });

  it("the worker source imports no store/db module and no DB credentials", async () => {
    const files = ["src/server.mjs", "src/agents.mjs"];
    for (const f of files) {
      const src = await fs.readFile(path.join(workerDir, f), "utf8");
      expect(src).not.toMatch(/mysql2|from ["'].*\/lib\/db|DATABASE_PASSWORD|DATABASE_USER/);
    }
  });
});

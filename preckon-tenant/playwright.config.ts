import { defineConfig } from "@playwright/test";

// Drives the running tenant app (docker: http://localhost:3100). Bring the stack
// up first:  docker compose up -d  &&  docker compose run --rm seed
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    headless: true,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
});

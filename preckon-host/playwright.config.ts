import { defineConfig, devices } from "@playwright/test";

// Playwright drives a real Next.js dev server. The auth UI tests below only
// exercise client-rendered pages (login, forgot-password, reset-password) so
// they run green without a live MySQL / seeded user. Full sign-in flows that
// hit the DB live behind the `@db` tag — run them once your database is up.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // `next dev` compiles each route on first hit; under parallel load a cold
  // compile can take a while, so give navigations generous headroom.
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

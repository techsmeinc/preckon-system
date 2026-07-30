// Warm the dev server before the suite runs. `next dev` compiles each route on
// its first request; doing that here (outside any per-test timeout) means tests
// hit already-compiled routes and don't race a cold compile.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = ["/", "/forgot-password", "/reset-password?token=warmup"];

export default async function globalSetup() {
  for (const route of ROUTES) {
    try {
      await fetch(BASE + route, { method: "GET" });
    } catch {
      // Server not ready yet / transient — tests will surface real failures.
    }
  }
}

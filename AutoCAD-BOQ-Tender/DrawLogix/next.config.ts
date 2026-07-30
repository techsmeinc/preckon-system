import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Server Actions carry a CSRF check: Next compares the request's Origin against its
// own host and aborts on a mismatch. We are ALWAYS reached through a proxy that
// rewrites Host to this app's own :3001 while Origin stays the portal's — so every
// action POST fails ("Invalid Server Actions request") unless the portal's origin is
// declared trusted here. Values are host[:port], no scheme.
const allowedOrigins = [
  // The Vite dev portal that proxies /drawlogix → :3001.
  "localhost:5173",
  "127.0.0.1:5173",
  // Production: nginx serves the portal at this host and proxies /drawlogix through.
  "74.208.182.201",
  // Escape hatch for other origins the portal is reached on (LAN IP during dev,
  // a real domain later): DRAWLOGIX_ALLOWED_ORIGINS=host:port,host:port
  ...(process.env.DRAWLOGIX_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const config: NextConfig = {
  reactStrictMode: true,
  // Served UNDER /drawlogix so TenderLogix (Vite on :5173) proxies this whole app at
  // ONE origin — the user only ever uses :5173, never :3001 directly. Next auto-
  // prefixes assets, server actions and navigation; DrawLogix uses server actions
  // only (no hardcoded absolute fetches), so nothing breaks under the path.
  basePath: "/drawlogix",
  // This app lives next to a pnpm workspace; pin its own root so Next doesn't infer
  // the parent lockfile as the tracing root.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  experimental: {
    serverActions: {
      // Bulk document uploads (many large PDFs) — allow a big server-action body.
      bodySizeLimit: "100mb",
      allowedOrigins,
    },
  },
};

export default config;

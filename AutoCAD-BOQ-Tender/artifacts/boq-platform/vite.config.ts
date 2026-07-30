import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      // Pure, browser-safe CPM engine shared with the API server. Aliased to the
      // file directly so we never resolve `@workspace/db`'s root (which imports
      // mysql2 and would break the bundle).
      "@workspace/db/schedule-cpm": path.resolve(import.meta.dirname, "..", "..", "lib", "db", "src", "schedule-cpm.ts"),
      // Pure work-calendar engine (weekends/holidays/leave + cost math), shared
      // with the API server. Aliased to the file directly for the same reason.
      "@workspace/db/calendar-engine": path.resolve(import.meta.dirname, "..", "..", "lib", "db", "src", "calendar-engine.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:5000",
        changeOrigin: true,
      },
      // DrawLogix is a separate Next.js app (the /DrawLogix concept studio) with
      // basePath "/drawlogix", running on :3001. Proxy it so it's reachable at THIS
      // origin (:5173/drawlogix) — the DrawLogix tab iframes it same-origin and the
      // user never touches :3001. `ws` carries Next's HMR socket in dev.
      "/drawlogix": {
        target: process.env.DRAWLOGIX_URL ?? "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

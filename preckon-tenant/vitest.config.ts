import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // shared DB — run test files serially
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});

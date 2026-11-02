import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    env: { PGLITE_DIR: "memory://" },
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/sandbox/**/*.test.ts", "src/**/*.test.ts"],
    // Unit tests always use the PayPal simulator, even with sandbox keys in the environment
    // (tests/sandbox talks to the sandbox client directly).
    env: { PGLITE_DIR: "memory://", PAYPAL_MODE: "sim" },
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});

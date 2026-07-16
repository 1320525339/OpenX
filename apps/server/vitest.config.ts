import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    pool: "vmThreads",
    fileParallelism: true,
  },
});

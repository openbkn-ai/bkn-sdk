import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // E2E (real backend) lives behind a separate entry, not part of `vitest run`.
    exclude: ["test/e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
  },
});

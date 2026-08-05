import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // E2E (real backend) lives behind a separate entry, not part of `vitest run`.
    exclude: ["test/e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
    // `tlsFetch` detours to undici's fetch whenever a request needs a
    // dispatcher; this keeps those requests observable through the global stub.
    setupFiles: ["test/setup/undici-passthrough.ts"],
  },
});

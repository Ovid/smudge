import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      exclude: ["**/coverage/**", "**/dist/**", "**/*.config.*", "**/node_modules/**", "**/__tests__/**"],
    },
    projects: ["packages/shared", "packages/server", "packages/client"],
  },
});

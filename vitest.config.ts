import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      exclude: [
        "**/coverage/**",
        "**/dist/**",
        "**/*.config.*",
        "**/node_modules/**",
        "**/__tests__/**",
        "**/src/main.tsx",
        "**/src/index.ts",
        "**/vite-env.d.ts",
        "**/types.ts",
        "**/*.types.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 90,
        lines: 95,
      },
    },
    projects: ["packages/shared", "packages/server", "packages/client"],
  },
});

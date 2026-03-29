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
      ],
    },
    projects: ["packages/shared", "packages/server", "packages/client"],
  },
});

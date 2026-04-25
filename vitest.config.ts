import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap worker concurrency. Vitest defaults to os.cpus().length (10 on an
    // M-series laptop), which under `--coverage` pushes an otherwise-busy box
    // into swap thrash. Four keeps parallelism useful without blowing memory.
    // Covering both `forks` (the v3 default) and `threads` so the cap holds
    // regardless of which pool is active.
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
      threads: { maxThreads: 4, minThreads: 1 },
    },
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

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
        // Thin IO shell for `make ensure-native`: npm-rebuild spawn, fs copies,
        // child-process probe. The testable logic lives in scripts/native-cache.mjs
        // (kept under coverage). See the spec, "Coverage scope (Finding 1)".
        "scripts/ensure-native.mjs",
        // Thin IO shell for `make dep-cooldown`: registry fetch, fs cache,
        // process exit. The testable logic lives in scripts/dep-cooldown-core.mjs
        // (kept under coverage). Same precedent as ensure-native.mjs above; see
        // docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md.
        "scripts/dep-cooldown.mjs",
      ],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 90,
        lines: 95,
      },
    },
    projects: ["packages/shared", "packages/server", "packages/client", "scripts"],
  },
});

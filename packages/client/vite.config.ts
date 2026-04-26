import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Read ports from env so the e2e harness can run a parallel client/server
// pair on different ports without colliding with `make dev`. Defaults
// preserve the standard 5173 (client) / 3456 (server) pair. The e2e
// harness in playwright.config.ts sets SMUDGE_PORT and SMUDGE_CLIENT_PORT
// to test-only ports so an e2e run cannot touch the dev workflow's
// database.
//
// S1 (review 2026-04-26, follow-up): the canonical default is
// DEFAULT_SERVER_PORT in @smudge/shared/constants.ts. This file
// duplicates the literal 3456 because vite.config.ts is loaded by
// vite's CONFIG resolver (esbuild-compiled then run under Node ESM),
// and Node ESM cannot follow @smudge/shared's `main: ./src/index.ts`
// chain — the .ts re-exports don't carry explicit extensions. The
// server's index.ts imports the constant correctly; if you change it,
// update the literal here and the prose in CLAUDE.md too.
const clientPort = Number.parseInt(process.env.SMUDGE_CLIENT_PORT ?? "5173", 10);
const serverPort = Number.parseInt(process.env.SMUDGE_PORT ?? "3456", 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: clientPort,
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});

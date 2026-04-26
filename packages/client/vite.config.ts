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
// vite's CONFIG resolver, which falls back to bare Node ESM when
// resolving workspace dependencies — and Node ESM cannot follow
// @smudge/shared's `main: ./src/index.ts` chain because the .ts
// re-exports inside `src/index.ts` don't carry explicit extensions.
// S9 (review 2026-04-26): re-verified by patching this file to
// `import { DEFAULT_SERVER_PORT } from "@smudge/shared"` and running
// `npx vite build` from packages/client. Build aborted with
//
//   failed to load config from /workspace/packages/client/vite.config.ts
//   error during build:
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
//   '/workspace/packages/shared/src/schemas' imported from
//   '/workspace/packages/shared/src/index.ts'
//
// The server's index.ts imports the constant correctly (it runs under
// tsx, which DOES rewrite extensionless .ts imports). If you change
// the literal here, update CLAUDE.md and packages/server/src/index.ts
// too.
//
// R3 (review 2026-04-26): mirror the server's SMUDGE_PORT validation
// (packages/server/src/index.ts). A non-numeric override (typo in
// .env, shell variable accidentally set to a string, etc.) would
// otherwise produce NaN here and surface as a confusing Vite
// "address invalid" error far from the cause. Fail fast at config
// load with a message that names the env var and the bad value.
//
// S1 (review 2026-04-26): the canonical implementation lives in
// `@smudge/shared/parsePort` and is unit-tested there; vite.config
// duplicates it inline because the bare-Node-ESM constraint
// described above prevents importing it. The strict /^\d+$/ check
// rejects "3456abc" / "3456 # comment" / "3456kb" — Number.parseInt
// alone would accept those (parseInt extracts a leading numeric
// prefix), defeating the fail-fast intent. Keep this implementation
// in lockstep with shared/parsePort.ts; the test suite over there
// is the spec for both.
function parsePort(envName: "SMUDGE_CLIENT_PORT" | "SMUDGE_PORT", fallback: string): number {
  const raw = process.env[envName] ?? fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  // The /^\d+$/ guard above already restricts `trimmed` to a non-empty
  // pure-digit string, so Number.parseInt cannot return NaN or a non-
  // integer here. Only the [1, 65535] range remains to enforce.
  const port = Number.parseInt(trimmed, 10);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  return port;
}
const clientPort = parsePort("SMUDGE_CLIENT_PORT", "5173");
const serverPort = parsePort("SMUDGE_PORT", "3456");

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

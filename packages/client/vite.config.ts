import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Read ports from env so a future e2e harness can run a parallel
// client/server pair on different ports without colliding with `make dev`.
// Defaults preserve the standard 5173 (client) / 3456 (server) pair.
//
// As of this branch, playwright.config.ts hardcodes 3456/5173, sets no
// env, and uses reuseExistingServer — so the isolation rationale is
// forward-looking. Roadmap Phase 4b.6 (E2E Test Isolation) will wire
// SMUDGE_PORT, SMUDGE_CLIENT_PORT, and DB_PATH on the playwright side
// and make the rationale true.
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
// tsx, which DOES rewrite extensionless .ts imports). The canonical
// source is DEFAULT_SERVER_PORT in packages/shared/src/constants.ts;
// if you change the literal here, mirror it there (a parity test
// enforces equality — see the S3 block below) and update any docs
// that quote the port (CLAUDE.md).
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
// described above prevents importing it. The strict regex rejects
// "3456abc" / "3456 # comment" / "3456kb" — Number.parseInt alone
// would accept those (parseInt extracts a leading numeric prefix),
// defeating the fail-fast intent. Keep this implementation in
// lockstep with shared/parsePort.ts; the test suite over there is
// the spec for both.
// I1 (review 2026-04-26 039ca1b): the inline `parsePort` now uses
// the same `(raw, envName)` signature as the shared utility so the
// two function bodies are byte-for-byte comparable. The env-lookup
// happens at the call sites below, exactly as in the server's
// index.ts. Anyone replacing the inline copy with an import once a
// `./parsePort` sub-path export lands will not have to flip
// argument order at every call site.
// S1 (review 2026-04-26 039ca1b): the regex /^(0|[1-9]\d*)$/ also
// rejects leading-zero forms (`"0080"`, `"0123"`) because
// parseInt("0080", 10) is 80 — a stray octal-looking value would
// have silently bound to the wrong port. "0" itself is rejected by
// the range check below, not by the regex.
// S3 (review 2026-04-26 f346047): name the default explicitly so the
// proxy-target literal is not a bare "3456" buried in the call site.
// Must equal `DEFAULT_SERVER_PORT` in `packages/shared/src/constants.ts`
// — drift is invisible at runtime (the dev workflow's client→server
// proxy and the server's listen call would silently disagree), so
// any change to that constant must be mirrored here. A parity test
// in `packages/shared/src/__tests__/vite-config-default-port.test.ts`
// reads this file and asserts the literal equals
// `String(DEFAULT_SERVER_PORT)`. The literal is duplicated rather
// than imported because vite.config.ts loads under bare Node ESM,
// which cannot resolve @smudge/shared's extensionless re-exports
// inside `src/index.ts` (see comment block above).
const DEFAULT_SERVER_PORT_VITE = "3456";

function parsePort(raw: string, envName: string): number {
  const trimmed = raw.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  // The regex above already restricts `trimmed` to a canonical-decimal
  // non-empty digit string (no leading zeros except the literal "0"),
  // so Number.parseInt cannot return NaN or a non-integer here. Only
  // the [1, 65535] range remains to enforce — and "0" falls through to
  // the range error below rather than passing.
  const port = Number.parseInt(trimmed, 10);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  return port;
}
const clientPort = parsePort(process.env.SMUDGE_CLIENT_PORT ?? "5173", "SMUDGE_CLIENT_PORT");
const serverPort = parsePort(process.env.SMUDGE_PORT ?? DEFAULT_SERVER_PORT_VITE, "SMUDGE_PORT");

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

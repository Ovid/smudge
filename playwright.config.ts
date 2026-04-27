import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parsePort } from "@smudge/shared";

// E2e DB isolation. Pre-fix, playwright reused the dev server (port 3456)
// via `reuseExistingServer: true`, so e2e tests created and trashed
// fixtures in the developer's actual working database — every `make e2e`
// run polluted `packages/server/data/smudge.db` with thousands of test
// projects, and any human-authored project in that DB was at risk.
//
// Now: e2e starts its own server/client pair on dedicated ports, with
// DB_PATH and DATA_DIR pointing into a dedicated temp directory under
// `os.tmpdir()` (R7 review 2026-04-26: no automatic wipe — see the
// comment on the mkdirSync block below for why a destructive top-level
// side-effect is unsafe here). The dev workflow's DB is never touched.
const E2E_DATA_DIR = path.join(os.tmpdir(), "smudge-e2e-data");
const E2E_DB_PATH = path.join(E2E_DATA_DIR, "smudge.db");
const E2E_SERVER_PORT = "3457";
const E2E_CLIENT_PORT = "5174";

// Ensure the data dir exists before the server starts. Tests clean up
// after themselves (specs delete their fixtures in `test.afterEach`),
// so we don't wipe — a crashed-run cleanup can be done explicitly via
// `make e2e-clean`, which derives the path the same way this file does
// (R8 review 2026-04-26: previously hardcoded `/tmp/smudge-e2e-data`,
// which is wrong on macOS where `os.tmpdir()` resolves under
// `/var/folders/.../T/`). We deliberately do NOT rmSync here:
// playwright loads this config from multiple processes (main + each
// worker), so a destructive top-level side-effect can run after the
// server has finished writing, deleting the freshly-written DB.
//
// I4 (review 2026-04-26): if E2E_DATA_DIR exists as a regular file
// (stale leftover or developer mistake), mkdirSync raises ENOTDIR at
// the top of the config in every Playwright worker — opaque enough
// that the cause isn't discoverable from the stack. Detect and re-throw
// with an actionable message instead. ENOTDIR means an ancestor up to
// and including E2E_DATA_DIR is a non-directory; EEXIST under recursive
// mkdir can ONLY fire on the leaf (E2E_DATA_DIR/images existing as a
// non-directory), so each code names a different offender — telling the
// user to `rm E2E_DATA_DIR` for an EEXIST on the leaf would
// destructively remove the parent directory and any siblings.
//
// S5 (review 2026-04-26): Node sets `errno.path` to the actual offender
// for both ENOTDIR (the non-directory ancestor) and EEXIST (the leaf
// path). Use it for both branches so the suggested `rm` lands on the
// real conflict — telling the user to `rm $E2E_DATA_DIR` when ENOTDIR
// fired on an ancestor (e.g. /tmp/smudge-e2e-data is fine but /tmp is
// somehow a non-directory) would name the wrong path.
try {
  fs.mkdirSync(path.join(E2E_DATA_DIR, "images"), { recursive: true });
} catch (err) {
  const errno = err as NodeJS.ErrnoException;
  if (errno.code === "ENOTDIR") {
    const offender = errno.path ?? E2E_DATA_DIR;
    throw new Error(
      `playwright.config: expected a directory at or above ${E2E_DATA_DIR}, but a non-directory exists at ${offender}. ` +
        `Remove the conflicting non-directory (e.g. \`rm ${offender}\`) and re-run \`make e2e\`.`,
    );
  }
  if (errno.code === "EEXIST") {
    const offender = errno.path ?? path.join(E2E_DATA_DIR, "images");
    throw new Error(
      `playwright.config: expected a directory at ${offender}, but a non-directory file exists there. ` +
        `Remove the conflicting file (e.g. \`rm ${offender}\`) and re-run \`make e2e\`.`,
    );
  }
  throw err;
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  // I5 (review 2026-04-26): the webServer below binds a single SQLite DB
  // at one fixed port. Without an explicit cap, Playwright defaults to
  // os.cpus().length / 2 workers, all hammering the same DB — SQLite
  // serializes writes but cross-spec cleanup ordering is interleaved
  // (e.g. one spec's afterAll deletes a fixture mid-creation in
  // another). Pin workers: 1 so serialization matches the single-port
  // webServer design. If e2e wall time becomes a problem, shard
  // DB_PATH/E2E_SERVER_PORT/E2E_CLIENT_PORT per worker via
  // process.env.TEST_PARALLEL_INDEX instead of removing this cap.
  workers: 1,
  use: {
    baseURL: `http://localhost:${E2E_CLIENT_PORT}`,
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -w packages/server",
      port: parsePort(E2E_SERVER_PORT, "E2E_SERVER_PORT"),
      // Never reuse a running server — it would defeat the whole point
      // of the env override below, since the existing server has its
      // own DB_PATH/DATA_DIR baked in at startup.
      reuseExistingServer: false,
      env: {
        SMUDGE_PORT: E2E_SERVER_PORT,
        DB_PATH: E2E_DB_PATH,
        DATA_DIR: E2E_DATA_DIR,
      },
    },
    {
      command: "npm run dev -w packages/client",
      port: parsePort(E2E_CLIENT_PORT, "E2E_CLIENT_PORT"),
      reuseExistingServer: false,
      env: {
        // Vite reads these to set its dev port and proxy target so that
        // /api requests land on the e2e server (3457) rather than the
        // default dev server (3456).
        SMUDGE_PORT: E2E_SERVER_PORT,
        SMUDGE_CLIENT_PORT: E2E_CLIENT_PORT,
      },
    },
  ],
});

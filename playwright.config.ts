import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// E2e DB isolation. Pre-fix, playwright reused the dev server (port 3456)
// via `reuseExistingServer: true`, so e2e tests created and trashed
// fixtures in the developer's actual working database — every `make e2e`
// run polluted `packages/server/data/smudge.db` with thousands of test
// projects, and any human-authored project in that DB was at risk.
//
// Now: e2e starts its own server/client pair on dedicated ports, with
// DB_PATH and DATA_DIR pointing into a temp directory that is wiped at
// config load. The dev workflow's DB is never touched.
const E2E_DATA_DIR = path.join(os.tmpdir(), "smudge-e2e-data");
const E2E_DB_PATH = path.join(E2E_DATA_DIR, "smudge.db");
const E2E_SERVER_PORT = "3457";
const E2E_CLIENT_PORT = "5174";

// Ensure the data dir exists before the server starts. Tests clean up
// after themselves (each `afterAll` deletes its project), so we don't
// wipe — a crashed-run cleanup can be done explicitly via
// `rm -rf /tmp/smudge-e2e-data`. We deliberately do NOT rmSync here:
// playwright loads this config from multiple processes (main + each
// worker), so a destructive top-level side-effect can run after the
// server has finished writing, deleting the freshly-written DB.
fs.mkdirSync(path.join(E2E_DATA_DIR, "images"), { recursive: true });

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${E2E_CLIENT_PORT}`,
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -w packages/server",
      port: Number.parseInt(E2E_SERVER_PORT, 10),
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
      port: Number.parseInt(E2E_CLIENT_PORT, 10),
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

import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parsePort } from "@smudge/shared";
// Direct file import (not via @smudge/shared) because these helpers
// only matter for Node-side tooling; re-exporting them through
// shared/index.ts would pull node-only modules into the client's
// transitive load chain (Vite externalizes them and the eager
// top-level import throws on the React app).
import {
  findFirstNonDirectoryAncestor,
  formatMkdirDataDirError,
} from "./packages/shared/src/findDirectoryConflict";

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
//
// I6 (review 2026-04-27): namespace the dir by UID. On hosts without a
// sticky `/tmp` (some CI runners, BSDs without it, dev hosts that
// disabled the bit), a co-tenant could pre-create
// `/tmp/smudge-e2e-data` as a symlink to a sensitive directory before
// the victim ran `make e2e`; the e2e server would then write its
// SQLite DB and uploaded images into the link target (potentially
// clobbering files in the victim's home dir). Suffixing with the UID
// eliminates the cross-user collision case — an attacker would have
// to pre-create the per-UID name AND win a race against `make e2e`,
// which is materially harder than a single fixed-name pre-position.
// Windows has no `process.getuid`; fall back to the literal "shared"
// so the path resolves at all (the symlink-attack threat model is
// POSIX-specific).
const E2E_DATA_DIR = path.join(os.tmpdir(), `smudge-e2e-data-${process.getuid?.() ?? "shared"}`);
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
// I3 (review 2026-04-27): only mkdir E2E_DATA_DIR itself. The server
// creates `<DATA_DIR>/images/<projectId>/...` lazily on first upload
// (packages/server/src/images/images.service.ts: `mkdir(path.dirname(
// filePath), { recursive: true })`), so pre-creating `images/` here
// duplicates server work AND bakes a server-side layout name into the
// harness — if storage ever moves to `uploads/` or per-tenant dirs,
// the pre-creation silently keeps creating an obsolete `images/`.
//
// I4 (review 2026-04-26): if E2E_DATA_DIR exists as a regular file
// (stale leftover or developer mistake), mkdirSync raises an opaque
// errno at the top of the config in every Playwright worker — not
// discoverable from the stack. Detect and re-throw with an actionable
// message instead.
//
// Errno codes handled:
//   - ENOTDIR: an ancestor of E2E_DATA_DIR is a non-directory file
//     (Node sets `errno.path` to the requested leaf, NOT the offender,
//     so we walk ancestors via `findFirstNonDirectoryAncestor`).
//   - ENOENT: a dangling symlink ancestor (the symlink exists at the
//     link layer but its target does not).
//   - ELOOP: a cyclic symlink ancestor.
//   - EEXIST: under recursive mkdir, the leaf exists as a non-directory.
//
// C1 (review 2026-04-27): for ENOTDIR/ENOENT/ELOOP, Node's `errno.path`
// is the requested leaf — a phantom path that doesn't exist on disk.
// `findFirstNonDirectoryAncestor` does a stat/lstat walk to surface
// the actual offender (regular file, symlink-to-file, dangling symlink,
// or cyclic symlink) so the diagnostic message names something the
// user can act on.
//
// I2 + I7 + S7 + S9 + S11 (review 2026-04-27, third pass):
//   - I2: extend the catch to ENOENT and ELOOP (the helper handles
//     them; only the wiring was missing).
//   - I7: route the message through `formatMkdirDataDirError`, which
//     wraps every interpolated path in `JSON.stringify` to neutralize
//     control chars / ANSI / shell-substitution metachars in
//     attacker-controlled filenames. `/tmp` is mode-1777, so any local
//     user could pre-position a hostile name.
//   - S7: narrow `err instanceof Error && "code" in err` before the
//     errno cast so non-Error throws fall through to the original
//     `throw err` path with no message tampering.
//   - S9: errno.code is now part of the formatted message, so the
//     diagnostic survives without the original Error object.
//   - S11: the verb (`rm` vs `unlink`) reflects whether the offender
//     is a symlink — picked at the call site via `lstatSync`, passed
//     into the formatter so the formatter stays pure.
try {
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
} catch (err) {
  if (err instanceof Error && "code" in err) {
    const errno = err as NodeJS.ErrnoException;
    const ANCESTOR_CODES = new Set(["ENOTDIR", "ENOENT", "ELOOP"]);
    if (errno.code !== undefined && ANCESTOR_CODES.has(errno.code)) {
      const offender = findFirstNonDirectoryAncestor(E2E_DATA_DIR);
      let offenderIsSymlink = false;
      if (offender !== null) {
        try {
          offenderIsSymlink = fs.lstatSync(offender).isSymbolicLink();
        } catch {
          // The offender disappeared between the mkdir failure and our
          // lstat (concurrent cleanup, perhaps). Defaulting to
          // non-symlink yields `rm` in the message — slightly off if it
          // was a symlink, but the user's next step is to re-run
          // `make e2e` and the offender is gone anyway.
        }
      }
      throw new Error(
        formatMkdirDataDirError({
          errnoCode: errno.code,
          dataDir: E2E_DATA_DIR,
          offender,
          offenderIsSymlink,
        }),
      );
    }
    if (errno.code === "EEXIST") {
      let offenderIsSymlink = false;
      try {
        offenderIsSymlink = fs.lstatSync(E2E_DATA_DIR).isSymbolicLink();
      } catch {
        // unlikely after EEXIST but defensive
      }
      throw new Error(
        formatMkdirDataDirError({
          errnoCode: errno.code,
          dataDir: E2E_DATA_DIR,
          offender: E2E_DATA_DIR,
          offenderIsSymlink,
        }),
      );
    }
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
  // DB_PATH/E2E_SERVER_PORT/E2E_CLIENT_PORT/E2E_DATA_DIR per worker
  // via process.env.TEST_PARALLEL_INDEX instead of removing this cap.
  //
  // LAT1 (review 2026-04-27): the mkdirSync above runs at config-load
  // time in main + every worker. With workers: 1, that's 2 invocations
  // — recursive mkdir is race-safe in libuv (EEXIST during walk is
  // swallowed for recursive mode), so today the race is benign. If
  // workers > 1 lands, ensure E2E_DATA_DIR is sharded per worker too,
  // not just DB_PATH/PORT, so the catch block here doesn't have to
  // adjudicate between "another worker created it" and "a real
  // non-directory file blocks us."
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

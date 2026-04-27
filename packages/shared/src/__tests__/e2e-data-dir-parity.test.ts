import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// S3 (review 2026-04-27): the e2e isolated data dir name
// (`smudge-e2e-data` today) is duplicated between
// `playwright.config.ts` (which writes the DB) and `Makefile`'s
// `e2e-clean` target (which removes it). Drift means `make e2e-clean`
// silently no-ops on whatever `make e2e` actually wrote, with no test
// surface. Without an executable check, a maintainer renaming the dir
// in playwright.config.ts to namespace per-branch would pass
// typecheck, lint, and the full unit suite — yet `make e2e-clean`
// would still try to remove the old name. Mirror the textual parity
// pattern from `vite-config-default-port.test.ts`.
//
// S3 (review 2026-04-27, second pass): use matchAll + length===1 so a
// future commented-out historical example (e.g. "previously
// /tmp/smudge-e2e-data") cannot silently match before the live
// derivation. .match() returns the first hit; .matchAll() with a
// length assertion catches drift in either direction.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// I6 (review 2026-04-27): the dir name is now `smudge-e2e-data-<UID>`
// to namespace per-user on shared/CI hosts without sticky /tmp. We
// capture only the static prefix that precedes the UID interpolation
// (in playwright) or concatenation (in Makefile) — the dynamic UID
// portion is verified separately below.
const PLAYWRIGHT_DATA_DIR_RE = /path\.join\(\s*os\.tmpdir\(\),\s*`(smudge-e2e-data-)\$\{/g;
const MAKEFILE_DATA_DIR_RE = /require\("os"\)\.tmpdir\(\),\s*"(smudge-e2e-data-)"\s*\+/g;

// I1 (review 2026-04-27): E2E_SERVER_PORT (3457) was hardcoded in two
// places — `const E2E_SERVER_PORT = "3457"` in playwright.config.ts and
// `port:3457` in the Makefile e2e-clean net-probe — with no parity
// surface. A future change parameterizing the port (env var, per-worker
// shard) would update playwright.config.ts and pass the unit suite, yet
// `make e2e-clean`'s probe would still check 3457. If a new e2e port is
// bound, the probe sees ECONNREFUSED on 3457, concludes "no listener,"
// and `rm -rf` wipes the live data dir mid-run — exactly the failure
// mode S5 (the probe) was added to prevent.
const PLAYWRIGHT_PORT_RE = /E2E_SERVER_PORT\s*=\s*"(\d+)"/g;
// Anchor on the inline-node `PORT=NNN` constant inside the e2e-clean
// probe. After S2/S13 (review 2026-04-27) the probe targets multiple
// hosts, so the literal `port:3457` would appear more than once;
// pulling the literal into a single `PORT` constant keeps the parity
// surface anchored to one canonical assignment AND keeps the comment
// block at Makefile:171 from matching (it's prose, not `PORT=...`).
const MAKEFILE_PORT_RE = /\bPORT\s*=\s*(\d+)\b/g;

function findExactlyOne(
  re: RegExp,
  source: string,
  fileLabel: string,
  patternLabel: string,
): string {
  const matches = Array.from(source.matchAll(re));
  expect(
    matches.length,
    matches.length === 0
      ? `${patternLabel} not found in ${fileLabel} — was the derivation rewritten? Update this test to match.`
      : `${patternLabel} matched ${matches.length} times in ${fileLabel} — expected exactly one. Did a commented-out historical example sneak in?`,
  ).toBe(1);
  return matches[0]![1]!;
}

describe("E2E config parity (playwright.config.ts ↔ Makefile)", () => {
  const playwrightConfig = readFileSync(resolve(PROJECT_ROOT, "playwright.config.ts"), "utf8");
  const makefileText = readFileSync(resolve(PROJECT_ROOT, "Makefile"), "utf8");

  it("derives the same e2e temp dir name", () => {
    const playwrightDir = findExactlyOne(
      PLAYWRIGHT_DATA_DIR_RE,
      playwrightConfig,
      "playwright.config.ts",
      'E2E_DATA_DIR = path.join(os.tmpdir(), "<dir>")',
    );
    const makefileDir = findExactlyOne(
      MAKEFILE_DATA_DIR_RE,
      makefileText,
      "Makefile",
      'require("path").join(require("os").tmpdir(), "<dir>")',
    );
    expect(playwrightDir).toBe(makefileDir);
  });

  it("namespaces the e2e data dir by UID in both files", () => {
    // The derivation is `smudge-e2e-data-${uid}` on POSIX and
    // `smudge-e2e-data-shared` on platforms without process.getuid
    // (Windows).
    //
    // I6 (review 2026-04-27, third pass): the prior assertions were
    // two independent `toMatch` calls — one for `process.getuid`, one
    // for `"shared"`. The string `"shared"` already appears in
    // unrelated comments elsewhere; `process.getuid` could be moved
    // to a different expression while leaving the literals
    // semantically disconnected. Anchor on the FULL coalesce
    // expression so a future refactor that decouples uid from the
    // fallback breaks the assertion. Plus length === 1 via the
    // existing findExactlyOne to catch drift in either form.
    findExactlyOne(
      /process\.getuid\?\.\(\)\s*\?\?\s*"shared"/g,
      playwrightConfig,
      "playwright.config.ts",
      'process.getuid?.() ?? "shared" coalesce expression',
    );
    findExactlyOne(
      /process\.getuid\s*\?\s*process\.getuid\(\)\s*:\s*"shared"/g,
      makefileText,
      "Makefile",
      'process.getuid ? process.getuid() : "shared" ternary expression',
    );
  });

  it("e2e-clean probe NOLISTEN set covers transient unreachable codes (S1)", () => {
    // S1 (review 2026-04-27, third pass): some Linux configs and macOS
    // in transient network states emit EHOSTUNREACH on connect() to
    // ::1; ECONNRESET is possible on a peer-side close-without-listener.
    // Both should classify as "no listener" — fail-closed treats them
    // as probe errors and refuses to wipe, which is operator-nuisance
    // on transient routing flakes (an IPv6-stack reset by NetworkManager
    // is benign for our purposes).
    expect(makefileText).toMatch(/EHOSTUNREACH/);
    expect(makefileText).toMatch(/ECONNRESET/);
  });

  it("e2e-clean Promise.all chain has a .catch() to suppress raw stack traces (S8)", () => {
    // S8 (review 2026-04-27, third pass): pre-fix, sync throws inside
    // net.createConnection (theoretically reachable for malformed host
    // args) became UnhandledPromiseRejection to stderr — the recipe
    // still failed-closed but the curated "refusing to wipe" message
    // was preceded by a Node stack trace. Add `.catch(...)` so the
    // diagnostic output stays curated.
    const probeMatch = makefileText.match(/Promise\.all\s*\([^)]*\)[\s\S]*?\.catch\s*\(/);
    expect(probeMatch, "expected Promise.all(...).catch(...) chain in e2e-clean probe").toBeTruthy();
  });

  it("e2e-clean recipe enforces a TMPDIR-prefix allowlist before rm -rf (I8)", () => {
    // I8 (review 2026-04-27, third pass): os.tmpdir() honors $TMPDIR,
    // which is operator-controlled. A developer with TMPDIR=$HOME or
    // TMPDIR=/ would have `make e2e-clean` issue `rm -rf
    // "$HOME/smudge-e2e-data-1000"` or `rm -rf
    // "/smudge-e2e-data-1000"` — fat-finger hazard. Refuse with a
    // clear message unless the resolved DATA_DIR sits under one of the
    // canonical tmp roots.
    const eCleanMatch = makefileText.match(/^e2e-clean:[\s\S]*?(?=\n[a-zA-Z][\w-]*:)/m);
    expect(eCleanMatch, "e2e-clean recipe block").toBeTruthy();
    const recipe = eCleanMatch![0];
    // The allowlist must include the standard POSIX prefixes for
    // os.tmpdir() resolutions.
    expect(recipe).toMatch(/\/tmp\//);
    expect(recipe).toMatch(/\/var\/folders\//);
    expect(recipe).toMatch(/\/var\/tmp\//);
    // The allowlist must be enforced before `rm -rf` — there must be a
    // `case ... esac` (or equivalent guard) in the recipe.
    expect(recipe).toMatch(/case\s+"\$\$DATA_DIR"\s+in/);
  });

  it("uses the same E2E_SERVER_PORT", () => {
    const playwrightPort = findExactlyOne(
      PLAYWRIGHT_PORT_RE,
      playwrightConfig,
      "playwright.config.ts",
      'E2E_SERVER_PORT = "<port>"',
    );
    const makefilePort = findExactlyOne(
      MAKEFILE_PORT_RE,
      makefileText,
      "Makefile",
      "net.createConnection({port:<port>, ...}) in e2e-clean",
    );
    expect(playwrightPort).toBe(makefilePort);
  });
});

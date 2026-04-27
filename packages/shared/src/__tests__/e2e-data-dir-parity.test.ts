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

const PLAYWRIGHT_DATA_DIR_RE = /E2E_DATA_DIR\s*=\s*path\.join\(os\.tmpdir\(\),\s*"([^"]+)"\)/g;
const MAKEFILE_DATA_DIR_RE = /require\("path"\)\.join\(require\("os"\)\.tmpdir\(\),\s*"([^"]+)"\)/g;

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
// Anchor on the JS-code `net.createConnection({port:NNN,host:...})` so
// the regex does not match the comment block at line ~171 that
// references "3457, hardcoded in playwright.config.ts".
const MAKEFILE_PORT_RE = /net\.createConnection\(\{[^}]*\bport:(\d+)/g;

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
  return matches[0][1];
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
